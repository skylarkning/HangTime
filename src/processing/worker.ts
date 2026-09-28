/**
 * Web Worker entry point. Heavy compute (stack reconstruction + signature
 * merge) runs here so the main thread stays responsive even on large
 * production-scale artifacts. Exposed to the app via Comlink.
 */

import * as Comlink from "comlink";
import { buildSignatures, type BugMap } from "./process";
import type { Profile } from "@/data/schema";

const api = {
  /**
   * `onComputed` fires once the signatures are built. Copying them back to the
   * page still takes a while after that, longer than the compute on a large
   * day, and has no progress of its own to report.
   */
  process(profile: Profile, bugs: BugMap, onComputed?: () => void) {
    const result = buildSignatures(profile, bugs);
    onComputed?.();
    return result;
  },
};

export type ProcessApi = typeof api;

Comlink.expose(api);
