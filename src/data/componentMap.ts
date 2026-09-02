/**
 * Suggests the Bugzilla product/component a hang belongs to, so filing a bug
 * from the dashboard lands in the right queue instead of the reporter guessing.
 *
 * The artifact carries no source paths -- a frame is only a function name plus
 * a library name -- so this reads a stack the way a triager does: walk from the
 * leaf outwards and find the innermost frame that actually names an owner. The
 * leaf itself is usually too generic to be the answer (`memcpy`, `WaitOnAddress`
 * and `nsTArray::Length` are three of the ten heaviest leaves in production),
 * so each rule carries a weight and the strongest match wins, with ties going
 * to the frame nearest the leaf.
 *
 * Rules are deliberately conservative: when nothing above the plumbing matches,
 * this returns null and the UI asks the reporter to choose rather than sending
 * a bug to the wrong team.
 */

import type { Frame } from "@/processing/types";

export interface BugComponent {
  product: string;
  component: string;
}

export interface Suggestion extends BugComponent {
  /** Confidence in the match, from the rule's weight. */
  confidence: "high" | "medium" | "low";
  /** The text that matched, for showing the reporter why. */
  matched: string;
  /** Depth of the deciding frame in the stack (0 = leaf). */
  frameIndex: number;
  /** The deciding frame's function name. */
  frameName: string;
}

/** OS a hang is dominated by, used to resolve the platform widget layers. */
export type HangPlatform = "Windows" | "Darwin" | "Linux" | "";

type Weight = 1 | 2 | 3 | 4;

interface Rule {
  /** Substring matched against the frame's function name (or library name). */
  match: string;
  /** Match against the library name rather than the function name. */
  lib?: boolean;
  product: string;
  component: string;
  /**
   * Widget and system-toolkit code is per-OS; the hang's dominant platform
   * picks the component so a Cocoa hang doesn't get filed against Win32.
   */
  perPlatform?: boolean;
  weight: Weight;
}

/**
 * Frames that say nothing about ownership: WebIDL binding glue, smart pointers,
 * container templates and the IPC transport all sit between a caller and the
 * code that actually hangs. Matching on them picks the messenger over the
 * culprit, so they are skipped before any rule is tried.
 */
const SKIP = [
  "_Binding::",
  "lazy_getter",
  "RefPtr<",
  "nsCOMPtr<",
  "mozilla::detail::",
  "LinkedListElement<",
  "nsTArray",
  "std::",
  "mozilla::Maybe<",
  "MessageChannel::",
  "MessageLink",
  "MainThreadConsoleData",
  "binding_detail::",
  "Callback::Call",
  "StaticMethodPromiseWrapper",
];

const WIDGET: Record<HangPlatform, string> = {
  Windows: "Widget: Win32",
  Darwin: "Widget: Cocoa",
  Linux: "Widget: Gtk",
  "": "Widget",
};

/**
 * Ordered by weight, then by specificity within a weight: the first rule that
 * matches a frame at a given weight decides that frame.
 *
 * Weight 3 names a subsystem outright, 2 names a broad but real area, and 1 is
 * shared plumbing that should only answer when nothing better appears anywhere
 * in the stack.
 */
