/**
 * Turn a hang signature into a prefilled Bugzilla bug, so filing a BHR bug
 * doesn't depend on someone hand-writing the `[bhr:...]` whiteboard tag (the
 * fragile, manual step the dashboard's bug-merge relies on).
 *
 * The suggested whiteboard tag is `[bhr:<frame>]`, where `<frame>` is a
 * distinctive function name from the stack. The dashboard merges any hang whose
 * stack contains a function matching that substring into the bug (see
 * data/bugs.ts + processing/process.ts), so filing with this tag makes the
 * merge automatic from the next aggregation onward.
 */

import type { Frame } from "@/processing/types";

const ENTER_BUG_URL = "https://bugzilla.mozilla.org/enter_bug.cgi";
const MAX_STACK_FRAMES = 20;

/** Drop a function signature's argument list. */
function stripArgs(name: string): string {
  const paren = name.indexOf("(");
  return paren <= 0 ? name : name.slice(0, paren);
}

/** A real symbol, not `<unsymbolicated>` or a `(root)`/`(other)` sentinel. */
function isMeaningful(name: string): boolean {
  return !!name && !name.startsWith("(") && !name.startsWith("<");
}

/** The frame to key the `[bhr:...]` tag on: the leaf, or first real symbol. */
export function suggestSignature(frames: Frame[]): string {
  const frame = frames.find((f) => isMeaningful(f.funcName)) ?? frames[0];
  return frame ? stripArgs(frame.funcName) : "";
}

export interface BugReport {
  summary: string;
  whiteboard: string;
  comment: string;
  url: string;
}

export function buildBugReport(opts: {
  frames: Frame[];
  count: number;
  durationMs: number;
  date: string;
  trendNote?: string;
  permalink: string;
}): BugReport {
  const { frames, count, durationMs, date, trendNote, permalink } = opts;
  const sig = suggestSignature(frames);
  const whiteboard = `[bhr:${sig}]`;
  const seconds = Math.round(durationMs / 1000).toLocaleString();
  const summary = `BHR hang: ${sig} (${count.toLocaleString()} hangs/day)`;

  const stack = frames
    .slice(0, MAX_STACK_FRAMES)
    .map((f, i) => `${i}  ${f.funcName}${f.libName ? `  [${f.libName}]` : ""}`)
    .join("\n");
  const truncated =
    frames.length > MAX_STACK_FRAMES
      ? `\n… ${frames.length - MAX_STACK_FRAMES} more frames (see dashboard)`
      : "";

  const comment = [
    "Main-thread hang signature flagged from the BHR dashboard.",
    "",
    `Prevalence (build ${date}): ${count.toLocaleString()} hangs, ${seconds}s total`,
    trendNote ? `Trend: ${trendNote}` : null,
    "",
    `Add \`${whiteboard}\` to the whiteboard so the dashboard auto-merges matching hangs.`,
    `Dashboard: ${permalink}`,
    "",
    "Stack:",
    "```",
    stack + truncated,
    "```",
  ]
    .filter((line) => line !== null)
    .join("\n");

  // No product is set on purpose: the reporter picks it on Bugzilla. (Bugzilla
  // drops these prefilled fields at the product-chooser step, so the "Copy
  // comment" button is the reliable way to carry the details across.)
  const params = new URLSearchParams({
    bug_type: "defect",
    short_desc: summary,
    status_whiteboard: whiteboard,
    comment,
  });

  return { summary, whiteboard, comment, url: `${ENTER_BUG_URL}?${params}` };
}
