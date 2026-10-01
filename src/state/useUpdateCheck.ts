/**
 * Notices when a newer HangTime has been deployed than the one running.
 *
 * GitHub Pages serves index.html with a 10-minute max-age, and a tab left open
 * never reloads it at all, so people can sit on an old version for days. Each
 * build publishes its id in version.json; this reads that file, bypassing
 * every cache, and compares it with the id baked into the running bundle.
 */

import { useCallback, useEffect, useState } from "react";

const CHECK_EVERY_MS = 10 * 60 * 1000;

/** The query parameter a reload adds, so it can't be served the cached page. */
const VERSION_PARAM = "v";

async function fetchDeployedBuild(): Promise<string | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      return null;
    }
    const { build } = (await res.json()) as { build?: unknown };
    return typeof build === "string" ? build : null;
  } catch {
    // Offline or blocked: say nothing rather than nag.
    return null;
  }
}

/**
 * Reload into the given build. A plain reload can still be handed the cached
 * index.html, by the browser or by GitHub's CDN; a new query string is a new
 * URL to both. The view state lives in the hash, which is kept.
 */
export function reloadInto(build: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set(VERSION_PARAM, build);
  window.location.replace(url.toString());
}

/**
 * Whether this page was already a reload into `build`. If it was and the
 * build still doesn't match, reloading again won't help, so don't loop.
 */
export function alreadyReloadedInto(build: string): boolean {
  return new URL(window.location.href).searchParams.get(VERSION_PARAM) === build;
}

/** The newer deployed build id, or null while this one is current. */
export function useUpdateCheck(): string | null {
  const [newer, setNewer] = useState<string | null>(null);

  const check = useCallback(async () => {
    const deployed = await fetchDeployedBuild();
    if (deployed && deployed !== __BUILD_ID__) {
      setNewer(deployed);
    }
  }, []);

  useEffect(() => {
    // A dev server has no version.json and rebuilds on its own.
    if (import.meta.env.DEV) {
      return;
    }
    void check();
    const id = setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void check();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [check]);

  return newer;
}
