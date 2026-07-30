import { useEffect, useMemo, useState } from "react";
import type {
  Frame,
  HangSignature,
  ProcessedProfile,
  ResolvedGroupMember,
} from "@/processing/types";
import type { FramePair } from "@/data/schema";
import type { TimeseriesIndex } from "@/data/timeseries";
import { computeTrend, trendBadge } from "@/data/trend";
import { buildBugReport } from "@/data/bugReport";
import { resolveFrames } from "@/processing/select";
import { formatCount, formatDate, formatSeconds } from "@/format";
import { frameLabel, isOwnCode } from "@/frames";
import { Highlight } from "./Highlight";
import { InfoTip } from "./InfoTip";
import { TimeseriesChart } from "./TimeseriesChart";

interface DetailPaneProps {
  profile: ProcessedProfile;
  signature: HangSignature | null;
  filter: string;
  timeseries: TimeseriesIndex | undefined;
  onSelect: (id: string) => void;
}

export function DetailPane({
  profile,
  signature,
  filter,
  timeseries,
  onSelect,
}: DetailPaneProps) {
  if (!signature) {
    return <div className="detail-empty">Select a hang to see its stack.</div>;
  }
  const frames = resolveFrames(profile, signature.frameKeys);

  let trendNote: string | undefined;
  const series = timeseries?.resolve(signature.memberKeys);
  if (series) {
    const badge = trendBadge(computeTrend(series, "ms"));
    trendNote =
      badge.text === "stable" || badge.text === "new"
        ? badge.text
        : `${badge.text} vs prior 7d`;
  }

  return (
    <div className="detail-pane">
      {signature.knownBug && (
        <div className="detail-section">
          <h3>Bugzilla</h3>
          <div className="bug-link">
            <a
              href={`https://bugzilla.mozilla.org/show_bug.cgi?id=${signature.knownBug.id}`}
              target="_blank"
              rel="noreferrer"
            >
              Bug {signature.knownBug.id}
            </a>{" "}
            — {signature.knownBug.summary}
          </div>
        </div>
      )}

      <TimeseriesChart index={timeseries} signature={signature} />

      <LeafGroupSection
        profile={profile}
        signature={signature}
        filter={filter}
        onSelect={onSelect}
      />

      <FileBugSection
        signature={signature}
        frames={frames}
        date={profile.date}
        trendNote={trendNote}
      />

      <PlatformSection signature={signature} />

      <AffectedClientsSection profile={profile} signature={signature} />

      <AnnotationStatsSection signature={signature} />

      <div className="detail-section">
        <h3>Stack ({frames.length} frames)</h3>
        <div className="stack-trace">
          {frames.length === 0 && <div className="frame">(empty stack)</div>}
          {frames.map((frame, i) => (
            <div key={i} className={`frame${isOwnCode(frame) ? "" : " system"}`}>
              <span className="idx">{i}</span>
              <span className="name">
                <Highlight text={frame.funcName} needle={filter} />
              </span>
              {frame.libName && (
                <span className="lib">
                  <Highlight text={frame.libName} needle={filter} />
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FileBugSection({
  signature,
  frames,
  date,
  trendNote,
}: {
  signature: HangSignature;
  frames: Frame[];
  date: string;
  trendNote?: string;
}) {
  const [copied, setCopied] = useState(false);

  const report = buildBugReport({
    frames,
    count: signature.count,
    durationMs: signature.duration,
    date: formatDate(date),
    trendNote,
    permalink: window.location.href,
  });

  const copy = async () => {
    await navigator.clipboard.writeText(report.comment);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (signature.knownBug) {
    return (
      <div className="detail-section">
        <h3>File a bug</h3>
        <p className="muted">
          Already tracked by Bug {signature.knownBug.id}.{" "}
          <button className="link" onClick={copy}>
            {copied ? "Copied" : "Copy hang summary"}
          </button>{" "}
          to add current data to it.
        </p>
      </div>
    );
  }

  return (
    <div className="detail-section">
      <h3>File a bug</h3>
      <p className="muted">
        Files with whiteboard tag <code>{report.whiteboard}</code>, so the
        dashboard auto-merges matching hangs from the next run.
      </p>
      <div className="report-actions">
        <a className="btn" href={report.url} target="_blank" rel="noreferrer">
          File Bugzilla bug…
        </a>
        <button className="btn secondary" onClick={copy}>
          {copied ? "Copied" : "Copy comment"}
        </button>
      </div>
    </div>
  );
}

/** One collapsed near-duplicate variant: group members with an identical
 * meaningful stack, folded into a single deduplicated row. */
interface GroupVariant {
  variantKey: string;
  /** Highest-ms member, the row's inspect/compare target. */
  rep: ResolvedGroupMember;
  /** How many raw members folded into this variant. */
  memberCount: number;
  duration: number;
  count: number;
  firstUniqueFrame: FramePair | null;
  containsSelected: boolean;
}

function LeafGroupSection({
  profile,
  signature,
  filter,
  onSelect,
}: {
  profile: ProcessedProfile;
  signature: HangSignature;
  filter: string;
  onSelect: (id: string) => void;
}) {
  const info = profile.leafGroupByKey?.[signature.stableKey];
  const groupKey = info?.groupKey;
  const group = groupKey ? profile.groupsByKey?.[groupKey] : undefined;

  // Every member of the group, ranked by hang time. Sourced from the group's
  // own member list (resolved to frames), NOT from the merged signature list,
  // so members that were folded into another row (e.g. a bug) are still here.
  const members = useMemo(
    () => (group ? [...group.members].sort((a, b) => b.ms - a.ms) : []),
    [group],
  );

  // Collapse members by meaningful-stack variant: members that differ only in
  // skipped noise frames (same variantKey) are the same hang and fold into one
  // row. Variants that truly diverge stay distinct, each labeled by its branch
  // frame. "Show individual stacks" drops back to the raw list so a merge can
  // be checked frame by frame.
  const variants = useMemo<GroupVariant[]>(() => {
    const byVariant = new Map<string, GroupVariant>();
    for (const m of members) {
      const vk = m.variantKey || m.key;
      let v = byVariant.get(vk);
      if (!v) {
        v = {
          variantKey: vk,
          rep: m,
          memberCount: 0,
          duration: 0,
          count: 0,
          firstUniqueFrame: m.firstUniqueFrame,
          containsSelected: false,
        };
        byVariant.set(vk, v);
      }
      v.memberCount += 1;
      v.duration += m.ms;
      v.count += m.count;
      if (m.ms > v.rep.ms) {
        v.rep = m;
      }
      if (m.key === signature.stableKey) {
        v.containsSelected = true;
      }
    }
    return [...byVariant.values()].sort((a, b) => b.duration - a.duration);
  }, [members, signature.stableKey]);

  // The section starts folded to the group name; both reset when the selected
  // signature moves to a different group.
  const [open, setOpen] = useState(false);
  const [showIndividual, setShowIndividual] = useState(false);
  useEffect(() => {
    setOpen(false);
    setShowIndividual(false);
  }, [groupKey]);

  if (!group) {
    return null;
  }

  const rawLeafLabel = (m: ResolvedGroupMember): string =>
    frameLabel(resolveFrames(profile, m.frameKeys.slice(0, 1))[0]);
  const singleVariant = variants.length === 1;
  const variantLabel = (v: GroupVariant): string => {
    const f = v.firstUniqueFrame;
    if (!f) {
      return "identical (differs only in system / event-loop frames)";
    }
    return f[1] ? `${f[0]} ${f[1]}` : f[0];
  };
  // A group member's stack belongs to a displayed signature (its own row, or a
  // bug it was folded into); clicking inspects that signature.
  const selectMember = (m: ResolvedGroupMember) => {
    const id = profile.sigIdByKey?.[m.key];
    if (id) {
      onSelect(id);
    }
  };
  // The raw per-member list (for single-variant groups and the "individual
  // stacks" view): labeled by raw leaf so noise differences are visible.
  const rawList = (
    <ul className="group-members">
      {members.map((m) => {
        return (
          <li
            key={m.key}
            className={`group-member${m.key === signature.stableKey ? " selected" : ""}`}
          >
            <button className="group-member-main" onClick={() => selectMember(m)}>
              <span className="member-arrow">↳</span>
              <Highlight text={rawLeafLabel(m)} needle={filter} />
            </button>
            <span className="group-member-stat">
              {formatSeconds(m.ms)}s · {formatCount(m.count)}
            </span>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="detail-section">
      <h3>
        Near-duplicate group
        <InfoTip label="Near-duplicate group">
          The aggregation job groups signatures by their first <em>meaningful</em>{" "}
          frame: system code, lock / allocator primitives, SpiderMonkey glue, and
          event-loop machinery are skipped so a pile of hangs that are really the
          same Firefox problem collapse together even when the raw leaf (a sleep,
          a <code>memcpy</code>, a <code>free</code>) differs. The whole group is
          one row in the list; open it here to see the distinct variants (each
          labeled by its branch frame) or every individual stack.
        </InfoTip>
      </h3>
      <button
        className="group-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className={`disclosure ${open ? "open" : ""}`}>▸</span>
        <span className="group-toggle-name">
          <Highlight text={group.displayName} needle={filter} />
        </span>
        <span className="group-badge">{group.memberCount.toLocaleString()} stacks</span>
        {group.avgEventLoopDepth >= 0.05 && (
          <span
            className="group-badge"
            title="Average number of nested event loops on the stack across this group's members"
          >
            ~{group.avgEventLoopDepth.toFixed(1)} event loops
          </span>
        )}
      </button>
      {open && (
        <>
          {singleVariant ? (
            <>
              <p className="muted group-note">
                All {members.length.toLocaleString()} stacks are the same hang,
                differing only in system, allocator, or event-loop frames.
              </p>
              {rawList}
            </>
          ) : showIndividual ? (
            rawList
          ) : (
            <ul className="group-members">
              {variants.map((v) => {
                return (
                  <li
                    key={v.variantKey}
                    className={`group-member${v.containsSelected ? " selected" : ""}`}
                  >
                    <button
                      className="group-member-main"
                      onClick={() => selectMember(v.rep)}
                    >
                      <span className="member-arrow">↳</span>
                      <Highlight text={variantLabel(v)} needle={filter} />
                      {v.memberCount > 1 && (
                        <span className="variant-count">×{v.memberCount}</span>
                      )}
                    </button>
                    <span className="group-member-stat">
                      {formatSeconds(v.duration)}s · {formatCount(v.count)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {!singleVariant && members.length > variants.length && (
            <button
              className="link group-individual-toggle"
              onClick={() => setShowIndividual((v) => !v)}
            >
              {showIndividual
                ? `Show ${variants.length.toLocaleString()} merged variants`
                : `Show all ${members.length.toLocaleString()} individual stacks`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

const OS_LABELS: Record<string, string> = {
  Windows: "Windows",
  Darwin: "macOS",
  Linux: "Linux",
};

function PlatformSection({ signature }: { signature: HangSignature }) {
  const entries = Object.entries(signature.platformStats).sort(
    (a, b) => b[1] - a[1],
  );
  if (entries.length === 0) {
    return null;
  }
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  const pct = (n: number) =>
    (n / total).toLocaleString(undefined, {
      style: "percent",
      minimumFractionDigits: 1,
    });

  return (
    <div className="detail-section">
      <h3>
        Platform
        <InfoTip label="Platform">
          Share of this signature’s hangs by operating system, weighted by hang
          count.
          <span className="eg">
            e.g. <code>Windows 75.8%</code> = most of these hangs came from
            Windows users.
          </span>
        </InfoTip>
      </h3>
      <ul className="annotation-list">
        {entries.map(([os, count]) => (
          <li key={os}>
            <code>{OS_LABELS[os] ?? os}</code>{" "}
            <span className="pct">
              {pct(count)} ({count.toLocaleString()} hangs)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AffectedClientsSection({
  profile,
  signature,
}: {
  profile: ProcessedProfile;
  signature: HangSignature;
}) {
  const c = signature.affectedClients;
  const total = profile.affectedClientsTotal;
  const pct = (n: number, d: number) =>
    d > 0
      ? (n / d).toLocaleString(undefined, {
          style: "percent",
          minimumFractionDigits: 1,
        })
      : "n/a";
  const hllDelta = c.raw > 0 ? (c.hll - c.raw) / c.raw : 0;
  const deltaLabel = `${hllDelta >= 0 ? "+" : ""}${(hllDelta * 100).toFixed(1)}%`;

  const rows: { label: string; n: number; d: number; note: string }[] = [
    { label: "Raw client_id", n: c.raw, d: total.raw, note: "exact, ground truth" },
    { label: "Salted hash", n: c.hashed, d: total.hashed, note: "exact, privacy-safe" },
    { label: "HyperLogLog", n: c.hll, d: total.hll, note: `estimate, Δ vs exact ${deltaLabel}` },
  ];

  return (
    <div className="detail-section">
      <h3>
        Affected clients (3-way)
        <InfoTip label="Affected clients">
          Distinct users hitting this hang, counted three ways for comparison: raw{" "}
          <code>client_id</code> (exact ground truth), a salted hash of{" "}
          <code>client_id</code> (exact and privacy-safe), and a HyperLogLog
          estimate (approximate, cheap, mergeable). Raw and hash should match; the
          HLL row shows the approximation error. Percentages are of the day’s
          distinct clients.
        </InfoTip>
        {profile.affectedClientsSynthetic && (
          <span className="pct"> (synthetic data)</span>
        )}
      </h3>
      <ul className="annotation-list">
        {rows.map((r) => (
          <li key={r.label}>
            <code>{r.label}</code>{" "}
            <span className="pct">
              {r.n.toLocaleString()} ({pct(r.n, r.d)}) — {r.note}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AnnotationStatsSection({ signature }: { signature: HangSignature }) {
  const entries = Object.entries(signature.annotationStats).sort(
    (a, b) => b[1].totalCount - a[1].totalCount,
  );
  if (entries.length === 0) {
    return null;
  }
  const pct = (n: number) =>
    (n / signature.count).toLocaleString(undefined, {
      style: "percent",
      minimumFractionDigits: 1,
    });

  return (
    <div className="detail-section">
      <h3>
        Hang annotations
        <InfoTip label="Hang annotations">
          Context flags Firefox recorded with the hang (e.g.{" "}
          <code>UserInteracting</code> = the user was actively interacting). The
          percentage is the share of this signature’s hangs carrying that flag.
        </InfoTip>
      </h3>
      <ul className="annotation-list">
        {entries.map(([key, stat]) => {
          const values = Object.entries(stat.values);
          let detail: React.ReactNode;
          if (values.length === 1 && values[0][0] === "true") {
            detail = `${pct(values[0][1])} (${values[0][1].toLocaleString()} hangs)`;
          } else if (values.length === 1) {
            detail = (
              <>
                {pct(values[0][1])} ({values[0][1].toLocaleString()} hangs:{" "}
                <code>{values[0][0]}</code>)
              </>
            );
          } else {
            detail = (
              <>
                {pct(stat.totalCount)} ({stat.totalCount.toLocaleString()} hangs:{" "}
                {values
                  .sort((a, b) => b[1] - a[1])
                  .map(([v, c], idx) => (
                    <span key={v}>
                      {idx > 0 && ", "}
                      {c.toLocaleString()} <code>{v}</code>
                    </span>
                  ))}
                )
              </>
            );
          }
          return (
            <li key={key}>
              <code>{key}</code> <span className="pct">{detail}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
