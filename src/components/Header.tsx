import { Link, useLocation } from "react-router-dom";
import bhrLogo from "@/assets/bhr-logo.png";

interface Tab {
  id: string;
  label: string;
  /** Route path for an enabled tab; omitted for planned (disabled) tabs. */
  to?: string;
}

const TABS: Tab[] = [
  { id: "top-hangs", label: "Top Hangs", to: "/top-hangs" },
  { id: "areas", label: "Areas", to: "/areas" },
  { id: "guide", label: "Guide", to: "/guide" },
];

const FEEDBACK_URL = "https://github.com/skylarkning/HangTime/issues";

interface HeaderProps {
  thread: string;
}

export function Header({ thread }: HeaderProps) {
  const location = useLocation();

  return (
    <header className="top">
      <div className="brand">
        <img className="logo" src={bhrLogo} alt="" aria-hidden="true" />
        HangTime
        <span className="subtitle">Background Hang Reporter Dashboard</span>
      </div>
      <nav className="tabs" aria-label="Main navigation">
        {TABS.map((tab) =>
          tab.to ? (
            // Preserve the current query string (thread/date/…) across tabs.
            <Link
              key={tab.id}
              to={{ pathname: tab.to, search: location.search }}
              className={location.pathname === tab.to ? "active" : ""}
              aria-current={location.pathname === tab.to ? "page" : undefined}
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
        <a
          className="pill feedback-link"
          href={FEEDBACK_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Feedback ↗
        </a>
        <span className="pill">{thread === "child" ? "Child process" : "Main thread"}</span>
        <span className="version">V1.2</span>
      </div>
    </header>
  );
}
