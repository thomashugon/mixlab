// YouTube Music source: a Python helper (ytmusicapi + yt-dlp) running in a private
// virtual environment under the app's data folder. Tracks are fetched as .m4a files
// that are then imported and analysed like any local file.

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import bridgeSource from './bridge.py';
import type { YtmSetupState, YtmStatus } from '../../shared/api';

const MIN_PY: [number, number] = [3, 10];
const PACKAGES = ['ytmusicapi', 'yt-dlp[default]', 'deno'];
const win = process.platform === 'win32';

export interface YtmOptions {
  dir: string;
  ffmpegDir: () => string | undefined;
  send: (channel: string, payload: unknown) => void;
}

type PyCmd = { cmd: string; args: string[] };

function pyVersion(c: PyCmd): [number, number] | null {
  try {
    const r = spawnSync(c.cmd, [...c.args, '-c', 'import sys;print("%d.%d" % sys.version_info[:2])'], { encoding: 'utf8', timeout: 8000 });
    if (r.status !== 0) return null;
    const [a, b] = r.stdout.trim().split('.').map(Number);
    return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null;
  } catch {
    return null;
  }
}

const recentEnough = (v: [number, number]) => v[0] > MIN_PY[0] || (v[0] === MIN_PY[0] && v[1] >= MIN_PY[1]);

/** A Python ≥ 3.10 to build the virtual environment with. */
export function findPython(): { ok: true; cmd: PyCmd; version: string } | { ok: false; error: string } {
  const c: PyCmd[] = [];
  if (process.env.MIXLAB_PYTHON) c.push({ cmd: process.env.MIXLAB_PYTHON, args: [] });
  if (win) {
    c.push({ cmd: 'py', args: ['-3'] }, { cmd: 'python', args: [] }, { cmd: 'python3', args: [] });
  } else {
    // Apps started from the Finder get a minimal PATH: look in the usual places first.
    // /usr/bin/python3 is left out on macOS: it is 3.9 and may open the developer tools installer.
    for (const d of ['/opt/homebrew/bin', '/usr/local/bin', '/Library/Frameworks/Python.framework/Versions/Current/bin']) {
      for (const v of ['python3.14', 'python3.13', 'python3.12', 'python3.11', 'python3.10', 'python3']) {
        const p = path.join(d, v);
        if (fs.existsSync(p)) c.push({ cmd: p, args: [] });
      }
    }
    c.push({ cmd: 'python3', args: [] });
  }
  let tooOld: string | null = null;
  for (const cand of c) {
    const v = pyVersion(cand);
    if (!v) continue;
    if (recentEnough(v)) return { ok: true, cmd: cand, version: v.join('.') };
    tooOld ??= `${cand.cmd} (${v.join('.')})`;
  }
  const how = win ? 'Installez Python 3.12 depuis python.org ou avec « winget install Python.Python.3.12 ».' : 'Installez-le avec Homebrew : « brew install python ».';
  return { ok: false, error: tooOld ? `Python ${MIN_PY.join('.')} ou plus récent est nécessaire, seul ${tooOld} a été trouvé. ${how}` : `Python ${MIN_PY.join('.')} ou plus récent est introuvable. ${how}` };
}

export class YouTubeMusic {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<void> | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private setupRun: Promise<void> | null = null;
  private stderrTail: string[] = [];

  constructor(private o: YtmOptions) {}

  private get venv() { return path.join(this.o.dir, 'venv'); }
  private get venvBin() { return path.join(this.venv, win ? 'Scripts' : 'bin'); }
  private get venvPython() { return process.env.MIXLAB_YTM_PYTHON || path.join(this.venvBin, win ? 'python.exe' : 'python3'); }
  private get marker() { return path.join(this.venv, '.mixlab-ready'); }
  get audioDir() { return path.join(this.o.dir, 'audio'); }
  private get fake() { return process.env.MIXLAB_YTM_FAKE === '1'; }

  installed(): boolean {
    if (process.env.MIXLAB_YTM_PYTHON) return true;
    return fs.existsSync(this.marker) && fs.existsSync(this.venvPython);
  }

  status(): YtmStatus {
    const installed = this.installed();
    const python = installed ? { ok: true as const } : (() => {
      const p = findPython();
      return p.ok ? { ok: true as const, version: p.version } : { ok: false as const, error: p.error };
    })();
    return {
      python,
      installed,
      connected: fs.existsSync(path.join(this.o.dir, 'browser.json')),
      audioDir: this.audioDir,
      fake: this.fake,
    };
  }

  private log(line: string, stage: YtmSetupState['stage'] = 'install') {
    this.o.send('ytm:setup', { stage, line } satisfies YtmSetupState);
  }

