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
 * a stack selects the row it belongs to, as the detail pane's group list does.
 */

import { useMemo, useState } from "react";
import type { ProcessedProfile, ResolvedGroup } from "@/processing/types";
import { resolveFrames, stackMatcher } from "@/processing/select";
import { explainGroup } from "@/data/groupRelation";
import { activityText, hangTitle } from "@/data/hangAreas";
import { formatCount, formatPercentOfTotal, formatSeconds, formatShare } from "@/format";
import { frameLabel } from "@/frames";
import { Highlight } from "./Highlight";
import { InfoTip } from "./InfoTip";
import { shortSymbol } from "./HangName";

interface GroupMemberTableProps {
  profile: ProcessedProfile;
  group: ResolvedGroup;
  filter: string;
  sort: "time" | "count";
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function GroupMemberTable({
  profile,
  group,
  filter,
  sort,
  selectedId,
  onSelect,
}: GroupMemberTableProps) {
  const explanation = useMemo(() => explainGroup(profile, group), [profile, group]);
  const members = useMemo(() => {
    const match = stackMatcher(profile, filter);
    const all = explanation.members;
    const shown = match ? all.filter((m) => match(m.member.frameKeys)) : all;
    return [...shown].sort((a, b) =>
      sort === "count" ? b.member.count - a.member.count : b.member.ms - a.member.ms,
    );
  }, [profile, explanation, filter, sort]);

  // Several stacks can belong to one row (all of a bug's, say), so the selected
  // row alone would highlight every one of them. Highlight the stack clicked,
  // or, before any click, a stack that's the only one in its row.
  const [clickedKey, setClickedKey] = useState<string | null>(null);
  const stacksPerRow = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of group.members) {
      const id = profile.sigIdByKey?.[m.key];
      if (id) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    return counts;
  }, [group, profile.sigIdByKey]);

  return (
    <table className="hangs">
      <thead>
        <tr>
          <th className="rank">#</th>
          <th className="num time">Time (s)</th>
          <th className="num share">Share</th>
          <th className="num count">Count</th>
          <th>
            How it differs
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
          </th>
        </tr>
      </thead>
      <tbody>
        {members.length === 0 && (
          <tr>
            <td colSpan={5} style={{ color: "var(--muted)" }}>
              No stack in this group matches the filter.
            </td>
          </tr>
        )}
        {members.map(({ member, kind, signature, distinguishing }, i) => {
          const sigId = profile.sigIdByKey?.[member.key];
          const bug = signature?.knownBug;
          const leaf = resolveFrames(profile, member.frameKeys.slice(0, 1))[0];
          const unique = distinguishing;
          const activity = activityText(kind);
          const isSelected =
            !!sigId &&
            sigId === selectedId &&
            (clickedKey ? clickedKey === member.key : stacksPerRow.get(sigId) === 1);
          return (
            <tr
              key={member.key}
              className={isSelected ? "selected" : ""}
              onClick={() => {
                setClickedKey(member.key);
                if (sigId) {
                  onSelect(sigId);
                }
              }}
            >
              <td className="rank">{i + 1}</td>
              <td
                className="num time"
                title={`${formatPercentOfTotal(member.ms, group.totalMs)} of the group's hang time`}
              >
                {formatSeconds(member.ms)}
              </td>
              <td className="num share">{formatShare(member.ms, group.totalMs)}</td>
              <td className="num count">{formatCount(member.count)}</td>
              <td className="sig">
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
