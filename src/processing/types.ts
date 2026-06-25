/** Derived types produced by the processing layer (worker) from a Profile. */

import type { FuncIndex, SampleIndex } from "@/data/schema";

/** A resolved stack frame: a function index plus its display strings. */
export interface Frame {
  funcIndex: FuncIndex;
  funcName: string;
  /** Library name, or "" for pseudo/JS frames with no native lib. */
  libName: string;
}

/** Per-annotation accumulation across all samples merged into a signature. */
export interface AnnotationStat {
  /** Total hang count across all values of this annotation key. */
  totalCount: number;
  /** value string -> summed hang count. */
  values: Record<string, number>;
}

export type AnnotationStats = Record<string, AnnotationStat>;

/** A known Bugzilla bug carrying one or more `[bhr:<signature>]` tags. */
export interface KnownBug {
  id: number;
  status: string;
  summary: string;
  /** The full `[bhr:...]` tag strings associated with this bug. */
  signatures: string[];
}

/**
 * One merged hang signature, after stack-dedup and bug-merging.
 *
 * `id` is the stable identity used everywhere (list rows, detail view, and the
 * future timeseries join): the representative stack's func indices joined, or
 * `bug:<id>` for bug-merged signatures. See the signature-identity contract.
 */
export interface HangSignature {
  id: string;
  /** Representative sample (highest single-sample duration) for stack display. */
  sampleIndex: SampleIndex;
  /** Representative stack as funcTable indices, leaf -> root. */
  frameKeys: FuncIndex[];
  /** Total hang milliseconds, summed across all merged samples. */
  duration: number;
  /** Total hang count, summed across all merged samples. */
  count: number;
  /** Highest single-sample duration seen (drives representative selection). */
  selfDuration: number;
  /**
   * Stable cross-day key of the representative stack (see signatureKey.ts).
   * Joins this signature to its timeseries entry.
   */
  stableKey: string;
  /**
   * Stable keys of every distinct stack merged into this signature. For a
   * plain signature this is just `[stableKey]`; for a bug-merged signature it
   * holds one key per contributing stack, so the timeseries view can sum them
   * into a bug total and break out the top individual stacks.
   */
  memberKeys: string[];
  annotationStats: AnnotationStats;
  knownBug?: KnownBug;
}

/** Compact, serializable result of processing a Profile in the worker. */
export interface ProcessedProfile {
  threadName: string;
  processType: string;
  /** Build-date string for the (single) day in this profile, e.g. "20260525". */
  date: string;
  /** Usage hours for `date`, used to normalize counts. */
  usageHours: number;
  /** funcTable-indexed function names (for filtering and display). */
  funcNames: string[];
  /** funcTable-indexed library names ("" when none). */
  libNames: string[];
  signatures: HangSignature[];
  totalDuration: number;
  totalCount: number;
}
