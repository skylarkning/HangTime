/**
 * The hang list narrowed to one near-duplicate group: every stack in the
 * group, one row each, ranked by time or count.
 *
 * Rows are the group's own members rather than the merged signature list, so
 * stacks folded into a bug still each get a row (marked with the bug), where
 * the signature list would show the whole group as that one bug row. Clicking
 * a stack selects the row it belongs to, as the detail pane's group list does.
 */

import { useMemo, useState } from "react";
import type { ProcessedProfile, ResolvedGroup } from "@/processing/types";
import { resolveFrames, stackMatcher } from "@/processing/select";
import { formatCount, formatPercentOfTotal, formatSeconds } from "@/format";
import { frameLabel } from "@/frames";
import { Highlight } from "./Highlight";

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
  const members = useMemo(() => {
    const match = stackMatcher(profile, filter);
    const shown = match ? group.members.filter((m) => match(m.frameKeys)) : group.members;
    return [...shown].sort((a, b) => (sort === "count" ? b.count - a.count : b.ms - a.ms));
  }, [profile, group, filter, sort]);

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

  const bugBySigId = useMemo(() => {
    const map = new Map<string, { id: number; summary: string }>();
    for (const sig of profile.signatures) {
      if (sig.knownBug) {
        map.set(sig.id, sig.knownBug);
      }
    }
    return map;
  }, [profile.signatures]);

  return (
    <table className="hangs">
      <thead>
        <tr>
          <th className="rank">#</th>
          <th className="num time">Time (s)</th>
          <th className="num count">Count</th>
          <th>Stack (leaf frame)</th>
        </tr>
      </thead>
      <tbody>
        {members.length === 0 && (
          <tr>
            <td colSpan={4} style={{ color: "var(--muted)" }}>
              No stack in this group matches the filter.
            </td>
          </tr>
        )}
        {members.map((member, i) => {
          const sigId = profile.sigIdByKey?.[member.key];
          const bug = sigId ? bugBySigId.get(sigId) : undefined;
          const leaf = resolveFrames(profile, member.frameKeys.slice(0, 1))[0];
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
              <td className="num count">{formatCount(member.count)}</td>
              <td className="sig">
                <Highlight text={frameLabel(leaf)} needle={filter} />
                {bug && (
                  <span className="group-member-bug" title={bug.summary}>
                    Bug {bug.id}
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