const RULES: Rule[] = [
  // -- Chrome JS, by module: the path in a JS frame names the owner directly --
  { match: "SessionStore", product: "Firefox", component: "Session Restore", weight: 4 },
  { match: "SessionWriter", product: "Firefox", component: "Session Restore", weight: 4 },
  { match: "netmonitor", product: "DevTools", component: "Netmonitor", weight: 4 },
  { match: "network-response-listener", product: "DevTools", component: "Netmonitor", weight: 4 },
  { match: "PlacesUtils", product: "Firefox", component: "Bookmarks & History", weight: 4 },
  { match: "PlacesDBUtils", product: "Firefox", component: "Bookmarks & History", weight: 4 },
  { match: "Bookmarks.sys.mjs", product: "Firefox", component: "Bookmarks & History", weight: 4 },
  { match: "History.sys.mjs", product: "Firefox", component: "Bookmarks & History", weight: 4 },
  { match: "Urlbar", product: "Firefox", component: "Address Bar", weight: 4 },
  { match: "WindowsJumpLists", product: "Firefox", component: "Shell Integration", weight: 4 },
  { match: "ShellService", product: "Firefox", component: "Shell Integration", weight: 4 },
  { match: "MigrationUtils", product: "Firefox", component: "Migration", weight: 4 },
  { match: "newtab/", product: "Firefox", component: "New Tab Page", weight: 4 },
  { match: "AboutNewTab", product: "Firefox", component: "New Tab Page", weight: 4 },
  { match: "ASRouter", product: "Firefox", component: "Messaging System", weight: 4 },
  { match: "UpdateService", product: "Toolkit", component: "Application Update", weight: 4 },
  { match: "LoginManager", product: "Toolkit", component: "Password Manager", weight: 4 },
  { match: "passwordmgr", product: "Toolkit", component: "Password Manager", weight: 4 },
  { match: "Downloads.sys.mjs", product: "Toolkit", component: "Downloads API", weight: 4 },
  { match: "DownloadIntegration", product: "Toolkit", component: "Downloads API", weight: 4 },
  { match: "TelemetryController", product: "Toolkit", component: "Telemetry", weight: 4 },
  { match: "TelemetrySession", product: "Toolkit", component: "Telemetry", weight: 4 },
  { match: "BHRTelemetryService", product: "Toolkit", component: "Telemetry", weight: 4 },
  { match: "ExtensionParent", product: "WebExtensions", component: "General", weight: 4 },
  { match: "ExtensionCommon", product: "WebExtensions", component: "General", weight: 4 },
  { match: "extensions/content/", product: "WebExtensions", component: "General", weight: 4 },
  { match: "devtools/", product: "DevTools", component: "General", weight: 4 },
  { match: "moz-extension://", product: "WebExtensions", component: "General", weight: 4 },

  // -- Gecko, by namespace or distinctive class --
  { match: "mozilla::a11y::", product: "Core", component: "Disability Access APIs", weight: 3 },
  { match: "AccessibleWrap", product: "Core", component: "Disability Access APIs", weight: 3 },
  { match: "get_acc", product: "Core", component: "Disability Access APIs", weight: 3 },
  { match: "PCompositorBridge", product: "Core", component: "Graphics: WebRender", weight: 3 },
  { match: "PWebRenderBridge", product: "Core", component: "Graphics: WebRender", weight: 3 },
  { match: "PAPZ", product: "Core", component: "Panning and Zooming", weight: 3 },
  { match: "PWebrtcGlobal", product: "Core", component: "WebRTC", weight: 3 },
  { match: "CrashReporterHost", product: "Toolkit", component: "Crash Reporting", weight: 3 },
  { match: "DownloadPlatform", product: "Toolkit", component: "Downloads API", weight: 3 },
  { match: "mozilla::wr::", product: "Core", component: "Graphics: WebRender", weight: 3 },
  { match: "WebRenderBridge", product: "Core", component: "Graphics: WebRender", weight: 3 },
  { match: "SendFlushRendering", product: "Core", component: "Graphics: WebRender", weight: 3 },
  { match: "WebRender", product: "Core", component: "Graphics: WebRender", weight: 3 },
  { match: "mozilla::layers::", product: "Core", component: "Graphics: WebRender", weight: 3 },
  { match: "TextureClient", product: "Core", component: "Graphics: WebRender", weight: 3 },
  { match: "gfxDWriteFont", product: "Core", component: "Layout: Text and Fonts", weight: 3 },
  { match: "gfxPlatformFontList", product: "Core", component: "Layout: Text and Fonts", weight: 3 },
  { match: "gfxFont", product: "Core", component: "Layout: Text and Fonts", weight: 3 },
  { match: "gfxTextRun", product: "Core", component: "Layout: Text and Fonts", weight: 3 },
  { match: "mozilla::gfx::", product: "Core", component: "Graphics", weight: 3 },
  { match: "AsyncPanZoom", product: "Core", component: "Panning and Zooming", weight: 3 },
  { match: "mozilla::apz", product: "Core", component: "Panning and Zooming", weight: 3 },
  { match: "ReceiveMouseInputEvent", product: "Core", component: "Panning and Zooming", weight: 3 },
  { match: "mozilla::net::", product: "Core", component: "Networking", weight: 3 },
  { match: "nsHttp", product: "Core", component: "Networking: HTTP", weight: 3 },
  { match: "nsSocketTransport", product: "Core", component: "Networking", weight: 3 },
  { match: "nsIOService", product: "Core", component: "Networking", weight: 3 },
  { match: "nsFileChannel", product: "Core", component: "Networking: File", weight: 3 },
  { match: "nsJARChannel", product: "Core", component: "Networking: JAR", weight: 3 },
  { match: "nsZipArchive", product: "Core", component: "Networking: JAR", weight: 3 },
  { match: "Omnijar", product: "Core", component: "Networking: JAR", weight: 3 },
  { match: "nsCookie", product: "Core", component: "Networking: Cookies", weight: 3 },
  { match: "nsNSSComponent", product: "Core", component: "Security: PSM", weight: 3 },
  { match: "cert_storage", product: "Core", component: "Security: PSM", weight: 3 },
  { match: "PK11_", product: "Core", component: "Security: PSM", weight: 3 },
  { match: "Servo_", product: "Core", component: "CSS Parsing and Computation", weight: 3 },
  { match: "style::", product: "Core", component: "CSS Parsing and Computation", weight: 3 },
  { match: "nsCSS", product: "Core", component: "CSS Parsing and Computation", weight: 3 },
  { match: "ServoStyle", product: "Core", component: "CSS Parsing and Computation", weight: 3 },
  { match: "PresShell", product: "Core", component: "Layout", weight: 3 },
  { match: "ReflowInput", product: "Core", component: "Layout", weight: 3 },
  { match: "nsBlockFrame", product: "Core", component: "Layout", weight: 3 },
  { match: "nsFlexContainerFrame", product: "Core", component: "Layout", weight: 3 },
  { match: "nsGridContainerFrame", product: "Core", component: "Layout", weight: 3 },
  { match: "ScrollContainerFrame", product: "Core", component: "Layout", weight: 3 },
  { match: "nsContainerFrame", product: "Core", component: "Layout", weight: 3 },
  { match: "nsRefreshDriver", product: "Core", component: "Layout", weight: 3 },
  { match: "js::gc::", product: "Core", component: "JavaScript: GC", weight: 3 },
  { match: "GCRuntime", product: "Core", component: "JavaScript: GC", weight: 3 },
  { match: "UnmarkGray", product: "Core", component: "JavaScript: GC", weight: 3 },
  { match: "js::jit::", product: "Core", component: "JavaScript Engine: JIT", weight: 3 },
  { match: "nsCycleCollector", product: "Core", component: "Cycle Collector", weight: 3 },
  { match: "SnowWhiteKiller", product: "Core", component: "Cycle Collector", weight: 3 },
  { match: "TraversalTracer", product: "Core", component: "Cycle Collector", weight: 3 },
  { match: "mozilla::glean::", product: "Toolkit", component: "Telemetry", weight: 3 },
  { match: "mozilla::Telemetry", product: "Toolkit", component: "Telemetry", weight: 3 },
  { match: "mozStorage", product: "Core", component: "SQLite and Embedded Database Bindings", weight: 3 },
  { match: "places::", product: "Firefox", component: "Bookmarks & History", weight: 3 },
  { match: "nsFilePicker", product: "Core", component: WIDGET[""], perPlatform: true, weight: 3 },
  { match: "nsCocoaWindow", product: "Core", component: "Widget: Cocoa", weight: 3 },
  { match: "nsChildView", product: "Core", component: "Widget: Cocoa", weight: 3 },
  { match: "nsRetrievalContext", product: "Core", component: "Widget: Gtk", weight: 3 },
  { match: "WinTaskbar", product: "Core", component: "Widget: Win32", weight: 3 },
  { match: "JumpListBuilder", product: "Core", component: "Widget: Win32", weight: 3 },
  { match: "FaviconHelper", product: "Core", component: "Widget: Win32", weight: 3 },
  { match: "TaskbarPreview", product: "Core", component: "Widget: Win32", weight: 3 },
  { match: "mozilla::widget::", product: "Core", component: WIDGET[""], perPlatform: true, weight: 3 },
  { match: "mozilla::dom::", product: "Core", component: "DOM: Core & HTML", weight: 3 },
  { match: "mozilla::EventListenerManager", product: "Core", component: "DOM: Events", weight: 3 },

  // -- Chrome JS, by location: less precise than a named module, still real --
  { match: "browser/content/", product: "Firefox", component: "General", weight: 2 },
  { match: "browser/modules/", product: "Firefox", component: "General", weight: 2 },
  { match: "gre/modules/", product: "Toolkit", component: "General", weight: 2 },
  { match: "global/content/", product: "Toolkit", component: "General", weight: 2 },
  { match: "/actors/", product: "Toolkit", component: "General", weight: 2 },

  // -- System libraries: the OS layer a hang sits in names the Gecko owner --
  { match: "DWrite", lib: true, product: "Core", component: "Layout: Text and Fonts", weight: 2 },
  { match: "libfreetype", lib: true, product: "Core", component: "Layout: Text and Fonts", weight: 2 },
  { match: "libfontconfig", lib: true, product: "Core", component: "Layout: Text and Fonts", weight: 2 },
  { match: "CoreText", lib: true, product: "Core", component: "Layout: Text and Fonts", weight: 2 },
  { match: "UIAutomationCore", lib: true, product: "Core", component: "Disability Access APIs", weight: 2 },
  { match: "oleacc", lib: true, product: "Core", component: "Disability Access APIs", weight: 2 },
  { match: "msctf", lib: true, product: "Core", component: "Widget: Win32", weight: 2 },
  { match: "TextInputFramework", lib: true, product: "Core", component: "Widget: Win32", weight: 2 },
  { match: "nss3", lib: true, product: "Core", component: "Security: PSM", weight: 2 },
  { match: "softokn3", lib: true, product: "Core", component: "Security: PSM", weight: 2 },
  { match: "freebl3", lib: true, product: "Core", component: "Security: PSM", weight: 2 },
  { match: "AppKit", lib: true, product: "Core", component: "Widget: Cocoa", weight: 2 },
  { match: "HIToolbox", lib: true, product: "Core", component: "Widget: Cocoa", weight: 2 },
  { match: "CoreGraphics", lib: true, product: "Core", component: "Widget: Cocoa", weight: 2 },
  { match: "SkyLight", lib: true, product: "Core", component: "Widget: Cocoa", weight: 2 },
  { match: "libgtk", lib: true, product: "Core", component: "Widget: Gtk", weight: 2 },
  { match: "libgdk", lib: true, product: "Core", component: "Widget: Gtk", weight: 2 },
  { match: "libX11", lib: true, product: "Core", component: "Widget: Gtk", weight: 2 },
  { match: "user32", lib: true, product: "Core", component: "Widget: Win32", weight: 2 },
  { match: "win32u", lib: true, product: "Core", component: "Widget: Win32", weight: 2 },
  { match: "uxtheme", lib: true, product: "Core", component: "Widget: Win32", weight: 2 },
  { match: "dwmapi", lib: true, product: "Core", component: "Widget: Win32", weight: 2 },
  { match: "gdi32", lib: true, product: "Core", component: "Widget: Win32", weight: 2 },
  { match: "comctl32", lib: true, product: "Core", component: "Widget: Win32", weight: 2 },
  { match: "comdlg32", lib: true, product: "Core", component: "Widget: Win32", weight: 2 },
  { match: "shell32", lib: true, product: "Core", component: "Widget: Win32", weight: 2 },
  { match: "ExplorerFrame", lib: true, product: "Core", component: "Widget: Win32", weight: 2 },
  { match: "Windows.Storage", lib: true, product: "Core", component: "Widget: Win32", weight: 2 },
  { match: "Microsoft.UI", lib: true, product: "Core", component: "Widget: Win32", weight: 2 },
  { match: "combase", lib: true, product: "Core", component: "Widget: Win32", weight: 2 },
  { match: "ole32", lib: true, product: "Core", component: "Widget: Win32", weight: 2 },

  // -- Plumbing: only answers when the whole stack is infrastructure --
  { match: "nsWindow::", product: "Core", component: WIDGET[""], perPlatform: true, weight: 2 },
  { match: "nsAppShell", product: "Core", component: WIDGET[""], perPlatform: true, weight: 2 },
  { match: "nsBaseWidget", product: "Core", component: "Widget", weight: 1 },
  { match: "nsBaseAppShell", product: "Core", component: "Widget", weight: 1 },
  { match: "js::", product: "Core", component: "JavaScript Engine", weight: 1 },
  { match: "JS::", product: "Core", component: "JavaScript Engine", weight: 1 },
  { match: "JSContext", product: "Core", component: "JavaScript Engine", weight: 1 },
  { match: "JSObject", product: "Core", component: "JavaScript Engine", weight: 1 },
  { match: "InfallibleQuoteJSONString", product: "Core", component: "JavaScript Engine", weight: 1 },
  { match: "mozJSModuleLoader", product: "Core", component: "JavaScript Engine", weight: 1 },
  { match: "XPCWrappedNative", product: "Core", component: "XPConnect", weight: 1 },
  { match: "XPCNativeInterface", product: "Core", component: "XPConnect", weight: 1 },
  { match: "nsThread", product: "Core", component: "XPCOM", weight: 1 },
  { match: "NS_NewNamedThread", product: "Core", component: "XPCOM", weight: 1 },
  { match: "mozilla::TaskController", product: "Core", component: "XPCOM", weight: 1 },
  { match: "nsTimerImpl", product: "Core", component: "XPCOM", weight: 1 },
  { match: "nsLocalFile", product: "Core", component: "XPCOM", weight: 1 },
  { match: "nsInputStream", product: "Core", component: "XPCOM", weight: 1 },
  { match: "nsComponentManager", product: "Core", component: "XPCOM", weight: 1 },
  { match: "mozjemalloc", product: "Core", component: "Memory Allocator", weight: 2 },
  { match: "arena_t", product: "Core", component: "Memory Allocator", weight: 2 },
  { match: "AllocInfo", product: "Core", component: "Memory Allocator", weight: 2 },
  { match: "nsPrint", product: "Core", component: "Printing: Output", weight: 3 },
  { match: "PrintTarget", product: "Core", component: "Printing: Output", weight: 3 },
  { match: "Preferences::", product: "Core", component: "Preferences: Backend", weight: 3 },
  { match: "mozilla::CycleCollectedJS", product: "Core", component: "Cycle Collector", weight: 1 },
  { match: "mozilla::ipc::", product: "Core", component: "IPC", weight: 1 },
  { match: "sqlite3", product: "Core", component: "SQLite and Embedded Database Bindings", weight: 1 },
  { match: "mozilla::IOUtils", product: "Core", component: "DOM: Core & HTML", weight: 1 },
];

