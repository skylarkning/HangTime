/** Frame display helpers shared by the table and detail pane. */

import type { Frame } from "@/processing/types";
/** Match the original dashboard: identify a stack by its recorded leaf frame. */
export function leafFrameDepth(frames: Frame[]): number {
  return frames.length ? 0 : -1;
}

/** Keep qualified names, templates and operator(), omitting call arguments. */
export function shortSymbol(funcName: string): string {
  const name = funcName.replace(/\s+\S+\.(?:m?js|jsm):\d+(?::\d+)?$/, "");
  let angle = 0;
  for (let i = 0; i < name.length; i++) {
    if (name[i] === "<" && !/operator[<>=!]*$/.test(name.slice(0, i))) angle++;
    else if (name[i] === ">" && angle > 0) angle--;
    else if (name[i] === "(" && angle === 0) {
      if (name.slice(i, i + 21) === "(anonymous namespace)") { i += 20; continue; }
      if (name.slice(0, i).endsWith("operator") && name[i + 1] === ")") { i++; continue; }
      if (i > 0) return name.slice(0, i).trim();
    }
  }
  return name;
}

const MOZ_LIBS = new Set(["xul", "XUL", "libxul.so", "mozglue", "libmozglue.so"]);
const OWN_BINARIES = new Set(["firefox", "plugin-container"]);

/** Whether the frame is in a Firefox-owned binary (vs a system library). */
export function isOwnCode(frame: Frame): boolean {
  return frame.libName === "" || MOZ_LIBS.has(frame.libName) || OWN_BINARIES.has(frame.libName);
}

/** Label for a frame's leaf line in the list ("funcName lib"). */
export function frameLabel(frame: Frame | undefined): string {
  if (!frame) {
    return "(empty stack)";
  }
  return frame.libName ? `${frame.funcName} ${frame.libName}` : frame.funcName;
}
