/**
 * System-level hang volume over the rolling window: one series (total hang ms
 * or count per day, summed across the tracked top signatures), drawn as a
 * filled area line. A single series, so no legend — the card title names it.
 * The peak day is marked with a dot; a crosshair tooltip reads exact values.
 */

import {
  CategoryScale,
  Chart,
  Filler,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import { Line } from "react-chartjs-2";
import type { Metric } from "@/data/timeseries";
import type { LineChartRef } from "./ChartRange";
import { formatDate } from "@/format";

Chart.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler);

// Single-series blue, from the dashboard's accent. Area fill is the same hue at
// low alpha so the line stays the salient mark.
const LINE = "#0250bb";
const FILL = "rgba(2, 80, 187, 0.12)";

interface VolumeChartProps {
  dates: string[];
  values: number[];
  metric: Metric;
  /** Exposes the chart instance so the caller can drag-select a range on it. */
  chartRef?: LineChartRef;
}

export function VolumeChart({ dates, values, metric, chartRef }: VolumeChartProps) {
  let peak = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[peak]) {
      peak = i;
    }
  }
  const unit = metric === "ms" ? "ms" : "hangs";

  const data: ChartData<"line"> = {
    labels: dates.map(formatDate),
    datasets: [
      {
        label: metric === "ms" ? "Hang ms" : "Hang count",
        data: values,
        borderColor: LINE,
        backgroundColor: FILL,
        fill: true,
        pointRadius: values.map((_, i) => (i === peak ? 4 : 0)),
        pointBackgroundColor: LINE,
        pointBorderColor: "#fff",
        pointBorderWidth: 1.5,
        borderWidth: 2,
        tension: 0.25,
      },
    ],
  };

  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => `${(ctx.parsed.y ?? 0).toLocaleString()} ${unit}`,
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

  return <Line ref={chartRef} data={data} options={options} />;
}
