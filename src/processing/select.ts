/**
 * Pure, main-thread selectors over a ProcessedProfile: text filtering and
 * frame resolution. Cheap enough for the main thread at current data sizes;
 * if production-scale filtering janks, move `filterSignatures` into the worker.
 */

import type { Frame, HangSignature, ProcessedProfile } from "./types";

/**
 * A test for whether a stack (funcTable indices) contains a frame whose
 * function or library name matches `filter`, or null when there's no filter.
 * The match is case-insensitive when the filter is entirely lower-case
 * (mirrors fqueze/hang-stats).
 */
export function stackMatcher(
  profile: ProcessedProfile,
  filter: string,
): ((frameKeys: number[]) => boolean) | null {
  if (!filter) {
    return null;
  }
  const caseInsensitive = filter.toLowerCase() === filter;
  const matches = (value: string) =>
    caseInsensitive ? value.toLowerCase().includes(filter) : value.includes(filter);

  const matchingFuncs = new Set<number>();
  for (let f = 0; f < profile.funcNames.length; f++) {
    if (matches(profile.funcNames[f]) || matches(profile.libNames[f])) {
      matchingFuncs.add(f);
    }
  }
  return (frameKeys) => frameKeys.some((fk) => matchingFuncs.has(fk));
}

/** Signatures whose representative stack matches `filter` (see stackMatcher). */
export function filterSignatures(
  profile: ProcessedProfile,
  filter: string,
): HangSignature[] {
  const match = stackMatcher(profile, filter);
  return match ? profile.signatures.filter((sig) => match(sig.frameKeys)) : profile.signatures;
}

/** Resolve a signature's frame indices to displayable frames (leaf -> root). */
export function resolveFrames(
  profile: ProcessedProfile,
  frameKeys: number[],
): Frame[] {
  return frameKeys.map((fk) => ({
    funcIndex: fk,
    funcName: profile.funcNames[fk],
    libName: profile.libNames[fk],
  }));
}
