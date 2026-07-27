/** Derived types produced by the processing layer (worker) from a Profile. */

import type {
  AffectedClientCounts,
  FramePair,
  FuncIndex,
  SampleIndex,
} from "@/data/schema";

export type { AffectedClientCounts };

/** A signature's membership in a near-duplicate leaf-frame group. */
export interface LeafGroupInfo {
  /** Stable id of the group (its leaf frame), shared by all its members. */
  groupKey: string;
  /** The group's readable name (shared leaf plus branch context). */
  displayName: string;
  /** How many near-duplicate signatures the group collapses. */
  memberCount: number;
  /** Total hang ms across the whole group. */
  totalMs: number;
  /** Total hang count across the whole group. */
  totalCount: number;
  /** This signature's earliest distinguishing frame within the group. */
  firstUniqueFrame: FramePair | null;
  /** Deepest frame shared by the whole group. */
  branchFrame: FramePair;
  /** Mean nested event-loop depth across the group's members. */
  avgEventLoopDepth: number;
  /**
   * Canonical key of this signature's meaningful frames. Signatures sharing it
   * are the same hang differing only in noise, and collapse into one member.
   */
  variantKey: string;
}

/**
 * A leaf-group member resolved for display: the artifact's per-member fields
 * plus the member's representative stack frames, looked up by canonical key.
 */
export interface ResolvedGroupMember {
  key: string;
  ms: number;
  count: number;
  firstUniqueFrame: FramePair | null;
  variantKey: string;
  /** Representative stack (funcTable indices, leaf -> root) for this member. */
  frameKeys: FuncIndex[];
}

/**
 * A near-duplicate group resolved for the detail pane. Built from the artifact's
 * own member list (not from merged signatures), so every member is present even
 * when several were folded into one displayed signature (e.g. a bug row).
 */
export interface ResolvedGroup {
  groupKey: string;
  displayName: string;
  memberCount: number;
  totalMs: number;
  totalCount: number;
  avgEventLoopDepth: number;
  branchFrame: FramePair;
  members: ResolvedGroupMember[];
}

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
  /** Per-signature OS histogram (platform string -> summed hang count). */
  platformStats: Record<string, number>;
  /** Distinct affected clients, counted raw / salted-hash / HLL for comparison. */
  affectedClients: AffectedClientCounts;
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
  /** Day's distinct-client totals per method (denominator for the % metric). */
  affectedClientsTotal: AffectedClientCounts;
  /** True when the counts are dashboard-synthesized (no --client-metrics data). */
  affectedClientsSynthetic: boolean;
  /**
   * Leaf-frame group membership keyed by signature key, for signatures that are
   * members of a multi-member group. Absent when the artifact carried no
   * leaf-grouping data.
   */
  leafGroupByKey?: Record<string, LeafGroupInfo>;
  /**
   * Near-duplicate groups keyed by groupKey, with every member resolved to its
   * frames. Drives the detail-pane member list and stack diff, independent of
   * how signatures were merged for the list.
   */
  groupsByKey?: Record<string, ResolvedGroup>;
  /** Canonical stack key -> the displayed signature id that stack belongs to. */
  sigIdByKey?: Record<string, string>;
}
