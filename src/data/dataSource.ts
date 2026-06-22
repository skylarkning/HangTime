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
 */
const DATA_BASE = (import.meta.env.VITE_DATA_BASE as string | undefined) ?? "data";

export type ThreadKind = "main" | "child";

/** "current" resolves to the most recent daily artifact. */
export type DateSpec = "current" | string;

function artifactName(thread: ThreadKind, date: DateSpec): string {
  return `hangs_${thread}_${date}.json`;
}

export async function fetchProfile(
  thread: ThreadKind,
  date: DateSpec,
): Promise<Profile> {
  const url = `${DATA_BASE}/${artifactName(thread, date)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as Profile;
}