/** A frame's symbol without its argument list, which names types it merely uses. */
function symbolOf(funcName: string): string {
  const paren = funcName.indexOf("(");
  return paren <= 0 ? funcName : funcName.slice(0, paren);
}

const CONFIDENCE: Record<Weight, Suggestion["confidence"]> = {
  4: "high",
  3: "high",
  2: "medium",
  1: "low",
};

/**
 * The strongest owner named anywhere in the stack, preferring the frame nearest
 * the leaf when two rules are equally specific. Null when only plumbing matched
 * nothing at all -- better to ask than to file into the wrong queue.
 */
export function classifyStack(
  frames: Frame[],
  platform: HangPlatform = "",
): Suggestion | null {
  let best: (Suggestion & { score: number }) | null = null;

  frames.forEach((frame, depth) => {
    const haystack = symbolOf(frame.funcName ?? "");
    if (SKIP.some((glue) => haystack.includes(glue))) {
      return;
    }
    for (const rule of RULES) {
      const subject = rule.lib ? frame.libName : haystack;
      if (!subject || !subject.includes(rule.match)) {
        continue;
      }
      const score = rule.weight * 10000 - depth;
      if (best && score <= best.score) {
        break; // a weaker or equal rule can't improve this frame's answer
      }
      best = {
        product: rule.product,
        component: rule.perPlatform ? WIDGET[platform] : rule.component,
        confidence: CONFIDENCE[rule.weight],
        matched: rule.match,
        frameIndex: depth,
        frameName: frame.funcName,
        score,
      };
      break;
    }
  });

  if (!best) {
    return null;
  }
  const { score: _score, ...suggestion } = best as Suggestion & { score: number };
  return suggestion;
}

/** The OS that accounts for most of a signature's hangs. */
export function dominantPlatform(stats: Record<string, number>): HangPlatform {
  let top: HangPlatform = "";
  let topCount = 0;
  for (const [os, count] of Object.entries(stats)) {
    if (count > topCount && (os === "Windows" || os === "Darwin" || os === "Linux")) {
      top = os;
      topCount = count;
    }
  }
  return top;
}
