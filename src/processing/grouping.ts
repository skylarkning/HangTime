/**
 * Helpers for presenting near-duplicate leaf-frame groups. The signatures that
 * share a leaf frame (members of a backend leaf-frame group) are surfaced in
 * the detail pane for a selected hang; each member is labeled by the earliest
 * frame that distinguishes it from its siblings.
 */

import type { HangSignature, LeafGroupInfo, ProcessedProfile } from "./types";

/**
 * One row in the hang list. Usually a single signature, but every signature in
 * a near-duplicate leaf-frame group folds into one row so the list shows one
 * entry per underlying hang. The per-variant / per-stack breakdown lives in the
 * detail pane.
 */
export interface ListRow {
  /** Representative signature (highest single-hang duration in the fold). */
  rep: HangSignature;
  /** Hang ms / count summed across the folded signatures. */
  duration: number;
  count: number;
  /** How many raw signatures this row represents (1 when nothing merged). */
  mergedCount: number;
}

/**
 * Collapse a ranked signature list into list rows, folding every signature in
 * the same near-duplicate group (shared `groupKey`) into one row. Signatures
 * with no group stay their own row. Rows are NOT re-sorted here; the caller
 * ranks them by the summed metric. First-appearance order is preserved so a
 * stable sort keeps ties in rank order.
 */
export function buildListRows(
  signatures: HangSignature[],
  lookup: Record<string, LeafGroupInfo> | undefined,
): ListRow[] {
  const byKey = new Map<string, ListRow>();
  const rows: ListRow[] = [];
  for (const sig of signatures) {
    const key = lookup?.[sig.stableKey]?.groupKey || sig.id;
    let row = byKey.get(key);
    if (!row) {
      row = { rep: sig, duration: 0, count: 0, mergedCount: 0 };
      byKey.set(key, row);
      rows.push(row);
    }
    row.duration += sig.duration;
    row.count += sig.count;
    row.mergedCount += 1;
    if (sig.duration > row.rep.duration) {
      row.rep = sig;
    }
  }
  return rows;
}

/** This member's distinguishing (first-unique) frame label, or a fallback. */
export function distinguishingLabel(
  profile: ProcessedProfile,
  sig: HangSignature,
): string {
  const info = profile.leafGroupByKey?.[sig.stableKey];
  const frame = info?.firstUniqueFrame;
  if (!frame) {
    return "(no distinguishing frame)";
  }
  return frame[1] ? `${frame[0]} ${frame[1]}` : frame[0];
}
