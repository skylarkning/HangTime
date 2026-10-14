/**
 * View state lives in the URL search params so every view is a shareable
 * permalink. This hook is the single read/write point for that state.
 */

import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import type { ThreadKind } from "@/data/dataSource";
import { isPlatform, type Platform } from "@/data/platforms";

/** Metric the hang list is ranked by. */
export type SortKey = "time" | "count";
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
