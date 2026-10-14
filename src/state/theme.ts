import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";
const STORAGE_KEY = "hangtime-theme";
const listeners = new Set<() => void>();
let current: Theme = "light";
let preference: Theme | null = null;
let system: MediaQueryList;
let initialized = false;
let transitionTimer: ReturnType<typeof setTimeout> | undefined;

function parsePreference(value: string | null): Theme | null {
  return value === "light" || value === "dark" ? value : null;
}

function applyTheme() {
  current = preference ?? (system.matches ? "dark" : "light");
  document.documentElement.dataset.theme = current;
  for (const listener of listeners) listener();
}

/** Run before React mounts so the first rendered frame uses the chosen appearance. */
export function initializeTheme() {
  if (initialized) return;
  initialized = true;
  system = window.matchMedia("(prefers-color-scheme: dark)");
  try {
    preference = parsePreference(localStorage.getItem(STORAGE_KEY));
  } catch {
    // A browser that blocks storage can still use the switch for this session.
  }
  applyTheme();
  system.addEventListener("change", () => {
    if (preference === null) applyTheme();
  });
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      preference = parsePreference(event.newValue);
      applyTheme();
    }
  });
}

export function setTheme(theme: Theme) {
  // Animate deliberate switches, without animating the initial page appearance.
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.documentElement.classList.add("theme-transitioning");
    clearTimeout(transitionTimer);
    transitionTimer = setTimeout(() => {
      document.documentElement.classList.remove("theme-transitioning");
    }, 300);
  }
  preference = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Keep the in-memory preference when persistence is unavailable.
  }
  applyTheme();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useTheme() {
  return useSyncExternalStore(subscribe, () => current, () => "light" as Theme);
}
