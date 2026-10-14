import { useEffect, useMemo } from "react";
import { useBugs, useProcessedProfile, useTimeseries, useTrendById } from "@/queries/hooks";
import { useViewState } from "@/state/useViewState";
import { isLegacyStackId } from "@/state/permalink";
import { narrowSignatures, type Narrowing } from "@/processing/select";
import type { Metric } from "@/data/timeseries";
import { HangTable } from "@/components/HangTable";
import { DetailPane } from "@/components/DetailPane";
import { GroupMemberTable } from "@/components/GroupMemberTable";
import { formatCount, formatPercentOfTotal, formatSeconds, formatShare } from "@/format";
import type { ThreadKind } from "@/data/dataSource";
import { LoadingProgress } from "@/components/LoadingProgress";
import { BuildBar } from "@/components/BuildBar";
import { PLATFORMS, platformLabel, type Platform } from "@/data/platforms";
import type { HangSignature } from "@/processing/types";
import {
  CONTEXTS,
  MECHANISMS,
  NO_AREA,
  areaLabel,
  type AreaFilter,
  type ContextId,
  type MechanismId,
} from "@/data/hangAreas";
import {
  INVESTIGATIONS,
  currentInvestigation,
  investigationNarrowing,
} from "@/data/investigations";
import type { BugFilter, ViewState } from "@/state/useViewState";
import { byArea, byMechanism } from "@/data/areaBreakdown";