  /** Create (or refresh, with `upgrade`) the private environment with ytmusicapi, yt-dlp and deno. */
  setup(upgrade = false): Promise<void> {
    if (this.setupRun) return this.setupRun;
    this.setupRun = (async () => {
      try {
        if (process.env.MIXLAB_YTM_PYTHON) { this.log('Environnement Python fourni par MIXLAB_YTM_PYTHON.', 'done'); return; }
        fs.mkdirSync(this.o.dir, { recursive: true });
        if (!fs.existsSync(this.venvPython)) {
          const py = findPython();
          if (!py.ok) throw new Error(py.error);
          this.log(`Création de l’environnement avec Python ${py.version}…`);
          await this.run(py.cmd.cmd, [...py.cmd.args, '-m', 'venv', this.venv]);
        }
        this.log(upgrade ? 'Mise à jour de ytmusicapi et yt-dlp…' : 'Installation de ytmusicapi, yt-dlp et deno (environ 60 Mo)…');
        await this.run(this.venvPython, ['-m', 'pip', 'install', '--disable-pip-version-check', '--upgrade', ...PACKAGES]);
        fs.writeFileSync(this.marker, new Date().toISOString());
        this.stop(); // the next request starts the helper on the new packages
        this.log('Prêt.', 'done');
      } catch (e: any) {
        this.log(e?.message ?? String(e), 'error');
        throw e;
      } finally {
        this.setupRun = null;
      }
    })();
    return this.setupRun;
  }

  private run(cmd: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const p = spawn(cmd, args, { env: { ...process.env, PIP_NO_INPUT: '1', PYTHONUNBUFFERED: '1' } });
      const tail: string[] = [];
      const onLine = (l: string) => {
        const s = l.trim();
        if (!s) return;
        tail.push(s);
        if (tail.length > 12) tail.shift();
        if (/^(Collecting|Downloading|Installing|Successfully|Requirement already)/.test(s)) this.log(s);
      };
      readline.createInterface({ input: p.stdout }).on('line', onLine);
      readline.createInterface({ input: p.stderr }).on('line', onLine);
      p.on('error', (e) => reject(new Error(`Impossible de lancer ${cmd} : ${e.message}`)));
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Échec de l’installation (code ${code}).\n${tail.slice(-4).join('\n')}`))));
    });
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      if (!this.installed()) { reject(new Error('Les outils YouTube Music ne sont pas installés.')); return; }
      fs.mkdirSync(this.o.dir, { recursive: true });
      const script = path.join(this.o.dir, 'bridge.py');
      if (!fs.existsSync(script) || fs.readFileSync(script, 'utf8') !== bridgeSource) fs.writeFileSync(script, bridgeSource);
      const ffmpegDir = this.o.ffmpegDir();
      const deno = path.join(this.venvBin, win ? 'deno.exe' : 'deno');
      const proc = spawn(this.venvPython, ['-u', '-I', script], {
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          MIXLAB_YTM_DIR: this.o.dir,
          ...(ffmpegDir ? { MIXLAB_FFMPEG_DIR: ffmpegDir } : {}),
          ...(fs.existsSync(deno) ? { MIXLAB_DENO: deno } : {}),
          PATH: [this.venvBin, ffmpegDir, process.env.PATH].filter(Boolean).join(path.delimiter),
        },
      });
      this.proc = proc;
      let started = false;
      readline.createInterface({ input: proc.stdout }).on('line', (line) => {
        let m: any;
        try { m = JSON.parse(line); } catch { return; }
        if (m.event === 'ready') { started = true; resolve(); return; }
        if (m.event) { this.o.send(`ytm:${m.event}`, m); return; }
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (m.ok) p.resolve(m.result);
        else p.reject(new Error(m.error));
      });
      readline.createInterface({ input: proc.stderr }).on('line', (l) => {
        this.stderrTail.push(l);
        if (this.stderrTail.length > 20) this.stderrTail.shift();
        console.error('[ytmusic]', l);
      });
      proc.on('error', (e) => { if (!started) reject(e); });
      proc.on('exit', (code) => {
        const err = new Error(`Le module YouTube Music s’est arrêté (code ${code}). ${this.stderrTail.slice(-3).join(' ')}`.trim());
        if (!started) reject(err);
        for (const p of this.pending.values()) p.reject(err);
        this.pending.clear();
        if (this.proc === proc) { this.proc = null; this.ready = null; }
      });
    });
    this.ready.catch(() => { this.ready = null; });
    return this.ready;
  }

  async call<T = unknown>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
    await this.start();
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc!.stdin.write(JSON.stringify({ id, cmd, args }) + '\n');
    });
  }

  stop() {
    this.proc?.kill();
    this.proc = null;
    this.ready = null;
  }
}
