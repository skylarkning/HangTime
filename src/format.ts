/** Small display-formatting helpers shared across views. */

/** Hang duration is stored in ms; the dashboard shows it in seconds. */
export function formatSeconds(ms: number): string {
  const seconds = ms > 1000 ? Math.round(ms / 1000) : ms / 1000;
  return seconds.toLocaleString();
}

export function formatCount(count: number): string {
  return count.toLocaleString();
}

/** Percentage of a total, as a label like "12.3%" or "< 0.01%". */
export function formatPercentOfTotal(value: number, total: number): string {
  if (total === 0) {
    return "0%";
  }
  const percent = Math.round((value / total) * 10000) / 100;
  if (percent > 0) {
    return `${percent.toLocaleString()}%`;
  }
  return `< ${(0.01).toLocaleString()}%`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Two "YYYYMMDD" build dates as a short span: "Oct 4-10", "Sep 27-Oct 3", or
 * "Oct 4" when they're the same day. Falls back to the raw strings otherwise.
 */
export function formatDateRange(start: string, end: string): string {
  const parse = (date: string) =>
    /^\d{8}$/.test(date)
      ? { month: MONTHS[Number(date.slice(4, 6)) - 1], day: Number(date.slice(6, 8)) }
      : null;
  const a = parse(start);
  const b = parse(end);
  if (!a || !b) {
    return start === end ? start : `${start} to ${end}`;
  }
  if (start === end) {
    return `${a.month} ${a.day}`;
  }
  return a.month === b.month
    ? `${a.month} ${a.day}-${b.day}`
    : `${a.month} ${a.day}-${b.month} ${b.day}`;
}

/** A "YYYYMMDD" build-date string as "YYYY-MM-DD". */
export function formatDate(date: string): string {
  if (/^\d{8}$/.test(date)) {
    return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  }
  return date;
}