export function Explorer() {
  const { state, update } = useViewState();
  const query = useProcessedProfile(state.thread as ThreadKind, state.date);
  const bugs = useBugs();
  const timeseries = useTimeseries(state.thread as ThreadKind);

  const metric: Metric = state.sort === "count" ? "count" : "ms";

  const trendById = useTrendById(query.data, timeseries.data, metric);

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

  // The area and mechanism filters list what this build (on this platform)
  // actually has, largest first, with each one's share of the hang time.
  const measures = useMemo(() => ({ durationOf, countOf }), [durationOf, countOf]);
  const areaRows = useMemo(
    () => (query.data ? byArea(query.data.signatures, measures) : []),
    [query.data, measures],
  );
  const mechanismRows = useMemo(
    () => (query.data ? byMechanism(query.data.signatures, measures) : []),
    [query.data, measures],
  );

  const narrowing: Narrowing = useMemo(
    () => ({
      filter: state.filter,
      platform,
      area: state.area,
      mechanism: state.mechanism,
      context: state.context,
      trend: state.trend,
      bug: state.bug,
    }),
    [state.filter, platform, state.area, state.mechanism, state.context, state.trend, state.bug],
  );

  const filtered = useMemo(() => {
    if (!query.data) {
      return [];
    }
    const sigs = narrowSignatures(query.data, narrowing, trendById);
    if (state.trend === "increase") {
      // A big rise on a hang that barely registers matters less than a modest
      // one on a heavy hang, so credible increases rank by what they added.
      const added = (s: HangSignature) => trendById.get(s.id)?.deltaPerDay ?? 0;
      return [...sigs].sort((a, b) => added(b) - added(a));
    }
    const value = metric === "count" ? countOf : durationOf;
    return [...sigs].sort((a, b) => value(b) - value(a));
  }, [query.data, narrowing, trendById, state.trend, metric, countOf, durationOf]);

  // Narrowed by anything but the platform, the summary counts what is shown.
  const narrowed =
    !!state.filter ||
    !!state.area ||
    !!state.mechanism ||
    !!state.context ||
    !!state.bug ||
    state.trend !== "all";
  const shownTotals = useMemo(() => {
    let duration = 0;
    let count = 0;
    for (const sig of filtered) {
      duration += durationOf(sig);
      count += countOf(sig);
    }
    return { duration, count };
  }, [filtered, durationOf, countOf]);

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
          <AreaFilters
            narrowing={narrowing}
            areaRows={areaRows}
            mechanismRows={mechanismRows}
            hasHistory={!!timeseries.data}
            disabled={!!group}
            onChange={update}
          />
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
                    : "Increases and decreases count only when both weeks have enough data behind them"
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
              <option value="increase">Increases</option>
              <option value="decrease">Decreases</option>
              <option value="new">Newly tracked</option>
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
              <strong>
                {formatSeconds(
                  narrowed
                    ? shownTotals.duration
                    : (platformTotals?.duration ?? profile.totalDuration),
                )}
              </strong>{" "}
              s ·{" "}
              <strong>
                {formatCount(
                  narrowed ? shownTotals.count : (platformTotals?.count ?? profile.totalCount),
                )}
              </strong>{" "}
              hangs
              {platform && <> on {platformLabel(platform)}</>}
              {narrowed && (
                <>
                  {" "}
                  ({formatPercentOfTotal(
                    shownTotals.duration,
                    platformTotals?.duration ?? profile.totalDuration,
                  )}{" "}
                  of hang time)
                </>
              )}
              {state.trend === "increase" && (
                <> · ranked by added {metric === "count" ? "hangs" : "time"} per day</>
              )}
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
              trendAllPlatforms={!!platform}
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

/**
 * The area, mechanism and context filters: the three ways a hang is described
 * (see data/hangAreas.ts), so "main-thread file I/O" or "everything in fonts"
 * is one choice away.
 */
function AreaFilters({
  narrowing,
  areaRows,
  mechanismRows,
  hasHistory,
  disabled,
  onChange,
}: {
  narrowing: Narrowing;
  areaRows: { key: AreaFilter; label: string; ms: number }[];
  mechanismRows: { key: MechanismId; label: string; ms: number }[];
  hasHistory: boolean;
  disabled: boolean;
  onChange: (patch: Partial<ViewState>) => void;
}) {
  const { area, mechanism, context, bug } = narrowing;
  const investigation = currentInvestigation(narrowing);
  const custom =
    !investigation &&
    (!!narrowing.filter ||
      !!area ||
      !!mechanism ||
      !!context ||
      !!bug ||
      narrowing.trend !== "all");
  const total = areaRows.reduce((sum, row) => sum + row.ms, 0);
  const share = (ms: number) => formatShare(ms, total);
  // Keep the current choice listed even when nothing in view matches it.
  const withCurrent = <K extends string>(
    rows: { key: K; label: string; ms: number }[],
    current: K | null,
    label: (key: K) => string,
  ) =>
    current && !rows.some((row) => row.key === current)
      ? [...rows, { key: current, label: label(current), ms: 0 }]
      : rows;
  const title = disabled
    ? "A group's stacks are listed one by one, so this doesn't apply to them"
    : undefined;
  const areaName = (key: AreaFilter) => areaLabel(key === NO_AREA ? null : key);

  return (
    <div className="area-filters">
      <label
        className="control investigation-control"
        title={title ?? investigation?.blurb ?? "Start from a common triage question"}
      >
        Investigation
        <select
          value={investigation?.id ?? (custom ? "custom" : "all")}
          disabled={disabled}
          onChange={(e) => {
            const picked = INVESTIGATIONS.find((inv) => inv.id === e.target.value);
            onChange({
              ...investigationNarrowing(picked ?? null),
              filter: "",
              ...(picked?.sort ? { sort: picked.sort } : {}),
            });
          }}
        >
          <option value="all">All hangs</option>
          {INVESTIGATIONS.map((inv) => (
            <option key={inv.id} value={inv.id} disabled={inv.needsHistory && !hasHistory}>
              {inv.label}
            </option>
          ))}
          {custom && (
            <option value="custom" disabled>
              Custom filters
            </option>
          )}
        </select>
      </label>
      <label className="control" title={title ?? "Show only hangs in one area of the browser"}>
        Area
        <select
          value={area ?? "all"}
          disabled={disabled}
          onChange={(e) =>
            onChange({ area: e.target.value === "all" ? null : (e.target.value as AreaFilter) })
          }
        >
          <option value="all">All</option>
          {withCurrent(areaRows, area, areaName).map((row) => (
            <option key={row.key} value={row.key}>
              {row.label} ({share(row.ms)})
            </option>
          ))}
        </select>
      </label>
      <label
        className="control"
        title={title ?? "Show only hangs stuck in one way: file I/O, a lock wait, sync IPC..."}
      >
        Mechanism
        <select
          value={mechanism ?? "all"}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              mechanism: e.target.value === "all" ? null : (e.target.value as MechanismId),
            })
          }
        >
          <option value="all">All</option>
          {withCurrent(mechanismRows, mechanism, (key) => MECHANISMS[key].label).map((row) => (
            <option key={row.key} value={row.key}>
              {row.label} ({share(row.ms)})
            </option>
          ))}
        </select>
      </label>
      <label
        className="control"
        title={title ?? "Show only hangs where most reports carry this flag"}
      >
        When
        <select
          value={context ?? "all"}
          disabled={disabled}
          onChange={(e) =>
            onChange({ context: e.target.value === "all" ? null : (e.target.value as ContextId) })
          }
        >
          <option value="all">Any time</option>
          {(Object.keys(CONTEXTS) as ContextId[]).map((key) => (
            <option key={key} value={key}>
              {CONTEXTS[key].label}
            </option>
          ))}
        </select>
      </label>
      <label className="control" title={title ?? "Show only hangs with, or without, a bug"}>
        Bug
        <select
          value={bug ?? "all"}
          disabled={disabled}
          onChange={(e) =>
            onChange({ bug: e.target.value === "all" ? null : (e.target.value as BugFilter) })
          }
        >
          <option value="all">Any</option>
          <option value="untracked">No bug yet</option>
          <option value="tracked">Has a bug</option>
        </select>
      </label>
    </div>
  );
}
