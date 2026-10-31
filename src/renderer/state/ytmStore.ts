// YouTube Music downloads: tracks are fetched as .m4a by the helper, then imported
// into the library (and analysed) like any dropped file.

import { create } from 'zustand';
import type { YtmDownloadEvent, YtmTrack } from '../../shared/api';
import { useStore } from './store';

export interface YtmItem {
  track: YtmTrack;
  status: YtmDownloadEvent['status'];
  progress: number;
  error?: string;
  path?: string;
}

interface YtmState {
  items: Record<string, YtmItem>;
  /** Tracks fetched since the queue was last empty (for the end-of-batch toast). */
  batchDone: number;
  enqueue(tracks: YtmTrack[]): Promise<void>;
  cancel(): Promise<void>;
  clearFinished(): void;
  onEvent(e: YtmDownloadEvent): void;
}

/** Strip Electron's "Error invoking remote method 'x': Error: " prefix. */
export const ipcMessage = (e: unknown) => String((e as any)?.message ?? e).replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '');

export const isActive = (i: YtmItem) => i.status === 'queued' || i.status === 'downloading';

export const useYtm = create<YtmState>()((set, get) => ({
  items: {},
  batchDone: 0,
  enqueue: async (tracks) => {
    const fresh = tracks.filter((t) => !get().items[t.videoId] || !isActive(get().items[t.videoId]));
    if (!fresh.length) return;
    if (!Object.values(get().items).some(isActive)) set({ batchDone: 0 });
    set((s) => ({ items: { ...s.items, ...Object.fromEntries(fresh.map((t) => [t.videoId, { track: t, status: 'queued' as const, progress: 0 }])) } }));
    try {
      await window.mixlab.ytm.download(fresh);
    } catch (e) {
      set((s) => ({ items: { ...s.items, ...Object.fromEntries(fresh.map((t) => [t.videoId, { track: t, status: 'error' as const, progress: 0, error: ipcMessage(e) }])) } }));
      useStore.getState().toast({ kind: 'error', title: 'Téléchargement impossible', detail: ipcMessage(e) });
    }
  },
  cancel: async () => { await window.mixlab.ytm.cancel(); },
  clearFinished: () => set((s) => ({ items: Object.fromEntries(Object.entries(s.items).filter(([, i]) => isActive(i))) })),
  onEvent: (e) => {
    const cur = get().items[e.videoId];
    if (!cur) return;
    set((s) => ({ items: { ...s.items, [e.videoId]: { ...cur, status: e.status, progress: e.progress ?? cur.progress, error: e.error, path: e.path ?? cur.path } } }));
    if (e.status === 'done' && e.path) {
      set((s) => ({ batchDone: s.batchDone + 1 }));
      void useStore.getState().importPaths([e.path]);
    }
    if (e.status === 'error') useStore.getState().toast({ kind: 'error', title: `« ${cur.track.title} » non téléchargé`, detail: e.error });
    const items = Object.values(get().items);
    if (e.status !== 'queued' && e.status !== 'downloading' && items.length && !items.some(isActive)) {
      const done = get().batchDone;
      if (done) useStore.getState().toast({ kind: 'success', title: `YouTube Music : ${done} morceau${done > 1 ? 'x' : ''} récupéré${done > 1 ? 's' : ''}`, detail: 'Analyse en cours dans la bibliothèque.' });
    }
  },
}));
