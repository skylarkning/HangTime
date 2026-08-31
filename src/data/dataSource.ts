/**
 * Single point of access for BHR data artifacts. Everything that reads data
 * goes through here so the source can be swapped — local files in dev, the
 * TaskCluster index URL in production, or a live-query backend later — without
 * touching the UI or processing layers.
 */

import type { Profile } from "./schema";

/**
 * Base URL for artifacts. Defaults to the dev server's `public/data`. In
 * production set `VITE_DATA_BASE` to the TaskCluster index artifact path, e.g.
 * https://firefox-ci-tc.services.mozilla.com/api/index/v1/task/<route>/artifacts/public
 *
 * That route resolves to the most recent cron run, which carries only its own
 * build. Reading an older build needs VITE_TC_INDEX as well.
 */
const DATA_BASE = (import.meta.env.VITE_DATA_BASE as string | undefined) ?? "data";

/**
 * TaskCluster index API root. When set, a build date other than "current" is
 * resolved through the per-run `pushdate` routes rather than looked for
 * alongside the latest artifact. Unset in dev, where every build sits in
 * `public/data` already.
 */
const TC_INDEX = import.meta.env.VITE_TC_INDEX as string | undefined;

/** Index namespace prefix for the daily cron's runs. */
const PUSHDATE_NS = "gecko.v2.mozilla-central.pushdate";
const JOB = "firefox.bhr-aggregate";

/**
 * Run days to try for a given build date.
 *
 * The cron aggregates a build four days after the fact, so the run that holds
 * build D is normally D+4. It slips when a run is late or retried — build
 * 20260826 came from the 2026-08-29 run — so try the neighbours too rather
 * than report a build missing when it is only a day off.
 */
const RUN_DAY_OFFSETS = [4, 3, 5, 6];

export type ThreadKind = "main" | "child";

/** "current" resolves to the most recent daily artifact. */
export type DateSpec = "current" | string;

function artifactName(thread: ThreadKind, date: DateSpec): string {
  return `hangs_${thread}_${date}.json`;
}

/** Shift a "YYYYMMDD" build date by whole days, back out as "YYYY.MM.DD". */
function runDayPath(buildDate: string, offsetDays: number): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(buildDate);
  if (!match) {
    return null;
  }
  const [, y, m, d] = match;
  const when = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  when.setUTCDate(when.getUTCDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${when.getUTCFullYear()}.${pad(when.getUTCMonth() + 1)}.${pad(when.getUTCDate())}`;
}

function indexedArtifactUrl(runDay: string, file: string): string {
  return `${TC_INDEX}/task/${PUSHDATE_NS}.${runDay}.latest.${JOB}/artifacts/public/bhr/${file}`;
}

export async function fetchProfile(
  thread: ThreadKind,
  date: DateSpec,
): Promise<Profile> {
  // The latest run publishes "current", so that needs no index lookup.
  if (date === "current" || !TC_INDEX) {
    const url = `${DATA_BASE}/${artifactName(thread, date)}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as Profile;
  }

  const file = artifactName(thread, date);
  for (const offset of RUN_DAY_OFFSETS) {
    const runDay = runDayPath(date, offset);
    if (!runDay) {
      break;
    }
    const res = await fetch(indexedArtifactUrl(runDay, file));
    if (res.ok) {
      return (await res.json()) as Profile;
    }
  }
  throw new Error(
    `No aggregation artifact for build ${date}. The daily job may not have ` +
      `run for it yet, or its artifact has expired.`,
  );
}
