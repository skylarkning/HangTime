/**
 * System-health overview for engineering managers: a few headline numbers, the
 * hang-volume trend over the rolling window, what needs attention (regressions
 * and newly appeared hangs), the worst offenders, and where hangs land by OS.
 *
 * It reads the same two artifacts the explorer does — the current daily profile
 * and the timeseries window — and derives everything else. Every offender row
 * and attention item links into the explorer's detail view for that hang.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useProcessedProfile, useTimeseries } from "@/queries/hooks";
import { useViewState } from "@/state/useViewState";
import {
  computeTrend,
  trendBadge,
  trendCategory,
  type TrendCategory,
  type TrendSummary,
} from "@/data/trend";
import type { Metric, ResolvedSeries, TimeseriesIndex } from "@/data/timeseries";
import type { HangSignature, ProcessedProfile } from "@/processing/types";
import type { ThreadKind } from "@/data/dataSource";
import { formatCount, formatDate, formatSeconds } from "@/format";
import { VolumeChart } from "@/components/VolumeChart";
import { InfoTip } from "@/components/InfoTip";
import { memberStacks } from "@/processing/signatureKey";

// Platform identity colors (Okabe-Ito; CVD-validated). Direct-labeled on the
// bar, so identity never rests on color alone.
const OS_META: Record<string, { label: string; color: string }> = {
  Windows: { label: "Windows", color: "#0072B2" },
  Darwin: { label: "macOS", color: "#E69F00" },
  Linux: { label: "Linux", color: "#009E73" },
};
const OS_OTHER = { label: "Other", color: "#8f8f9d" };
const OS_ORDER = ["Windows", "Darwin", "Linux"];

export function Overview() {
  const { state } = useViewState();
  const query = useProcessedProfile(state.thread as ThreadKind, state.date);
  const timeseries = useTimeseries(state.thread as ThreadKind);
  const index = timeseries.data;

  // Per-signature trend over the window, keyed by signature id.
  const trendById = useMemo(() => {
    const map = new Map<string, TrendSummary | null>();
    if (!query.data) {
      return map;
    }
    index?.bind(query.data);
    for (const sig of query.data.signatures) {
      const series = index?.resolveByStack(memberStacks(sig)) ?? null;
      map.set(sig.id, series ? computeTrend(series, "ms") : null);
    }
    return map;
  }, [query.data, index]);

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
    <div className="overview">
      <KpiRow profile={profile} index={index} />
      <VolumeCard index={index} />
      <div className="ov-grid">
        <TopHangsCard profile={profile} trendById={trendById} state={state} />
        <div className="ov-col">
          <AttentionCard profile={profile} trendById={trendById} state={state} />
          <PlatformCard profile={profile} />
        </div>
      </div>
    </div>
  );
}

/** A `?thread=…&date=…&selected=…` search string for an explorer deep link. */
function detailSearch(
  state: { thread: string; date: string },
  id?: string,
): string {
  const p = new URLSearchParams();
  if (state.thread && state.thread !== "main") p.set("thread", state.thread);
  if (state.date && state.date !== "current") p.set("date", state.date);
  if (id) p.set("selected", id);
  const s = p.toString();
  return s ? `?${s}` : "";
}

function TrendChip({ trend }: { trend: TrendSummary | null | undefined }) {
  if (!trend) {
    return null;
  }
  const badge = trendBadge(trend);
  const text =
    badge.text === "stable" || badge.text === "new"
      ? badge.text
      : `${badge.text} vs prior 7d`;
  return <span className={`chip ${badge.tone}`}>{text}</span>;
}

// -- Headline numbers --------------------------------------------------------

function windowSeries(index: TimeseriesIndex): ResolvedSeries {
  const totals = index.totals();
  return { dates: index.dates, total: totals, members: [] };
}

function KpiRow({
  profile,
  index,
}: {
  profile: ProcessedProfile;
  index: TimeseriesIndex | undefined;
}) {
  const series = index ? windowSeries(index) : null;
  const msTrend = series ? computeTrend(series, "ms") : null;
  const countTrend = series ? computeTrend(series, "count") : null;

  // Bug coverage: share of hang time whose signature is tracked by a bug.
  let trackedMs = 0;
  const bugIds = new Set<number>();
  for (const sig of profile.signatures) {
    if (sig.knownBug) {
      trackedMs += sig.duration;
      bugIds.add(sig.knownBug.id);
    }
  }
  const coverage = profile.totalDuration > 0 ? trackedMs / profile.totalDuration : 0;

  return (
    <div className="kpi-grid">
      <KpiTile
        label="Hang time"
        value={formatSeconds(profile.totalDuration)}
        unit="s"
        sub={`Build ${formatDate(profile.date)}`}
        chip={<TrendChip trend={msTrend} />}
      />
      <KpiTile
        label="Hangs"
        value={formatCount(profile.totalCount)}
        sub="reported this build"
        chip={<TrendChip trend={countTrend} />}
      />
      <KpiTile
        label="Distinct signatures"
        value={profile.signatures.length.toLocaleString()}
        sub="unique hang stacks"
      />
      <KpiTile
        label="Tracked by a bug"
        value={`${Math.round(coverage * 100)}%`}
        sub={`${bugIds.size.toLocaleString()} bug${bugIds.size === 1 ? "" : "s"} · by hang time`}
      />
    </div>
  );
}

