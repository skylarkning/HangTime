/**
 * Shared bar geometry for the daily charts.
 *
 * A window runs from 7 to 365 days, so one fixed bar width can't suit it: a
 * week wants wide bars with air between them, a year has only a few pixels per
 * day. The plugin sizes bars from the pixels each day actually gets: a 2px gap
 * between neighbours while there's room for one, bars capped at 24px, and a
 * rounded data-end only when the bar is wide enough to show it.
 */

import type { BorderRadius, Chart, Plugin, ScriptableContext } from "chart.js";

const GAP_PX = 2;
const MAX_BAR_PX = 24;
const RADIUS_PX = 4;
/** Below this many pixels per day, a gap would leave bars thinner than it. */
const MIN_SLOT_FOR_GAP = 5;
/** Below this bar width a 4px corner would round the bar into a point. */
const MIN_BAR_FOR_RADIUS = 10;

/** Pixels available per day on the x axis. */
function slotWidth(chart: Chart): number {
  const days = chart.data.labels?.length ?? 0;
  const width = chart.chartArea?.width ?? chart.width;
  return days > 0 ? width / days : width;
}

function barWidth(chart: Chart): number {
  const slot = slotWidth(chart);
  return Math.min(MAX_BAR_PX, slot >= MIN_SLOT_FOR_GAP ? slot - GAP_PX : slot);
}

export const barGapPlugin: Plugin<"bar"> = {
  id: "barGap",
  beforeUpdate(chart) {
    const slot = slotWidth(chart);
    const fraction = slot > 0 ? barWidth(chart) / slot : 1;
    for (const dataset of chart.data.datasets) {
      dataset.categoryPercentage = 1;
      dataset.barPercentage = fraction;
    }
  },
};

/**
 * Round the data-end of whichever segment is on top of that day's stack (the
 * last dataset with a value there), and leave the rest square, so a stacked
 * bar reads as one bar. A single series is its own top segment.
 */
export function topSegmentRadius(ctx: ScriptableContext<"bar">): number | BorderRadius {
  const { chart, dataIndex, datasetIndex } = ctx;
  if (barWidth(chart) < MIN_BAR_FOR_RADIUS) {
    return 0;
  }
  const datasets = chart.data.datasets;
  for (let i = datasets.length - 1; i > datasetIndex; i--) {
    const value = datasets[i].data[dataIndex];
    if (value != null && value !== 0 && chart.isDatasetVisible(i)) {
      return 0;
    }
  }
  return { topLeft: RADIUS_PX, topRight: RADIUS_PX, bottomLeft: 0, bottomRight: 0 };
}
