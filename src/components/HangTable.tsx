import { useEffect, useMemo, useState } from "react";
import type { HangSignature, ProcessedProfile } from "@/processing/types";
import { trendBadge, trendEvidence, type TrendSummary } from "@/data/trend";
import { formatCount, formatPercentOfTotal, formatSeconds } from "@/format";
import { HangName } from "./HangName";
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
  /**
   * Which hang time and count a row shows: the signature's own by default, or
   * one platform's share of it when the list is narrowed to a platform.
   */
  durationOf?: (sig: HangSignature) => number;
  countOf?: (sig: HangSignature) => number;
  /** What the time column's percentages are of; defaults to the build total. */
  totalDuration?: number;
  /**
   * The list is narrowed to a platform, but trends can't be: the history only
   * has all-platform series. The column header says so.
   */
  trendAllPlatforms?: boolean;
}

const ownDuration = (sig: HangSignature) => sig.duration;
const ownCount = (sig: HangSignature) => sig.count;

export function HangTable({
  profile,
  signatures,
  filter,
  selectedId,
  onSelect,
  trendById,
  durationOf = ownDuration,
  countOf = ownCount,
  totalDuration,
  trendAllPlatforms = false,
}: HangTableProps) {
  const totals = useMemo(() => {
    let duration = 0;
    let count = 0;
    for (const sig of signatures) {
      duration += durationOf(sig);
      count += countOf(sig);
    }
    return { duration, count };
  }, [signatures, durationOf, countOf]);

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
            {trendAllPlatforms ? "Trend (all platforms)" : "Trend"}
            <InfoTip label="Trend">
              This hang’s average over the 7 days ending on this build, against
              the 7 days before. A percentage is only shown when both weeks have
              at least 5 days of data, enough hangs to mean something, and the
              typical day moved too, not just one spike:{" "}
              <code>↑</code> an increase, <code>↓</code> a decrease.{" "}
              <code>newly tracked</code> = absent before, real volume now.
              <span className="eg">
                Otherwise the badge says what’s missing: <code>partial 1/7d</code>{" "}
                (too few days observed), <code>no baseline</code>,{" "}
                <code>no recent data</code>, <code>below cut</code> (recorded days
                where this hang fell under the history’s top-signature cut),{" "}
                <code>spike</code> (one day, not sustained) or <code>low volume</code>. Hover a badge for the dates compared, the
                days behind each week and the change per day.
                {trendAllPlatforms && (
                  <> Trends cover all platforms; there is no per-platform history.</>
                )}
              </span>
            </InfoTip>
          </th>
          <th>
            Hang
            <InfoTip label="Hang">
              What the hang is, read from its stack: the area of the browser it
              is in and how the thread was stuck, then (in grey) the frame the
              stack stopped on and the Firefox code that called it.
              <span className="eg">
                e.g. <b>Startup cache: lock wait</b> during JS module loading, over{" "}
                <code>WaitOnAddress ← StartupCache::GetBuffer</code>. It describes
                where the thread was, not a confirmed cause.
              </span>
            </InfoTip>
          </th>
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
                title={`${formatPercentOfTotal(durationOf(sig), totalDuration ?? profile.totalDuration)} of total hang time`}
              >
                {formatSeconds(durationOf(sig))}
              </td>
              <td className="num count">{formatCount(countOf(sig))}</td>
              <td className="trend">
                {badge && trend && (
                  <span className={`trend-badge ${badge.tone}`} title={trendEvidence(trend)}>
                    {badge.text}
                  </span>
                )}
              </td>
              <td className="sig">
                <HangName profile={profile} sig={sig} filter={filter} />
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
