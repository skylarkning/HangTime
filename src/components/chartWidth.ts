/**
 * Keeps a daily bar chart wide enough for every day to stay separate.
 *
 * A bar and its separator need MIN_DEVICE_PX_PER_DAY device pixels a day. The
 * hang detail pane over a year gets about 1.4 CSS pixels a day: enough on a 2x
 * screen, not on a 1x one. There the chart is given a minimum width and its
 * box scrolls sideways, opening on the newest days, with the y axis moved to
 * the right so it's in view at that end.
 */

import { useEffect, useLayoutEffect, useState } from "react";
import { MIN_DEVICE_PX_PER_DAY } from "./barStyle";

/** Roughly what the y-axis labels and title take from a chart's width. */
const Y_AXIS_PX = 90;

export interface DailyChartWidth {
  /** Callback ref for the scrolling box around the chart. */
  scrollRef: (el: HTMLElement | null) => void;
  /** Minimum width for the chart, when it needs more than the box; else undefined. */
  minWidth: number | undefined;
}

export function useDailyChartWidth(days: number): DailyChartWidth {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [boxWidth, setBoxWidth] = useState(0);

  useEffect(() => {
    if (!el) {
      return;
    }
    setBoxWidth(el.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => setBoxWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);

  const dpr = window.devicePixelRatio || 1;
  const needed = Math.ceil(Y_AXIS_PX + (days * MIN_DEVICE_PX_PER_DAY) / dpr);
  const minWidth = boxWidth > 0 && needed > boxWidth ? needed : undefined;

  // Open on the newest days, and stay there when the window changes.
  useLayoutEffect(() => {
    if (el && minWidth) {
      el.scrollLeft = el.scrollWidth;
    }
  }, [el, minWidth, days]);

  return { scrollRef: setEl, minWidth };
}
