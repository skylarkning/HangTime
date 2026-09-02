import { Link, useLocation } from "react-router-dom";
import { useViewState } from "@/state/useViewState";
import bhrLogo from "@/assets/bhr-logo.png";
import { BuildPicker } from "./BuildPicker";

interface Tab {
  id: string;
  label: string;
  /** Route path for an enabled tab; omitted for planned (disabled) tabs. */
  to?: string;
}

const TABS: Tab[] = [
  { id: "overview", label: "Overview", to: "/" },
  { id: "top-hangs", label: "Top Hangs", to: "/top-hangs" },
  { id: "per-site", label: "Per-Site" },
  { id: "alerts", label: "Alerts" },
];

interface HeaderProps {
  date?: string;
  thread: string;
}

export function Header({ date, thread }: HeaderProps) {
  const location = useLocation();
  const { state, update } = useViewState();

  return (
    <header className="top">
      <div className="brand">
        <img className="logo" src={bhrLogo} alt="" aria-hidden="true" />
        Hang Time
        <span className="subtitle">Background Hang Reporter</span>
      </div>
      <nav className="tabs">
        {TABS.map((tab) =>
          tab.to ? (
            // Preserve the current query string (thread/date/…) across tabs.
            <Link
              key={tab.id}
              to={{ pathname: tab.to, search: location.search }}
              className={location.pathname === tab.to ? "active" : ""}
            >
              {tab.label}
            </Link>
          ) : (
            <button key={tab.id} disabled title="Planned">
              {tab.label}
            </button>
          ),
        )}
      </nav>
      <div className="header-right">
        <BuildPicker
          date={date}
          pinned={state.date !== "current"}
          onSelect={(next) => update({ date: next })}
          onReset={() => update({ date: "" })}
        />
        <span className="pill">{thread === "child" ? "Child process" : "Main thread"}</span>
        <span className="version">Dashboard Version: V1.0.4</span>
      </div>
    </header>
  );
}
