import { useEffect, useMemo } from "react";
import { useBugs, useProcessedProfile, useTimeseries } from "@/queries/hooks";
import { useViewState } from "@/state/useViewState";
import { isLegacyStackId } from "@/state/permalink";
import { filterSignatures } from "@/processing/select";
import { computeTrend, trendCategory, type TrendSummary } from "@/data/trend";
import type { Metric } from "@/data/timeseries";
import { HangTable } from "@/components/HangTable";
import { DetailPane } from "@/components/DetailPane";
import { GroupMemberTable } from "@/components/GroupMemberTable";
import { formatCount, formatSeconds } from "@/format";
import type { ThreadKind } from "@/data/dataSource";
import { memberStacks } from "@/processing/signatureKey";
import { LoadingProgress } from "@/components/LoadingProgress";
import { BuildBar } from "@/components/BuildBar";
import { PLATFORMS, platformLabel, type Platform } from "@/data/platforms";
import type { HangSignature } from "@/processing/types";

export function Explorer() {
  const { state, update } = useViewState();
  const query = useProcessedProfile(state.thread as ThreadKind, state.date);
  const bugs = useBugs();
  const timeseries = useTimeseries(state.thread as ThreadKind);

  const metric: Metric = state.sort === "count" ? "count" : "ms";

  const trendById = useMemo(() => {
    const map = new Map<string, TrendSummary | null>();
    if (!query.data) {
      return map;
    }
    const index = timeseries.data;
    index?.bind(query.data);
    for (const sig of query.data.signatures) {
      const series = index?.resolveByStack(memberStacks(sig));
      map.set(sig.id, series ? computeTrend(series, metric) : null);
    }
    return map;
  }, [query.data, timeseries.data, metric]);

  // The near-duplicate group the list is narrowed to, if any. The list then
  // shows the group's stacks one by one (GroupMemberTable) instead of rows.
  const group = state.group ? query.data?.groupsByKey?.[state.group] : undefined;

  // Narrowed to one platform, the list keeps that platform's hangs and shows
  // and ranks each by its hang time and count on that platform alone, so a
  // platform with few users isn't buried under hangs that are mostly elsewhere.
  // (Group mode lists stacks, which carry no platform, so it ignores this.)
  const platform: Platform | null = group ? null : state.platform;
  const durationOf = useMemo(
    () =>
      platform
        ? (sig: HangSignature) => sig.platformMs[platform] ?? 0
        : (sig: HangSignature) => sig.duration,
    [platform],
  );
  const countOf = useMemo(
    () =>
      platform
        ? (sig: HangSignature) => sig.platformStats[platform] ?? 0
        : (sig: HangSignature) => sig.count,
    [platform],
  );
  const platformTotals = useMemo(() => {
    if (!platform || !query.data) {
      return null;
    }
    let duration = 0;
    let count = 0;
    for (const sig of query.data.signatures) {
      duration += sig.platformMs[platform] ?? 0;
      count += sig.platformStats[platform] ?? 0;
    }
    return { duration, count };
  }, [platform, query.data]);

  const filtered = useMemo(() => {
    if (!query.data) {
      return [];
    }
    let sigs = filterSignatures(query.data, state.filter);
    if (platform) {
      sigs = sigs.filter((s) => countOf(s) > 0);
    }
    if (state.trend !== "all") {
      sigs = sigs.filter((s) => {
        const t = trendById.get(s.id);
        return t != null && trendCategory(t) === state.trend;
      });
    }
    const value = metric === "count" ? countOf : durationOf;
    return [...sigs].sort((a, b) => value(b) - value(a));
  }, [query.data, state.filter, state.trend, trendById, metric, platform, countOf, durationOf]);

  const selected = useMemo(() => {
    if (!query.data || !state.selected) {
      return null;
    }
    // An older link names the hang by its stack's funcTable indices, which
    // still find it on the build the link was made on.
    const id = isLegacyStackId(state.selected)
      ? (query.data.sigIdByKey?.[state.selected] ?? state.selected)
      : state.selected;
    return query.data.signatures.find((s) => s.id === id) ?? null;
  }, [query.data, state.selected]);

  // Once an older link has found its hang, put the stable id in the address,
  // so copying it from there gives a link that works on any build.
  useEffect(() => {
    if (selected && state.selected !== selected.id) {
      update({ selected: selected.id });
    }
  }, [selected, state.selected, update]);

  if (query.isError) {
    return (
      <div className="view-state">
        <BuildBar />
        <div className="state-msg error">
          Failed to load data: {(query.error as Error).message}
        </div>
      </div>
    );
  }
  if (!query.data) {
    return (
      <div className="view-state">
        <BuildBar />
        <LoadingProgress thread={state.thread} date={state.date} />
      </div>
    );
  }
  const profile = query.data;

  return (
    <div className="explorer">
      <div className="list-pane">
        <BuildBar date={profile.date} />
        {bugs.isError && (
          <div className="banner warn">
            Couldn’t load the Bugzilla bug list — hangs are not merged by bug.{" "}
            <button className="link" onClick={() => bugs.refetch()}>
              Retry
            </button>
          </div>
        )}
        {state.group && (
          <div className="group-banner">
            {group ? (
              <>
                <span className="group-banner-label">Near-duplicate group</span>
                <span className="group-banner-name" title={group.displayName}>
                  {group.displayName}
                </span>
                <span className="group-badge">
                  {group.memberCount.toLocaleString()} stacks
                </span>
              </>
            ) : (
              <span>That near-duplicate group isn’t in this build.</span>
            )}
            <button className="btn secondary" onClick={() => update({ group: null })}>
              Show all hangs
            </button>
          </div>
        )}
        <div className="filter-bar">
          <input
            type="text"
            placeholder="Filter by function or library name…"
            value={state.filter}
            onChange={(e) => update({ filter: e.target.value })}
            autoFocus
          />
          <label className="control">
            Sort
            <select
              value={state.sort}
              onChange={(e) => update({ sort: e.target.value as typeof state.sort })}
            >
              <option value="time">Time</option>
              <option value="count">Count</option>
            </select>
          </label>
          <label
            className="control"
            title={
              group
                ? "A group's stacks carry no platform, so this doesn't apply to them"
                : "Show only hangs seen on one platform, ranked by their time or count there"
            }
          >
            Platform
            <select
              value={platform ?? "all"}
              disabled={!!group}
              onChange={(e) =>
                update({ platform: e.target.value === "all" ? null : (e.target.value as Platform) })
              }
            >
              <option value="all">All</option>
              {PLATFORMS.map((os) => (
                <option key={os} value={os}>
                  {platformLabel(os)}
                </option>
              ))}
            </select>
          </label>
          <label
            className="control"
            title={
              group
                ? "Trends are per hang row, not per stack, so they don't apply to a group's stacks"
                : !timeseries.data
                  ? "Trend filtering needs the timeseries artifact"
                  : platform
                    ? "Trends are worked out across all platforms"
                    : undefined
            }
          >
            Trend
            <select
              value={group ? "all" : state.trend}
              disabled={!timeseries.data || !!group}
              onChange={(e) =>
                update({ trend: e.target.value as typeof state.trend })
              }
            >
              <option value="all">All</option>
              <option value="regression">Regressions</option>
              <option value="improvement">Improvements</option>
              <option value="new">New</option>
            </select>
          </label>
          {group ? (
            <span className="summary">
              <strong>{group.memberCount.toLocaleString()}</strong> stacks ·{" "}
              <strong>{formatSeconds(group.totalMs)}</strong> s ·{" "}
              <strong>{formatCount(group.totalCount)}</strong> hangs
            </span>
          ) : (
            <span className="summary">
              <strong>{filtered.length.toLocaleString()}</strong> signatures ·{" "}
              <strong>{formatSeconds(platformTotals?.duration ?? profile.totalDuration)}</strong>{" "}
              s · <strong>{formatCount(platformTotals?.count ?? profile.totalCount)}</strong> hangs
              {platform && <> on {platformLabel(platform)}</>}
            </span>
          )}
        </div>
        <div className="table-scroll">
          {group ? (
            <GroupMemberTable
              profile={profile}
              group={group}
              filter={state.filter}
              sort={metric === "count" ? "count" : "time"}
              selectedId={state.selected}
              onSelect={(id) => update({ selected: id })}
            />
          ) : (
            <HangTable
              profile={profile}
              signatures={filtered}
              filter={state.filter}
              selectedId={state.selected}
              onSelect={(id) => update({ selected: id })}
              trendById={trendById}
              durationOf={durationOf}
              countOf={countOf}
              totalDuration={platformTotals?.duration}
            />
          )}
        </div>
      </div>
      <DetailPane
        profile={profile}
        signature={selected}
        requestedId={state.selected}
        filter={state.filter}
        timeseries={timeseries.data}
        onSelect={(id) => update({ selected: id })}
        activeGroup={state.group}
        onShowGroup={(key) => update({ group: key })}
      />
    </div>
  );
}
