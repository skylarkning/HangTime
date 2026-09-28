/**
 * Single point of access for BHR data artifacts. Everything that reads data
 * goes through here so the source can be swapped — local files in dev, the
 * TaskCluster index URL in production, or a live-query backend later — without
 * touching the UI or processing layers.
 */

import type { Profile } from "./schema";
import { learned } from "./loadProgress";

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
 * Namespace a backfill publishes under. A one-off run is indexed by the build
 * date it aggregated rather than by the push that triggered it, so it is found
 * exactly instead of guessed at through the run-day offsets below.
 */
const BUILD_NS = "gecko.v2.mozilla-central.bhr-aggregate.build";

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

function backfillArtifactUrl(date: string, file: string): string {
  return `${TC_INDEX}/task/${BUILD_NS}.${date}/artifacts/public/bhr/${file}`;
}

/** Bytes on the wire so far, and in all (0 when the server doesn't say). */
export type DownloadProgress = (loaded: number, total: number) => void;

/**
 * Read a response body as JSON, reporting progress as it streams in.
 *
 * Content-Length counts the bytes on the wire, but the stream hands back the
 * body already decompressed, and the artifact is served gzipped. So when the
 * response is compressed, progress is the decompressed count scaled down by
 * the ratio the last load measured. It's an estimate, capped short of the
 * total so a ratio that's off can't show the bar full while data still flows.
 */
async function readJson<T>(res: Response, onProgress?: DownloadProgress): Promise<T> {
  if (!onProgress || !res.body) {
    return (await res.json()) as T;
  }
  const total = Number(res.headers.get("Content-Length")) || 0;
  const encoding = res.headers.get("Content-Encoding");
  const compressed = !!encoding && encoding !== "identity";
  const ratio = compressed ? learned.compressionRatio() : 1;

  const chunks: BlobPart[] = [];
  let decoded = 0;
  const reader = res.body.getReader();
  onProgress(0, total);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    decoded += value.byteLength;
    const wire = decoded / ratio;
    onProgress(total ? Math.min(wire, total * 0.99) : wire, total);
  }
  onProgress(total || decoded, total);
  if (compressed && total) {
    learned.setCompressionRatio(decoded / total);
  }
  return (await new Response(new Blob(chunks)).json()) as T;
}

export async function fetchProfile(
  thread: ThreadKind,
  date: DateSpec,
  onProgress?: DownloadProgress,
): Promise<Profile> {
  // The latest run publishes "current", so that needs no index lookup.
  if (date === "current" || !TC_INDEX) {
    const url = `${DATA_BASE}/${artifactName(thread, date)}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
    }
    return readJson<Profile>(res, onProgress);
  }

  const file = artifactName(thread, date);

  // A backfilled day is indexed by its build date, so it resolves in one hit.
  const backfilled = await fetch(backfillArtifactUrl(date, file));
  if (backfilled.ok) {
    return readJson<Profile>(backfilled, onProgress);
  }

  for (const offset of RUN_DAY_OFFSETS) {
    const runDay = runDayPath(date, offset);
    if (!runDay) {
      break;
    }
    const res = await fetch(indexedArtifactUrl(runDay, file));
    if (res.ok) {
      return readJson<Profile>(res, onProgress);
    }
  }
  throw new Error(
    `No aggregation artifact for build ${date}. The daily job may not have ` +
      `run for it yet, or its artifact has expired.`,
  );
}
