import { useMemo } from "react";
import { useBugs, useProcessedProfile, useTimeseries } from "@/queries/hooks";
import { useViewState } from "@/state/useViewState";
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

  const filtered = useMemo(() => {
    if (!query.data) {
      return [];
    }
    let sigs = filterSignatures(query.data, state.filter);
    if (state.trend !== "all") {
      sigs = sigs.filter((s) => {
        const t = trendById.get(s.id);
        return t != null && trendCategory(t) === state.trend;
      });
    }
    const rank =
      metric === "count"
        ? (a: (typeof sigs)[number], b: (typeof sigs)[number]) => b.count - a.count
        : (a: (typeof sigs)[number], b: (typeof sigs)[number]) =>
            b.duration - a.duration;
    return [...sigs].sort(rank);
  }, [query.data, state.filter, state.trend, trendById, metric]);

  const selected = useMemo(() => {
    if (!query.data || !state.selected) {
      return null;
    }
    return query.data.signatures.find((s) => s.id === state.selected) ?? null;
  }, [query.data, state.selected]);

  if (query.isError) {
    return (
      <div className="state-msg error">
        Failed to load data: {(query.error as Error).message}
      </div>
    );
  }
  if (!query.data) {
    return <LoadingProgress thread={state.thread} date={state.date} />;
  }
  const profile = query.data;

  return (
    <div className="explorer">
      <div className="list-pane">
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
                ? "Trends are per hang row, not per stack, so they don't apply to a group's stacks"
                : timeseries.data
                  ? undefined
                  : "Trend filtering needs the timeseries artifact"
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
              <strong>{formatSeconds(profile.totalDuration)}</strong> s ·{" "}
              <strong>{formatCount(profile.totalCount)}</strong> hangs
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
            />
          )}
        </div>
      </div>
      <DetailPane
        profile={profile}
        signature={selected}
        filter={state.filter}
        timeseries={timeseries.data}
        onSelect={(id) => update({ selected: id })}
        activeGroup={state.group}
        onShowGroup={(key) => update({ group: key })}
      />
    </div>
  );
}
