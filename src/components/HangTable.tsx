import { useEffect, useMemo, useState } from "react";
import type { HangSignature, ProcessedProfile } from "@/processing/types";
import { resolveFrames } from "@/processing/select";
import { trendBadge, type TrendSummary } from "@/data/trend";
import { formatCount, formatPercentOfTotal, formatSeconds } from "@/format";
import { frameLabel } from "@/frames";
import { Highlight } from "./Highlight";
import { InfoTip } from "./InfoTip";

/** Rows rendered up front, and how many each "show more" click adds. */
const PAGE = 50;

interface HangTableProps {
  profile: ProcessedProfile;
  signatures: HangSignature[];
  filter: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  trendById: Map<string, TrendSummary | null>;
}

export function HangTable({
  profile,
  signatures,
  filter,
  selectedId,
  onSelect,
  trendById,
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

  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [signatures]);

  const visible = signatures.slice(0, limit);
  const remaining = signatures.length - visible.length;

  return (
    <table className="hangs">
      <thead>
        <tr>
          <th className="rank">#</th>
          <th className="num time">
            Time (s)
            <InfoTip label="Time (s)">
              Total time Firefox’s main thread spent hanging on this signature
              during the day, in seconds — every sampled hang’s duration summed.
              <span className="eg">
                e.g. <code>837</code> = 837 seconds of cumulative
                unresponsiveness across sampled users that day.
              </span>
            </InfoTip>
          </th>
          <th className="num count">
            Count
            <InfoTip label="Count">
              How many hangs matched this signature in the day’s sampled BHR
              reports. Each is one main-thread stall.
              <span className="eg">
                e.g. <code>1,773</code> = 1,773 recorded hang occurrences.
              </span>
            </InfoTip>
          </th>
          <th className="trend">
            Trend
            <InfoTip label="Trend">
              Change in this hang’s activity: its recent 7-day average vs the
              previous 7 days. <code>↑</code> getting worse, <code>↓</code>{" "}
              improving, <code>new</code> = little or no earlier activity.
              <span className="eg">
                e.g. <code>↑74%</code> = ~74% more hang activity than the prior
                week.
              </span>
            </InfoTip>
          </th>
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
          const trend = trendById.get(sig.id) ?? null;
          const badge = trend ? trendBadge(trend) : null;
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
                  <Highlight text={frameLabel(leaf)} needle={filter} />
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
            <td>
              <button className="link more" onClick={() => setLimit((n) => n + PAGE)}>
                Show {Math.min(PAGE, remaining)} more
              </button>{" "}
              · {remaining.toLocaleString()} of{" "}
              {signatures.length.toLocaleString()} not shown
            </td>
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
