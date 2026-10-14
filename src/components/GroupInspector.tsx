import { useEffect, useMemo, useRef, useState } from "react";
import type { ProcessedProfile, ResolvedGroup, ResolvedGroupMember } from "@/processing/types";
import { inspectGroupMember } from "@/processing/groupInspection";
import { resolveFrames } from "@/processing/select";
import { formatCount, formatSeconds } from "@/format";
import { HangSummary, evidenceMarks } from "./HangSummary";
import { StackSection } from "./DetailPane";
import { useViewState } from "@/state/useViewState";
import { investigationLink } from "@/state/permalink";

export function GroupInspector({profile, group, member, originalKey, slot, memberId, filter, sort, onBack, onOpenHang}: {
  profile: ProcessedProfile; group: ResolvedGroup; member: ResolvedGroupMember | null;
  originalKey: string; slot: number; memberId: string; filter: string; sort: "time" | "count";
  onBack: () => void; onOpenHang: (id: string) => void;
}) {
  const pane = useRef<HTMLDivElement>(null);
  const {state} = useViewState();
  const [copyStatus, setCopyStatus] = useState("Copy link");
  const [flash, setFlash] = useState<number | null>(null);
  useEffect(() => {
    if (flash === null) return;
    const timer = setTimeout(() => setFlash(null), 1500);
    return () => clearTimeout(timer);
  }, [flash]);
  const signature = useMemo(() => member ? inspectGroupMember(profile, member, memberId) : null, [profile, member, memberId]);
  if (!member || !signature) return <div className="detail-empty"><div className="inspector-welcome">
    <h2>Select a stack</h2><p>Inspect an exact member or use the left checkboxes to compare up to four stacks.</p>
  </div></div>;
  const frames = resolveFrames(profile, member.frameKeys);
  const owner = profile.sigIdByKey?.[member.key];
  const rank = [...group.members].sort((a,b) => sort === "count" ? b.count-a.count : b.ms-a.ms).findIndex(m => m.key === member.key) + 1;
  const jump = (depth: number) => {
    setFlash(depth);
    // StackSection reveals folded evidence before scrolling on the next frame.
    requestAnimationFrame(() => requestAnimationFrame(() => pane.current?.querySelector(`[data-depth="${depth}"]`)?.scrollIntoView({block:"center",behavior:"smooth"})));
  };
  return <div className="detail-pane" ref={pane}>
    <div className="group-inspector-toolbar" data-slot={slot >= 0 ? slot : 4}>
      <span className="comparison-badge">{member.key === originalKey ? "A · Original" : slot > 0 ? `${String.fromCharCode(65+slot)} · Candidate` : "Candidate"} · Stack #{rank}</span>
      <span>{formatSeconds(member.ms)} s · {formatCount(member.count)} hangs</span>
      <button className="link inspector-back" onClick={onBack}>← Back to stacks</button>
      <button className="link" onClick={async () => {
        try { await navigator.clipboard.writeText(investigationLink(state,profile.date)); setCopyStatus("Link copied"); }
        catch { setCopyStatus("Copy failed"); }
      }}>{copyStatus}</button>
    </div>
    <HangSummary signature={signature} frames={frames} onJump={jump} contextAvailable={false} />
    <StackSection frames={frames} filter={filter} marks={evidenceMarks(signature.kind)} flash={flash} table={profile.frameTable} />
    {owner && <div className="detail-section"><button className="link" onClick={() => onOpenHang(owner)}>Open the aggregate hang{signature.knownBug ? ` · Bug ${signature.knownBug.id}` : ""} →</button></div>}
  </div>;
}
