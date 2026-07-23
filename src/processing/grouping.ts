/**
 * Fold the flat signature list into a foldable tree: signatures that share a
 * leaf frame (members of a backend leaf-frame group) collapse under one parent
 * "folder" row; everything else stays a plain signature row.
 *
 * A group only becomes a folder when at least two of its members survive the
 * current filter — a lone survivor reads better as a normal row than as a
 * folder of one. Ordering follows the incoming (already ranked) signature
 * order: a group takes the rank of its highest-ranked member.
 */

import type { HangSignature, LeafGroupInfo, ProcessedProfile } from "./types";

/** A parent folder over near-duplicate signatures sharing a leaf frame. */
export interface GroupRow {
  kind: "group";
  groupKey: string;
  displayName: string;
  /** Member signatures present in the current list, ranked as they arrived. */
  members: HangSignature[];
  /** Summed hang ms / count across the present members. */
  duration: number;
  count: number;
}

/** A plain (ungrouped) signature row. */
export interface SigRow {
  kind: "sig";
  sig: HangSignature;
}

export type ListRow = GroupRow | SigRow;

/**
 * Build the grouped row list from ranked signatures and the per-key group
 * lookup. `lookup` is undefined when the artifact carried no grouping, in which
 * case every signature is its own row.
 */
export function buildListRows(
  signatures: HangSignature[],
  lookup: Record<string, LeafGroupInfo> | undefined,
): ListRow[] {
  const groupInfo = (sig: HangSignature): LeafGroupInfo | undefined =>
    lookup?.[sig.stableKey];

  // First pass: bucket members by group so we know which groups have >= 2.
  const membersByGroup = new Map<string, HangSignature[]>();
  if (lookup) {
    for (const sig of signatures) {
      const info = groupInfo(sig);
      if (info) {
        const bucket = membersByGroup.get(info.groupKey) ?? [];
        bucket.push(sig);
        membersByGroup.set(info.groupKey, bucket);
      }
    }
  }

  // Second pass: emit rows in ranked order; a group is emitted once, at the
  // position of its first (highest-ranked) member.
  const rows: ListRow[] = [];
  const emitted = new Set<string>();
  for (const sig of signatures) {
    const info = groupInfo(sig);
    const members = info && membersByGroup.get(info.groupKey);
    if (info && members && members.length >= 2) {
      if (!emitted.has(info.groupKey)) {
        emitted.add(info.groupKey);
        rows.push({
          kind: "group",
          groupKey: info.groupKey,
          displayName: info.displayName,
          members,
          duration: members.reduce((s, m) => s + m.duration, 0),
          count: members.reduce((s, m) => s + m.count, 0),
        });
      }
    } else {
      rows.push({ kind: "sig", sig });
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
