/**
 * View state lives in the URL search params so every view is a shareable
 * permalink. This hook is the single read/write point for that state.
 */

import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import type { ThreadKind } from "@/data/dataSource";

export interface ViewState {
  thread: ThreadKind;
  /** Build-date string, or "current" for the latest artifact. */
  date: string;
  /** Free-text frame/lib filter. */
  filter: string;
  /** Selected hang signature id, or null. */
  selected: string | null;
}

export function useViewState() {
  const [params, setParams] = useSearchParams();

  const state: ViewState = {
    thread: (params.get("thread") as ThreadKind) || "main",
    date: params.get("date") || "current",
    filter: params.get("filter") || "",
    selected: params.get("selected"),
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
