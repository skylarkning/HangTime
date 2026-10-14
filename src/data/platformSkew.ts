/**
 * How a hang's platform mix compares with all hangs on the build.
 *
 * A hang's raw platform shares mostly restate who uses Firefox: nearly every
 * hang is mostly Windows because most hang reports are. What says something
 * about the hang is a platform carrying more of it than that platform carries
 * of hangs overall. So each platform's share of this hang is set against its
 * share of every hang on the build, as a ratio (1× = in line with all hangs).
 *
 * The baseline is all hangs, not all users: the artifact has no per-platform
 * user or usage counts yet (bug 2081885 asks the aggregation job for them). A platform is only called out when the gap is big
 * (1.5× or more), backed by enough reports (20+ on that platform), and unlikely
 * to be chance (more than three standard deviations from what the baseline
 * share predicts), so a handful of macOS reports can't produce a dramatic "5×".
 */

import type { ProcessedProfile } from "@/processing/types";
import { PLATFORMS, platformLabel, type Platform } from "./platforms";

/** Fewer reports than this and the shares are too noisy to compare. */
const MIN_REPORTS = 30;
/** A platform called out needs at least this many of the hang's reports. */
const MIN_PLATFORM_REPORTS = 20;
const NOTABLE_RATIO = 1.5;
const NOTABLE_Z = 3;
/** At or above this share, the hang is treated as one platform's. */
const SINGLE_PLATFORM_SHARE = 0.99;

export interface PlatformRow {
  os: Platform;
  label: string;
  /** This hang's reports on the platform. */
  count: number;
  /** Share of this hang's reports, 0..1. */
  share: number;
  /** The platform's share of all hangs on the build, 0..1. */
  baseline: number;
  /** share / baseline: 1 is in line with all hangs. Null without a baseline. */
  ratio: number | null;
  /** More of this hang than of hangs overall, by enough to mean something. */
  notable: boolean;
}

export type PlatformVerdict =
  | { kind: "too-few"; reports: number }
  | { kind: "single"; os: Platform; share: number; reports: number }
  | { kind: "skewed"; rows: PlatformRow[] }
  | { kind: "in-line" };

export interface PlatformSkew {
  reports: number;
  rows: PlatformRow[];
  verdict: PlatformVerdict;
}

const baselineCache = new WeakMap<ProcessedProfile, Record<string, number>>();

/** Hang reports per platform across every signature on the build. */
export function platformBaseline(profile: ProcessedProfile): Record<string, number> {
  let baseline = baselineCache.get(profile);
  if (!baseline) {
    baseline = {};
    for (const sig of profile.signatures) {
      for (const [os, count] of Object.entries(sig.platformStats)) {
        baseline[os] = (baseline[os] ?? 0) + count;
      }
    }
    baselineCache.set(profile, baseline);
  }
  return baseline;
}

export function platformSkew(
  platformStats: Record<string, number>,
  baselineCounts: Record<string, number>,
): PlatformSkew {
  const reports = Object.values(platformStats).reduce((a, b) => a + b, 0);
  const baselineTotal = Object.values(baselineCounts).reduce((a, b) => a + b, 0);

  const rows: PlatformRow[] = PLATFORMS.map((os) => {
    const count = platformStats[os] ?? 0;
    const share = reports > 0 ? count / reports : 0;
    const baseline = baselineTotal > 0 ? (baselineCounts[os] ?? 0) / baselineTotal : 0;
    const ratio = baseline > 0 ? share / baseline : null;
    // How far the count sits from what the baseline share predicts, in
    // standard deviations of a binomial with that share.
    const expected = reports * baseline;
    const sd = Math.sqrt(reports * baseline * (1 - baseline));
    const z = sd > 0 ? (count - expected) / sd : 0;
    // Judged on the ratio as displayed (one decimal), so a row reading "1.5×"
    // is never left out of a verdict that calls out 1.5× and up.
    const shownRatio = ratio == null ? null : Math.round(ratio * 10) / 10;
    const notable =
      reports >= MIN_REPORTS &&
      shownRatio != null &&
      shownRatio >= NOTABLE_RATIO &&
      count >= MIN_PLATFORM_REPORTS &&
      z >= NOTABLE_Z;
    return { os, label: platformLabel(os), count, share, baseline, ratio, notable };
  });

  let verdict: PlatformVerdict;
  const top = rows.reduce((a, b) => (b.share > a.share ? b : a));
  if (reports < MIN_REPORTS) {
    verdict = { kind: "too-few", reports };
  } else if (top.share >= SINGLE_PLATFORM_SHARE) {
    verdict = { kind: "single", os: top.os, share: top.share, reports };
  } else {
    const skewed = rows
      .filter((row) => row.notable)
      .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));
    verdict = skewed.length > 0 ? { kind: "skewed", rows: skewed } : { kind: "in-line" };
  }
  return { reports, rows, verdict };
}
