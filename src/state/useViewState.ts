/**
 * View state lives in the URL search params so every view is a shareable
 * permalink. This hook is the single read/write point for that state.
 */

import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import type { ThreadKind } from "@/data/dataSource";
import { isPlatform, type Platform } from "@/data/platforms";
import {
  isAreaFilter,
  isContext,
  isMechanism,
  type AreaFilter,
  type ContextId,
  type MechanismId,
} from "@/data/hangAreas";

/** Metric the hang list is ranked by. */
export type SortKey = "time" | "count";
/** Whether the list keeps hangs a bug already tracks, or only the others. */
export type BugFilter = "untracked" | "tracked";
/** Trend bucket the hang list is filtered to. */
export type TrendFilter = "all" | "increase" | "decrease" | "new";

/**
 * Read the `trend` param. Links from before the rename say `regression` and
 * `improvement`; they still open the bucket they meant.
 */
function parseTrend(value: string | null): TrendFilter {
  switch (value) {
    case "increase":
    case "regression":
      return "increase";
    case "decrease":
    case "improvement":
      return "decrease";
    case "new":
      return "new";
    default:
      return "all";
  }
}

function parseBug(value: string | null): BugFilter | null {
  return value === "untracked" || value === "tracked" ? value : null;
}

export interface ViewState {
  thread: ThreadKind;
  /** Build-date string, or "current" for the latest artifact. */
  date: string;
  /** Free-text frame/lib filter. */
  filter: string;
  /** Selected hang signature id, or null. */
  selected: string | null;
  /** Rank the list by hang time or hang count. */
  sort: SortKey;
  /** Restrict the list to a trend bucket, or show all. */
  trend: TrendFilter;
  /** Restrict and re-rank the list to one platform's hangs, or null for all. */
  platform: Platform | null;
  /** Restrict the list to one near-duplicate group (its group key), or null. */
  group: string | null;
  /** Exact group member and original baseline, by stable stack identity. */
  member: string | null;
  original: string | null;
  /** Restrict the list to one area of the browser ("none": unattributed). */
  area: AreaFilter | null;
  /** Restrict the list to one mechanism (file I/O, lock wait, ...). */
  mechanism: MechanismId | null;
  /** Restrict the list to hangs most of whose reports carry a context. */
  context: ContextId | null;
  /** Restrict the list to hangs with, or without, a bug tracking them. */
  bug: BugFilter | null;
}

export function useViewState() {
  const [params, setParams] = useSearchParams();

  const state: ViewState = {
    thread: (params.get("thread") as ThreadKind) || "main",
    date: params.get("date") || "current",
    filter: params.get("filter") || "",
    selected: params.get("selected"),
    sort: (params.get("sort") as SortKey) || "time",
    trend: parseTrend(params.get("trend")),
    platform: isPlatform(params.get("platform")) ? (params.get("platform") as Platform) : null,
    group: params.get("group"),
    member: params.get("member"),
    original: params.get("original"),
    area: isAreaFilter(params.get("area")) ? (params.get("area") as AreaFilter) : null,
    mechanism: isMechanism(params.get("mechanism"))
      ? (params.get("mechanism") as MechanismId)
      : null,
    context: isContext(params.get("context")) ? (params.get("context") as ContextId) : null,
    bug: parseBug(params.get("bug")),
  };

  const update = useCallback(
    (patch: Partial<ViewState>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(patch)) {
            if (value === null || value === "" || value === undefined) {
              next.delete(key);
            } else {
              next.set(key, String(value));
            }
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return { state, update };
}
