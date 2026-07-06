/**
 * Core processing: turn a columnar BHR Profile into a merged list of hang
 * signatures, ported from fqueze/hang-stats `bhr.js`.
 *
 * What changed vs the legacy frontend: the new aggregation job already applies
 * the stack-trimming heuristics upstream (see `aggregation/heuristics.py`), so
 * we do NOT re-run `getHangFrames`-style trimming here. The stored stack is the
 * authoritative signature stack. We still do the two merge passes the frontend
 * has always done:
 *   1. stack-dedup — fold samples with identical stacks (they can differ only
 *      in runnable / annotations / platform, which are part of the backend
 *      aggregation key but not part of a displayed hang).
 *   2. bug-merge — fold distinct stacks that match the same `[bhr:<sig>]`
 *      Bugzilla whiteboard tag into a single bug row.
 */

import type { Profile, Thread } from "@/data/schema";
import { canonicalKey } from "./signatureKey";
import type {
  AnnotationStats,
  HangSignature,
  KnownBug,
  ProcessedProfile,
} from "./types";

/** Maps a bug `[bhr:...]` signature substring to its bug. */
export type BugMap = Map<string, KnownBug>;

/** Pick the thread to analyze: the main-process Gecko thread, else the first. */
function pickThread(profile: Profile): Thread | undefined {
  return (
    profile.threads.find(
      (t) => t.name === "Gecko" && t.processType === "default",
    ) ?? profile.threads[0]
  );
}

/**
 * Walk the prefix-linked stack for a sample, returning funcTable indices
 * leaf -> root. Stack index 0 is the `(root)` terminator and is excluded.
 */
function reconstructStack(thread: Thread, sampleIndex: number): number[] {
  const { stack: sampleStack } = thread.sampleTable;
  const { prefix, func } = thread.stackTable;
  const frames: number[] = [];
  let stack: number | null = sampleStack[sampleIndex];
  while (stack) {
    frames.push(func[stack]);
    stack = prefix[stack];
  }
  return frames;
}

/** Resolve a sample's annotations to a name -> value map (last value wins). */
function readAnnotations(
  thread: Thread,
  sampleIndex: number,
): Record<string, string> {
  const head = thread.sampleTable.annotations[sampleIndex];
  const annotations: Record<string, string> = {};
  if (head == null) {
    return annotations;
  }
  const { prefix, name, value } = thread.annotationsTable;
  const strings = thread.stringArray;
  let a: number | null = head;
  while (a !== null) {
    const key = strings[name[a]];
    if (key) {
      annotations[key] = strings[value[a]];
    }
    a = prefix[a];
  }
  return annotations;
}

/** Resolve a sample's platform (OS) string. */
function readPlatform(thread: Thread, sampleIndex: number): string {
  return thread.stringArray[thread.sampleTable.platform[sampleIndex]] ?? "";
}

/** Add `count` to a value's bucket in a string histogram. */
function addCount(hist: Record<string, number>, key: string, count: number): void {
  if (key) {
    hist[key] = (hist[key] ?? 0) + count;
  }
}

function addAnnotations(
  stats: AnnotationStats,
  annotations: Record<string, string>,
  count: number,
): void {
  for (const [key, value] of Object.entries(annotations)) {
    let stat = stats[key];
    if (!stat) {
      stat = { totalCount: 0, values: {} };
      stats[key] = stat;
    }
    stat.values[value] = (stat.values[value] ?? 0) + count;
    stat.totalCount += count;
  }
}

/**
 * Build a regex matching any known bug signature, plus the lookup from a
 * matched substring back to its bug. Mirrors `bhr.js` fetchBugs.
 */
function buildBugMatcher(bugs: BugMap): RegExp | null {
  if (bugs.size === 0) {
    return null;
  }
  const escape = (s: string) => s.replace(/[[\]{}()*+?.\\^$|]/g, "\\$&");
  const pattern = [...bugs.keys()].map(escape).join("|");
  return pattern ? new RegExp(pattern) : null;
}

