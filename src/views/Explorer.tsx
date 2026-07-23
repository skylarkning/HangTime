import { useMemo, useState } from "react";
import { useBugs, useProcessedProfile, useTimeseries } from "@/queries/hooks";
import { useViewState } from "@/state/useViewState";
import { filterSignatures } from "@/processing/select";
import { buildListRows } from "@/processing/grouping";
import { computeTrend, trendCategory, type TrendSummary } from "@/data/trend";
import type { Metric } from "@/data/timeseries";
import { HangTable } from "@/components/HangTable";
import { DetailPane } from "@/components/DetailPane";
import { StackDiff } from "@/components/StackDiff";
import { formatCount, formatSeconds } from "@/format";
import type { ThreadKind } from "@/data/dataSource";

export function Explorer() {
  const { state, update } = useViewState();
  const query = useProcessedProfile(state.thread as ThreadKind, state.date);
  const bugs = useBugs();
  const timeseries = useTimeseries(state.thread as ThreadKind);

  // Local (non-URL) view state for the group tree and the compare selection.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [compare, setCompare] = useState<string[]>([]);
  const [showDiff, setShowDiff] = useState(false);

  const metric: Metric = state.sort === "count" ? "count" : "ms";

  const trendById = useMemo(() => {
    const map = new Map<string, TrendSummary | null>();
    if (!query.data) {
      return map;
    }
    const index = timeseries.data;
    for (const sig of query.data.signatures) {
      const series = index?.resolve(sig.memberKeys);
      map.set(sig.id, series ? computeTrend(series, metric) : null);
    }
    return map;
  }, [query.data, timeseries.data, metric]);

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

  const rows = useMemo(
    () => buildListRows(filtered, query.data?.leafGroupByKey),
    [filtered, query.data],
  );

  const selected = useMemo(() => {
    if (!query.data || !state.selected) {
      return null;
    }
    return query.data.signatures.find((s) => s.id === state.selected) ?? null;
  }, [query.data, state.selected]);

  const compareSigs = useMemo(() => {
    if (!query.data) {
      return [];
    }
    return compare
      .map((id) => query.data!.signatures.find((s) => s.id === id))
      .filter((s): s is NonNullable<typeof s> => !!s);
  }, [compare, query.data]);

  const toggleGroup = (groupKey: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });

  const toggleCompare = (id: string) =>
    setCompare((prev) => {
      if (prev.includes(id)) {
        return prev.filter((x) => x !== id);
      }
      return prev.length >= 2 ? prev : [...prev, id];
    });

  if (query.isError) {
    return (
      <div className="state-msg error">
        Failed to load data: {(query.error as Error).message}
      </div>
    );
  }
  if (!query.data) {
    return <div className="state-msg">Loading and processing hang data…</div>;
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
              timeseries.data
                ? undefined
                : "Trend filtering needs the timeseries artifact"
            }
          >
            Trend
            <select
              value={state.trend}
              disabled={!timeseries.data}
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
          <span className="summary">
            <strong>{filtered.length.toLocaleString()}</strong> signatures ·{" "}
            <strong>{formatSeconds(profile.totalDuration)}</strong> s ·{" "}
            <strong>{formatCount(profile.totalCount)}</strong> hangs
          </span>
        </div>
        {compare.length > 0 && (
          <div className="compare-bar">
            <span>
              {compare.length === 2
                ? "2 stacks selected"
                : "Pick one more stack to compare"}
            </span>
            <button
              className="btn"
              disabled={compare.length !== 2}
              onClick={() => setShowDiff(true)}
            >
              Compare stacks →
            </button>
            <button className="link" onClick={() => setCompare([])}>
              Clear
            </button>
          </div>
        )}
        <div className="table-scroll">
          <HangTable
            profile={profile}
            rows={rows}
            filter={state.filter}
            selectedId={state.selected}
            onSelect={(id) => update({ selected: id })}
            trendById={trendById}
            expanded={expanded}
            onToggleGroup={toggleGroup}
            compare={compare}
            onToggleCompare={toggleCompare}
          />
        </div>
      </div>
      <DetailPane
        profile={profile}
        signature={selected}
        filter={state.filter}
        timeseries={timeseries.data}
      />
      {showDiff && compareSigs.length === 2 && (
        <StackDiff
          profile={profile}
          a={compareSigs[0]}
          b={compareSigs[1]}
          onClose={() => setShowDiff(false)}
        />
      )}
    </div>
  );
}
