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

// cyrb53's seeds and multipliers (bryc, public domain).
const SEED_A = 0xdeadbeef;
const SEED_B = 0x41c6ce57;
const MUL_A = 2654435761;
const MUL_B = 1597334677;

/** cyrb53's final avalanche, mixing each 32-bit lane into the other. */
function avalanche(a: number, b: number): [number, number] {
  let h1 = a;
  let h2 = b;
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return [h1 >>> 0, h2 >>> 0];
}

/**
 * Per-function hash lanes for `stableStackId`, one pair per funcTable entry.
 * Hashing every name once keeps the per-stack work to an array lookup a frame.
 */
export interface FrameHashes {
  a: Uint32Array;
  b: Uint32Array;
}

/**
 * Hash each function's `funcName <FIELD_SEP> libName`, the same text a frame
 * contributes to the canonical key, so equal frames hash equally in any
 * artifact whatever their funcTable index.
 */
export function frameHashes(funcNames: string[], libNames: string[]): FrameHashes {
  const n = funcNames.length;
  const a = new Uint32Array(n);
  const b = new Uint32Array(n);
  for (let f = 0; f < n; f++) {
    const text = `${funcNames[f]}${FIELD_SEP}${libNames[f]}`;
    let h1 = SEED_A;
    let h2 = SEED_B;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, MUL_A);
      h2 = Math.imul(h2 ^ ch, MUL_B);
    }
    [a[f], b[f]] = avalanche(h1, h2);
  }
  return { a, b };
}

/**
 * A hang's id in links: the same for the same stack in every daily artifact,
 * unlike its funcTable indices, which only mean something in one file.
 *
 * What is hashed: for each frame, cyrb53's two 32-bit lanes over the UTF-16
 * code units of `funcName <FIELD_SEP> libName` (see `frameHashes`). Those
 * per-frame lanes are folded in leaf -> root order, xor then multiply, lane by
 * lane from cyrb53's seeds, and finished with cyrb53's avalanche, keeping 53
 * bits as cyrb53 does. It is a hash of the canonical key's frames without
 * spelling the key out, which at production scale costs gigabytes (see
 * `HangSignature.stackKey`).
 *
 * Written `s` + base36, about a dozen characters.
 */
export function stableStackId(frameKeys: number[], hashes: FrameHashes): string {
  let h1 = SEED_A;
  let h2 = SEED_B;
  for (const fk of frameKeys) {
    h1 = Math.imul(h1 ^ hashes.a[fk], MUL_A);
    h2 = Math.imul(h2 ^ hashes.b[fk], MUL_B);
  }
  const [lo, hi] = avalanche(h1, h2);
  return `s${(4294967296 * (2097151 & hi) + lo).toString(36)}`;
}

/**
 * A frame name without the parts the compiler or an edit renumbers from one
 * build to the next while the code path stays the same: MSVC and Itanium
 * lambda numbers (`<lambda_7>` vs `<lambda_5>`), the line and column in
 * clang's "lambda at file:line:col", Rust closure and impl numbers, and a JS
 * frame's line number (`write SessionWriter.sys.mjs:137` vs `:167`).
 */
export function shapeName(funcName: string, libName: string): string {
  let name = funcName
    .replace(/<lambda_[0-9a-f]+>/g, "<lambda>")
    .replace(/\{lambda\([^)]*\)#\d+\}/g, "{lambda}")
    .replace(/(lambda at [^'>]*?):\d+:\d+/g, "$1")
    .replace(/\b(impl|closure)\$\d+/g, "$1$")
    .replace(/\{closure#\d+\}/g, "{closure}");
  if (!libName) {
    name = name.replace(/:\d+(:\d+)?$/, "");
  }
  return name;
}

/**
 * A stack's shape: its canonical key with `shapeName` applied to every frame.
 * Not an identity (that stays `canonicalKey`, shared with the Python side);
 * it groups the stacks one code path produced across builds, so a hang's
 * history survives a renamed lambda or an edited JS file.
 */
export function shapeKey(frameKeys: number[], funcNames: string[], libNames: string[]): string {
  return frameKeys
    .map((fk) => `${shapeName(funcNames[fk], libNames[fk])}${FIELD_SEP}${libNames[fk]}`)
    .join(FRAME_SEP);
}

/** `shapeKey` for a timeseries signature's `[funcName, libName]` frames. */
export function shapeKeyFromFrames(frames: [string, string][]): string {
  return frames.map(([name, lib]) => `${shapeName(name, lib)}${FIELD_SEP}${lib}`).join(FRAME_SEP);
}

/**
 * The stacks a signature covers with each one's hang ms and count on the
 * build: its own, or every stack folded into it when it is a bug-merged row.
 */
export function memberStackTotals(signature: {
  stackKey: string;
  duration: number;
  count: number;
  memberStackKeys?: string[];
  memberStackMs?: number[];
  memberStackCounts?: number[];
}): { key: string; ms: number; count: number }[] {
  const { memberStackKeys: keys, memberStackMs: ms, memberStackCounts: counts } = signature;
  if (!keys) {
    return [{ key: signature.stackKey, ms: signature.duration, count: signature.count }];
  }
  return keys.map((key, i) => ({ key, ms: ms?.[i] ?? 0, count: counts?.[i] ?? 0 }));
}

/**
 * The stack keys a signature covers: its own, or every stack folded into it
 * when it is a bug-merged row.
 */
export function memberStacks(signature: {
  stackKey: string;
  memberStackKeys?: string[];
}): string[] {
  return signature.memberStackKeys ?? [signature.stackKey];
}
