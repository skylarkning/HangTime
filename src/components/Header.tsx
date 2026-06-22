import { formatDate } from "@/format";

const TABS = [
  { id: "top-hangs", label: "Top Hangs", enabled: true },
  { id: "overview", label: "Overview", enabled: false },
  { id: "detail", label: "Hang Detail", enabled: false },
  { id: "per-site", label: "Per-Site", enabled: false },
  { id: "alerts", label: "Alerts", enabled: false },
];

interface HeaderProps {
  date?: string;
  thread: string;
}

export function Header({ date, thread }: HeaderProps) {
  return (
    <header className="top">
      <div className="brand">
        <div className="logo" />
        BHR Dashboard
        <span className="subtitle">Background Hang Reporter</span>
      </div>
      <nav className="tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={tab.enabled ? "active" : ""}
            disabled={!tab.enabled}
            title={tab.enabled ? undefined : "Planned"}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <div className="header-right">
        {date && <span className="pill live">Build {formatDate(date)}</span>}
        <span className="pill">{thread === "child" ? "Child process" : "Main thread"}</span>
      </div>
    </header>
  );
}
