/**
 * The timeseries artifact produced by the secondary `bhr-timeseries` job:
 * per-signature daily hang ms/count over a rolling window, for the top-M
 * signatures. Loaded once and indexed by stable signature key so a selected
 * hang (or a bug merging several stacks) can be joined to its history.
 */

import { canonicalKeyFromFrames } from "@/processing/signatureKey";
import type { ThreadKind } from "./dataSource";

const DATA_BASE = (import.meta.env.VITE_DATA_BASE as string | undefined) ?? "data";

/** One signature's daily series; `ms`/`count` run parallel to `dates`. */
export interface TimeseriesSignature {
  /** Representative stack as `[funcName, libName]` pairs, leaf -> root. */
  frames: [string, string][];
  totalMs: number;
  totalCount: number;
  ms: number[];
  count: number[];
}

export interface TimeseriesArtifact {
  uuid: string;
  windowStartDate: string;
  windowEndDate: string;
  topCount: number;
  /** Ordered build dates ("20260401") forming the shared x-axis. */
  dates: string[];
  signatures: TimeseriesSignature[];
}

/** Which metric a series carries. */
export type Metric = "ms" | "count";

/** A single contributing stack's series, resolved for charting. */
export interface MemberSeries {
  key: string;
  /** Leaf function name, for the legend. */
  label: string;
  frames: [string, string][];
  ms: number[];
  count: number[];
  totalMs: number;
  totalCount: number;
}

/** Resolved series for a (possibly bug-merged) signature. */
export interface ResolvedSeries {
  dates: string[];
  /** Element-wise sum across all present members. */
  total: { ms: number[]; count: number[] };
  /** Present member series, sorted by descending total ms. */
  members: MemberSeries[];
}

export class TimeseriesIndex {
  readonly dates: string[];
  private readonly byKey: Map<string, TimeseriesSignature>;

  constructor(artifact: TimeseriesArtifact) {
    this.dates = artifact.dates;
    this.byKey = new Map();
    for (const sig of artifact.signatures) {
      this.byKey.set(canonicalKeyFromFrames(sig.frames), sig);
    }
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }

  /**
   * Resolve the series for a set of member keys. Missing keys (signatures
   * outside the published top-M, or with no history) are skipped; returns null
   * if none of the members are present.
   */
  resolve(memberKeys: string[]): ResolvedSeries | null {
    const members: MemberSeries[] = [];
    for (const key of memberKeys) {
      const sig = this.byKey.get(key);
      if (!sig) {
        continue;
      }
      members.push({
        key,
        label: sig.frames[0]?.[0] ?? "(root)",
        frames: sig.frames,
        ms: sig.ms,
        count: sig.count,
        totalMs: sig.totalMs,
        totalCount: sig.totalCount,
      });
    }
    if (members.length === 0) {
      return null;
    }
    members.sort((a, b) => b.totalMs - a.totalMs);

    const n = this.dates.length;
    const total = { ms: new Array(n).fill(0), count: new Array(n).fill(0) };
    for (const member of members) {
      for (let i = 0; i < n; i++) {
        total.ms[i] += member.ms[i] ?? 0;
        total.count[i] += member.count[i] ?? 0;
      }
    }
    return { dates: this.dates, total, members };
  }
}

export async function fetchTimeseries(thread: ThreadKind): Promise<TimeseriesIndex> {
  const url = `${DATA_BASE}/hangs_timeseries_${thread}.json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return new TimeseriesIndex((await res.json()) as TimeseriesArtifact);
}
