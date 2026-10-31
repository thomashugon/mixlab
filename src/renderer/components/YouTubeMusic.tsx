// YouTube Music: install the helper, connect with the browser's request headers,
// browse playlists / liked songs / search, and fetch tracks into the library.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, CirclePlay, Download, FolderOpen, Heart, ListMusic, Loader2, LogOut, MoreHorizontal, RefreshCw, Search, X } from 'lucide-react';
import { useStore } from '../state/store';
import { isActive, ipcMessage, useYtm } from '../state/ytmStore';
import { fmtTime, plural } from '../lib/format';
import { Button, IconButton, Modal, ProgressRing, useContextMenu } from './ui';
import { Cover } from './Library';
import type { YtmAccount, YtmPlaylist, YtmSetupState, YtmStatus, YtmTrack } from '../../shared/api';

type View = { kind: 'playlist'; id: string; title: string } | { kind: 'search' };
const LIKED: YtmPlaylist = { id: 'LM', title: 'Titres likés', count: null, thumbnail: null };

export function YtmGlyph({ size = 16 }: { size?: number }) {
  return <CirclePlay size={size} className="ytm-glyph" />;
}

export function YouTubeMusicModal() {
  const open = useStore((s) => s.modal === 'ytmusic');
  const setModal = useStore((s) => s.setModal);
  const [status, setStatus] = useState<YtmStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try { setStatus(await window.mixlab.ytm.status()); setError(null); }
    catch (e) { setError(ipcMessage(e)); }
  }, []);
  useEffect(() => { if (open) void refresh(); }, [open, refresh]);

  const close = () => setModal(null);
  if (!open) return null;
  let body;
  if (error) body = <div className="ytm-state"><AlertTriangle size={18} className="tone-problem" /><p>{error}</p></div>;
  else if (!status) body = <div className="ytm-state"><Loader2 size={18} className="spin" /></div>;
  else if (!status.installed) body = <SetupStep status={status} onDone={refresh} />;
  else if (!status.connected) body = <ConnectStep onDone={refresh} />;
  else return <Browser onClose={close} onSignedOut={refresh} />;

  return (
    <Modal open={open} onClose={close} width={640} title={<><YtmGlyph size={20} /> YouTube Music</>} subtitle="Récupérez des morceaux de votre compte pour les mixer comme des fichiers locaux.">
      {body}
    </Modal>
  );
}

function SetupStep({ status, onDone }: { status: YtmStatus; onDone: () => void }) {
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<YtmSetupState[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => window.mixlab.ytm.onSetup((e) => setLog((l) => [...l.slice(-5), e])), []);
  const install = async () => {
    setRunning(true); setFailed(null); setLog([]);
    try { await window.mixlab.ytm.setup(); onDone(); }
    catch (e) { setFailed(ipcMessage(e)); }
    finally { setRunning(false); }
  };
  const py = status.python;
  return (
    <div className="field-stack">
      <p className="ytm-lead">MixLab utilise deux outils libres, installés dans un dossier privé de l’application : <strong>ytmusicapi</strong> pour lire votre bibliothèque et <strong>yt-dlp</strong> pour récupérer l’audio.</p>
      {!py.ok ? (
        <div className="ytm-note ytm-note-problem"><AlertTriangle size={15} /><span>{py.error}</span></div>
      ) : (
        <p className="hint">Python {py.version ?? ''} détecté. L’installation télécharge environ 60 Mo et prend une minute.</p>
      )}
      {(running || log.length > 0) && (
        <div className="ytm-log" role="log">
          {log.map((l, i) => <div key={i} className={l.stage === 'error' ? 'tone-problem' : l.stage === 'done' ? 'tone-ok' : ''}>{l.line}</div>)}
          {running && <div className="ytm-log-live"><Loader2 size={12} className="spin" /> En cours…</div>}
        </div>
      )}
      {failed && <div className="ytm-note ytm-note-problem"><AlertTriangle size={15} /><span>{failed}</span></div>}
      <div className="ytm-actions">
        <Button variant="primary" disabled={!py.ok || running} onClick={install} icon={running ? <Loader2 size={14} className="spin" /> : <Download size={14} />} data-testid="ytm-install">
          {running ? 'Installation…' : 'Installer'}
        </Button>
      </div>
    </div>
  );
}

