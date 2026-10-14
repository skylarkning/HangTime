/**
 * The hang list narrowed to one near-duplicate group: every stack in the
 * group, one row each, ranked by time or count.
 *
 * Every member shares the frame the group is named after, so a row leads with
 * what sets it apart: its first distinguishing frame, then its own description
 * and leaf frame, and its share of the group's hang time.
 *
 * Rows are the group's own members rather than the merged signature list, so
 * stacks folded into a bug still each get a row (marked with the bug), where
 * the signature list would show the whole group as that one bug row. Clicking
 * a stack inspects that exact member, even when several share a tracked bug.
 */

import { useMemo } from "react";
import type { ProcessedProfile, ResolvedGroup } from "@/processing/types";
import { resolveFrames, stackMatcher } from "@/processing/select";
import { explainGroup } from "@/data/groupRelation";
import { activityText, hangTitle } from "@/data/hangAreas";
import { formatCount, formatPercentOfTotal, formatSeconds, formatShare } from "@/format";
import { frameLabel } from "@/frames";
import { Highlight } from "./Highlight";
import { InfoTip } from "./InfoTip";
import { shortSymbol } from "@/frames";

interface GroupMemberTableProps {
  profile: ProcessedProfile;
  group: ResolvedGroup;
  filter: string;
  sort: "time" | "count";
  selectedKey: string | null;
  originalKey: string;
  compareKeys: (string | null)[];
  onSelect: (key: string) => void;
  onToggleCompare: (key: string) => void;
}

export function GroupMemberTable({
  profile,
  group,
  filter,
  sort,
  selectedKey, originalKey, compareKeys,
  onSelect, onToggleCompare,
}: GroupMemberTableProps) {
  const explanation = useMemo(() => explainGroup(profile, group), [profile, group]);
  const ranks = useMemo(() => new Map([...explanation.members].sort((a,b) =>
    sort === "count" ? b.member.count-a.member.count : b.member.ms-a.member.ms,
  ).map((item, i) => [item.member.key, i + 1])), [explanation, sort]);
  const members = useMemo(() => {
    const match = stackMatcher(profile, filter);
    const all = explanation.members;
    const shown = match ? all.filter((m) => match(m.member.frameKeys)) : all;
    return [...shown].sort((a, b) =>
      sort === "count" ? b.member.count - a.member.count : b.member.ms - a.member.ms,
    );
  }, [profile, explanation, filter, sort]);

  return (
    <table className="hangs group-stack-table">
      <thead>
        <tr>
          <th className="compare-column"><span title="Original A plus up to three comparison stacks">✓</span></th>
          <th className="rank">#</th>
          <th className="num time">Time (s)</th>
          <th className="num share">Share</th>
          <th className="num count">Count</th>
          <th>
            <span className="column-heading"><span>How it differs</span>
            <InfoTip label="How it differs">
              Every stack here shares the group&rsquo;s frame, so each row leads with
              the first frame that sets it apart from the others. Below, in grey, its
              own description and the frame it stopped on. <b>Share</b> is its part
              of the group&rsquo;s hang time.
              <span className="eg">
                <em>Same meaningful stack</em> means it differs from another member
                only in system, allocator or event-loop frames.
              </span>
            </InfoTip>
            </span>
          </th>
        </tr>
      </thead>
      <tbody>
        {members.length === 0 && (
          <tr>
            <td colSpan={6} style={{ color: "var(--muted)" }}>
              No stack in this group matches the filter.
            </td>
          </tr>
        )}
        {members.map(({ member, kind, signature, distinguishing }) => {
          const rank = ranks.get(member.key)!;
          const bug = signature?.knownBug;
          const leaf = resolveFrames(profile, member.frameKeys.slice(0, 1))[0];
          const unique = distinguishing;
          const activity = activityText(kind);
          const isSelected = member.key === selectedKey;
          const slot = compareKeys.indexOf(member.key);
          const original = member.key === originalKey;
          const disabled = !original && slot < 0 && compareKeys.every(Boolean);
          return (
            <tr
              key={member.key}
              className={`group-stack-row${isSelected ? " inspecting" : ""}`}
              data-member-key={member.key} data-slot={slot >= 0 ? slot : isSelected ? 4 : undefined}
              aria-selected={isSelected} tabIndex={0}
              onClick={() => onSelect(member.key)}
              onKeyDown={event => {
                if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault(); onSelect(member.key);
                }
              }}
            >
              <td className="compare-column" onClick={event => event.stopPropagation()}>
                <input type="checkbox" className="stack-compare-checkbox" checked={slot >= 0}
                  disabled={original || disabled}
                  aria-label={original ? `Original stack ${rank}, included in comparison` : `Compare stack ${rank}`}
                  title={original ? "Original A stays included" : disabled ? "Four stacks selected; uncheck a candidate first" : "Include this exact stack in comparison"}
                  onChange={() => onToggleCompare(member.key)} />
              </td>
              <td className="rank">{rank}</td>
              <td
                className="num time"
                title={`${formatPercentOfTotal(member.ms, group.totalMs)} of the group's hang time`}
              >
                {formatSeconds(member.ms)}
              </td>
              <td className="num share">{formatShare(member.ms, group.totalMs)}</td>
              <td className="num count">{formatCount(member.count)}</td>
              <td className="sig">
                {(slot >= 0 || isSelected) && <span className="comparison-badge">
                  {slot >= 0 ? String.fromCharCode(65 + slot) : "Viewing"}{original ? " · Original" : ""}{isSelected && slot >= 0 ? " · Viewing" : ""}
                </span>}

                {unique ? (
                  <span className="hang-title member-diff" title={unique.join(" ")}>
                    <Highlight text={shortSymbol(unique[0])} needle={filter} />
                    {unique[1] && <span className="lib"> {unique[1]}</span>}
                  </span>
                ) : (
                  <span className="hang-title member-same">
                    Same meaningful stack (differs only in system or event-loop frames)
                  </span>
                )}
                <span className="hang-sub">
                  <span className="hang-sub-title">
                    {hangTitle(kind)}
                    {activity && ` ${activity}`} ·{" "}
                  </span>
                  <Highlight text={frameLabel(leaf)} needle={filter} />
                  {bug && (
                    <span className="group-member-bug" title={bug.summary}>
                      Bug {bug.id}
                    </span>
                  )}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
