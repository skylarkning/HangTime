import type { HangSignature, ProcessedProfile, ResolvedGroup, ResolvedGroupMember } from "./types";
import { classifyStack } from "@/data/hangAreas";
import { frameHashes, stableStackId } from "./signatureKey";

export function originalGroupMember(group: ResolvedGroup, signature: HangSignature | null): ResolvedGroupMember | undefined {
  // A merged bug's stackKey can name its first member while frameKeys has
  // since adopted a different representative. Preserve what was on screen.
  return group.members.find(member => member.key === signature?.frameKeys.join(","))
    ?? group.members.find(member => signature?.memberStackKeys?.includes(member.key))
    ?? group.members[0];
}

/** Hash just this group's functions; identities stay independent of funcTable numbering. */
export function groupMemberIds(profile: ProcessedProfile, group: ResolvedGroup): Map<string, string> {
  const funcs = [...new Set(group.members.flatMap((member) => member.frameKeys))];
  const index = new Map(funcs.map((func, i) => [func, i]));
  const hashes = frameHashes(funcs.map(f => profile.funcNames[f]), funcs.map(f => profile.libNames[f]));
  return new Map(group.members.map(member => [member.key,
    stableStackId(member.frameKeys.map(f => index.get(f)!), hashes),
  ]));
}

/** Inspect the exact member, never its bug's representative stack or aggregate metrics. */
export function inspectGroupMember(profile: ProcessedProfile, member: ResolvedGroupMember, id: string): HangSignature {
  const owner = profile.signatures.find(sig => sig.id === profile.sigIdByKey?.[member.key]);
  return {
    id, sampleIndex: owner?.sampleIndex ?? 0,
    frameKeys: member.frameKeys, stackKey: member.key,
    duration: member.ms, selfDuration: member.ms, count: member.count,
    annotationStats: {}, platformStats: {}, platformMs: {},
    knownBug: owner?.knownBug,
    kind: classifyStack(member.frameKeys, profile.frameTable, profile.libNames),
  };
}

/** Original is pinned to A; removing a candidate never changes other stacks' colors. */
export function toggleComparison(slots: (string | null)[], key: string): (string | null)[] {
  if (key === slots[0]) return slots;
  const existing = slots.indexOf(key);
  if (existing > 0) return slots.map((value, i) => i === existing ? null : value);
  const free = slots.findIndex((value, i) => i > 0 && value === null);
  return free < 0 ? slots : slots.map((value, i) => i === free ? key : value);
}
