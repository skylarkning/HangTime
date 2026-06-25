import { useMemo } from "react";
import type { HangSignature, ProcessedProfile } from "@/processing/types";
import { resolveFrames } from "@/processing/select";
import type { TimeseriesIndex } from "@/data/timeseries";
import { computeTrend, trendBadge } from "@/data/trend";
import { formatCount, formatPercentOfTotal, formatSeconds } from "@/format";
import { frameLabel } from "@/frames";
import { Highlight } from "./Highlight";

const MAX_ROWS = 50;

interface HangTableProps {
  profile: ProcessedProfile;
  signatures: HangSignature[];
  filter: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  timeseries: TimeseriesIndex | undefined;
}

export function HangTable({
  profile,
  signatures,
  filter,
  selectedId,
  onSelect,
  timeseries,
}: HangTableProps) {
  const totals = useMemo(() => {
    let duration = 0;
    let count = 0;
    for (const sig of signatures) {
      duration += sig.duration;
      count += sig.count;
    }
    return { duration, count };
  }, [signatures]);

  const visible = signatures.slice(0, MAX_ROWS);
  const remaining = signatures.length - visible.length;

  return (
    <table className="hangs">
      <thead>
        <tr>
          <th className="rank">#</th>
          <th className="num time">Time (s)</th>
          <th className="num count">Count</th>
          <th className="trend">Trend</th>
          <th>Hang signature (leaf frame)</th>
        </tr>
      </thead>
      <tbody>
        {visible.length === 0 && (
          <tr>
            <td colSpan={5} style={{ color: "var(--muted)" }}>
              No hang matching filter.
            </td>
          </tr>
        )}
        {visible.map((sig, i) => {
          const leaf = resolveFrames(profile, sig.frameKeys.slice(0, 1))[0];
          const series = timeseries?.resolve(sig.memberKeys);
          const badge = series ? trendBadge(computeTrend(series, "count")) : null;
          return (
            <tr
              key={sig.id}
              className={sig.id === selectedId ? "selected" : ""}
              onClick={() => onSelect(sig.id)}
            >
              <td className="rank">{i + 1}</td>
              <td
                className="num time"
                title={`${formatPercentOfTotal(sig.duration, profile.totalDuration)} of total hang time`}
              >
                {formatSeconds(sig.duration)}
              </td>
              <td className="num count">{formatCount(sig.count)}</td>
              <td className="trend">
                {badge && (
                  <span className={`trend-badge ${badge.tone}`}>{badge.text}</span>
                )}
              </td>
              <td className="sig">
                {sig.knownBug ? (
                  <BugCell bug={sig.knownBug} />
                ) : (
                  <FrameCell label={frameLabel(leaf)} filter={filter} />
                )}
              </td>
            </tr>
          );
        })}
        {remaining > 0 && (
          <tr className="footer">
            <td className="rank" />
            <td className="num time">{formatSeconds(totals.duration)}</td>
            <td className="num count">{formatCount(totals.count)}</td>
            <td className="trend" />
            <td>And {remaining.toLocaleString()} more signatures…</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function BugCell({ bug }: { bug: { id: number; summary: string; status: string } }) {
  return (
    <>
      <a
        href={`https://bugzilla.mozilla.org/show_bug.cgi?id=${bug.id}`}
        title={`${bug.status} — ${bug.summary}`}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
      >
        Bug {bug.id}
      </a>{" "}
      — {bug.summary}
    </>
  );
}

function FrameCell({ label, filter }: { label: string; filter: string }) {
  return <Highlight text={label} needle={filter} />;
}
