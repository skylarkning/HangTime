/**
 * What a near-duplicate group's members have in common, said with the
 * confidence the evidence supports.
 *
 * The aggregation job groups stacks by their first meaningful frame. That
 * frame is shared by construction, but sharing it can mean very different
 * things: a 1,000-stack group whose members all wait on the same lock from a
 * dozen unrelated callers is one blocking mechanism, possibly many problems;
 * a group whose members all come from one caller is most likely one problem.
 * So each member is classified (data/hangAreas.ts) and the group is labelled:
 *
 *  - **Same bug**: every member is already tracked by one bug.
 *  - **Shared blocking mechanism**: members come from different callers or
 *    areas, and most of their time is a blocking wait (a lock, sync IPC, file
 *    I/O). One wait, possibly several problems; one fix may not cover all.
 *  - **Shared code, different callers**: members come from different callers
 *    or areas, running the same non-blocking code (a hash-table lookup, a
 *    JS property get, an idle-callback wrapper). Shared code, not one problem.
 *  - **Similar call paths**: members mostly share a caller and an area, and
 *    diverge below the shared frame. Likely related, not confirmed the same.
 *
 * "Different callers or areas" means no single caller, or no single area,
 * accounts for 60% of the group's hang time. On the 1,713 groups of the
 * 2026-04-15 full-sample artifact that marks 299 groups (about one in six,
 * holding 13% of grouped hang time); 50% would mark 119 and 70% would mark
 * 447. A blocking share of 60% then separates the 15 shared-mechanism groups.
 */

import type { FramePair } from "./schema";
import type {
  HangSignature,
  KnownBug,
  ProcessedProfile,
  ResolvedGroup,
  ResolvedGroupMember,
} from "@/processing/types";
import {
  classifyStack,
  mechanismLabel,
  type HangKind,
  type MechanismId,
} from "./hangAreas";

export type GroupRelation = "same-bug" | "shared-mechanism" | "shared-code" | "similar-paths";

export const RELATION_LABELS: Record<GroupRelation, string> = {
  "same-bug": "Same bug",
  "shared-mechanism": "Shared blocking mechanism",
  "shared-code": "Shared code, different callers",
  "similar-paths": "Similar call paths",
};

/** A group member with its own classification and the caller it names. */
export interface ClassifiedMember {
  member: ResolvedGroupMember;
  kind: HangKind;
  /** The member's Firefox caller (argument list dropped), or "". */
  caller: string;
  /**
   * The frame that best tells this member apart from the rest of the group,
   * or null when nothing on its stack does (it differs only in noise).
   */
  distinguishing: FramePair | null;
  /** The displayed row this stack belongs to, if any. */
  signature?: HangSignature;
}

export interface GroupExplanation {
  relation: GroupRelation;
  /** The shared frame, argument list dropped. */
  sharedFrame: string;
  /** Distinct callers and areas across the members. */
  callers: number;
  areas: number;
  /** The tracking bug, for "same bug". */
  bug?: KnownBug;
  /** The dominant blocking mechanism's label, for "shared blocking mechanism". */
  mechanism?: string;
  members: ClassifiedMember[];
}

/**
 * A frame shared by more than this share of a group's members doesn't tell a
 * member apart, whatever else it is.
 */
const DISTINCTIVE_SHARE = 0.5;

/** Below this share for the top caller or area, members are "different". */
const DIVERGENT_SHARE = 0.6;
/** At least this share of time in blocking waits makes a shared mechanism. */
const BLOCKING_SHARE = 0.6;

const BLOCKING = new Set<MechanismId>([
  "file-io",
  "registry",
  "library-load",
  "process-launch",
  "clipboard",
  "gpu-driver",
  "network",
  "com-call",
  "lock-wait",
  "blocking-wait",
  "sleep",
  "sync-ipc",
  "thread-join",
  "idle-wait",
]);

function shortSymbol(funcName: string): string {
  const paren = funcName.indexOf("(");
  return paren <= 0 ? funcName : funcName.slice(0, paren);
}

/** A JavaScript frame of Firefox's own: "handleEvent resource://.../Foo.sys.mjs:756". */
function isScriptFrame(profile: ProcessedProfile, func: number): boolean {
  const name = profile.funcNames[func];
  return profile.libNames[func] === "" && /\S+:\d+$/.test(name) && !name.includes("self-hosted:");
}

/** Signature lookup by id, built once per processed profile. */
const signaturesById = new WeakMap<ProcessedProfile, Map<string, HangSignature>>();

function signatureOf(profile: ProcessedProfile, key: string): HangSignature | undefined {
  let byId = signaturesById.get(profile);
  if (!byId) {
    byId = new Map(profile.signatures.map((sig) => [sig.id, sig]));
    signaturesById.set(profile, byId);
  }
  const id = profile.sigIdByKey?.[key];
  return id ? byId.get(id) : undefined;
}

/** Explanations by group, worked out once per group of a processed profile. */
const explained = new WeakMap<ResolvedGroup, GroupExplanation>();

