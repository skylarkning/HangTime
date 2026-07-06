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
import { InfoTip } from "./InfoTip";

Chart.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip);

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

  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const value = ctx.parsed.y ?? 0;
            const unit = metric === "ms" ? "ms" : "hangs";
            return `${ctx.dataset.label}: ${value.toLocaleString()} ${unit}`;
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
              The dot marks the peak day; dashed lines are the top contributing
              stacks for a bug.
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
