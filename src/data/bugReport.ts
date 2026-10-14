/**
 * Turn a hang signature into a prefilled Bugzilla bug, so filing a BHR bug
 * doesn't depend on someone hand-writing the `[bhr:...]` whiteboard tag (the
 * fragile, manual step the dashboard's bug-merge relies on).
 *
 * The whiteboard tag is `[bhr:<frame>]`, where `<frame>` is a function name
 * from the stack. The dashboard merges any hang whose stack contains a function
 * matching that substring into the bug (see data/bugs.ts + processing/process.ts),
 * so filing with this tag makes the merge automatic from the next aggregation
 * onward. Which frame to use, and what it would match, is data/tagScope.ts.
 */

import type { Frame } from "@/processing/types";
import type { BugComponent } from "./componentMap";
import {
  areaLabel,
  hangTitle,
  mechanismLabel,
  type ContextShare,
  type HangKind,
} from "./hangAreas";

const ENTER_BUG_URL = "https://bugzilla.mozilla.org/enter_bug.cgi";
const MAX_STACK_FRAMES = 20;
/** Bugzilla's limit on a summary. */
const MAX_SUMMARY = 255;

/** Drop a function signature's argument list. */
function stripArgs(name: string): string {
  const paren = name.indexOf("(");
  return paren <= 0 ? name : name.slice(0, paren);
}

/**
 * A tag as it reads in a summary: the class and method of a C++ name
 * ("StartupCache::GetBuffer" for "mozilla::scache::StartupCache::GetBuffer"),
 * or a JS function and its file ("notify (Timer.sys.mjs)").
 */
export function shortTag(tag: string): string {
  const js = /^([^\s:]*)\s+(\S*[/.]\S*)$/.exec(tag);
  if (js) {
    const file = js[2].slice(js[2].lastIndexOf("/") + 1);
    return js[1] ? `${js[1]} (${file})` : file;
  }
  // Only split outside template arguments, which carry their own "::".
  let depth = 0;
  const cuts: number[] = [];
  for (let i = 0; i < tag.length - 1; i++) {
    const c = tag[i];
    if (c === "<") {
      depth++;
    } else if (c === ">") {
      depth--;
    } else if (depth === 0 && c === ":" && tag[i + 1] === ":") {
      cuts.push(i);
      i++;
    }
  }
  return cuts.length >= 2 ? tag.slice(cuts[cuts.length - 2] + 2) : tag;
}

interface HangFacts {
  frames: Frame[];
  kind: HangKind;
  count: number;
  durationMs: number;
  date: string;
  trendNote?: string;
  permalink: string;
  /** Context shares, largest first (hangAreas.hangContext). */
  contexts: ContextShare[];
  /** OS share of the hang, e.g. "Windows 96%". */
  platformNote?: string;
}

/**
 * What the stack shows, as bullet lines: the mechanism, area and activity
 * with the frames they come from, then when it happens.
 */
export function stackEvidence({ frames, kind, contexts, platformNote }: HangFacts): string[] {
  const at = (depth: number) =>
    depth >= 0 && frames[depth] ? `, frame ${depth} (${stripArgs(frames[depth].funcName)})` : "";
  const pct = (share: number) =>
    share.toLocaleString("en-US", { style: "percent", maximumFractionDigits: 1 });
  const when = contexts
    .filter((c) => c.share >= 0.01)
    .slice(0, 4)
    .map((c) => `${c.label} ${pct(c.share)}`)
    .join(", ");
  return [
    "What the stack shows (read from its function names, not a confirmed cause):",
    `- Mechanism: ${mechanismLabel(kind)}${at(kind.mechanismFrame)}`,
    `- Area: ${areaLabel(kind.area)}${kind.area ? at(kind.areaFrame) : ""}`,
    kind.activity ? `- During: ${areaLabel(kind.activity)}${at(kind.activityFrame)}` : null,
    `- When: ${when || "no context flags recorded"}`,
    platformNote ? `- Platforms: ${platformNote}` : null,
  ].filter((line): line is string => line !== null);
}

/** The comment body, with the whiteboard instruction when filing a new bug. */
function comment(facts: HangFacts, whiteboard: string | null): string {
  const { frames, count, durationMs, date, trendNote, permalink } = facts;
  const seconds = Math.round(durationMs / 1000).toLocaleString("en-US");
  const stack = frames
    .slice(0, MAX_STACK_FRAMES)
    .map((f, i) => `${i}  ${f.funcName}${f.libName ? `  [${f.libName}]` : ""}`)
    .join("\n");
  const truncated =
    frames.length > MAX_STACK_FRAMES
      ? `\n... ${frames.length - MAX_STACK_FRAMES} more frames (see dashboard)`
      : "";

  return [
    "Main-thread hang signature flagged from the BHR dashboard.",
    "",
    ...stackEvidence(facts),
    "",
    `Prevalence (build ${date}): ${count.toLocaleString("en-US")} hangs, ${seconds}s total`,
    trendNote ? `Trend: ${trendNote}` : null,
    "",
    whiteboard
      ? `Add \`${whiteboard}\` to the whiteboard so the dashboard auto-merges matching hangs.`
      : null,
    `Dashboard: ${permalink}`,
    "",
    "Stack:",
    "```",
    stack + truncated,
    "```",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

export interface BugReport {
  summary: string;
  whiteboard: string;
  comment: string;
  url: string;
}

export function buildBugReport(
  opts: HangFacts & {
    /** The whiteboard tag's frame text (tagScope.tagText). */
    tag: string;
    /** Where to file. Bugzilla only prefills the form when both are set. */
    target?: BugComponent;
  },
): BugReport {
  const { tag, target, kind } = opts;
  const whiteboard = `[bhr:${tag}]`;
  const summary = `BHR hang: ${hangTitle(kind)} in ${shortTag(tag)}`.slice(0, MAX_SUMMARY);
  const body = comment(opts, whiteboard);

  // Product and component have to be set together for Bugzilla to skip the
  // product chooser -- that step drops every other prefilled field, which is
  // why filing used to arrive on an empty form.
  const params = new URLSearchParams({
    bug_type: "defect",
    short_desc: summary,
    status_whiteboard: whiteboard,
    comment: body,
  });
  if (target) {
    params.set("product", target.product);
    params.set("component", target.component);
  }

  return { summary, whiteboard, comment: body, url: `${ENTER_BUG_URL}?${params}` };
}

/** The latest data on a hang a bug already tracks, to paste into that bug. */
export function buildHangSummary(facts: HangFacts): string {
  return comment(facts, null);
}
