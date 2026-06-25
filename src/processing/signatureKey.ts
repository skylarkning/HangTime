/**
 * Stable, cross-day signature key. A hang signature is identified across daily
 * artifacts by the content of its stack — funcTable indices are per-file and
 * cannot be used. This must stay byte-for-byte identical to the Python side
 * (`bhr_timeseries.canonical_key`) so the frontend can join a displayed
 * signature to its timeseries entry.
 *
 * Key = each frame's `funcName <FIELD_SEP> libName`, leaf -> root, frames joined
 * by `FRAME_SEP`. The separators are control characters that cannot occur in a
 * symbol or library name.
 */

const FIELD_SEP = "\x1f";
const FRAME_SEP = "\x1e";

/** Build the key from funcTable indices plus the resolved name/lib arrays. */
export function canonicalKey(
  frameKeys: number[],
  funcNames: string[],
  libNames: string[],
): string {
  return frameKeys
    .map((fk) => `${funcNames[fk]}${FIELD_SEP}${libNames[fk]}`)
    .join(FRAME_SEP);
}

/** Build the key from a timeseries signature's `[funcName, libName]` frames. */
export function canonicalKeyFromFrames(frames: [string, string][]): string {
  return frames.map(([name, lib]) => `${name}${FIELD_SEP}${lib}`).join(FRAME_SEP);
}
