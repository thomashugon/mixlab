// Contract between the renderer and the main process (exposed by the preload as window.mixlab).

import type { MixPlan } from '../core/mix/plan';
import type { ExportOptions, ExportReport, ExportProgress } from '../core/export/exporter';
import type { ProjectFile, TrackAnalysis, TrackMeta } from '../core/types';

export interface InspectedFile {
  path: string;
  fileName: string;
  size: number;
  fingerprint: string;
  error?: string;
}

export interface AnalysisDone {
  id: string;
  meta: TrackMeta;
  analysis: TrackAnalysis;
  cacheDir: string;
  coverUrl: string | null;
  fromCache: boolean;
}

export interface AppInfo {
  version: string;
  platform: NodeJS.Platform;
  ffmpeg: { ok: boolean; path?: string; soxr?: boolean; error?: string };
  cacheDir: string;
  reducedMotion: boolean;
}

export interface OpenedProject {
  path: string;
  project: ProjectFile;
  exists: Record<string, boolean>;
}

// ---------- YouTube Music ----------

export interface YtmStatus {
  python: { ok: true; version?: string } | { ok: false; error: string };
  /** ytmusicapi, yt-dlp and deno are installed in MixLab's private environment. */
  installed: boolean;
  connected: boolean;
  audioDir: string;
  fake: boolean;
}

export interface YtmSetupState {
  stage: 'install' | 'done' | 'error';
  line: string;
}

export interface YtmAccount {
  name: string;
  handle: string;
  photo: string | null;
}

export interface YtmPlaylist {
  id: string;
  title: string;
  count: number | string | null;
  thumbnail: string | null;
}

export interface YtmTrack {
  videoId: string;
  title: string;
  artists: string;
  album: string;
  duration: number | null;
  thumbnail: string | null;
  available: boolean;
  downloaded: boolean;
}

export interface YtmDownloadEvent {
  videoId: string;
  status: 'queued' | 'downloading' | 'done' | 'error' | 'cancelled';
  progress?: number;
  path?: string;
  error?: string;
}

export interface YtmApi {
  status(): Promise<YtmStatus>;
  setup(upgrade?: boolean): Promise<void>;
  onSetup(cb: (e: YtmSetupState) => void): () => void;
  login(headers: string): Promise<YtmAccount>;
  logout(): Promise<void>;
  account(): Promise<YtmAccount>;
  versions(): Promise<Record<string, string>>;
  playlists(): Promise<YtmPlaylist[]>;
  playlist(id: string): Promise<{ title: string; tracks: YtmTrack[] }>;
  search(q: string): Promise<YtmTrack[]>;
  download(tracks: YtmTrack[]): Promise<void>;
  cancel(): Promise<void>;
  onDownload(cb: (e: YtmDownloadEvent) => void): () => void;
  revealAudio(): Promise<void>;
}

export interface MixlabApi {
  ytm: YtmApi;

  info(): Promise<AppInfo>;
  pickAudioFiles(): Promise<string[]>;
  pathForFile(file: File): string;
  inspectFiles(paths: string[]): Promise<InspectedFile[]>;
  analyze(jobs: Array<{ id: string; path: string; fingerprint: string }>): Promise<void>;
  onAnalysisProgress(cb: (e: { id: string; progress: number; stage: string }) => void): () => void;
  onAnalysisDone(cb: (e: AnalysisDone) => void): () => void;
  onAnalysisError(cb: (e: { id: string; error: string }) => void): () => void;

  previewStart(plan: MixPlan, frame: number): Promise<number>;
  previewChunk(session: number, frames: number): Promise<{ left: Float32Array; right: Float32Array } | null>;
  previewStop(session: number): Promise<void>;

  pickExportPath(defaultName: string, format: 'mp3' | 'wav'): Promise<string | null>;
  exportStart(plan: MixPlan, opts: ExportOptions): Promise<number>;
  exportCancel(id: number): Promise<void>;
  onExportProgress(cb: (e: { id: number } & ExportProgress) => void): () => void;
  onExportDone(cb: (e: { id: number; report: ExportReport }) => void): () => void;
  onExportError(cb: (e: { id: number; error: string; cancelled: boolean }) => void): () => void;

  saveProject(project: ProjectFile, path: string | null): Promise<string | null>;
  openProject(path?: string): Promise<OpenedProject | null>;
  relink(missing: Array<{ id: string; fileName: string; size: number; fingerprint: string }>): Promise<Record<string, string> | null>;
  reveal(path: string): Promise<void>;
  setDirty(dirty: boolean): void;
  closeNow(): void;
  onMenu(cb: (cmd: string) => void): () => void;
}

declare global {
  interface Window {
    mixlab: MixlabApi;
  }
}
