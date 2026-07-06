/**
 * View state lives in the URL search params so every view is a shareable
 * permalink. This hook is the single read/write point for that state.
 */

import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import type { ThreadKind } from "@/data/dataSource";

/** Metric the hang list is ranked by. */
export type SortKey = "time" | "count";
/** Trend bucket the hang list is filtered to. */
export type TrendFilter = "all" | "regression" | "improvement" | "new";

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
}

export function useViewState() {
  const [params, setParams] = useSearchParams();

  const state: ViewState = {
    thread: (params.get("thread") as ThreadKind) || "main",
    date: params.get("date") || "current",
    filter: params.get("filter") || "",
    selected: params.get("selected"),
    sort: (params.get("sort") as SortKey) || "time",
    trend: (params.get("trend") as TrendFilter) || "all",
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
