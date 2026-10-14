/**
 * Saved investigations: the questions a triager starts from, each a preset of
 * the list's filters. "What got worse?", "What has nobody filed?", "Where is
 * the main thread doing file I/O?" are one choice away rather than four
 * dropdowns, on Top Hangs and as the queue on the Areas page.
 *
 * A preset sets every narrowing dimension (unset ones back to "all"), so
 * picking one always shows exactly that investigation.
 */

import type { Narrowing } from "@/processing/select";
import type { SortKey } from "@/state/useViewState";

export interface Investigation {
  id: string;
  label: string;
  /** What it finds and how it's ranked, for tooltips and the Areas page. */
  blurb: string;
  narrowing: Partial<Omit<Narrowing, "filter" | "platform">>;
  sort?: SortKey;
  /** Needs the timeseries (trend-based). */
  needsHistory?: boolean;
}

export const INVESTIGATIONS: Investigation[] = [
  {
    id: "increases",
    label: "Credible increases",
    blurb:
      "Hangs whose last 7 days rose against the 7 before, with enough observed days and volume to back it, ranked by the time they added per day.",
    narrowing: { trend: "increase" },
    needsHistory: true,
  },
  {
    id: "newly-tracked",
    label: "Newly tracked",
    blurb: "Hangs with meaningful volume now and none through a well-covered week before.",
    narrowing: { trend: "new" },
    needsHistory: true,
  },
  {
    id: "untracked",
    label: "Biggest hangs with no bug",
    blurb: "The most hang time that no Bugzilla bug tracks yet.",
    narrowing: { bug: "untracked" },
    sort: "time",
  },
  {
    id: "file-io",
    label: "Main-thread file I/O",
    blurb:
      "Hangs sampled inside a file operation (open, read, write, delete, metadata), with the Firefox code that made the call.",
    narrowing: { mechanism: "file-io" },
  },
  {
    id: "sync-ipc",
    label: "Synchronous IPC",
    blurb: "The main thread blocked waiting for another process to answer.",
    narrowing: { mechanism: "sync-ipc" },
  },
  {
    id: "lock-wait",
    label: "Lock waits",
    blurb: "The main thread waiting on a lock or condition variable another thread holds.",
    narrowing: { mechanism: "lock-wait" },
  },
  {
    id: "startup",
    label: "Startup",
    blurb: "Hangs where most reports came before startup finished.",
    narrowing: { context: "startup" },
  },
  {
    id: "shutdown",
    label: "Shutdown",
    blurb: "Hangs where most reports came as Firefox was shutting down.",
    narrowing: { context: "shutdown" },
  },
  {
    id: "interacting",
    label: "While the user was interacting",
    blurb: "Hangs where most reports say the user had just clicked, typed or scrolled.",
    narrowing: { context: "interacting" },
  },
];

/** Every dimension a preset owns, at its "all" value. */
const CLEARED: Omit<Narrowing, "filter" | "platform"> = {
  area: null,
  mechanism: null,
  context: null,
  trend: "all",
  bug: null,
};

/** The full set of filters an investigation stands for; null is "All hangs". */
export function investigationNarrowing(
  inv: Investigation | null,
): Omit<Narrowing, "filter" | "platform"> {
  return { ...CLEARED, ...inv?.narrowing };
}

/** The investigation the list's filters currently amount to, if any. */
export function currentInvestigation(n: Narrowing): Investigation | null {
  if (n.filter) {
    return null;
  }
  return (
    INVESTIGATIONS.find((inv) => {
      const want = investigationNarrowing(inv);
      return (Object.keys(want) as (keyof typeof want)[]).every((key) => want[key] === n[key]);
    }) ?? null
  );
}
