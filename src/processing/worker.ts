/**
 * Web Worker entry point. Heavy compute (stack reconstruction + signature
 * merge) runs here so the main thread stays responsive even on large
 * production-scale artifacts. Exposed to the app via Comlink.
 */

import * as Comlink from "comlink";
import { buildSignatures, type BugMap } from "./process";
import type { Profile } from "@/data/schema";

const api = {
  process(profile: Profile, bugs: BugMap) {
    return buildSignatures(profile, bugs);
  },
};

export type ProcessApi = typeof api;

Comlink.expose(api);
