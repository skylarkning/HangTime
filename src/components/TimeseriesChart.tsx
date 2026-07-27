/**
 * Per-hang prevalence over time. For a plain signature this is a single line;
 * for a bug-merged signature it shows the bug total plus the top contributing
 * stacks as separate lines, so a regression in one stack is visible even when
 * the bug total is flat.
 *
 * The legend is rendered as HTML rather than via Chart.js's canvas legend:
 * stack labels are long function signatures, and only DOM text can reliably
 * ellipsize them and expose the full signature on hover.
 */

import { useMemo, useState } from "react";
import {
  CategoryScale,
  Chart,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions,
  type Plugin,
} from "chart.js";
import { Line } from "react-chartjs-2";
import type { HangSignature } from "@/processing/types";
import type {
  MemberSeries,
  Metric,
  ResolvedSeries,
  TimeseriesIndex,
} from "@/data/timeseries";
import { computeTrend, trendBadge, type TrendTone } from "@/data/trend";
import { formatCount, formatDate, formatSeconds } from "@/format";
import {
  PHASE_META,
  releaseMarkersForDates,
  type ReleaseColumnMarker,
} from "@/data/releases";
import { InfoTip } from "./InfoTip";

/**
 * Draw a dashed vertical line at each Firefox train milestone that lands in the
 * visible window, so a spike or a newly appeared hang can be read against the
 * release (or the Beta / Nightly that preceded it) that may have caused it. Each
 * day's milestones are stacked as colored "Fx NN Release/Beta/Nightly" labels;
 * the line is colored by the most prominent milestone (release > beta > nightly).
 * Markers come through the chart's plugin options as `releaseMarkers.markers`.
 */
const releaseMarkersPlugin: Plugin<"line"> = {
  id: "releaseMarkers",
  afterDatasetsDraw(chart) {
    const opts = (chart.options.plugins as Record<string, unknown> | undefined)
      ?.releaseMarkers as { markers?: ReleaseColumnMarker[] } | undefined;
    const markers = opts?.markers;
    if (!markers || markers.length === 0) {
      return;
    }
    const xScale = chart.scales.x;
    if (!xScale) {
      return;
    }
    const { ctx, chartArea } = chart;
    ctx.save();
    ctx.font = "10px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.textBaseline = "top";
    const mid = (chartArea.left + chartArea.right) / 2;
    for (const marker of markers) {
      const px = xScale.getPixelForValue(marker.index);
      if (px == null || Number.isNaN(px) || marker.events.length === 0) {
        continue;
      }
      // Line colored by the top-ranked milestone on this day (release first).
      ctx.beginPath();
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = PHASE_META[marker.events[0].phase].color;
      ctx.moveTo(px, chartArea.top);
      ctx.lineTo(px, chartArea.bottom);
      ctx.stroke();

      // Stacked, per-phase colored labels; keep them inside the plot area.
      ctx.setLineDash([]);
      const alignRight = px > mid;
      ctx.textAlign = alignRight ? "right" : "left";
      const labelX = alignRight ? px - 3 : px + 3;
      marker.events.forEach((event, i) => {
        const meta = PHASE_META[event.phase];
        ctx.fillStyle = meta.color;
        ctx.fillText(`Fx ${event.version} ${meta.label}`, labelX, chartArea.top + 1 + i * 12);
      });
    }
    ctx.restore();
  },
};

Chart.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  releaseMarkersPlugin,
);

// Distinct, color-blind-friendly line colors for the individual member stacks.
const MEMBER_COLORS = [
  "#1f77b4",
  "#ff7f0e",
  "#2ca02c",
  "#d62728",
  "#9467bd",
  "#8c564b",
];
const TOTAL_COLOR = "#111827";
const MAX_MEMBER_LINES = 5;

interface LegendItem {
  label: string;
  title: string;
  color: string;
}

interface TimeseriesChartProps {
  index: TimeseriesIndex | undefined;
  signature: HangSignature;
}

/** Full stack as a multi-line leaf->root list, for a legend item's hover title. */
function stackPath(member: MemberSeries): string {
  return member.frames.map((frame) => frame[0]).join("\n");
}

/** Drop a function signature's argument list so labels stay compact. */
function shortFunc(name: string): string {
  const paren = name.indexOf("(");
  // paren === 0 is a sentinel like "(root)" / "(unresolved)" — leave it intact.
  return paren <= 0 ? name : name.slice(0, paren);
}

/** A real symbol, not an empty or sentinel ("(root)", "(unresolved)") frame. */
function isMeaningful(name: string | undefined): name is string {
  return !!name && !name.startsWith("(");
}

/**
 * Short, scannable label per member: the leaf frame (what's actually stuck),
 * argument list stripped. Bug-merged members usually share a leaf, so when one
 * isn't distinguished at the leaf we append the first meaningful caller above
 * the point where its stack diverges from the others — "what's stuck · where
 * from". The full stack stays in the legend item's hover title.
 */
