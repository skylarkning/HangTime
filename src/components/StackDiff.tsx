/**
 * Side-by-side diff of two near-duplicate hang stacks. The two stacks share a
 * leaf frame and a common trunk, then diverge; aligning them from the leaf
 * downward makes the branch point and everything past it easy to see. Shared
 * frames are dimmed; the first divergent frame and everything below it are
 * highlighted. Rendered as a modal so there's room for two full stacks.
 */

import { useEffect } from "react";
import type { Frame, HangSignature, ProcessedProfile } from "@/processing/types";
import { resolveFrames } from "@/processing/select";
import { distinguishingLabel } from "@/processing/grouping";
import { frameLabel } from "@/frames";

interface DiffRow {
  a: Frame | null;
  b: Frame | null;
  same: boolean;
}

const sameFrame = (x: Frame, y: Frame) =>
  x.funcName === y.funcName && x.libName === y.libName;

/**
 * Longest-common-subsequence alignment of two frame lists (leaf -> root). Shared
 * frames line up on the same row even when one stack has an inserted or removed
 * frame; frames unique to one side sit alone with the other cell blank. This
 * keeps a one-frame insertion from cascading into a wall of false differences.
 */
function diffFrames(a: Frame[], b: Frame[]): DiffRow[] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = sameFrame(a[i], b[j])
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (sameFrame(a[i], b[j])) {
      rows.push({ a: a[i], b: b[j], same: true });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ a: a[i], b: null, same: false });
      i++;
    } else {
      rows.push({ a: null, b: b[j], same: false });
      j++;
    }
  }
  while (i < m) rows.push({ a: a[i++], b: null, same: false });
  while (j < n) rows.push({ a: null, b: b[j++], same: false });
  return rows;
}

interface StackDiffProps {
  profile: ProcessedProfile;
  a: HangSignature;
  b: HangSignature;
  onClose: () => void;
}

export function StackDiff({ profile, a, b, onClose }: StackDiffProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const framesA = resolveFrames(profile, a.frameKeys);
  const framesB = resolveFrames(profile, b.frameKeys);
  const rows = diffFrames(framesA, framesB);
  const shared = rows.filter((r) => r.same).length;
  const differing = rows.length - shared;

  return (
    <div className="diff-backdrop" onClick={onClose}>
      <div className="diff-modal" onClick={(e) => e.stopPropagation()}>
        <div className="diff-head">
          <h3>Compare stacks</h3>
          <button className="diff-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="diff-sub">
          Aligned by longest common subsequence, leaf first. {shared} shared
          frame{shared === 1 ? "" : "s"} dimmed; {differing} frame
          {differing === 1 ? "" : "s"} unique to one stack highlighted.
        </div>
        <table className="diff-table">
          <thead>
            <tr>
              <th className="diff-mark" />
              <th>
                A · <span className="diff-distinct">{distinguishingLabel(profile, a)}</span>
              </th>
              <th>
                B · <span className="diff-distinct">{distinguishingLabel(profile, b)}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={r.same ? "diff-same" : "diff-changed"}>
                <td className="diff-mark">{r.same ? "" : "≠"}</td>
                <td>{r.a ? frameLabel(r.a) : ""}</td>
                <td>{r.b ? frameLabel(r.b) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
