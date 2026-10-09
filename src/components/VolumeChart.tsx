/**
 * System-level hang volume over the rolling window: one series (total hang ms
 * or count per day, summed across the tracked top signatures), drawn as daily
 * bars. Day-to-day volume is noisy, and a line through it reads every wobble as
 * a movement; bars keep each day separate, so the eye averages them into a
 * level instead. A single series, so no legend: the card title names it.
 * Where the chart is too narrow for a year of separated daily bars, the caller
 * passes weekly buckets and each bar is that week's daily average.
 */

import {
  BarElement,
  CategoryScale,
  Chart,
  LinearScale,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import type { Metric } from "@/data/timeseries";
import type { BarChartRef } from "./ChartRange";
import {
  BAR_SEPARATOR_COLOR,
  barBorderWidth,
  barGapPlugin,
  topSegmentRadius,
} from "./barStyle";
import { averageInto, type DayBuckets } from "./dayBuckets";
import { formatDate } from "@/format";

Chart.register(CategoryScale, LinearScale, BarElement, Tooltip, barGapPlugin);

// Single series in the dashboard's accent blue.
const BAR = "#0250bb";

interface VolumeChartProps {
  dates: string[];
  values: number[];
  metric: Metric;
  /** How the days are grouped into bars (daily, or weekly when space is short). */
  buckets: DayBuckets;
  /** Exposes the chart instance so the caller can drag-select a range on it. */
  chartRef?: BarChartRef;
}

export function VolumeChart({ dates, values, metric, buckets, chartRef }: VolumeChartProps) {
  const unit = metric === "ms" ? "ms" : "hangs";
  const weekly = buckets.size > 1;

  const data: ChartData<"bar"> = {
    labels: buckets.starts.map((day) => formatDate(dates[day])),
    datasets: [
      {
        label: metric === "ms" ? "Hang ms" : "Hang count",
        data: averageInto(buckets, values),
        backgroundColor: BAR,
        borderRadius: topSegmentRadius,
        borderSkipped: false,
        borderColor: BAR_SEPARATOR_COLOR,
        borderWidth: barBorderWidth,
      },
    ],
  };

  const options: ChartOptions<"bar"> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (items) => {
            const bar = items[0]?.dataIndex ?? 0;
            const start = formatDate(dates[buckets.starts[bar]]);
            return weekly ? `${start} – ${formatDate(dates[buckets.ends[bar]])}` : start;
          },
          label: (ctx) => {
            const value = Math.round(ctx.parsed.y ?? 0).toLocaleString();
            return weekly ? `${value} ${unit} per day (week average)` : `${value} ${unit}`;
          },
        },
      },
    },
    scales: {
      x: {
        ticks: { maxRotation: 0, autoSkip: true, autoSkipPadding: 14, maxTicksLimit: 8 },
        grid: { display: false },
      },
      y: { beginAtZero: true, ticks: { maxTicksLimit: 5 } },
    },
  };

  return <Bar ref={chartRef} data={data} options={options} />;
}