function memberLabels(members: MemberSeries[]): string[] {
  const names = members.map((m) => m.frames.map((frame) => frame[0]));
  return names.map((mine, idx) => {
    const leaf = shortFunc(mine[0] ?? "(root)");

    // Depth where mine's leaf-rooted prefix first becomes unique among members.
    let divergence = mine.length - 1;
    for (let depth = 0; depth < mine.length; depth++) {
      const unique = names.every((other, j) => {
        if (j === idx) {
          return true;
        }
        for (let i = 0; i <= depth; i++) {
          if (other[i] !== mine[i]) {
            return true; // diverges within the prefix — not a conflict
          }
        }
        return false; // shares mine's whole prefix through `depth`
      });
      if (unique) {
        divergence = depth;
        break;
      }
    }

    if (divergence === 0) {
      return leaf; // the leaf alone already distinguishes this member
    }
    for (let i = divergence; i < mine.length; i++) {
      if (isMeaningful(mine[i])) {
        const context = shortFunc(mine[i]);
        return context === leaf ? leaf : `${leaf} · ${context}`;
      }
    }
    return leaf;
  });
}

export function TimeseriesChart({ index, signature }: TimeseriesChartProps) {
  const [metric, setMetric] = useState<Metric>("ms");
  const [showAll, setShowAll] = useState(false);

  const series = useMemo<ResolvedSeries | null>(
    () => (index ? index.resolve(signature.memberKeys) : null),
    [index, signature],
  );

  if (!index) {
    return null;
  }
  if (!series) {
    return (
      <div className="detail-section">
        <h3>History</h3>
        <p className="muted">
          No timeseries data for this hang — it isn’t in the top tracked
          signatures over the window.
        </p>
      </div>
    );
  }

  const showMembers = series.members.length > 1;
  const pick = (s: { ms: number[]; count: number[] }) =>
    metric === "ms" ? s.ms : s.count;

  const trend = computeTrend(series, metric);
  const peakIndex = series.dates.indexOf(trend.peakDate);
  const unit = metric === "ms" ? "ms" : "hangs";
  const fmt = (v: number) => Math.round(v).toLocaleString();

  const chips: { text: string; tone: TrendTone; title?: string }[] = [];
  if (trend.isNew && trend.newSince) {
    chips.push({
      text: `New since ${formatDate(trend.newSince)}`,
      tone: "blue",
      title: "First sustained activity after a near-zero baseline",
    });
  } else {
    const change = trendBadge(trend);
    chips.push({
      text: change.text === "stable" ? "stable" : `${change.text} vs prior 7d`,
      tone: change.tone,
      title:
        `Recent 7d avg: ${fmt(trend.recentAvg)} ${unit}/day\n` +
        `Previous 7d avg: ${fmt(trend.priorAvg)} ${unit}/day`,
    });
  }
  chips.push({
    text: `Peak ${formatDate(trend.peakDate)}`,
    tone: "neutral",
    title: `${fmt(trend.peakValue)} ${unit}`,
  });
  if (showMembers) {
    chips.push({ text: `${trend.trackedStacks} tracked stacks`, tone: "neutral" });
  }

  const datasets: ChartData<"line">["datasets"] = [];
  const legend: LegendItem[] = [];

  const addLine = (
    label: string,
    title: string,
    data: number[],
    color: string,
    extra: object,
  ) => {
    datasets.push({
      label,
      data,
      borderColor: color,
      backgroundColor: color,
      pointRadius: 0,
      tension: 0.2,
      ...extra,
    });
    legend.push({ label, title, color });
  };

  // Labels are computed across ALL members (not just the charted top-5) so the
  // legend and the "show all" list stay consistent.
  const memberLabelsAll = showMembers ? memberLabels(series.members) : [];

  if (showMembers) {
    const bug = signature.knownBug;
    addLine(
      bug ? `Bug ${bug.id} total` : "Total",
      bug ? bug.summary : `Sum across ${series.members.length} stacks`,
      pick(series.total),
      TOTAL_COLOR,
      { borderWidth: 2.5 },
    );
    series.members.slice(0, MAX_MEMBER_LINES).forEach((member, i) => {
      addLine(
        `#${i + 1} ${memberLabelsAll[i]}`,
        stackPath(member),
        pick(member),
        MEMBER_COLORS[i % MEMBER_COLORS.length],
        { borderWidth: 1.5, borderDash: [4, 3] },
      );
    });
  } else {
    const only = series.members[0];
    addLine(shortFunc(only.label), stackPath(only), pick(only), MEMBER_COLORS[0], {
      borderWidth: 2,
    });
  }

  // Mark the peak on the primary line rather than annotating every point.
  if (peakIndex >= 0 && datasets[0]) {
    datasets[0].pointRadius = series.dates.map((_, i) =>
      i === peakIndex ? 4 : 0,
    );
    datasets[0].pointBackgroundColor = datasets[0].borderColor as string;
    datasets[0].pointBorderColor = "#fff";
    datasets[0].pointBorderWidth = 1.5;
  }

  const data: ChartData<"line"> = {
    labels: series.dates.map(formatDate),
    datasets,
  };

  // Firefox releases that fall inside the visible window, drawn as dashed
  // vertical markers by releaseMarkersPlugin.
  const releaseMarkers = releaseMarkersForDates(series.dates);
  const markerByIndex = new Map(releaseMarkers.map((m) => [m.index, m]));

  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          // Surface the train milestones on the tooltip title when the hovered
          // day carries one, so the marker is identifiable without a legend.
          title: (items) => {
            const base = items[0]?.label ?? "";
            const marker = markerByIndex.get(items[0]?.dataIndex ?? -1);
            if (!marker) {
              return base;
            }
            const parts = marker.events.map(
              (e) => `Fx ${e.version} ${PHASE_META[e.phase].label}`,
            );
            return `${base}  ·  ${parts.join(", ")}`;
          },
          label: (ctx) => {
            const value = ctx.parsed.y ?? 0;
            const unit = metric === "ms" ? "ms" : "hangs";
            return `${ctx.dataset.label}: ${value.toLocaleString()} ${unit}`;
          },
          // Append that single day's distinct affected users (and share of the
          // day's users) when the artifact carried client metrics.
          afterBody: (items) => {
            const affected = series.total.affected;
            if (!affected) {
              return "";
            }
            const i = items[0]?.dataIndex ?? 0;
            const users = affected[i] ?? 0;
            const dayTotal = series.totalAffected?.[i];
            const share =
              dayTotal && dayTotal > 0
                ? ` (${((users / dayTotal) * 100).toFixed(2)}% of users)`
                : "";
            return `Affected users: ${users.toLocaleString()}${share}`;
          },
        },
      },
    },
    scales: {
      x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
      y: {
        beginAtZero: true,
        title: {
          display: true,
          text: metric === "ms" ? "hang ms" : "hang count",
        },
      },
    },
  };
  // Custom plugin options (not part of Chart.js's typed plugin map).
  (options.plugins as Record<string, unknown>).releaseMarkers = {
    markers: releaseMarkers,
  };

  return (
    <div className="detail-section">
      <div className="ts-header">
        <h3>
          History ({series.dates.length} days)
          <InfoTip label="History">
            Daily hang time (or count) for this signature across the window, so
            you can see if it’s rising, spiking, or newly appeared. Use the
            ms/count toggle to switch metric.
            <span className="eg">
              The dot marks the peak day; dashed <em>grey</em> lines are the top
              contributing stacks for a bug. Vertical lines mark Firefox train
              milestones (<code>Fx NN</code>) so a spike or a new hang can be
              lined up against a release: <em style={{ color: "#d76e00" }}>orange
              = Release</em>, <em style={{ color: "#0250bb" }}>blue = Beta</em>,{" "}
              <em style={{ color: "#058b00" }}>green = Nightly</em>. Hover a day
              to also see the distinct users affected that day.
            </span>
          </InfoTip>
        </h3>
        <div className="ts-toggle">
          <button
            className={metric === "ms" ? "active" : ""}
            onClick={() => setMetric("ms")}
          >
            ms
          </button>
          <button
            className={metric === "count" ? "active" : ""}
            onClick={() => setMetric("count")}
          >
            count
          </button>
        </div>
      </div>
      <div className="ts-chips">
        {chips.map((chip, i) => (
          <span key={i} className={`chip ${chip.tone}`} title={chip.title}>
            {chip.text}
          </span>
        ))}
      </div>
      <div className="ts-chart">
        <Line data={data} options={options} />
      </div>
      <div className="ts-legend">
        {legend.map((item) => (
          <div className="ts-legend-item" key={item.label} title={item.title}>
            <span
              className="ts-legend-swatch"
              style={{ backgroundColor: item.color }}
            />
            <span className="ts-legend-label">{item.label}</span>
          </div>
        ))}
      </div>
      {showMembers && (
        <div className="member-detail">
          <p className="muted">
            {series.members.length} stacks merged into this bug
            {series.members.length > MAX_MEMBER_LINES && (
              <> · showing the top {MAX_MEMBER_LINES} on the chart</>
            )}
            .
            {series.members.length > MAX_MEMBER_LINES && (
              <>
                {" "}
                <button className="link" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? "Show fewer" : `Show all ${series.members.length}`}
                </button>
              </>
            )}
          </p>
          {showAll && (
            <ol className="member-list">
              {series.members.map((member, i) => (
                <li key={member.key} title={stackPath(member)}>
                  <span
                    className="member-rank"
                    style={{
                      color:
                        i < MAX_MEMBER_LINES
                          ? MEMBER_COLORS[i % MEMBER_COLORS.length]
                          : "var(--muted-2)",
                    }}
                  >
                    #{i + 1}
                  </span>
                  <span className="member-name">{memberLabelsAll[i]}</span>
                  <span className="member-stat">
                    {formatSeconds(member.totalMs)}s ·{" "}
                    {formatCount(member.totalCount)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