function KpiTile({
  label,
  value,
  unit,
  sub,
  chip,
}: {
  label: string;
  value: string;
  unit?: string;
  sub: string;
  chip?: React.ReactNode;
}) {
  return (
    <div className="kpi-tile">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">
        {value}
        {unit && <span className="kpi-unit">{unit}</span>}
      </div>
      <div className="kpi-foot">
        {chip}
        <span className="kpi-sub">{sub}</span>
      </div>
    </div>
  );
}

// -- Volume over time --------------------------------------------------------

function VolumeCard({ index }: { index: TimeseriesIndex | undefined }) {
  const [metric, setMetric] = useState<Metric>("ms");
  if (!index) {
    return null;
  }
  const totals = index.totals();
  const values = metric === "ms" ? totals.ms : totals.count;
  const range = `${formatDate(index.dates[0])} – ${formatDate(index.dates[index.dates.length - 1])}`;

  return (
    <div className="ov-card">
      <div className="ov-card-head">
        <h2>
          Hang volume over time
          <InfoTip label="Hang volume over time">
            Total hang {metric === "ms" ? "time" : "count"} per day summed across
            the tracked top signatures, over {index.dates.length} days ({range}).
            The dot marks the peak day. This is tracked volume, not the absolute
            total, so it reads as a health trend rather than a raw quantity.
          </InfoTip>
        </h2>
        <div className="ts-toggle">
          <button className={metric === "ms" ? "active" : ""} onClick={() => setMetric("ms")}>
            ms
          </button>
          <button className={metric === "count" ? "active" : ""} onClick={() => setMetric("count")}>
            count
          </button>
        </div>
      </div>
      <div className="ov-chart">
        <VolumeChart dates={index.dates} values={values} metric={metric} />
      </div>
    </div>
  );
}

// -- Worst offenders ---------------------------------------------------------

