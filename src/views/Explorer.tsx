import { useMemo } from "react";
import { useBugs, useProcessedProfile, useTimeseries } from "@/queries/hooks";
import { useViewState } from "@/state/useViewState";
import { filterSignatures } from "@/processing/select";
import { HangTable } from "@/components/HangTable";
import { DetailPane } from "@/components/DetailPane";
import { formatCount, formatSeconds } from "@/format";
import type { ThreadKind } from "@/data/dataSource";

export function Explorer() {
  const { state, update } = useViewState();
  const query = useProcessedProfile(state.thread as ThreadKind, state.date);
  const bugs = useBugs();
  const timeseries = useTimeseries(state.thread as ThreadKind);

  const filtered = useMemo(() => {
    if (!query.data) {
      return [];
    }
    return filterSignatures(query.data, state.filter);
  }, [query.data, state.filter]);

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
    // Covers both initial fetch and the brief window where the query is
    // disabled waiting on the (best-effort) bug list.
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
          <span className="summary">
            <strong>{filtered.length.toLocaleString()}</strong> signatures ·{" "}
            <strong>{formatSeconds(profile.totalDuration)}</strong> s ·{" "}
            <strong>{formatCount(profile.totalCount)}</strong> hangs
          </span>
        </div>
        <div className="table-scroll">
          <HangTable
            profile={profile}
            signatures={filtered}
            filter={state.filter}
            selectedId={state.selected}
            onSelect={(id) => update({ selected: id })}
            timeseries={timeseries.data}
          />
        </div>
      </div>
      <DetailPane
        profile={profile}
        signature={selected}
        filter={state.filter}
        timeseries={timeseries.data}
      />
    </div>
  );
}
