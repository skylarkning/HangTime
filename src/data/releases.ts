/**
 * Firefox release-cycle dates, overlaid on the History timeseries so a newly
 * appeared or spiking hang can be lined up against a Firefox release (a release
 * is a common cause of a regression or a fresh signature showing up).
 *
 * Source: https://whattrainisitnow.com/calendar/ (Firefox rapid release, roughly
 * a 4-week cadence, shipped on Tuesdays). This is a static snapshot; refresh it
 * from that calendar as the schedule advances. Dates are "YYYYMMDD" to match the
 * artifact's build-date strings.
 */

export interface FirefoxRelease {
  /** Major version number, e.g. "139". */
  version: string;
  /** Release (GA) date as "YYYYMMDD". */
  date: string;
}

export const FIREFOX_RELEASES: FirefoxRelease[] = [
  { version: "135", date: "20260106" },
  { version: "136", date: "20260203" },
  { version: "137", date: "20260303" },
  { version: "138", date: "20260331" },
  { version: "139", date: "20260428" },
  { version: "140", date: "20260526" },
  { version: "141", date: "20260623" },
  { version: "142", date: "20260721" },
];

/** A release positioned on the timeseries x-axis. */
export interface ReleaseMarker {
  /** Index into the chart's category axis (the sample-date columns). */
  index: number;
  /** Short label, e.g. "Fx 139". */
  label: string;
  /** The release date as "YYYYMMDD", for the tooltip / title. */
  date: string;
}

/**
 * Place the releases that fall inside a window of sorted "YYYYMMDD" sample dates
 * onto that axis. A release landing between two sample days snaps to the first
 * sample on or after it, so the marker sits on a real column. Releases outside
 * the window are dropped.
 */
export function releaseMarkersForDates(dates: string[]): ReleaseMarker[] {
  if (dates.length === 0) {
    return [];
  }
  const first = dates[0];
  const last = dates[dates.length - 1];
  const markers: ReleaseMarker[] = [];
  for (const release of FIREFOX_RELEASES) {
    if (release.date < first || release.date > last) {
      continue;
    }
    let index = dates.findIndex((d) => d >= release.date);
    if (index < 0) {
      index = dates.length - 1;
    }
    markers.push({ index, label: `Fx ${release.version}`, date: release.date });
  }
  return markers;
}
