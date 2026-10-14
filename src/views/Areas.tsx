/**
 * Where a build's hang time goes: by area of the browser (fonts, the startup
 * cache, the OS shell, navigation...), by mechanism (file I/O, lock waits,
 * synchronous IPC...), and by when it happens (startup, while the user was
 * interacting). Each row opens Top Hangs narrowed to it.
 *
 * Replaces the old Overview page, whose summaries repeated the hang list and
 * whose volume chart summed only the signatures the timeseries happens to
 * retain, so a change in coverage looked like a change in browser health.
 */

import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useProcessedProfile } from "@/queries/hooks";
import { useViewState } from "@/state/useViewState";
import type { ThreadKind } from "@/data/dataSource";
import type { HangSignature } from "@/processing/types";
import { byArea, byContext, byMechanism, type BreakdownRow } from "@/data/areaBreakdown";
import { NO_AREA } from "@/data/hangAreas";
import { PLATFORMS, platformLabel, type Platform } from "@/data/platforms";
import { formatCount, formatSeconds, formatShare } from "@/format";
import { BuildBar } from "@/components/BuildBar";
import { InfoTip } from "@/components/InfoTip";
import { LoadingProgress } from "@/components/LoadingProgress";

/** Rows a card shows before "Show all". */
const TOP_ROWS = 12;

export function Areas() {
  const { state, update } = useViewState();
  const { search } = useLocation();
  const query = useProcessedProfile(state.thread as ThreadKind, state.date);
  const platform = state.platform;

  // On one platform, every number is that platform's share of each hang.
  const measures = useMemo(
    () =>
      platform
        ? {
            durationOf: (sig: HangSignature) => sig.platformMs[platform] ?? 0,
            countOf: (sig: HangSignature) => sig.platformStats[platform] ?? 0,
          }
        : {
            durationOf: (sig: HangSignature) => sig.duration,
            countOf: (sig: HangSignature) => sig.count,
          },
    [platform],
  );
  const breakdowns = useMemo(() => {
    if (!query.data) {
      return null;
    }
    const sigs = query.data.signatures;
    const areas = byArea(sigs, measures);
    return {
      areas,
      mechanisms: byMechanism(sigs, measures),
      contexts: byContext(sigs, measures),
      total: areas.reduce((sum, row) => sum + row.ms, 0),
      unattributed: areas.find((row) => row.key === NO_AREA)?.ms ?? 0,
    };
  }, [query.data, measures]);

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
  if (!query.data || !breakdowns) {
    return (
      <div className="view-state">
        <BuildBar />
        <LoadingProgress thread={state.thread} date={state.date} />
      </div>
    );
  }
  const { areas, mechanisms, contexts, total, unattributed } = breakdowns;

  return (
    <div className="areas-page">
      <BuildBar date={query.data.date} />
      <div className="areas-intro">
        <p>
          Where this build&rsquo;s main-thread hang time goes. Each hang is described by
          the <b>area</b> of the browser its stack names and the <b>mechanism</b> by which
          the thread was stuck. Pick a row to list those hangs.
        </p>
        <label className="control">
          Platform
          <select
            value={platform ?? "all"}
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
      </div>
      <div className="areas-grid">
        <BreakdownCard
          title="By area"
          info={
            <>
              The part of the browser each hang belongs to: the innermost frame on its
              stack that names one (a font list, the startup cache, the taskbar). Under
              each area, the mechanisms that make up most of its time. The grey figure is
              the share of its time in hangs no bug tracks yet.
              <span className="eg">
                <b>Unattributed</b> hangs have no frame any rule recognises, usually
                because the stack is all event-loop and system code.
              </span>
            </>
          }
          rows={areas}
          total={total}
          param="area"
        />
        <BreakdownCard
          title="By mechanism"
          info={
            <>
              How the thread was stuck where it was sampled: inside a file operation,
              waiting on a lock, waiting for another process over synchronous IPC, or
              simply running code (CPU work). Under each, the areas it happens in. The
              grey figure is the share of its time in hangs no bug tracks yet.
              <span className="eg">
                A file operation on the stack says where the thread was, not that the
                disk was slow: antivirus, network drives and locks stall there too.
              </span>
            </>
          }
          rows={mechanisms}
          total={total}
          param="mechanism"
        />
      </div>
      <ContextCard rows={contexts} total={total} />
      <p className="areas-note">
        Areas and mechanisms are read from function and library names, since the hang
        data carries no source paths. {formatShare(unattributed, total)} of hang
        time has no recognised area. See the{" "}
        <Link to={{ pathname: "/guide", search }}>
          Guide
        </Link>{" "}
        for how it works.
      </p>
    </div>
  );
}