function TopHangsCard({
  profile,
  trendById,
  state,
}: {
  profile: ProcessedProfile;
  trendById: Map<string, TrendSummary | null>;
  state: { thread: string; date: string };
}) {
  const top = profile.signatures.slice(0, 8);
  return (
    <div className="ov-card">
      <div className="ov-card-head">
        <h2>Top hangs by time</h2>
        <Link className="ov-link" to={{ pathname: "/top-hangs", search: detailSearch(state) }}>
          All hangs →
        </Link>
      </div>
      <table className="ov-table">
        <thead>
          <tr>
            <th className="rank">#</th>
            <th>Signature</th>
            <th className="num">Share</th>
            <th className="num">Time</th>
            <th>Trend</th>
          </tr>
        </thead>
        <tbody>
          {top.map((sig, i) => {
            const share = profile.totalDuration > 0 ? sig.duration / profile.totalDuration : 0;
            const trend = trendById.get(sig.id);
            return (
              <tr key={sig.id}>
                <td className="rank">{i + 1}</td>
                <td className="ov-sig">
                  <Link
                    to={{ pathname: "/top-hangs", search: detailSearch(state, sig.id) }}
                    title={leafName(profile, sig)}
                  >
                    {leafName(profile, sig)}
                  </Link>
                  {sig.knownBug && <span className="ov-bug">bug {sig.knownBug.id}</span>}
                </td>
                <td className="num">{(share * 100).toFixed(1)}%</td>
                <td className="num">{formatSeconds(sig.duration)}s</td>
                <td>{trend ? <TrendChip trend={trend} /> : <span className="kpi-sub">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The leaf function name of a signature (argument list stripped). */
function leafName(profile: ProcessedProfile, sig: HangSignature): string {
  if (sig.knownBug) {
    return sig.knownBug.summary;
  }
  const leaf = profile.funcNames[sig.frameKeys[0]] ?? "(root)";
  const paren = leaf.indexOf("(");
  return paren > 0 ? leaf.slice(0, paren) : leaf;
}

// -- Needs attention ---------------------------------------------------------

function AttentionCard({
  profile,
  trendById,
  state,
}: {
  profile: ProcessedProfile;
  trendById: Map<string, TrendSummary | null>;
  state: { thread: string; date: string };
}) {
  const buckets = useMemo(() => {
    const byCat: Record<TrendCategory, { sig: HangSignature; trend: TrendSummary }[]> = {
      regression: [],
      new: [],
      improvement: [],
      stable: [],
    };
    for (const sig of profile.signatures) {
      const trend = trendById.get(sig.id);
      if (!trend) {
        continue;
      }
      byCat[trendCategory(trend)].push({ sig, trend });
    }
    for (const cat of Object.keys(byCat) as TrendCategory[]) {
      byCat[cat].sort((a, b) => b.trend.recentAvg - a.trend.recentAvg);
    }
    return byCat;
  }, [profile.signatures, trendById]);

  const hasTrends = trendById.size > 0 && [...trendById.values()].some(Boolean);

  return (
    <div className="ov-card">
      <div className="ov-card-head">
        <h2>
          Needs attention
          <InfoTip label="Needs attention">
            Signatures whose recent 7-day average rose sharply (regressions) or
            that appeared after a near-zero baseline (new), ranked by recent
            volume. These are the hangs most likely worth triaging first.
          </InfoTip>
        </h2>
      </div>
      {!hasTrends ? (
        <p className="ov-empty">Trends need the timeseries artifact for this thread.</p>
      ) : (
        <>
          <AttentionGroup
            title="Regressions"
            tone="red"
            items={buckets.regression}
            profile={profile}
            state={state}
          />
          <AttentionGroup
            title="New"
            tone="blue"
            items={buckets.new}
            profile={profile}
            state={state}
          />
        </>
      )}
    </div>
  );
}

function AttentionGroup({
  title,
  tone,
  items,
  profile,
  state,
}: {
  title: string;
  tone: string;
  items: { sig: HangSignature; trend: TrendSummary }[];
  profile: ProcessedProfile;
  state: { thread: string; date: string };
}) {
  return (
    <div className="ov-attn-group">
      <div className="ov-attn-head">
        <span className={`chip ${tone}`}>{title}</span>
        <span className="kpi-sub">{items.length.toLocaleString()} total</span>
      </div>
      {items.length === 0 ? (
        <p className="ov-empty">None.</p>
      ) : (
        <ul className="ov-attn-list">
          {items.slice(0, 4).map(({ sig, trend }) => (
            <li key={sig.id}>
              <Link
                className="ov-attn-name"
                to={{ pathname: "/top-hangs", search: detailSearch(state, sig.id) }}
                title={leafName(profile, sig)}
              >
                {leafName(profile, sig)}
              </Link>
              <TrendChip trend={trend} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// -- Platform mix ------------------------------------------------------------

function PlatformCard({ profile }: { profile: ProcessedProfile }) {
  const { segments, total } = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const sig of profile.signatures) {
      for (const [os, count] of Object.entries(sig.platformStats)) {
        totals[os] = (totals[os] ?? 0) + count;
      }
    }
    let other = 0;
    for (const [os, count] of Object.entries(totals)) {
      if (!OS_ORDER.includes(os)) {
        other += count;
      }
    }
    const segs = OS_ORDER.filter((os) => totals[os] > 0).map((os) => ({
      ...OS_META[os],
      value: totals[os],
    }));
    if (other > 0) {
      segs.push({ ...OS_OTHER, value: other });
    }
    const sum = segs.reduce((s, seg) => s + seg.value, 0);
    return { segments: segs, total: sum };
  }, [profile.signatures]);

  if (total === 0) {
    return null;
  }

  return (
    <div className="ov-card">
      <div className="ov-card-head">
        <h2>
          Where hangs happen
          <InfoTip label="Where hangs happen">
            Share of hangs by operating system, weighted by hang count across all
            signatures on this build.
          </InfoTip>
        </h2>
      </div>
      <div className="ov-bar" role="img" aria-label="Hang share by operating system">
        {segments.map((seg) => (
          <div
            key={seg.label}
            className="ov-bar-seg"
            style={{ width: `${(seg.value / total) * 100}%`, background: seg.color }}
            title={`${seg.label}: ${((seg.value / total) * 100).toFixed(1)}%`}
          />
        ))}
      </div>
      <ul className="ov-legend">
        {segments.map((seg) => (
          <li key={seg.label}>
            <span className="ov-swatch" style={{ background: seg.color }} />
            {seg.label}
            <span className="ov-legend-pct">{((seg.value / total) * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
