/**
 * What a build's numbers cover: which hangs (channel, process, thread) and
 * which of its reports, so the build bar can say both without the reader
 * opening a tooltip.
 */

import type { ThreadKind } from "./dataSource";

/**
 * A build counts the reports received within this many days of its build
 * date. Mirrors the submission window in the aggregation job's query
 * (`bhr_collection.py`), which ends at midnight UTC as the fifth day starts.
 */
const COLLECTION_DAYS = 5;

export interface CollectionWindow {
  /** Last day whose reports count toward the build, "YYYYMMDD" (UTC). */
  lastDay: string;
  /**
   * Whether that day is still to come. The daily job processes a build once,
   * on its window's last day (bhr-aggregate.py: four days after the build, at
   * 10:00 UTC), so every build misses that day's late reports. Only a build
   * processed earlier than that, by a one-off run, can be missing whole days,
   * and today being before the last day proves it was.
   */
  open: boolean;
}

/** "YYYYMMDD" for a Date's UTC calendar day. */
function compactUtc(when: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${when.getUTCFullYear()}${pad(when.getUTCMonth() + 1)}${pad(when.getUTCDate())}`;
}

/** The reports a build counts, or null for a malformed build date. */
export function collectionWindow(
  buildDate: string,
  now: Date = new Date(),
): CollectionWindow | null {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(buildDate);
  if (!match) {
    return null;
  }
  const [, y, m, d] = match;
  const last = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d) + COLLECTION_DAYS - 1));
  const lastDay = compactUtc(last);
  // Same-width "YYYYMMDD" strings compare in date order.
  return { lastDay, open: compactUtc(now) < lastDay };
}

const PROCESS_LABELS: Record<string, string> = {
  default: "Parent process",
  tab: "Content process",
};

/** BHR monitors several threads; these two are their process's main thread. */
const MAIN_THREADS = new Set(["Gecko", "Gecko_Child"]);

/** What a thread kind loads, for naming it before its data arrives. */
const THREAD_OF_KIND: Record<ThreadKind, { threadName: string; processType: string }> = {
  main: { threadName: "Gecko", processType: "default" },
  child: { threadName: "Gecko_Child", processType: "tab" },
};

/**
 * "Firefox Nightly · Parent process · Gecko (main thread)": the channel, then
 * the process and thread the hangs were recorded on. Read from the loaded
 * build when there is one, else from the thread kind asked for.
 */
export function scopeLabel(
  kind: ThreadKind,
  loaded?: { threadName: string; processType: string },
): string {
  const { threadName, processType } = loaded ?? THREAD_OF_KIND[kind] ?? THREAD_OF_KIND.main;
  const process = PROCESS_LABELS[processType] ?? `${processType} process`;
  const thread = MAIN_THREADS.has(threadName) ? `${threadName} (main thread)` : threadName;
  return `Firefox Nightly · ${process} · ${thread}`;
}
