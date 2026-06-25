/**
 * Trend summary for a signature's timeseries, for triage. The question a
 * reviewer asks first is "is this getting worse, by how much, is it new, worth
 * opening?" — so we reduce a per-day series to a few robust judgements rather
 * than leave the user to read the chart.
 *
 * Robustness choices:
 *  - % change compares the recent 7-day average to the previous 7-day average,
 *    not today vs yesterday (single days are too noisy).
 *  - "new" is conservative: meaningful recent volume AND a near-zero baseline,
 *    so a single stray hang on one day does not flag as new.
 */

import type { Metric, ResolvedSeries } from "./timeseries";

export type TrendTone = "red" | "amber" | "green" | "blue" | "neutral";

export interface TrendSummary {
  /** Signed fraction (0.74 = +74%), or null when the prior window was zero. */
  changePct: number | null;
  recentAvg: number;
  priorAvg: number;
  /** Metric the % change / averages were computed on. */
  metric: Metric;
  isNew: boolean;
  /** First date of sustained activity, when `isNew`. */
  newSince: string | null;
  peakDate: string;
  peakValue: number;
  /** Number of member stacks behind the series (1 for a plain signature). */
  trackedStacks: number;
}

const RECENT_DAYS = 7;
const NEW_MIN_COUNT = 20;
const NEW_MIN_MS = 30_000;
const NEW_BASELINE_MAX_COUNT = 3;
const REGRESSION_PCT = 0.5;
const ELEVATED_PCT = 0.2;

const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
const mean = (a: number[]) => (a.length ? sum(a) / a.length : 0);

export function computeTrend(
  series: ResolvedSeries,
  metric: Metric,
): TrendSummary {
  const { ms, count } = series.total;
  const primary = metric === "ms" ? ms : count;
  const n = primary.length;

  let peakIndex = 0;
  for (let i = 1; i < n; i++) {
    if (primary[i] > primary[peakIndex]) {
      peakIndex = i;
    }
  }

  const recent = primary.slice(Math.max(0, n - RECENT_DAYS));
  const prior = primary.slice(Math.max(0, n - 2 * RECENT_DAYS), n - RECENT_DAYS);
  const recentAvg = mean(recent);
  const priorAvg = mean(prior);
  const changePct = priorAvg > 0 ? (recentAvg - priorAvg) / priorAvg : null;

  const baselineEnd = Math.max(0, n - RECENT_DAYS);
  const recentCount = sum(count.slice(baselineEnd));
  const recentMs = sum(ms.slice(baselineEnd));
  const baselineCount = sum(count.slice(0, baselineEnd));
  const baselinePrimaryMean = mean(primary.slice(0, baselineEnd));

  const meaningful = recentCount >= NEW_MIN_COUNT || recentMs >= NEW_MIN_MS;
  const nearZeroBaseline =
    baselineCount < NEW_BASELINE_MAX_COUNT ||
    baselinePrimaryMean < 0.05 * recentAvg;
  const isNew = meaningful && nearZeroBaseline;

  let newSince: string | null = null;
  if (isNew) {
    let cumBefore = 0;
    for (let i = 0; i < n; i++) {
      if (count[i] > 0 && cumBefore < NEW_BASELINE_MAX_COUNT) {
        newSince = series.dates[i];
        break;
      }
      cumBefore += count[i];
    }
  }

  return {
    changePct,
    recentAvg,
    priorAvg,
    metric,
    isNew,
    newSince,
    peakDate: series.dates[peakIndex],
    peakValue: primary[peakIndex],
    trackedStacks: series.members.length,
  };
}

/** Compact badge text + color tone for a trend, e.g. list rows. */
export function trendBadge(trend: TrendSummary): { text: string; tone: TrendTone } {
  if (trend.isNew) {
    return { text: "new", tone: "blue" };
  }
  if (trend.changePct === null) {
    return trend.recentAvg > 0
      ? { text: "↑ new", tone: "amber" }
      : { text: "stable", tone: "neutral" };
  }
  const pct = Math.round(Math.abs(trend.changePct) * 100);
  if (trend.changePct >= ELEVATED_PCT) {
    return {
      text: `↑${pct}%`,
      tone: trend.changePct >= REGRESSION_PCT ? "red" : "amber",
    };
  }
  if (trend.changePct <= -ELEVATED_PCT) {
    return { text: `↓${pct}%`, tone: "green" };
  }
  return { text: "stable", tone: "neutral" };
}
