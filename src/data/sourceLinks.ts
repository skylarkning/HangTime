/**
 * Links from stack frames to Firefox source: Searchfox and GitHub.
 *
 * JS frames carry a file and line ("onDOMContentLoaded browser/content/
 * browser-init.js:237"), but the file is the module's in-browser location with
 * its resource:// or chrome:// scheme dropped, not its place in the source tree.
 * The build's chrome-map.json (made for code coverage, published by the Linux
 * ccov build) maps those URLs to source files; the resolution below follows
 * python/mozbuild/mozbuild/codecoverage/lcov_rewriter.py (UrlFinder). Frames the
 * map misses fall back to a few roots Firefox only registers at runtime, then
 * to a unique matching tail of the path, then a unique file name: together
 * about nine JS frames in ten resolve.
 *
 * Native frames have no file or line in the hang data (the aggregation job
 * doesn't keep them yet; bug 2081894), so a Firefox frame links to a Searchfox search for
 * its function, which leads to the definition.
 *
 * Links go to the current source, not the build's revision, so a line number
 * can drift if the file changed since the build.
 */

const CHROME_MAP_URL =
  "https://firefox-ci-tc.services.mozilla.com/api/index/v1/task/" +
  "gecko.v2.mozilla-central.latest.firefox.linux64-ccov-opt/artifacts/public/build/chrome-map.json";

const SEARCHFOX = "https://searchfox.org/firefox-main";
const GITHUB = "https://github.com/mozilla-firefox/firefox/blob/main";

/**
 * resource:// roots that Firefox registers at runtime (for system add-ons and
 * some components), so they're absent from the build's chrome map.
 */
const RUNTIME_ROOTS: Record<string, string> = {
  "newtab/": "browser/extensions/newtab/",
  "nimbus/": "toolkit/components/nimbus/",
  "normandy/": "toolkit/components/normandy/",
  "autofill/": "toolkit/components/formautofill/",
};

type ChromeMapJson = [
  Record<string, string[]>,
  Record<string, string>,
  Record<string, [string, unknown]>,
  { topobjdir: string },
];

export interface SourceResolver {
  resolve(path: string): string | null;
}

