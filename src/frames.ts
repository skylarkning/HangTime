/** Frame display helpers shared by the table and detail pane. */

import type { Frame } from "@/processing/types";

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
