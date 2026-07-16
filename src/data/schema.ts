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

/** Distinct-client counts computed three ways, for the affected-users metric. */
export interface AffectedClientCounts {
  /** Exact distinct count of raw client_id (ground truth; local experiment only). */
  raw: number;
  /** Exact distinct count of salted-hashed client_id (privacy-safe; should equal raw). */
  hashed: number;
  /** HyperLogLog estimate of distinct clients (approximate; cheap and mergeable). */
  hll: number;
}

/**
 * Optional affected-clients block emitted by the experimental
 * `bhr-aggregate --client-metrics` run. Keyed by the canonical signature key
 * (see signatureKey.ts) so the frontend can attach counts to each signature.
 * When absent, the dashboard synthesizes placeholder numbers (dev only).
 */
export interface AffectedClientsArtifact {
  /** Day's distinct-client totals per method; the denominator for the % metric. */
  totalDistinct: AffectedClientCounts;
  bySignature: Record<string, AffectedClientCounts>;
}

/** Top-level shape of a `hangs_<thread>_<date>.json` artifact. */
export interface Profile {
  threads: Thread[];
  /** Maps a build-date string ("20260525") to usage hours for normalization. */
  usageHoursByDate: Record<string, number>;
  uuid: string;
  /** Present only from a `--client-metrics` run; see AffectedClientsArtifact. */
  affectedClients?: AffectedClientsArtifact;
}
