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
  keepPreviousData,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import { fetchProfile, type DateSpec, type ThreadKind } from "@/data/dataSource";
import { fetchBugs, type BugMap } from "@/data/bugs";
import { getProcessor } from "@/processing/client";
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

export function useProcessedProfile(thread: ThreadKind, date: DateSpec) {
  const bugs = useBugs();
  const raw = useQuery({
    queryKey: ["raw-profile", thread, date],
    queryFn: () => fetchProfile(thread, date),
  });

  // Re-process when the bug list first arrives (or refreshes after an error).
  const bugsVersion = bugs.data ? bugs.dataUpdatedAt : 0;

  return useQuery<ProcessedProfile>({
    queryKey: ["processed", thread, date, bugsVersion],
    enabled: !!raw.data,
    placeholderData: keepPreviousData,
    queryFn: () => getProcessor().process(raw.data!, bugs.data ?? EMPTY_BUGS),
  });
}
