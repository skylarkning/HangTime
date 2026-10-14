/**
 * Shared x-axis range control for the time charts: preset windows (last N days)
 * plus drag-to-zoom on the plot itself.
 *
 * Callers slice their data to the returned range rather than zooming the scale,
 * so everything derived from what is on screen — the peak marker, the release
 * overlay, the tick density — stays aligned with the visible days.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Chart as ChartJS } from "chart.js";

/** What react-chartjs-2 wants for a `<Line ref>`. */
export type BarChartRef = React.MutableRefObject<ChartJS<"bar"> | null | undefined>;

/** Inclusive index window into a chart's full date array. */
export interface DateRange {
  start: number;
  end: number;
}

const PRESET_DAYS = [7, 30, 90, 180, 365];
/** Narrowest window a drag may select, so a stray click can't zoom to a point. */
const MIN_SPAN = 2;
/** Below this many pixels a drag is a click, not a selection. */
const DRAG_THRESHOLD = 5;

export function fullRange(length: number): DateRange {
  return { start: 0, end: Math.max(0, length - 1) };
}

function presetRange(length: number, days: number): DateRange {
  return { start: Math.max(0, length - days), end: Math.max(0, length - 1) };
}

/** Range state, optionally opening on recent days around the selected build. */
export function useChartRange(length: number, initialDays = length, initialEnd?: number) {
  const [range, setRange] = useState<DateRange | null>(null);
  const full = fullRange(length);
  const clamped: DateRange = range
    ? {
        start: Math.max(0, Math.min(range.start, full.end)),
        end: Math.max(0, Math.min(range.end, full.end)),
      }
    : presetRange(Math.min(length, initialEnd != null && initialEnd >= 0 ? initialEnd + 1 : length), initialDays);
  const reset = useCallback(() => setRange(fullRange(length)), [length]);
  return {
    range: clamped,
    setRange,
    reset,
    isFull: clamped.start === full.start && clamped.end === full.end,
  };
}

export function ChartRangeControls({
  length,
  range,
  onChange,
  onReset,
}: {
  length: number;
  range: DateRange;
  onChange: (range: DateRange) => void;
  onReset: () => void;
}) {
  // Drop presets wider than the data, keeping the narrowest of them so the
  // "whole window" option is always offered.
  const presets = PRESET_DAYS.filter(
    (days, i) => days < length || PRESET_DAYS.findIndex((d) => d >= length) === i,
  );
  const active = presets.find((days) => {
    const p = presetRange(length, days);
    return p.start === range.start && p.end === range.end;
  });

  return (
    <div className="ts-toggle range">
      {presets.map((days) => (
        <button
          key={days}
          className={days === active ? "active" : ""}
          title={`Last ${days} days`}
          onClick={() => onChange(presetRange(length, days))}
        >
          {days}d
        </button>
      ))}
      {active === undefined && (
        <button title="Show the whole window" onClick={onReset}>
          reset
        </button>
      )}
    </div>
  );
}

/**
 * Drag-to-zoom over a category-axis chart. Attach `chartRef` to the chart,
 * spread `dragProps` on a positioned wrapper around it, and render `marquee`
 * inside that wrapper.
 */
export function useDragZoom(range: DateRange, onZoom: (range: DateRange) => void) {
  const chartRef: BarChartRef = useRef<ChartJS<"bar"> | null | undefined>(null);
  const [drag, setDrag] = useState<{ fromX: number; toX: number } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;

  const canvasX = (clientX: number): number | null => {
    const chart = chartRef.current;
    if (!chart) {
      return null;
    }
    const scale = chart.scales.x;
    const x = clientX - chart.canvas.getBoundingClientRect().left;
    return Math.min(Math.max(x, scale.left), scale.right);
  };

  const indexAt = (x: number): number => {
    const scale = chartRef.current?.scales.x;
    // At the plot's very edge the pixel rounds to half a day past the last
    // one, so keep it on a real day.
    const days = range.end - range.start + 1;
    const day = Math.round(scale?.getValueForPixel(x) ?? 0);
    return range.start + Math.min(days - 1, Math.max(0, day));
  };

  const onMouseDown = (event: React.MouseEvent) => {
    if (event.button !== 0) {
      return;
    }
    const x = canvasX(event.clientX);
    if (x != null) {
      event.preventDefault();
      setDrag({ fromX: x, toX: x });
    }
  };

  // Read at mouse-up, which happens outside this render's closure.
  const finish = useRef<() => void>(() => {});
  finish.current = () => {
    const current = dragRef.current;
    setDrag(null);
    if (!current || Math.abs(current.toX - current.fromX) < DRAG_THRESHOLD) {
      return;
    }
    const a = indexAt(Math.min(current.fromX, current.toX));
    const b = indexAt(Math.max(current.fromX, current.toX));
    if (b - a >= MIN_SPAN) {
      onZoom({ start: a, end: b });
    }
  };

  // Track the rest of the gesture on the window so releasing outside the chart
  // still completes (or cancels) the selection.
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) {
      return;
    }
    const move = (event: MouseEvent) => {
      const x = canvasX(event.clientX);
      if (x != null) {
        setDrag((d) => (d ? { ...d, toX: x } : d));
      }
    };
    // Finish at where the button came up, not at the last drawn drag: the
    // final mousemove's state may not have rendered yet, which would end the
    // selection short of the release point.
    const up = (event: MouseEvent) => {
      const x = canvasX(event.clientX);
      if (x != null && dragRef.current) {
        dragRef.current = { ...dragRef.current, toX: x };
      }
      finish.current();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [dragging]);

  const area = chartRef.current?.chartArea;
  const marquee =
    drag && area && Math.abs(drag.toX - drag.fromX) >= DRAG_THRESHOLD ? (
      <div
        className="chart-marquee"
        style={{
          left: Math.min(drag.fromX, drag.toX),
          width: Math.abs(drag.toX - drag.fromX),
          top: area.top,
          height: area.bottom - area.top,
        }}
      />
    ) : null;

  return { chartRef, dragProps: { onMouseDown }, marquee };
}