export async function fetchSourceResolver(): Promise<SourceResolver> {
  const res = await fetch(CHROME_MAP_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch chrome-map.json: ${res.status}`);
  }
  return makeResolver((await res.json()) as ChromeMapJson);
}

function makeResolver([prefixes, overrides, install, buildconfig]: ChromeMapJson): SourceResolver {
  // Registered at runtime by the resource protocol handler (as UrlFinder adds).
  prefixes["resource:///"] ??= ["dist/bin/browser"];
  prefixes["resource://gre/"] ??= ["dist/bin"];
  const topobjdir = `${buildconfig.topobjdir}/`;

  /** Source path for an objdir path, directly or through a wildcard parent. */
  const installInfo = (objPath: string): string | null => {
    const direct = install[objPath];
    if (direct) {
      return direct[0];
    }
    const parts = objPath.split("/");
    for (let i = parts.length - 1; i > 0; i--) {
      const parent = install[parts.slice(0, i).join("/")];
      if (parent) {
        const srcPrefix = parent[0]
          .split("/")
          .filter((p) => !p.includes("*"))
          .join("/");
        return `${srcPrefix}/${parts.slice(i).join("/")}`;
      }
    }
    return null;
  };

  const findFiles = (url: string, depth = 0): string | null => {
    if (depth > 5) {
      return null;
    }
    const term = overrides[url] ?? url;
    for (const [prefix, dests] of Object.entries(prefixes)) {
      if (!term.startsWith(prefix)) {
        continue;
      }
      for (let dest of dests) {
        if (!dest.endsWith("/")) {
          dest += "/";
        }
        if (dest.startsWith("resource://") || dest.startsWith("chrome://")) {
          const found = findFiles(term.replace(prefix, dest), depth + 1);
          if (found) {
            return found;
          }
          continue;
        }
        let objPath = term.replace(prefix, dest);
        if (objPath.startsWith(topobjdir)) {
          objPath = objPath.slice(topobjdir.length);
        }
        const src = installInfo(objPath);
        if (src) {
          return src;
        }
      }
    }
    return null;
  };

  // Source JS files known to the build, for the tail and file-name fallbacks.
  const sources: string[] = [];
  const byName = new Map<string, string[]>();
  for (const [src] of Object.values(install)) {
    if (/\.(m?js|jsm)$/.test(src) && !src.includes("*")) {
      sources.push(src);
      const name = src.slice(src.lastIndexOf("/") + 1);
      const list = byName.get(name);
      if (list) {
        list.push(src);
      } else {
        byName.set(name, [src]);
      }
    }
  }

  const fallback = (path: string): string | null => {
    for (const [root, dir] of Object.entries(RUNTIME_ROOTS)) {
      if (path.startsWith(root)) {
        return dir + path.slice(root.length);
      }
    }
    const segs = path.split("/");
    // The longest tail of the path that names exactly one source file; when
    // several match, the first segment (often a component name) may decide.
    for (let i = 1; i < segs.length; i++) {
      const tail = `/${segs.slice(i).join("/")}`;
      const hits = sources.filter((s) => s.endsWith(tail));
      if (hits.length === 1) {
        return hits[0];
      }
      if (hits.length > 1) {
        const narrowed = hits.filter((s) => s.split("/").includes(segs[0]));
        return narrowed.length === 1 ? narrowed[0] : null;
      }
    }
    const named = byName.get(segs[segs.length - 1]) ?? [];
    return named.length === 1 ? named[0] : null;
  };

  const memo = new Map<string, string | null>();
  return {
    resolve(rawPath: string) {
      const path = rawPath.replace(/^\/+/, "");
      let src = memo.get(path);
      if (src === undefined) {
        src =
          findFiles(`resource://${path}`) ??
          findFiles(`chrome://${path}`) ??
          findFiles(`moz-src:///${path}`) ??
          fallback(path);
        memo.set(path, src);
      }
      return src;
    },
  };
}

export interface JsFrameLocation {
  /** The file as the frame names it (in-browser location, scheme dropped). */
  path: string;
  line: number;
}

/** A JS frame's file and line, from its label; null for other frames. */
export function jsFrameLocation(funcName: string): JsFrameLocation | null {
  const match = /(?:^| )(\S+\.(?:m?js|jsm)):(\d+)(?::\d+)?$/.exec(funcName);
  return match ? { path: match[1], line: Number(match[2]) } : null;
}

export function searchfoxLine(sourcePath: string, line: number): string {
  return `${SEARCHFOX}/source/${sourcePath}#${line}`;
}

export function githubLine(sourcePath: string, line: number): string {
  return `${GITHUB}/${sourcePath}#L${line}`;
}

/**
 * The name to search Searchfox for: a native function's qualified name with
 * its argument list, qualifiers and template arguments removed, which is how
 * Searchfox indexes identifiers ("mozilla::dom::Foo::Bar").
 */
export function searchableName(funcName: string): string | null {
  // "(anonymous namespace)::Foo" is searched as "Foo"; the parenthesis would
  // otherwise read as the start of the argument list.
  const named = funcName.replaceAll("(anonymous namespace)::", "");
  let depth = 0;
  let out = "";
  for (const ch of named) {
    if (ch === "<") {
      depth++;
    } else if (ch === ">") {
      depth = Math.max(0, depth - 1);
    } else if (ch === "(" && depth === 0) {
      break;
    } else if (depth === 0) {
      out += ch;
    }
  }
  const name = out.trim();
  // Sentinels like "(root)" / "(unresolved)" and bare addresses aren't symbols.
  return name && !/^0x[0-9a-f]+$/i.test(name) ? name : null;
}

export function searchfoxSearch(name: string): string {
  return `${SEARCHFOX}/search?q=${encodeURIComponent(name)}`;
}
