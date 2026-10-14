/**
 * Where a build's hang time goes, by area, mechanism or context: the totals
 * behind the Areas page and the shares beside each option of the list's area
 * and mechanism filters.
 */

import type { HangSignature } from "@/processing/types";
import {
  CONTEXTS,
  MECHANISMS,
  NO_AREA,
  areaLabel,
  hasContext,
  type AreaFilter,
  type ContextId,
  type MechanismId,
} from "./hangAreas";

export interface BreakdownRow<K extends string> {
  key: K;
  label: string;
  ms: number;
  count: number;
  /** Signature rows in it. */
  signatures: number;
  /** Hang time in rows no bug tracks yet. */
  untrackedMs: number;
  /** Its two or three largest parts along the other dimension. */
  parts: { key: string; label: string; ms: number }[];
}

interface Measures {
  durationOf: (sig: HangSignature) => number;
  countOf: (sig: HangSignature) => number;
}

function breakdown<K extends string>(
  signatures: HangSignature[],
  keyOf: (sig: HangSignature) => K,
  labelOf: (key: K) => string,
  partOf: ((sig: HangSignature) => [string, string]) | null,
  { durationOf, countOf }: Measures,
): BreakdownRow<K>[] {
  type Building = BreakdownRow<K> & { byPart: Map<string, { label: string; ms: number }> };
  const rows = new Map<K, Building>();
  for (const sig of signatures) {
    const ms = durationOf(sig);
    const count = countOf(sig);
    if (ms <= 0 && count <= 0) {
      continue; // not on the platform the list is narrowed to
    }
    const key = keyOf(sig);
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        label: labelOf(key),
        ms: 0,
        count: 0,
        signatures: 0,
        untrackedMs: 0,
        parts: [],
        byPart: new Map(),
      };
      rows.set(key, row);
    }
    row.ms += ms;
    row.count += count;
    row.signatures += 1;
    if (!sig.knownBug) {
      row.untrackedMs += ms;
    }
    if (partOf) {
      const [partKey, partLabel] = partOf(sig);
      const part = row.byPart.get(partKey);
      if (part) {
        part.ms += ms;
      } else {
        row.byPart.set(partKey, { label: partLabel, ms });
      }
    }
  }
  return [...rows.values()]
    .map(({ byPart, ...row }) => ({
      ...row,
      parts: [...byPart]
        .map(([key, part]) => ({ key, ...part }))
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 3),
    }))
    .sort((a, b) => b.ms - a.ms);
}

const areaOf = (sig: HangSignature): AreaFilter => sig.kind.area ?? NO_AREA;
const areaName = (key: AreaFilter) => areaLabel(key === NO_AREA ? null : key);
const mechanismOf = (sig: HangSignature) => sig.kind.mechanism;
const mechanismName = (key: MechanismId) => MECHANISMS[key].label;

export function byArea(signatures: HangSignature[], measures: Measures) {
  return breakdown(
    signatures,
    areaOf,
    areaName,
    (sig) => [mechanismOf(sig), mechanismName(mechanismOf(sig))],
    measures,
  );
}

export function byMechanism(signatures: HangSignature[], measures: Measures) {
  return breakdown(
    signatures,
    mechanismOf,
    mechanismName,
    (sig) => [areaOf(sig), areaName(areaOf(sig))],
    measures,
  );
}

/**
 * Hang time in hangs most of whose reports carry each context. A hang can
 * count towards several (startup and user interacting), so the rows don't sum
 * to the total.
 */
export function byContext(
  signatures: HangSignature[],
  { durationOf, countOf }: Measures,
): { key: ContextId; label: string; ms: number; signatures: number }[] {
  return (Object.keys(CONTEXTS) as ContextId[])
    .map((key) => {
      let ms = 0;
      let rows = 0;
      for (const sig of signatures) {
        if (countOf(sig) > 0 && hasContext(sig.annotationStats, sig.count, key)) {
          ms += durationOf(sig);
          rows += 1;
        }
      }
      return { key, label: CONTEXTS[key].label, ms, signatures: rows };
    })
    .filter((row) => row.signatures > 0)
    .sort((a, b) => b.ms - a.ms);
}
