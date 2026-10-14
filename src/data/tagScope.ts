/**
 * What a `[bhr:<tag>]` whiteboard tag would cover before anyone files it.
 *
 * The dashboard merges every hang whose stack has a function name containing
 * the tag into the bug (see process.ts `buildBugMatcher`), so a tag on a
 * generic primitive such as `WaitOnAddress` or `memcpy` would fold hundreds of
 * unrelated hangs into one bug. This picks a tag from the frames that are
 * specific to the hang, and counts what each candidate would match on the
 * build in view, using the same substring rule the merge uses.
 */

import type { HangSignature, ProcessedProfile } from "@/processing/types";
import { describeGeneric, type AreaId, type GenericFrame } from "./hangAreas";

/** How many distinctive frames to offer as tags. */
const MAX_CANDIDATES = 8;

/**
 * A frame's name as a tag: no argument list, and no line for a JS frame. It
 * stays a substring of the full name, since that is what the merge matches:
 * a name inside an anonymous namespace keeps only what follows it.
 */
export function tagText(funcName: string, libName: string): string {
  const anon = "(anonymous namespace)::";
  const inner = funcName.lastIndexOf(anon);
  let name = inner >= 0 ? funcName.slice(inner + anon.length) : funcName;
  const paren = name.indexOf("(");
  if (paren > 0) {
    name = name.slice(0, paren);
  }
  // "handleEvent /modules/Foo.sys.mjs:756": the line moves between builds.
  if (!libName) {
    name = name.replace(/(:\d+)+$/, "");
  }
  return name.trim();
}

/** Whether a tag can round-trip through `[bhr:...]` and mean something. */
function usable(tag: string): boolean {
  return tag.length >= 4 && !tag.includes("[") && !tag.includes("]") && !tag.startsWith("<");
}

export interface TagCandidate {
  /** Stack depth of the frame the tag comes from. */
  depth: number;
  tag: string;
  /** Why the frame is shared low-level code, or null when it is distinctive. */
  generic: GenericFrame | null;
}

/**
 * Tags a reporter can choose from, leaf first: the stack's distinctive Firefox
 * frames, then the frame the thread was stuck in when that is a shared
 * primitive, so it can still be picked knowingly. `preferred` indexes the
 * default: the hang's caller (the code that made the blocking call, or that
 * was running), else the frame naming its area, else the first distinctive
 * frame. Never a primitive or OS library frame while anything else exists.
 */
export function tagCandidates(
  profile: ProcessedProfile,
  signature: HangSignature,
): { candidates: TagCandidate[]; preferred: number } {
  const { frameKeys, kind } = signature;
  const { funcNames, libNames, frameTable } = profile;
  const at = (depth: number): TagCandidate | null => {
    const f = frameKeys[depth];
    if (f === undefined) {
      return null;
    }
    const tag = tagText(funcNames[f], libNames[f]);
    return usable(tag) ? { depth, tag, generic: describeGeneric(frameTable, f) } : null;
  };

  const distinctive: TagCandidate[] = [];
  const seen = new Set<string>();
  for (let d = 0; d < frameKeys.length && distinctive.length < MAX_CANDIDATES; d++) {
    const c = at(d);
    if (c && !c.generic && !seen.has(c.tag)) {
      seen.add(c.tag);
      distinctive.push(c);
    }
  }

  const pick = (depth: number) => {
    const c = depth >= 0 ? at(depth) : null;
    return c && !c.generic ? c : null;
  };
  const preferred = pick(kind.callerFrame) ?? pick(kind.areaFrame) ?? distinctive[0] ?? null;
  if (preferred && !seen.has(preferred.tag)) {
    seen.add(preferred.tag);
    distinctive.push(preferred);
    distinctive.sort((a, b) => a.depth - b.depth);
  }

  // The primitive the thread was stuck in, offered last; with nothing
  // distinctive on the stack it is the only (broad) choice.
  const candidates = [...distinctive];
  let stuck: TagCandidate | null = null;
  for (let d = Math.max(kind.mechanismFrame, 0); d < frameKeys.length && !stuck; d++) {
    const c = at(d);
    if (c && !seen.has(c.tag)) {
      stuck = c;
    }
  }
  if (stuck) {
    candidates.push(stuck);
  }
  const chosen = preferred ?? stuck;
  const index = chosen ? candidates.findIndex((c) => c.tag === chosen.tag) : -1;
  return { candidates, preferred: Math.max(index, 0) };
}

