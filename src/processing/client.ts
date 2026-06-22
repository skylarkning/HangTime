/**
 * Lazily-instantiated handle to the processing worker. A single worker is
 * shared across the app; Comlink turns its methods into promises.
 */

import * as Comlink from "comlink";
import type { ProcessApi } from "./worker";

let proxy: Comlink.Remote<ProcessApi> | null = null;

export function getProcessor(): Comlink.Remote<ProcessApi> {
  if (!proxy) {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    proxy = Comlink.wrap<ProcessApi>(worker);
  }
  return proxy;
}
