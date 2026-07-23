import type { HangSignature, ProcessedProfile } from "@/processing/types";
import type { GroupRow, ListRow } from "@/processing/grouping";
import { distinguishingLabel } from "@/processing/grouping";
import { resolveFrames } from "@/processing/select";
import { trendBadge, type TrendSummary } from "@/data/trend";
import { formatCount, formatPercentOfTotal, formatSeconds } from "@/format";
import { frameLabel } from "@/frames";
import { Highlight } from "./Highlight";
import { InfoTip } from "./InfoTip";

const MAX_ROWS = 50;

interface HangTableProps {
  profile: ProcessedProfile;
  rows: ListRow[];
  filter: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  trendById: Map<string, TrendSummary | null>;
  /** groupKeys currently unfolded. */
  expanded: Set<string>;
  onToggleGroup: (groupKey: string) => void;
  /** signature ids chosen for the side-by-side diff (max 2). */
  compare: string[];
  onToggleCompare: (id: string) => void;
}

export function HangTable({
  profile,
  rows,
  filter,
  selectedId,
  onSelect,
  trendById,
  expanded,
  onToggleGroup,
  compare,
  onToggleCompare,
}: HangTableProps) {
  const visible = rows.slice(0, MAX_ROWS);
  const remaining = rows.length - visible.length;

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
              For a group, the summed time across its near-duplicate members.
            </InfoTip>
          </th>
          <th className="num count">
            Count
            <InfoTip label="Count">
              How many hangs matched this signature in the day’s sampled BHR
              reports. For a group, summed across its members.
            </InfoTip>
          </th>
          <th className="trend">
            Trend
            <InfoTip label="Trend">
              Change in this hang’s activity: its recent 7-day average vs the
              previous 7 days. <code>↑</code> worse, <code>↓</code> improving,{" "}
              <code>new</code> = little earlier activity.
            </InfoTip>
          </th>
          <th>
            Hang signature (leaf frame)
            <InfoTip label="Grouping">
              Near-duplicate hangs that share a leaf frame are folded into one{" "}
              group. Click a group to unfold its individual signatures and their
              distinguishing frame, then tick two to compare their stacks
              side by side.
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
        {visible.map((row, i) =>
          row.kind === "group" ? (
            <GroupRows
              key={row.groupKey}
              row={row}
              rank={i + 1}
              profile={profile}
              filter={filter}
              selectedId={selectedId}
              onSelect={onSelect}
              trendById={trendById}
              open={expanded.has(row.groupKey)}
              onToggle={() => onToggleGroup(row.groupKey)}
              compare={compare}
              onToggleCompare={onToggleCompare}
            />
          ) : (
            <SignatureRow
              key={row.sig.id}
              sig={row.sig}
              rank={`${i + 1}`}
              profile={profile}
              filter={filter}
              selected={row.sig.id === selectedId}
              onSelect={onSelect}
              trend={trendById.get(row.sig.id) ?? null}
            />
          ),
        )}
        {remaining > 0 && (
          <tr className="footer">
            <td className="rank" />
            <td className="num time" />
            <td className="num count" />
            <td className="trend" />
            <td>And {remaining.toLocaleString()} more rows…</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function GroupRows({
  row,
  rank,
  profile,
  filter,
  selectedId,
  onSelect,
  trendById,
  open,
  onToggle,
  compare,
  onToggleCompare,
}: {
  row: GroupRow;
  rank: number;
  profile: ProcessedProfile;
  filter: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  trendById: Map<string, TrendSummary | null>;
  open: boolean;
  onToggle: () => void;
  compare: string[];
  onToggleCompare: (id: string) => void;
}) {
  return (
    <>
      <tr className="group-row" onClick={onToggle}>
        <td className="rank">
          <span className={`disclosure ${open ? "open" : ""}`}>▸</span>
          {rank}
        </td>
        <td
          className="num time"
          title={`${formatPercentOfTotal(row.duration, profile.totalDuration)} of total hang time`}
        >
          {formatSeconds(row.duration)}
        </td>
        <td className="num count">{formatCount(row.count)}</td>
        <td className="trend" />
        <td className="sig">
          <span className="group-name">
            <Highlight text={row.displayName} needle={filter} />
          </span>
          <span className="group-badge">{row.members.length} stacks</span>
        </td>
      </tr>
      {open &&
        row.members.map((sig) => {
          const checked = compare.includes(sig.id);
          const disabled = !checked && compare.length >= 2;
          const badge = (() => {
            const t = trendById.get(sig.id) ?? null;
            return t ? trendBadge(t) : null;
          })();
          return (
            <tr
              key={sig.id}
              className={`member-row${sig.id === selectedId ? " selected" : ""}`}
              onClick={() => onSelect(sig.id)}
            >
              <td className="rank">
                <input
                  type="checkbox"
                  className="compare-box"
                  checked={checked}
                  disabled={disabled}
                  title={
                    disabled
                      ? "Two stacks already selected"
                      : "Select to compare (pick two)"
                  }
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => onToggleCompare(sig.id)}
                />
              </td>
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
              <td className="sig member-sig">
                <span className="member-arrow">↳</span>
                <Highlight text={distinguishingLabel(profile, sig)} needle={filter} />
              </td>
            </tr>
          );
        })}
    </>
  );
}

function SignatureRow({
  sig,
  rank,
  profile,
  filter,
  selected,
  onSelect,
  trend,
}: {
  sig: HangSignature;
  rank: string;
  profile: ProcessedProfile;
  filter: string;
  selected: boolean;
  onSelect: (id: string) => void;
  trend: TrendSummary | null;
}) {
  const leaf = resolveFrames(profile, sig.frameKeys.slice(0, 1))[0];
  const badge = trend ? trendBadge(trend) : null;
  return (
    <tr className={selected ? "selected" : ""} onClick={() => onSelect(sig.id)}>
      <td className="rank">{rank}</td>
      <td
        className="num time"
        title={`${formatPercentOfTotal(sig.duration, profile.totalDuration)} of total hang time`}
      >
        {formatSeconds(sig.duration)}
      </td>
      <td className="num count">{formatCount(sig.count)}</td>
      <td className="trend">
        {badge && <span className={`trend-badge ${badge.tone}`}>{badge.text}</span>}
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
