import { useEffect, useState } from "react";
import {
  clearProgress,
  getProgress,
  learned,
  progressKey,
  useLoadProgress,
  type LoadProgress,
} from "@/data/loadProgress";

interface LoadingProgressProps {
  thread: string;
  date: string;
}

/** Wait this long before quoting a download rate, so one early chunk can't skew it. */
const RATE_SETTLE_MS = 1000;

function formatMB(bytes: number): string {
  return (bytes / 1e6).toFixed(1);
}

function formatRemaining(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds <= 1) {
    return "Almost done";
  }
  if (seconds < 60) {
    return `About ${seconds} seconds remaining`;
  }
  return `About ${Math.ceil(seconds / 60)} min remaining`;
}

/** Expected processing time, ms, from the pace the last load measured. */
function processEstimate(p: LoadProgress): number {
  return (p.total / 1e6) * learned.processMsPerMB();
}

/**
 * Time left for the whole load, or null while there's nothing to base it on.
 * Downloading is estimated from the rate so far. Processing can't report its
 * own progress for most of its run (see the worker), so it's timed against the
 * last load's pace.
 */
function estimateRemaining(p: LoadProgress, now: number): number | null {

  if (p.phase === "download") {
    const elapsed = now - p.startedAt;
    if (!p.total || elapsed < RATE_SETTLE_MS || p.loaded === 0) {
      return null;
    }
    const rate = p.loaded / elapsed;
    return (p.total - p.loaded) / rate + processEstimate(p);
  }
  if (!p.total) {
    // Processing a build whose download was cached, so no size to scale by.
    return null;
  }
  if (p.phase === "waiting") {
    return processEstimate(p);
  }
  return Math.max(0, processEstimate(p) - (now - p.processStartedAt));
}

export function LoadingProgress({ thread, date }: LoadingProgressProps) {
  const key = progressKey(thread, date);
  const progress = useLoadProgress(key);

  // This screen goes away once the dashboard behind it has rendered, which
  // takes a while on its own after the worker returns. So the pace the next
  // load is estimated from is timed to here, not to the worker. An unmount
  // before the worker finished is only a switch between views mid-load.
  useEffect(
    () => () => {
      const p = getProgress(key);
      if (p?.phase !== "process" || !p.computed) {
        return;
      }
      if (p.total) {
        learned.setProcessMsPerMB((Date.now() - p.processStartedAt) / (p.total / 1e6));
      }
      clearProgress(key);
    },
    [key],
  );

  // Progress events can pause (a slow network, the worker between reports);
  // redraw anyway so the time remaining keeps counting down. The clock is read
  // at render, not kept from the last tick, which could be older than the
  // start of processing.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, []);
  const now = Date.now();

  if (!progress) {
    return <div className="state-msg">Loading and processing hang data…</div>;
  }

  const downloading = progress.phase === "download";
  const unpacking = downloading && progress.total > 0 && progress.loaded >= progress.total;
  let label: string;
  let detail: string;
  let fraction: number | null;
  if (downloading) {
    label = unpacking ? "Reading the hang data" : "Downloading the hang data";
    fraction = progress.total ? progress.loaded / progress.total : null;
    detail = progress.total
      ? `${formatMB(progress.loaded)} of ${formatMB(progress.total)} MB`
      : `${formatMB(progress.loaded)} MB`;
  } else if (progress.phase === "waiting") {
    label = "Waiting for the Bugzilla bug list";
    fraction = null;
    detail = "";
  } else {
    label = progress.computed ? "Finishing up" : "Processing hangs";
    // Timed, so hold it short of full until the result actually lands.
    fraction = progress.total
      ? Math.min(0.97, (now - progress.processStartedAt) / processEstimate(progress))
      : null;
    detail = fraction == null ? "" : `${Math.round(fraction * 100)}%`;
  }
  const remaining = estimateRemaining(progress, now);

  return (
    <div className="load-progress" role="status" aria-live="polite">
      <div className="load-title">Loading hang data</div>
      <div className="load-step">
        Step {downloading ? 1 : 2} of 2 · {label}
      </div>
      <div
        className={`load-bar${fraction == null ? " indeterminate" : ""}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={fraction == null ? undefined : Math.round(fraction * 100)}
      >
        <div
          className="load-fill"
          style={fraction == null ? undefined : { width: `${fraction * 100}%` }}
        />
      </div>
      <div className="load-meta">
        <span>{detail}</span>
        <span>{remaining == null ? "Estimating time remaining…" : formatRemaining(remaining)}</span>
      </div>
      <div className="load-note">
        Please don't refresh the page. That starts the download over.
      </div>
    </div>
  );
}
