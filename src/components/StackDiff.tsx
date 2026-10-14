import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { ProcessedProfile } from "@/processing/types";
import { alignStackKeys } from "@/processing/stackAlignment";

export interface DiffSide {
  frameKeys: number[];
  label: string;
  slot: number;
}
export function StackDiff({profile, sides, onClose}: {
  profile: ProcessedProfile; sides: DiffSide[]; onClose: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key === "Tab") {
        const targets = dialog.current?.querySelectorAll<HTMLElement>('button, [tabindex="0"]');
        if (!targets?.length) return;
        const first = targets[0], last = targets[targets.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [onClose]);
  const same = (a: number, b: number) => profile.funcNames[a] === profile.funcNames[b] && profile.libNames[a] === profile.libNames[b];
  const rows = alignStackKeys(sides.map(side => side.frameKeys), same);
  const depths = sides.map(() => 0);
  return createPortal(<div className="diff-backdrop" onClick={onClose}>
    <div className="diff-modal multi-diff" ref={dialog} role="dialog" aria-modal="true" aria-label="Compare stacks" onClick={e => e.stopPropagation()}>
      <div className="diff-head"><h3>Compare {sides.length} stacks</h3>
        <button ref={close} className="diff-close" onClick={onClose} aria-label="Close comparison">×</button></div>
      <p className="diff-sub">Aligned against Original A, leaf first. Shared frames are dimmed;
        differences use each stack’s color. A dash means no corresponding frame.
        Insertions align before the next original frame.</p>
      <div className="diff-scroll" role="region" aria-label="Aligned stack frames" tabIndex={0}><table className="diff-table multi-diff-table">
        <thead><tr>{sides.map(side => <th key={side.slot} data-slot={side.slot}>
          <span className="comparison-badge">{String.fromCharCode(65 + side.slot)}{side.slot === 0 ? " · Original" : ""}</span> {side.label}
        </th>)}</tr></thead>
        <tbody>{rows.map((row, i) => {
          const original = row[0];
          const shared = original !== null && row.every(value => value !== null && same(value, original));
          return <tr key={i}>{row.map((key, column) => <td key={sides[column].slot} data-slot={sides[column].slot}
            className={shared ? "comparison-shared" : "comparison-different"}>
            {key === null ? <span className="muted">—</span> : <><span className="comparison-depth">{depths[column]++}</span> {profile.funcNames[key]} <span className="muted">{profile.libNames[key]}</span></>}
          </td>)}</tr>;
        })}</tbody>
      </table></div>
    </div>
  </div>, document.body);
}
