/**
 * Links that keep pointing at the same investigation. The address bar can say
 * `date=current`, which moves to a newer build every day, so a link copied
 * from it stops meaning what it did; these links always name the build.
 */

import type { ViewState } from "./useViewState";

/**
 * An absolute link to the hang list as it is now: the build actually shown
 * (never "current"), the selected hang by its stable id, and the filters that
 * shape the list. A hang's trend is compared over the days up to the build it
 * is shown on, so pinning the build pins that comparison too.
 */
export function investigationLink(
  state: ViewState,
  buildDate: string,
  selected: string | null = state.selected,
): string {
  const params = new URLSearchParams();
  if (state.thread !== "main") {
    params.set("thread", state.thread);
  }
  params.set("date", buildDate);
  if (selected) {
    params.set("selected", selected);
  }
  if (state.filter) {
    params.set("filter", state.filter);
  }
  if (state.platform) {
    params.set("platform", state.platform);
  }
  if (state.group) {
    params.set("group", state.group);
    if (state.member) params.set("member", state.member);
    if (state.original) params.set("original", state.original);
  }
  if (state.sort !== "time") {
    params.set("sort", state.sort);
  }
  if (state.trend !== "all") {
    params.set("trend", state.trend);
  }
  for (const key of ["area", "mechanism", "context", "bug"] as const) {
    const value = state[key];
    if (value) {
      params.set(key, value);
    }
  }
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#/top-hangs?${params}`;
}

/**
 * Whether a `selected` value is the old kind of hang id: the stack's funcTable
 * indices, which only mean something in the one artifact they came from.
 */
export function isLegacyStackId(id: string): boolean {
  return /^\d+(,\d+)*$/.test(id);
}
