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
import { StackDiff } from "./StackDiff";
import { TimeseriesChart } from "./TimeseriesChart";
import { memberStacks } from "@/processing/signatureKey";

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
  const series = timeseries?.resolveByStack(memberStacks(signature));
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

      <AffectedClientsSection
        profile={profile}
        signature={signature}
        timeseries={timeseries}
      />

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
  const info = profile.leafGroupByKey?.[signature.stackKey];
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
      if (m.key === signature.stackKey) {
        v.containsSelected = true;
      }
    }
    return [...byVariant.values()].sort((a, b) => b.duration - a.duration);
  }, [members, signature.stackKey]);

  // The section starts folded to the group name; a compare selection (max two)
  // drives the side-by-side stack diff. All reset when the selected signature
  // moves to a different group.
  const [open, setOpen] = useState(false);
  const [showIndividual, setShowIndividual] = useState(false);
  const [compare, setCompare] = useState<string[]>([]);
  const [showDiff, setShowDiff] = useState(false);
  useEffect(() => {
    setOpen(false);
    setShowIndividual(false);
    setCompare([]);
    setShowDiff(false);
  }, [groupKey]);

  if (!group) {
    return null;
  }

  const memberByKey = new Map(members.map((m) => [m.key, m]));
  const toggleCompare = (key: string) =>
    setCompare((prev) => {
      if (prev.includes(key)) {
        return prev.filter((x) => x !== key);
      }
      return prev.length >= 2 ? prev : [...prev, key];
    });

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
  const compareRow = (key: string) => {
    const checked = compare.includes(key);
    return { checked, disabled: !checked && compare.length >= 2 };
  };
  // Compare is keyed by member; each side carries that member's frames so any
  // two individual stacks can be diffed, even ones folded into the same row.
  const diffSides = compare
    .map((k) => memberByKey.get(k))
    .filter((m): m is ResolvedGroupMember => !!m)
    .map((m) => ({ frameKeys: m.frameKeys, label: rawLeafLabel(m) }));

  // The raw per-member list (for single-variant groups and the "individual
  // stacks" view): labeled by raw leaf so noise differences are visible.
  const rawList = (
    <ul className="group-members">
      {members.map((m) => {
        const { checked, disabled } = compareRow(m.key);
        return (
          <li
            key={m.key}
            className={`group-member${m.key === signature.stackKey ? " selected" : ""}`}
          >
            <input
              type="checkbox"
              className="compare-box"
              checked={checked}
              disabled={disabled}
              title={
                disabled ? "Two stacks already selected" : "Select to compare (pick two)"
              }
              onChange={() => toggleCompare(m.key)}
            />
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
          labeled by its branch frame), show every individual stack, or tick two
          and diff them to confirm the merge is right.
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
                differing only in system, allocator, or event-loop frames. Compare
                any two below to confirm.
              </p>
              {rawList}
            </>
          ) : showIndividual ? (
            rawList
          ) : (
            <ul className="group-members">
              {variants.map((v) => {
                const { checked, disabled } = compareRow(v.rep.key);
                return (
                  <li
                    key={v.variantKey}
                    className={`group-member${v.containsSelected ? " selected" : ""}`}
                  >
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
                      onChange={() => toggleCompare(v.rep.key)}
                    />
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
          {members.length >= 2 && (
            <div className="group-compare">
              <span>
                {compare.length === 2
                  ? "2 stacks selected"
                  : "Tick two stacks to compare"}
              </span>
              <button
                className="btn"
                disabled={compare.length !== 2}
                onClick={() => setShowDiff(true)}
              >
                Compare stacks →
              </button>
              {compare.length > 0 && (
                <button className="link" onClick={() => setCompare([])}>
                  Clear
                </button>
              )}
            </div>
          )}
        </>
      )}
      {showDiff && diffSides.length === 2 && (
        <StackDiff
          profile={profile}
          a={diffSides[0]}
          b={diffSides[1]}
          onClose={() => setShowDiff(false)}
        />
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

type AffectedWindowKey = "today" | "d7" | "d28" | "d365";

const AFFECTED_OPTIONS: { key: AffectedWindowKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "d7", label: "7-Day" },
  { key: "d28", label: "28-Day" },
  { key: "d365", label: "365-Day" },
];

function AffectedClientsSection({
  profile,
  signature,
  timeseries,
}: {
  profile: ProcessedProfile;
  signature: HangSignature;
  timeseries: TimeseriesIndex | undefined;
}) {
  const [window, setWindow] = useState<AffectedWindowKey>("today");
  const resolved = timeseries?.resolveAffectedByStack(memberStacks(signature)) ?? null;
  const hasCrossDay = !!resolved;

  // A stale window selection (e.g. cross-day unavailable) falls back to Today.
  const active: AffectedWindowKey = window !== "today" && !hasCrossDay ? "today" : window;

  return (
    <div className="detail-section">
      <div className="ts-header">
        <h3>
          Affected clients
          <InfoTip label="Affected clients">
            Distinct users who hit this hang, estimated with HyperLogLog.{" "}
            <b>Today</b> is the current build's count. The <b>7 / 28 / 365-Day</b>{" "}
            windows merge per-day HyperLogLog sketches across the rolling
            timeseries, so a user who hangs on many days is counted once; the
            denominator is all distinct users seen in that same window.
            {resolved?.approximate && (
              <span className="eg">
                This row merges several stacks; their user sets can’t be unioned
                from the published counts, so cross-day totals are summed as an
                upper bound.
              </span>
            )}
          </InfoTip>
          {profile.affectedClientsSynthetic && (
            <span className="pct"> (synthetic data)</span>
          )}
        </h3>
        <select
          className="affected-window"
          value={active}
          onChange={(e) => setWindow(e.target.value as AffectedWindowKey)}
          title={hasCrossDay ? undefined : "Cross-day windows need the timeseries artifact"}
        >
          {AFFECTED_OPTIONS.map((o) => (
            <option
              key={o.key}
              value={o.key}
              disabled={o.key !== "today" && !hasCrossDay}
            >
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {active === "today" ? (
        <TodayAffected profile={profile} signature={signature} />
      ) : (
        <WindowAffected resolved={resolved} windowKey={active} />
      )}
    </div>
  );
}

/** Distinct affected clients for the current build day (HyperLogLog). */
function TodayAffected({
  profile,
  signature,
}: {
  profile: ProcessedProfile;
  signature: HangSignature;
}) {
  const users = signature.affectedClients;
  const total = profile.affectedClientsTotal;
  const pct =
    total > 0
      ? (users / total).toLocaleString(undefined, {
          style: "percent",
          minimumFractionDigits: 2,
        })
      : "n/a";
  return (
    <ul className="annotation-list">
      <li>
        <code>Users affected</code>{" "}
        <span className="pct">
          {pct} ({users.toLocaleString()} of {total.toLocaleString()} distinct
          users this build)
        </span>
      </li>
      <li>
        <span className="pct">HyperLogLog estimate.</span>
      </li>
    </ul>
  );
}

/** Distinct users affected over one trailing window (HLL-merged). */
function WindowAffected({
  resolved,
  windowKey,
}: {
  resolved: ReturnType<TimeseriesIndex["resolveAffected"]>;
  windowKey: "d7" | "d28" | "d365";
}) {
  const win = resolved?.windows.find((w) => w.key === windowKey);
  if (!win) {
    return <p className="muted">No cross-day data for this hang.</p>;
  }
  const pct = win.pct.toLocaleString(undefined, {
    style: "percent",
    minimumFractionDigits: 2,
  });
  return (
    <ul className="annotation-list">
      <li>
        <code>Users affected</code>{" "}
        <span className="pct">
          {pct} ({win.users.toLocaleString()} of {win.totalUsers.toLocaleString()}{" "}
          distinct users)
        </span>
      </li>
      <li>
        <span className="pct">
          HyperLogLog estimate, merged across the trailing {win.label.replace("-Day", "")}{" "}
          days{resolved?.approximate ? " · summed across merged stacks (upper bound)" : ""}.
        </span>
      </li>
    </ul>
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
