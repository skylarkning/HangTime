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

/** A "YYYYMMDD" build-date string as "YYYY-MM-DD". */
export function formatDate(date: string): string {
  if (/^\d{8}$/.test(date)) {
    return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  }
  return date;
}

/** A "YYYYMMDD" date as a short day label like "Apr 14", for running text. */
export function formatShortDate(date: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(date);
  if (!match) {
    return date;
  }
  const [, y, m, d] = match;
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))).toLocaleDateString(
    undefined,
    { month: "short", day: "numeric", timeZone: "UTC" },
  );
}