export interface TagScope {
  /** Signature rows on this build the tag would fold into the bug. */
  signatures: number;
  ms: number;
  /** ms as a share of the build's hang time. */
  share: number;
  /** Of those rows, how many another bug already tracks. */
  trackedElsewhere: number;
  /** Matched hang time by area (null: unattributed), to see if it's one problem. */
  msByArea: Map<AreaId | null, number>;
}

const scopes = new WeakMap<ProcessedProfile, Map<string, TagScope>>();
const memberFrames = new WeakMap<ProcessedProfile, Map<string, number[][]>>();

/** A bug row's stacks as funcTable indices, parsed once per build. */
function stacksOf(profile: ProcessedProfile, sig: HangSignature): number[][] {
  if (!sig.memberStackKeys) {
    return [sig.frameKeys];
  }
  let byId = memberFrames.get(profile);
  if (!byId) {
    byId = new Map();
    memberFrames.set(profile, byId);
  }
  let stacks = byId.get(sig.id);
  if (!stacks) {
    stacks = sig.memberStackKeys.map((key) => key.split(",").map(Number));
    byId.set(sig.id, stacks);
  }
  return stacks;
}

/**
 * What each tag would match on this build. Memoized per build and tag; the
 * uncached tags are resolved together in one pass over the signatures, with a
 * bit per tag on each matching function, so a handful of candidates costs
 * about what one does.
 */
export function tagScopes(profile: ProcessedProfile, tags: string[]): Map<string, TagScope> {
  let cache = scopes.get(profile);
  if (!cache) {
    cache = new Map();
    scopes.set(profile, cache);
  }
  const todo = [...new Set(tags)].filter((tag) => !cache.has(tag));
  for (let start = 0; start < todo.length; start += 32) {
    const batch = todo.slice(start, start + 32);
    for (const [tag, scope] of resolve(profile, batch)) {
      cache.set(tag, scope);
    }
  }
  return new Map(tags.map((tag) => [tag, cache.get(tag)!]));
}

function resolve(profile: ProcessedProfile, tags: string[]): Map<string, TagScope> {
  const { funcNames } = profile;
  // Same rule as the bug merge: the tag appears anywhere in the function name.
  const bits = new Uint32Array(funcNames.length);
  let any = 0;
  for (let f = 0; f < funcNames.length; f++) {
    const name = funcNames[f];
    for (let t = 0; t < tags.length; t++) {
      if (name.includes(tags[t])) {
        bits[f] |= 1 << t;
        any |= 1 << t;
      }
    }
  }

  const out: TagScope[] = tags.map(() => ({
    signatures: 0,
    ms: 0,
    share: 0,
    trackedElsewhere: 0,
    msByArea: new Map(),
  }));
  if (any) {
    for (const sig of profile.signatures) {
      let mask = 0;
      for (const stack of stacksOf(profile, sig)) {
        for (let i = 0; i < stack.length; i++) {
          mask |= bits[stack[i]];
        }
      }
      if (!mask) {
        continue;
      }
      for (let t = 0; t < tags.length; t++) {
        if (mask & (1 << t)) {
          const scope = out[t];
          scope.signatures += 1;
          scope.ms += sig.duration;
          if (sig.knownBug) {
            scope.trackedElsewhere += 1;
          }
          const area = sig.kind.area;
          scope.msByArea.set(area, (scope.msByArea.get(area) ?? 0) + sig.duration);
        }
      }
    }
  }
  for (const scope of out) {
    scope.share = profile.totalDuration > 0 ? scope.ms / profile.totalDuration : 0;
  }
  return new Map(tags.map((tag, t) => [tag, out[t]]));
}
