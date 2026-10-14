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

/**
 * A share as a compact percentage for lists of shares: whole numbers from 10%,
 * one decimal below that, and "< 0.1%" for slivers.
 */
export function formatShare(value: number, total: number): string {
  const share = total > 0 ? value / total : 0;
  if (share > 0 && share < 0.001) {
    return `< ${(0.1).toLocaleString()}%`;
  }
  return share.toLocaleString(undefined, {
    style: "percent",
    maximumFractionDigits: share >= 0.1 ? 0 : 1,
  });
}

/** A "YYYYMMDD" build-date string as "YYYY-MM-DD". */
export function formatDate(date: string): string {
  if (/^\d{8}$/.test(date)) {
    return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  }
  return date;
}