export function buildSignatures(
  profile: Profile,
  bugs: BugMap = new Map(),
): ProcessedProfile {
  const thread = pickThread(profile);
  if (!thread) {
    throw new Error("Profile has no threads");
  }

  const day = thread.dates[0];
  const dateStr = String(day.date);
  const usageHours = profile.usageHoursByDate[dateStr] ?? 1;

  // funcTable-indexed display strings, resolved once.
  const funcNames: string[] = thread.funcTable.name.map(
    (nameIdx) => thread.stringArray[nameIdx],
  );
  const libNames: string[] = thread.funcTable.lib.map((libIdx) =>
    libIdx == null ? "" : thread.libs[libIdx].name,
  );

  const bugMatcher = buildBugMatcher(bugs);
  const bySignature = new Map<string, HangSignature>();
  // A bug's chosen representative signature, so distinct stacks merge into it.
  const byBug = new Map<number, HangSignature>();
  const signatures: HangSignature[] = [];

  const sampleCount = thread.sampleTable.length;
  const { sampleHangMs, sampleHangCount } = day;

  for (let i = 0; i < sampleCount; i++) {
    const frameKeys = reconstructStack(thread, i);
    const duration = Math.round(sampleHangMs[i]);
    const count = Math.round(sampleHangCount[i]);
    const annotations = readAnnotations(thread, i);
    const platform = readPlatform(thread, i);
    const stackKey = frameKeys.join(",");

    // Pass 1: dedup identical stacks.
    const existing = bySignature.get(stackKey);
    if (existing) {
      mergeInto(existing, { i, frameKeys, duration, annotations });
      existing.count += count;
      addAnnotations(existing.annotationStats, annotations, count);
      addCount(existing.platformStats, platform, count);
      continue;
    }

    const stableKey = canonicalKey(frameKeys, funcNames, libNames);

    // Pass 2: bug-merge — fold distinct stacks that match the same bug.
    let bug: KnownBug | undefined;
    if (bugMatcher) {
      for (const fk of frameKeys) {
        const match = funcNames[fk].match(bugMatcher);
        if (match) {
          bug = bugs.get(match[0]);
          break;
        }
      }
    }
    if (bug) {
      const bugHang = byBug.get(bug.id);
      if (bugHang) {
        mergeInto(bugHang, { i, frameKeys, duration, annotations });
        bugHang.count += count;
        addAnnotations(bugHang.annotationStats, annotations, count);
        addCount(bugHang.platformStats, platform, count);
        // Distinct stack folded into the bug — record it as a member series.
        bugHang.memberKeys.push(stableKey);
        bySignature.set(stackKey, bugHang);
        continue;
      }
    }

    // New signature.
    const annotationStats: AnnotationStats = {};
    addAnnotations(annotationStats, annotations, count);
    const sig: HangSignature = {
      id: bug ? `bug:${bug.id}` : stackKey,
      sampleIndex: i,
      frameKeys,
      duration,
      count,
      selfDuration: duration,
      stableKey,
      memberKeys: [stableKey],
      annotationStats,
      platformStats: platform ? { [platform]: count } : {},
      knownBug: bug,
    };
    signatures.push(sig);
    bySignature.set(stackKey, sig);
    if (bug) {
      byBug.set(bug.id, sig);
    }
  }

  signatures.sort((a, b) => b.duration - a.duration);

  let totalDuration = 0;
  let totalCount = 0;
  for (const sig of signatures) {
    totalDuration += sig.duration;
    totalCount += sig.count;
  }

  return {
    threadName: thread.name,
    processType: thread.processType,
    date: dateStr,
    usageHours,
    funcNames,
    libNames,
    signatures,
    totalDuration,
    totalCount,
  };
}

/** Accumulate duration and adopt a new representative stack if it's larger. */
function mergeInto(
  sig: HangSignature,
  sample: { i: number; frameKeys: number[]; duration: number; annotations: Record<string, string> },
): void {
  sig.duration += sample.duration;
  if (sample.duration > sig.selfDuration) {
    sig.selfDuration = sample.duration;
    sig.sampleIndex = sample.i;
    sig.frameKeys = sample.frameKeys;
  }
}
