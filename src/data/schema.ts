/**
 * TypeScript types for the BHR aggregation artifact — the columnar,
 * Firefox-Profiler-style profile produced by `./mach bhr-aggregate`.
 *
 * The format is struct-of-arrays: most tables are objects whose fields are
 * parallel arrays indexed by the same row id. Stacks are a prefix-linked list
 * rooted at index 0 (`(root)`), reconstructed by walking `prefix` pointers.
 *
 * Indices that can be absent are encoded as `null` in the JSON (e.g. the root
 * stack has `prefix === null`, the root func has `lib === null`).
 */

/** Index into a thread's `stringArray`. */
export type StringIndex = number;
/** Index into a thread's `funcTable`. */
export type FuncIndex = number;
/** Index into a thread's `stackTable` (0 is the `(root)` terminator). */
export type StackIndex = number;
/** Index into a thread's `libs` array. */
export type LibIndex = number;
/** Index into a thread's `annotationsTable`. */
export type AnnotationIndex = number;
/** Index into a thread's `sampleTable` (one row per aggregated hang stack). */
export type SampleIndex = number;

export interface Lib {
  name: string;
  offset: number;
  path: string;
  debugName: string;
  debugPath: string;
  arch: string;
}

export interface FuncTable {
  /** `stringArray` index of the function name. */
  name: StringIndex[];
  /** `libs` index of the owning library, or `null` for pseudo/JS frames. */
  lib: (LibIndex | null)[];
  length: number;
}

export interface StackTable {
  /** Parent stack row, or `null` at the `(root)` terminator (row 0). */
  prefix: (StackIndex | null)[];
  /** `funcTable` index of the frame at this stack node. */
  func: FuncIndex[];
  length: number;
}

export interface AnnotationsTable {
  /** Parent annotation row in the linked list, or `null` at the end. */
  prefix: (AnnotationIndex | null)[];
  /** `stringArray` index of the annotation name. */
  name: StringIndex[];
  /** `stringArray` index of the annotation value. */
  value: StringIndex[];
  length: number;
}

export interface SampleTable {
  /** `stackTable` index of the hang's leaf stack node. */
  stack: StackIndex[];
  /** `stringArray` index of the runnable name. */
  runnable: StringIndex[];
  /** Head of the annotations linked list for this sample, or `null`. */
  annotations: (AnnotationIndex | null)[];
  /** `stringArray` index of the platform string. */
  platform: StringIndex[];
  length: number;
}

/** Per-day hang totals; arrays run parallel to `sampleTable`. */
export interface DateData {
  /** Build date as an integer, e.g. 20260525. */
  date: number;
  /** Total hang milliseconds for each sample on this date. */
  sampleHangMs: number[];
  /** Total hang count for each sample on this date. */
  sampleHangCount: number[];
}

export interface Thread {
  name: string;
  processType: string;
  libs: Lib[];
  funcTable: FuncTable;
  stackTable: StackTable;
  annotationsTable: AnnotationsTable;
  sampleTable: SampleTable;
  stringArray: string[];
  dates: DateData[];
}

/**
 * Optional affected-clients block emitted by a `bhr-aggregate --client-metrics`
 * run. Each value is a HyperLogLog distinct-client estimate. Keyed by the
 * canonical signature key (see signatureKey.ts) so the frontend can attach the
 * count to each signature. When absent, the dashboard synthesizes a placeholder
 * (dev only).
 */
export interface AffectedClientsArtifact {
  /** Day's distinct-client total (HLL); the denominator for the % metric. */
  totalDistinct: number;
  bySignature: Record<string, number>;
}

/** A `[funcName, libName]` frame pair, leaf -> root order. */
export type FramePair = [string, string];

/** One signature folded into a leaf-frame group. */
export interface LeafGroupMembers {
  /**
   * Each member's node in the thread's stackTable, leaf -> root via `prefix`.
   * Walking it yields the funcTable indices that reproduce the canonical
   * signature key (see signatureKey.ts), which is how a member joins to a
   * displayed signature. The artifact points at the stackTable rather than
   * respelling the stack, since the profile already stores it.
   */
  stack: number[];
  ms: number[];
  count: number[];
  /**
   * funcTable index of the earliest frame separating this member from its
   * siblings, or null. An index rather than a name/lib pair, but it cannot be
   * derived here: choosing it needs the aggregation job's noise-prefix list.
   */
  firstUniqueFunc: (FuncIndex | null)[];
  /**
   * Ordinal distinguishing a member's *meaningful* stack within its group.
   * Members sharing a variant are the same hang differing only in skipped
   * noise frames, so the frontend collapses them into one deduplicated member.
   * Only unique within a group, so callers scope it by groupKey.
   */
  variant: number[];
}

/**
 * A group of near-duplicate signatures sharing a leaf frame, produced by the
 * aggregation job's leaf-frame grouping pass. Only multi-member groups are
 * emitted; the frontend joins by member key and does no fuzzy matching.
 *
 * Grouping is by each stack's first *meaningful* frame (system code, sync /
 * allocator primitives, SpiderMonkey glue, and event-loop machinery are
 * skipped), so `leafFrame`, `branchFrame`, and each member's
 * `firstUniqueFunc` are meaningful frames, not the raw stack leaf.
 */
export interface LeafGroup {
  /** Readable name: the leaf, plus its deepest shared caller when they differ. */
  displayName: string;
  leafFrame: FramePair;
  /** Deepest frame shared by the whole group (the branch point's context). */
  branchFrame: FramePair;
  memberCount: number;
  totalMs: number;
  totalCount: number;
  /** Mean nested event-loop depth across members (loops trimmed from the leaf). */
  avgEventLoopDepth: number;
  /** Parallel arrays, one entry per member, sorted by descending ms. */
  members: LeafGroupMembers;
}

/** Top-level shape of a `hangs_<thread>_<date>.json` artifact. */
export interface Profile {
  threads: Thread[];
  /** Maps a build-date string ("20260525") to usage hours for normalization. */
  usageHoursByDate: Record<string, number>;
  uuid: string;
  /** Present only from a `--client-metrics` run; see AffectedClientsArtifact. */
  affectedClients?: AffectedClientsArtifact;
  /** Near-duplicate leaf-frame groups per thread name, when grouping ran. */
  leafGroups?: Record<string, LeafGroup[]>;
}
