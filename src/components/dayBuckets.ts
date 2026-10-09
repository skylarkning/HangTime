/**
 * Daily or weekly bars, by the space available.
 *
 * Every bar should stay visibly separate from its neighbours, which takes a
 * few pixels per bar. A narrow chart over a long window can't give each day
 * that (the hang detail pane over a year has about 1.4px a day), so there the
 * days are grouped into weeks. A weekly bar is the week's average per day, not
 * its sum: the units stay those of a daily bar, and a partial week compares
 * fairly with a full one. Days with no data are left out of the average, as
 * the trend does.
 *
 * Weeks are counted back from the newest day, so the most recent bar is a full
 * week and any partial week falls at the old end of the window.
 */

import { useEffect, useState } from "react";

/** A day narrower than this can't fit a bar plus a separator, so use weeks. */
const MIN_PX_PER_DAY = 3;
const WEEK = 7;
/** Roughly what the y-axis labels and title take from a chart's width. */
const Y_AXIS_PX = 90;

/** The visible days, grouped into bars. Indices are into the visible window. */
export interface DayBuckets {
  /** 1 for daily bars, 7 for weekly. */
  size: number;
  /** First and last day index of each bar. */
  starts: number[];
  ends: number[];
}

export function makeBuckets(days: number, size: number): DayBuckets {
  const starts: number[] = [];
  const ends: number[] = [];
  for (let end = days - 1; end >= 0; end -= size) {
    starts.unshift(Math.max(0, end - size + 1));
    ends.unshift(end);
  }
  return { size, starts, ends };
}

/** Daily bars when each day gets enough pixels for a separated bar, else weekly. */
export function bucketSizeFor(days: number, chartWidth: number): number {
  if (chartWidth <= 0 || days === 0) {
    return 1;
  }
  return (chartWidth - Y_AXIS_PX) / days >= MIN_PX_PER_DAY ? 1 : WEEK;
}

/**
 * Average a daily series into the buckets, over the days `counts` says to
 * include (by default, the days with data). A day included but missing from
 * this series counts as zero: in a stack, a member absent on a day the bug
 * total has data contributed nothing that day. A bucket with no included day
 * is null, so it draws no bar.
 */
export function averageInto(
  buckets: DayBuckets,
  values: (number | null)[],
  counts: (day: number) => boolean = (day) => values[day] != null,
): (number | null)[] {
  return buckets.starts.map((start, b) => {
    let sum = 0;
    let days = 0;
    for (let day = start; day <= buckets.ends[b]; day++) {
      if (counts(day)) {
        sum += values[day] ?? 0;
        days++;
      }
    }
    return days > 0 ? sum / days : null;
  });
}

/**
 * An element's current width, tracked as it resizes. Returns a callback ref:
 * the element can mount after the first render (a chart drawn once its data
 * arrives), and a ref object read in an effect would miss it.
 */
export function useElementWidth(): [(el: HTMLElement | null) => void, number] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) {
      return;
    }
    setWidth(el.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return [setEl, width];
}
