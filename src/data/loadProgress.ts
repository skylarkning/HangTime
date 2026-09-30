/**
 * Progress of the artifact load, for the loading screen.
 *
 * React Query has no notion of progress, so the fetch and the worker report
 * into this small store instead and the loading screen subscribes to it. One
 * entry per thread/date, so a load that was abandoned (the user switched build
 * mid-download) can't overwrite the one on screen.
 */

import { useSyncExternalStore } from "react";

export interface LoadProgress {
  phase: "download" | "waiting" | "process";
  /** When the download started, ms since epoch. */
  startedAt: number;
  /** Bytes on the wire so far. Estimated when the response is compressed. */
  loaded: number;
  /** Bytes on the wire in all, from Content-Length; 0 when the server omits it. */
  total: number;
  /** When processing started, ms since epoch; 0 before then. */
  processStartedAt: number;
  /** The worker has built the signatures and is copying them to the page. */
  computed: boolean;
}

const entries = new Map<string, LoadProgress>();
/**
 * Download size per thread/date, kept after its entry is cleared. Coming back
 * to a build whose download is still cached only reprocesses it, and the
 * processing estimate is scaled by this.
 */
const sizes = new Map<string, number>();
const listeners = new Set<() => void>();

export function progressKey(thread: string, date: string): string {
  return `${thread}:${date}`;
}

export function reportProgress(key: string, patch: Partial<LoadProgress>): void {
  const prev = entries.get(key) ?? {
    phase: "download",
    startedAt: Date.now(),
    loaded: 0,
    total: sizes.get(key) ?? 0,
    processStartedAt: 0,
    computed: false,
  };
  const next = { ...prev, ...patch };
  entries.set(key, next);
  if (next.total > 0) {
    sizes.set(key, next.total);
  }
  listeners.forEach((fn) => fn());
}

export function getProgress(key: string): LoadProgress | undefined {
  return entries.get(key);
}

export function clearProgress(key: string): void {
  entries.delete(key);
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useLoadProgress(key: string): LoadProgress | undefined {
  return useSyncExternalStore(subscribe, () => entries.get(key));
}

/*
 * What the last load measured, so the next estimate starts from this machine
 * and this artifact rather than a guess. Both are best-effort: private
 * browsing may refuse storage, and then the defaults stand.
 */

const RATIO_KEY = "hangtime.compressionRatio";
const PROCESS_KEY = "hangtime.processMsPerMB";

/** The artifact is JSON gzipped around 4.4:1 (104 MB to 24 MB on 2026-09-28). */
const DEFAULT_RATIO = 4.4;
/**
 * Processing, from handing the profile to the worker to the dashboard showing,
 * per MB downloaded: 4.3 s for 23.9 MB in Chrome on a laptop, 2026-09-28.
 */
const DEFAULT_PROCESS_MS_PER_MB = 175;

function readNumber(key: string, fallback: number): number {
  try {
    const value = Number(localStorage.getItem(key));
    return value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

function writeNumber(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Storage unavailable; the next load uses the defaults.
  }
}

/**
 * Fold a new measurement into the stored one: clamped, so a load that stalled
 * (a backgrounded tab, a machine under load) can't be taken at face value, and
 * averaged with the last, so one odd load only moves the next estimate halfway.
 */
function learn(key: string, fallback: number, value: number, min: number, max: number): void {
  const clamped = Math.min(max, Math.max(min, value));
  writeNumber(key, (readNumber(key, fallback) + clamped) / 2);
}

export const learned = {
  compressionRatio: () => readNumber(RATIO_KEY, DEFAULT_RATIO),
  setCompressionRatio: (ratio: number) => learn(RATIO_KEY, DEFAULT_RATIO, ratio, 1, 20),
  processMsPerMB: () => readNumber(PROCESS_KEY, DEFAULT_PROCESS_MS_PER_MB),
  setProcessMsPerMB: (ms: number) =>
    learn(PROCESS_KEY, DEFAULT_PROCESS_MS_PER_MB, ms, 40, 2000),
};
