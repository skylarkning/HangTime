/**
 * React Query hooks. These own all async data access and caching.
 *
 * Design notes:
 *  - The daily artifact is fetched ONCE (keyed by thread/date) and cached raw,
 *    so re-merging when the bug list arrives doesn't re-download it.
 *  - The Bugzilla bug list is its own query. A failure is a real error state
 *    (retried, not cached) — we must never cache an empty bug list as success,
 *    or a transient Bugzilla blip silently disables bug-merging for the whole
 *    session.
 *  - Processing (worker) is gated only on the profile, NOT on bugs: the list
 *    renders immediately (unmerged) and re-merges once bugs load. Including the
 *    bug list's update time in the processing key drives that re-merge.
 */

import {
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import { fetchProfile, type DateSpec, type ThreadKind } from "@/data/dataSource";
import { fetchBugs, type BugMap } from "@/data/bugs";
import { fetchComponents, type ProductComponents } from "@/data/components";
import { fetchTimeseries, type TimeseriesIndex } from "@/data/timeseries";
import {
  progressKey,
  reportProgress,
} from "@/data/loadProgress";
import { getProcessor } from "@/processing/client";
import * as Comlink from "comlink";
import type { Profile } from "@/data/schema";
import type { ProcessedProfile } from "@/processing/types";

const EMPTY_BUGS: BugMap = new Map();
const BUGS_STALE_MS = 60 * 60 * 1000; // bugs change slowly

export function useBugs(): UseQueryResult<BugMap> {
  return useQuery<BugMap>({
    queryKey: ["bugs"],
    queryFn: fetchBugs,
    staleTime: BUGS_STALE_MS,
    retry: 2,
  });
}

/**
 * Bugzilla's product/component list, for the file-a-bug component picker.
 * Best-effort: without it the picker falls back to the components the
 * classifier itself knows about.
 */
export function useComponents(): UseQueryResult<ProductComponents[]> {
  return useQuery<ProductComponents[]>({
    queryKey: ["bz-components"],
    queryFn: fetchComponents,
    staleTime: BUGS_STALE_MS,
    retry: 1,
  });
}

/**
 * The timeseries artifact for a thread. Best-effort and long-lived: a failure
 * just disables the per-hang history chart, it never blocks the explorer.
 */
export function useTimeseries(
  thread: ThreadKind,
): UseQueryResult<TimeseriesIndex> {
  return useQuery<TimeseriesIndex>({
    queryKey: ["timeseries", thread],
    queryFn: () => fetchTimeseries(thread),
    staleTime: BUGS_STALE_MS,
    retry: 1,
  });
}

/** Download, then have the worker process, reporting both to the loading screen. */
async function loadProfile(thread: ThreadKind, date: DateSpec) {
  const key = progressKey(thread, date);
  // A retry starts over, so the progress does too.
  reportProgress(key, { phase: "download", startedAt: Date.now(), loaded: 0 });
  // The body arrives in hundreds of small chunks; redrawing the loading screen
  // for each one slows the download it is reporting on. A few times a second
  // is plenty.
  let lastReport = 0;
  const profile = await fetchProfile(thread, date, (loaded, total) => {
    const now = Date.now();
    if (now - lastReport >= 150 || (total > 0 && loaded >= total)) {
      lastReport = now;
      reportProgress(key, { loaded, total });
    }
  });
  reportProgress(key, { phase: "waiting" });
  return profile;
}

async function processProfile(
  thread: ThreadKind,
  date: DateSpec,
  profile: Profile,
  bugs: BugMap,
): Promise<ProcessedProfile> {
  const key = progressKey(thread, date);
  reportProgress(key, { phase: "process", processStartedAt: Date.now(), computed: false });
  return getProcessor().process(
    profile,
    bugs,
    Comlink.proxy(() => reportProgress(key, { computed: true })),
  );
}

export function useProcessedProfile(thread: ThreadKind, date: DateSpec) {
  const bugs = useBugs();
  const raw = useQuery({
    queryKey: ["raw-profile", thread, date],
    queryFn: () => loadProfile(thread, date),
  });

  // Re-process when the bug list first arrives (or refreshes after an error).
  const bugsVersion = bugs.data ? bugs.dataUpdatedAt : 0;

  const processed = useQuery<ProcessedProfile>({
    queryKey: ["processed", thread, date, bugsVersion],
    // Wait for the bug list to settle. It is fetched in parallel with the
    // artifact and resolves sooner, so this costs nothing in practice, and it
    // avoids processing the whole profile twice -- once unmerged, then again
    // when the bugs land.
    enabled: !!raw.data && !bugs.isPending,
    // Keep showing the current result while a refreshed bug list re-merges it,
    // but not across a change of build or thread: that would leave the old
    // build on screen, under the new build's name, with no sign it's loading.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === thread && previousQuery?.queryKey[2] === date
        ? previous
        : undefined,
    queryFn: () => processProfile(thread, date, raw.data!, bugs.data ?? EMPTY_BUGS),
  });

  // A failed fetch leaves the processing query disabled, and a disabled query
  // reads as pending forever -- so a build with no artifact would sit on the
  // loading message rather than saying what went wrong. Surface the fetch
  // error in its place.
  if (raw.isError) {
    return {
      ...processed,
      data: undefined,
      isError: true,
      isSuccess: false,
      isPending: false,
      isLoading: false,
      error: raw.error,
    } as typeof processed;
  }
  return processed;
}
