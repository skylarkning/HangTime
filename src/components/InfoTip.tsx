import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { placePopover } from "./popoverPosition";

/** Clickable help, rendered outside scrolling cards and kept inside the viewport. */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<ReturnType<typeof placePopover> | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const id = useId();

  useLayoutEffect(() => {
    if (!open) return;
    const reposition = () => {
      if (!button.current) return;
      const rect = button.current.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        setOpen(false);
        return;
      }
      const next = placePopover(rect, { width: window.innerWidth, height: window.innerHeight },
        popover.current?.getBoundingClientRect().height ?? 0);
      setPosition((current) => current && Object.keys(next).every(
        (key) => current[key as keyof typeof next] === next[key as keyof typeof next],
      ) ? current : next);
    };
    reposition();
    const observer = new ResizeObserver(reposition);
    if (popover.current) observer.observe(popover.current);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, position !== null, children]);

  // Measure again once the portal is mounted at its constrained width.
  useLayoutEffect(() => {
    if (open && position && popover.current && button.current) {
      const next = placePopover(button.current.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight }, popover.current.getBoundingClientRect().height);
      if (next.top !== position.top || next.left !== position.left) setPosition(next);
    }
  }, [open, position]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!button.current?.contains(event.target as Node) && !popover.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (open && position) popover.current?.focus({ preventScroll: true });
  }, [open, position !== null]);

  return (
    <span className="infotip">
      <button ref={button} type="button" className="infotip-btn"
        aria-label={`About ${label}`} aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }}>
        i
      </button>
      {open && position && createPortal(
        <div ref={popover} id={id} className="infotip-pop" role="dialog" tabIndex={-1} aria-label={`About ${label}`}
          style={position} onClick={(event) => event.stopPropagation()}>
          <div className="infotip-heading"><strong>{label}</strong>
            <button type="button" aria-label="Close explanation" onClick={() => { setOpen(false); button.current?.focus(); }}>×</button>
          </div>
          {children}
        </div>, document.body,
      )}
    </span>
  );
}