export function explainGroup(profile: ProcessedProfile, group: ResolvedGroup): GroupExplanation {
  const cached = explained.get(group);
  if (cached) {
    return cached;
  }

  const shared = shortSymbol(group.leafFrame[0]);
  const classified = group.members.map((member) => {
    const kind = classifyStack(member.frameKeys, profile.frameTable, profile.libNames);
    const callerIndex = kind.callerFrame >= 0 ? member.frameKeys[kind.callerFrame] : undefined;
    // Where this member could differ from its siblings, most specific first:
    // the frame the aggregation job found, then the frames naming its area,
    // what it was doing, and its caller, and last the first JavaScript frame
    // (members that differ only in which script set them off).
    const frameAt = (depth: number): FramePair | null => {
      const f = depth >= 0 ? member.frameKeys[depth] : undefined;
      return f === undefined ? null : [profile.funcNames[f], profile.libNames[f]];
    };
    const candidates = [
      member.firstUniqueFrame,
      frameAt(kind.areaFrame),
      frameAt(kind.activityFrame),
      frameAt(kind.callerFrame),
      frameAt(member.frameKeys.findIndex((f) => isScriptFrame(profile, f))),
    ].filter((f): f is FramePair => !!f && shortSymbol(f[0]) !== shared);
    return {
      member,
      kind,
      caller: callerIndex === undefined ? "" : shortSymbol(profile.funcNames[callerIndex]),
      signature: signatureOf(profile, member.key),
      candidates,
    };
  });

  // The aggregation job's first unique frame is sometimes the same for most of
  // a group (the frame right past the shared one), which tells no member
  // apart. Take each member's first candidate that at most half the group
  // shares, else its first candidate at all.
  const holders = new Map<string, number>();
  for (const c of classified) {
    for (const name of new Set(c.candidates.map((f) => shortSymbol(f[0])))) {
      holders.set(name, (holders.get(name) ?? 0) + 1);
    }
  }
  const limit = classified.length * DISTINCTIVE_SHARE;
  const members: ClassifiedMember[] = classified.map(({ candidates, ...m }) => ({
    ...m,
    distinguishing:
      candidates.find((f) => (holders.get(shortSymbol(f[0])) ?? 0) <= limit) ??
      candidates[0] ??
      null,
  }));

  // Shares by hang time; a member with no recorded time still counts a little,
  // so a group of zero-time stacks isn't empty.
  const weight = (m: ClassifiedMember) => Math.max(m.member.ms, 1);
  const byCaller = new Map<string, number>();
  const byArea = new Map<string, number>();
  const byMechanism = new Map<MechanismId, number>();
  let total = 0;
  let blocking = 0;
  for (const m of members) {
    const w = weight(m);
    total += w;
    byCaller.set(m.caller, (byCaller.get(m.caller) ?? 0) + w);
    const area = m.kind.area ?? "";
    byArea.set(area, (byArea.get(area) ?? 0) + w);
    byMechanism.set(m.kind.mechanism, (byMechanism.get(m.kind.mechanism) ?? 0) + w);
    if (BLOCKING.has(m.kind.mechanism)) {
      blocking += w;
    }
  }
  const topShare = (counts: Map<string, number>) =>
    total > 0 ? Math.max(0, ...counts.values()) / total : 1;
  const divergent = Math.min(topShare(byCaller), topShare(byArea)) < DIVERGENT_SHARE;

  const bugs = new Set(members.map((m) => m.signature?.knownBug?.id));
  const bug = members[0]?.signature?.knownBug;

  let relation: GroupRelation;
  let mechanism: string | undefined;
  if (bug && bugs.size === 1) {
    relation = "same-bug";
  } else if (divergent && total > 0 && blocking / total >= BLOCKING_SHARE) {
    relation = "shared-mechanism";
    const [top] = [...byMechanism].sort((a, b) => b[1] - a[1])[0];
    mechanism = mechanismLabel({ mechanism: top });
  } else if (divergent) {
    relation = "shared-code";
  } else {
    relation = "similar-paths";
  }

  const explanation: GroupExplanation = {
    relation,
    sharedFrame: shared,
    callers: byCaller.size,
    areas: byArea.size,
    bug: relation === "same-bug" ? bug : undefined,
    mechanism,
    members,
  };
  explained.set(group, explanation);
  return explanation;
}

/** One sentence saying why the group exists and how far to trust it. */
export function relationSentence(e: GroupExplanation, memberCount: number): string {
  const spread =
    `${e.callers.toLocaleString()} different caller${e.callers === 1 ? "" : "s"} ` +
    `in ${e.areas.toLocaleString()} area${e.areas === 1 ? "" : "s"}`;
  switch (e.relation) {
    case "same-bug":
      return `All ${memberCount.toLocaleString()} stacks are tracked by bug ${e.bug?.id}.`;
    case "shared-mechanism":
      return (
        `Every stack reaches ${e.sharedFrame}, from ${spread}. They share a blocking ` +
        `mechanism (${e.mechanism}), not necessarily a cause: one fix may not cover them all.`
      );
    case "shared-code":
      return (
        `Every stack runs through ${e.sharedFrame}, called from ${spread}. Shared code ` +
        `rather than one problem: check the stacks one by one.`
      );
    case "similar-paths":
      return (
        `Every stack shares ${e.sharedFrame} and diverges below it, mostly from the same ` +
        `caller. Likely related, not confirmed to be the same issue.`
      );
  }
}
