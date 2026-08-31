/**
 * Build-date selector. The header shows which build is on screen; clicking it
 * opens a native date input so any other build can be loaded.
 *
 * A native <input type="date"> rather than a hand-rolled calendar: it is
 * keyboard accessible and localized for free, and the set of valid builds is
 * not known up front anyway — the job publishes one artifact per run, so a
 * date is only known to be missing once it has been asked for.
 */

import { useEffect, useRef, useState } from "react";
import { formatDate } from "@/format";

/** "YYYYMMDD" -> "YYYY-MM-DD" for the input, and back. */
function toInputValue(compact: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(compact);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}
function toCompact(value: string): string {
  return value.replaceAll("-", "");
}

interface BuildPickerProps {
  /** Build currently displayed, "YYYYMMDD". Absent while the first load runs. */
  date?: string;
  /** Whether the view is pinned to a build rather than following the latest. */
  pinned: boolean;
  onSelect: (date: string) => void;
  onReset: () => void;
}

export function BuildPicker({ date, pinned, onSelect, onReset }: BuildPickerProps) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!date) {
    return null;
  }

  return (
    <div className="build-picker" ref={box}>
      <button
        type="button"
        className={`pill live build-pill${pinned ? " pinned" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Choose a build date"
        onClick={() => setOpen((v) => !v)}
      >
        Build {formatDate(date)}
        <span className="build-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="build-pop" role="dialog" aria-label="Choose a build date">
          <label className="build-pop-label" htmlFor="build-date">
            Build date
          </label>
          <input
            id="build-date"
            type="date"
            value={toInputValue(date)}
            max={toInputValue(date) || undefined}
            onChange={(e) => {
              if (!e.target.value) {
                return;
              }
              onSelect(toCompact(e.target.value));
              setOpen(false);
            }}
          />
          <p className="build-pop-note">
            The job aggregates a build about four days later, so the newest few
            days may not exist yet.
          </p>
          {pinned && (
            <button
              type="button"
              className="build-pop-reset"
              onClick={() => {
                onReset();
                setOpen(false);
              }}
            >
              Back to latest build
            </button>
          )}
        </div>
      )}
    </div>
  );
}
