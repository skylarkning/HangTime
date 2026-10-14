/**
 * Why a near-duplicate group exists and how far to trust it: a relationship
 * label and one sentence (see data/groupRelation.ts). Shown over the list
 * when it is narrowed to a group, and in the detail pane's group section.
 */

import { useMemo } from "react";
import { InfoTip } from "./InfoTip";
import type { ProcessedProfile, ResolvedGroup } from "@/processing/types";
import {
  RELATION_LABELS,
  explainGroup,
  relationSentence,
  type GroupRelation,
} from "@/data/groupRelation";

/** The bug case is settled; the rest go from fairly to least confident. */
const TONE: Record<GroupRelation, string> = {
  "same-bug": "green",
  "similar-paths": "blue",
  "shared-mechanism": "amber",
  "shared-code": "amber",
};

export function GroupRelationNote({
  profile,
  group,
}: {
  profile: ProcessedProfile;
  group: ResolvedGroup;
}) {
  const explanation = useMemo(() => explainGroup(profile, group), [profile, group]);
  return (
    <div className="group-relation">
      <span className={`chip ${TONE[explanation.relation]}`}>
        {RELATION_LABELS[explanation.relation]}
      </span>
      <InfoTip label="Group relationship">
        {relationSentence(explanation, group.memberCount)}
        <span className="eg">This describes stack similarity, not a confirmed shared root cause.</span>
      </InfoTip>
    </div>
  );
}
