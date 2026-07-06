/**
 * A small "i" affordance next to a label. Click to open a short plain-language
 * explanation of what a number/column means; click outside or press Escape to
 * dismiss. The popover is fixed-positioned from the button's rect so it never
 * gets clipped by scrolling table/detail containers.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

const POPOVER_WIDTH = 260;

export function InfoTip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({
        top: rect.bottom + 6,
        left: Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 12),
      });
    }
    setOpen((v) => !v);
  };

  return (
    <span className="infotip" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className="infotip-btn"
        aria-label={`About ${label}`}
        aria-expanded={open}
        onClick={toggle}
      >
        i
      </button>
      {open && pos && (
        <div
          className="infotip-pop"
          role="tooltip"
          style={{ top: pos.top, left: pos.left, width: POPOVER_WIDTH }}
        >
          {children}
        </div>
      )}
    </span>
  );
}