/** A Top Hangs link narrowed to one row, keeping the build, thread and platform. */
function useNarrowedLink() {
  const { search } = useLocation();
  return (param: "area" | "mechanism" | "context", value: string) => {
    const next = new URLSearchParams();
    const current = new URLSearchParams(search);
    for (const keep of ["thread", "date", "platform"]) {
      const v = current.get(keep);
      if (v) {
        next.set(keep, v);
      }
    }
    next.set(param, value);
    return { pathname: "/top-hangs", search: `?${next}` };
  };
}

function BreakdownCard<K extends string>({
  title,
  info,
  rows,
  total,
  param,
}: {
  title: string;
  info: React.ReactNode;
  rows: BreakdownRow<K>[];
  total: number;
  param: "area" | "mechanism";
}) {
  const [showAll, setShowAll] = useState(false);
  const linkTo = useNarrowedLink();
  const shown = showAll ? rows : rows.slice(0, TOP_ROWS);
  const max = rows[0]?.ms ?? 0;
  const pct = formatShare;

  return (
    <div className="ov-card">
      <div className="ov-card-head">
        <h2>
          {title}
          <InfoTip label={title}>{info}</InfoTip>
        </h2>
        <span className="areas-col-head">share of hang time · untracked</span>
      </div>
      <ol className="breakdown">
        {shown.map((row) => (
          <li key={row.key}>
            <Link
              className="breakdown-row"
              to={linkTo(param, row.key)}
              title={
                `${row.label}: ${formatSeconds(row.ms)} s over ${formatCount(row.count)} hangs ` +
                `in ${formatCount(row.signatures)} signatures; ` +
                `${pct(row.untrackedMs, row.ms)} of it in hangs no bug tracks yet`
              }
            >
              <span className="breakdown-label">{row.label}</span>
              <span className="breakdown-track">
                <span
                  className="breakdown-fill"
                  style={{ width: `${max > 0 ? (row.ms / max) * 100 : 0}%` }}
                />
              </span>
              <span className="breakdown-share">{pct(row.ms, total)}</span>
              <span className="breakdown-untracked">{pct(row.untrackedMs, row.ms)}</span>
              <span className="breakdown-parts">
                {row.parts.map((part) => `${part.label} ${pct(part.ms, row.ms)}`).join(" · ")}
              </span>
            </Link>
          </li>
        ))}
      </ol>
      {rows.length > TOP_ROWS && (
        <button className="link breakdown-more" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

function ContextCard({
  rows,
  total,
}: {
  rows: { key: string; label: string; ms: number; signatures: number }[];
  total: number;
}) {
  const linkTo = useNarrowedLink();
  return (
    <div className="ov-card">
      <div className="ov-card-head">
        <h2>
          When
          <InfoTip label="When">
            Hang time in hangs where most reports carry a flag Firefox records with
            the hang: during startup or shutdown, while the user was interacting, with
            a paint pending, or while other applications kept the CPU busy.
            <span className="eg">
              A hang can carry several flags, so these don&rsquo;t add up to 100%. A
              report without a flag is unknown, not &ldquo;no&rdquo;: older builds
              record fewer of them.
            </span>
          </InfoTip>
        </h2>
      </div>
      {rows.length === 0 ? (
        <p className="ov-empty">No hang on this build carries a context flag on most reports.</p>
      ) : (
        <ul className="context-tiles">
          {rows.map((row) => (
            <li key={row.key}>
              <Link to={linkTo("context", row.key)} className="context-tile">
                <span className="context-share">{formatShare(row.ms, total)}</span>
                <span className="context-label">{row.label}</span>
                <span className="context-sub">{formatCount(row.signatures)} signatures</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
