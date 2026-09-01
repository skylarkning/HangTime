/**
 * Firefox release-cycle dates, overlaid on the History timeseries so a newly
 * appeared or spiking hang can be lined up against a Firefox train (a release,
 * or the day a version reaches Beta or Nightly, is a common cause of a
 * regression or a fresh signature showing up).
 *
 * Source: https://whattrainisitnow.com/calendar/ (Firefox rapid release, ~4-week
 * cadence, with the usual longer cycle across the December holidays). This is a
 * static snapshot taken 2026-09-01; refresh it from that calendar as the
 * schedule advances (155 onwards moved off the four-week cadence).
 * Dates are "YYYYMMDD" to match the artifact's build-date strings.
 *
 * Each train exposes the three calendar milestones the site shows: the day it
 * enters Nightly, the day it enters Beta, and its release (GA) day. On any given
 * merge day version N ships, N+1 goes to Beta, and N+2 opens on Nightly, so a
 * single day on the chart can carry all three.
 */

export interface FirefoxTrain {
  /** Major version number, e.g. "150". */
  version: string;
  /** Day this version opened on Nightly ("YYYYMMDD"). */
  nightly: string;
  /** Day this version entered Beta ("YYYYMMDD"). */
  beta: string;
  /** Release (GA) day ("YYYYMMDD"). */
  release: string;
}

export const FIREFOX_TRAINS: FirefoxTrain[] = [
  { version: "135", nightly: "20241126", beta: "20250107", release: "20250204" },
  { version: "136", nightly: "20250107", beta: "20250204", release: "20250304" },
  { version: "137", nightly: "20250204", beta: "20250304", release: "20250401" },
  { version: "138", nightly: "20250304", beta: "20250401", release: "20250429" },
  { version: "139", nightly: "20250401", beta: "20250429", release: "20250527" },
  { version: "140", nightly: "20250429", beta: "20250527", release: "20250624" },
  { version: "141", nightly: "20250527", beta: "20250624", release: "20250722" },
  { version: "142", nightly: "20250624", beta: "20250722", release: "20250819" },
  { version: "143", nightly: "20250722", beta: "20250819", release: "20250916" },
  { version: "144", nightly: "20250819", beta: "20250916", release: "20251014" },
  { version: "145", nightly: "20250916", beta: "20251014", release: "20251111" },
  { version: "146", nightly: "20251014", beta: "20251111", release: "20251209" },
  { version: "147", nightly: "20251111", beta: "20251209", release: "20260113" },
  { version: "148", nightly: "20251209", beta: "20260113", release: "20260224" },
  { version: "149", nightly: "20260113", beta: "20260225", release: "20260324" },
  { version: "150", nightly: "20260224", beta: "20260325", release: "20260421" },
  { version: "151", nightly: "20260324", beta: "20260422", release: "20260519" },
  { version: "152", nightly: "20260421", beta: "20260520", release: "20260616" },
  { version: "153", nightly: "20260519", beta: "20260617", release: "20260721" },
  { version: "154", nightly: "20260616", beta: "20260722", release: "20260818" },
  { version: "155", nightly: "20260721", beta: "20260817", release: "20260901" },
  { version: "156", nightly: "20260816", beta: "20260827", release: "20260915" },
  { version: "157", nightly: "20260827", beta: "20260910", release: "20260929" },
  { version: "158", nightly: "20260910", beta: "20260924", release: "20261013" },
];

export type ReleasePhase = "release" | "beta" | "nightly";

/** Display metadata per phase; `rank` orders stacked labels (release first). */
export const PHASE_META: Record<
  ReleasePhase,
  { label: string; color: string; rank: number }
> = {
  release: { label: "Release", color: "#d76e00", rank: 0 }, // --orange
  beta: { label: "Beta", color: "#0250bb", rank: 1 }, // --blue
  nightly: { label: "Nightly", color: "#058b00", rank: 2 }, // --green
};

/** One train milestone falling on a given chart column. */
export interface ReleaseEvent {
  version: string;
  phase: ReleasePhase;
}

/** All milestones landing on a single sample-date column. */
export interface ReleaseColumnMarker {
  /** Index into the chart's category axis (the sample-date columns). */
  index: number;
  /** The sample date this column represents ("YYYYMMDD"). */
  date: string;
  /** Milestones on this day, release first, then beta, then nightly. */
  events: ReleaseEvent[];
}

/**
 * Place the train milestones (Nightly / Beta / Release) that fall inside a
 * window of sorted "YYYYMMDD" sample dates onto that axis, grouped by column so
 * a day carrying several milestones is drawn once with stacked labels. A
 * milestone landing between two sample days snaps to the first sample on or
 * after it. Milestones outside the window are dropped.
 */
export function releaseMarkersForDates(dates: string[]): ReleaseColumnMarker[] {
  if (dates.length === 0) {
    return [];
  }
  const first = dates[0];
  const last = dates[dates.length - 1];
  const snap = (date: string): number | null => {
    if (date < first || date > last) {
      return null;
    }
    const i = dates.findIndex((d) => d >= date);
    return i < 0 ? dates.length - 1 : i;
  };

  const byIndex = new Map<number, ReleaseColumnMarker>();
  const add = (version: string, phase: ReleasePhase, date: string) => {
    const index = snap(date);
    if (index == null) {
      return;
    }
    let marker = byIndex.get(index);
    if (!marker) {
      marker = { index, date: dates[index], events: [] };
      byIndex.set(index, marker);
    }
    marker.events.push({ version, phase });
  };

  for (const train of FIREFOX_TRAINS) {
    add(train.version, "nightly", train.nightly);
    add(train.version, "beta", train.beta);
    add(train.version, "release", train.release);
  }

  // Rapid release lands a version's Release, the next's Beta, and the one
  // after's Nightly on the same merge day (the calendar's 1-day offsets are
  // just Nightly opening vs Beta the following day). Coalesce milestones within
  // a couple of columns into one marker so the day draws as a single line with
  // stacked labels rather than overlapping near-adjacent lines.
  const MERGE_GAP = 2;
  const sorted = [...byIndex.values()].sort((a, b) => a.index - b.index);
  const merged: ReleaseColumnMarker[] = [];
  for (const marker of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && marker.index - prev.index <= MERGE_GAP) {
      prev.events.push(...marker.events);
    } else {
      merged.push({ index: marker.index, date: marker.date, events: [...marker.events] });
    }
  }
  for (const marker of merged) {
    marker.events.sort((a, b) => PHASE_META[a.phase].rank - PHASE_META[b.phase].rank);
  }
  return merged;
}