function ConnectStep({ onDone }: { onDone: () => void }) {
  const [headers, setHeaders] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useStore((s) => s.toast);
  const connect = async () => {
    setBusy(true); setErr(null);
    try {
      const a = await window.mixlab.ytm.login(headers);
      toast({ kind: 'success', title: 'Connecté à YouTube Music', detail: a.name || a.handle || undefined });
      setHeaders('');
      onDone();
    } catch (e) { setErr(ipcMessage(e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="field-stack">
      <p className="ytm-lead">YouTube Music n’a pas de connexion officielle pour les applications : MixLab réutilise la session de votre navigateur. Une seule fois :</p>
      <ol className="ytm-steps">
        <li>Ouvrez <strong>music.youtube.com</strong> dans Chrome ou Firefox, connecté à votre compte.</li>
        <li>Ouvrez les outils de développement (<kbd>⌥⌘I</kbd>), onglet <strong>Réseau</strong>, et filtrez sur <code>browse</code>.</li>
        <li>Cliquez sur « Bibliothèque » dans YouTube Music, puis sur une requête <code>browse</code> de type POST.</li>
        <li>Copiez ses <strong>en-têtes de requête</strong> : Firefox, activez « Brut » puis copiez ; Chrome, faites un clic droit sur la requête → Copier → <em>Copier les en-têtes de requête</em>.</li>
        <li>Collez-les ici.</li>
      </ol>
      <textarea
        className="ytm-headers" value={headers} onChange={(e) => setHeaders(e.target.value)} spellCheck={false}
        placeholder={'accept: */*\ncookie: …\nx-goog-authuser: 0\n…'} aria-label="En-têtes de requête" data-testid="ytm-headers"
      />
      <p className="hint">Ces en-têtes contiennent vos cookies de session : ils restent sur cet ordinateur, dans le dossier de MixLab, et ne sont envoyés qu’à YouTube.</p>
      {err && <div className="ytm-note ytm-note-problem"><AlertTriangle size={15} /><span>{err}</span></div>}
      <div className="ytm-actions">
        <Button variant="primary" disabled={!headers.trim() || busy} onClick={connect} icon={busy ? <Loader2 size={14} className="spin" /> : undefined} data-testid="ytm-connect">
          Se connecter
        </Button>
      </div>
    </div>
  );
}

function Browser({ onClose, onSignedOut }: { onClose: () => void; onSignedOut: () => void }) {
  const toast = useStore((s) => s.toast);
  const items = useYtm((s) => s.items);
  const enqueue = useYtm((s) => s.enqueue);
  const cancel = useYtm((s) => s.cancel);
  const libFiles = useStore((s) => s.tracks);
  const menu = useContextMenu();
  const [account, setAccount] = useState<YtmAccount | null>(null);
  const [playlists, setPlaylists] = useState<YtmPlaylist[] | null>(null);
  const [view, setView] = useState<View>({ kind: 'playlist', id: LIKED.id, title: LIKED.title });
  const [tracks, setTracks] = useState<YtmTrack[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    window.mixlab.ytm.account().then(setAccount).catch(() => {});
    window.mixlab.ytm.playlists().then(setPlaylists).catch((e) => { setPlaylists([]); setErr(ipcMessage(e)); });
  }, []);

  const load = useCallback(async (fn: () => Promise<YtmTrack[]>) => {
    setLoading(true); setErr(null); setSelected(new Set());
    try { setTracks(await fn()); }
    catch (e) { setTracks([]); setErr(ipcMessage(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    if (view.kind === 'playlist') void load(async () => (await window.mixlab.ytm.playlist(view.id)).tracks);
    else setTracks(null);
  }, [view, load]);

  const runSearch = () => { if (query.trim()) void load(() => window.mixlab.ytm.search(query.trim())); };

  // A track counts as "in the library" when its downloaded file is one of the project's tracks.
  const inLibrary = useMemo(() => new Set(Object.values(libFiles).map((t) => t.fileName.replace(/\.m4a$/, ''))), [libFiles]);
  const selectable = (tracks ?? []).filter((t) => t.available);
  const allSelected = selectable.length > 0 && selectable.every((t) => selected.has(t.videoId));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const active = Object.values(items).filter(isActive);
  const chosen = selectable.filter((t) => selected.has(t.videoId));

  const fetchChosen = () => {
    void enqueue(chosen);
    setSelected(new Set());
    toast({ kind: 'info', title: `${plural(chosen.length, 'morceau ajouté', 'morceaux ajoutés')} à la file`, detail: 'Les morceaux arrivent dans la bibliothèque au fil des téléchargements.' });
  };
  const signOut = async () => {
    if (!confirm('Se déconnecter de YouTube Music ? Les morceaux déjà récupérés restent disponibles.')) return;
    await window.mixlab.ytm.logout();
    onSignedOut();
  };
  const update = async () => {
    setUpdating(true);
    try {
      await window.mixlab.ytm.setup(true);
      const v = await window.mixlab.ytm.versions();
      toast({ kind: 'success', title: 'Outils YouTube Music à jour', detail: Object.entries(v).map(([k, x]) => `${k} ${x}`).join(' · ') });
    } catch (e) { toast({ kind: 'error', title: 'Mise à jour impossible', detail: ipcMessage(e) }); }
    finally { setUpdating(false); }
  };

  const title = view.kind === 'search' ? 'Recherche' : view.title;
  return (
    <Modal
      open onClose={onClose} width={980}
      title={<><YtmGlyph size={20} /> YouTube Music</>}
      subtitle={account ? `Connecté : ${account.name || account.handle}` : 'Connecté'}
      footer={
        <>
          <p className="hint ytm-foot-hint">Usage personnel uniquement : les fichiers récupérés ne doivent pas être partagés, ni les mixes publiés.</p>
          {active.length > 0 && (
            <Button variant="ghost" size="sm" icon={<X size={14} />} onClick={() => void cancel()}>Arrêter ({active.length})</Button>
          )}
          <IconButton
            label="Options YouTube Music" size="sm"
            onClick={(e) => menu.open(e, [
              { label: updating ? 'Mise à jour…' : 'Mettre à jour yt-dlp et ytmusicapi', icon: <RefreshCw size={14} />, disabled: updating, onClick: () => void update() },
              { label: 'Afficher les fichiers récupérés', icon: <FolderOpen size={14} />, onClick: () => void window.mixlab.ytm.revealAudio() },
              { separator: true, label: '' },
              { label: 'Se déconnecter', icon: <LogOut size={14} />, danger: true, onClick: () => void signOut() },
            ])}
          >
            <MoreHorizontal size={16} />
          </IconButton>
          <Button variant="primary" disabled={!chosen.length} onClick={fetchChosen} icon={<Download size={14} />} data-testid="ytm-fetch">
            {chosen.length ? `Récupérer ${plural(chosen.length, 'morceau', 'morceaux')}` : 'Récupérer'}
          </Button>
        </>
      }
    >
      <div className="ytm-browser">
        <nav className="ytm-nav" aria-label="Bibliothèque YouTube Music">
          <button className={`ytm-nav-item ${view.kind === 'search' ? 'is-active' : ''}`} onClick={() => setView({ kind: 'search' })}><Search size={14} /> Rechercher</button>
          <button className={`ytm-nav-item ${view.kind === 'playlist' && view.id === LIKED.id ? 'is-active' : ''}`} onClick={() => setView({ kind: 'playlist', id: LIKED.id, title: LIKED.title })}><Heart size={14} /> Titres likés</button>
          <div className="ytm-nav-label">Playlists</div>
          {playlists === null ? <div className="ytm-nav-loading"><Loader2 size={13} className="spin" /></div>
            : playlists.length === 0 ? <div className="ytm-nav-empty">Aucune playlist</div>
            : playlists.map((p) => (
              <button key={p.id} className={`ytm-nav-item ${view.kind === 'playlist' && view.id === p.id ? 'is-active' : ''}`} onClick={() => setView({ kind: 'playlist', id: p.id, title: p.title })} title={p.title} data-testid="ytm-playlist">
                <ListMusic size={14} /><span className="ytm-nav-text">{p.title}</span>{p.count != null && <span className="ytm-nav-count num">{p.count}</span>}
              </button>
            ))}
        </nav>
        <section className="ytm-main">
          <header className="ytm-main-head">
            {view.kind === 'search' ? (
              <form className="search ytm-search" onSubmit={(e) => { e.preventDefault(); runSearch(); }}>
                <Search size={14} />
                <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Titre, artiste…" aria-label="Rechercher sur YouTube Music" data-testid="ytm-search" />
              </form>
            ) : <h3 className="ytm-main-title">{title}</h3>}
            {selectable.length > 0 && (
              <button className="ytm-select-all" onClick={() => setSelected(allSelected ? new Set() : new Set(selectable.map((t) => t.videoId)))}>
                {allSelected ? 'Tout désélectionner' : `Tout sélectionner (${selectable.length})`}
              </button>
            )}
          </header>
          <div className="ytm-list">
            {loading ? <div className="ytm-state"><Loader2 size={18} className="spin" /></div>
              : err ? <div className="ytm-note ytm-note-problem"><AlertTriangle size={15} /><span>{err}</span></div>
              : tracks === null ? <div className="ytm-state ytm-dim">Cherchez un titre ou un artiste.</div>
              : tracks.length === 0 ? <div className="ytm-state ytm-dim">Aucun morceau.</div>
              : tracks.map((t) => {
                const it = items[t.videoId];
                const here = inLibrary.has(t.videoId);
                return (
                  <label key={t.videoId} className={`ytm-row ${!t.available ? 'is-off' : ''} ${selected.has(t.videoId) ? 'is-selected' : ''}`} data-testid="ytm-track">
                    <input type="checkbox" disabled={!t.available} checked={selected.has(t.videoId)} onChange={() => toggle(t.videoId)} />
                    {t.thumbnail ? <img className="cover" src={t.thumbnail} alt="" width={34} height={34} style={{ borderRadius: 6 }} loading="lazy" referrerPolicy="no-referrer" /> : <Cover title={t.title} size={34} radius={6} />}
                    <div className="lib-main">
                      <div className="lib-title" title={t.title}>{t.title}</div>
                      <div className="lib-sub"><span className="lib-artist">{t.artists}{t.album ? ` · ${t.album}` : ''}</span></div>
                    </div>
                    <span className="ytm-row-state">
                      {it && isActive(it) ? <ProgressRing value={it.progress} indeterminate={it.status === 'queued'} size={16} />
                        : it?.status === 'error' ? <span title={it.error}><AlertTriangle size={15} className="tone-problem" /></span>
                        : here ? <span className="ytm-badge" title="Dans la bibliothèque du projet"><CheckCircle2 size={13} /> Bibliothèque</span>
                        : it?.status === 'done' || t.downloaded ? <span className="ytm-badge ytm-badge-dim" title="Déjà récupéré sur cet ordinateur">Récupéré</span>
                        : !t.available ? <span className="ytm-badge ytm-badge-dim">Indisponible</span> : null}
                    </span>
                    <span className="ytm-row-time num">{t.duration ? fmtTime(t.duration) : ''}</span>
                  </label>
                );
              })}
          </div>
        </section>
      </div>
      {menu.node}
    </Modal>
  );
}
