import { useState } from "react";
import type { Frame, HangSignature, ProcessedProfile } from "@/processing/types";
import type { TimeseriesIndex } from "@/data/timeseries";
import { computeTrend, trendBadge } from "@/data/trend";
import { buildBugReport } from "@/data/bugReport";
import { resolveFrames } from "@/processing/select";
import { formatDate } from "@/format";
import { isOwnCode } from "@/frames";
import { Highlight } from "./Highlight";
import { InfoTip } from "./InfoTip";
import { TimeseriesChart } from "./TimeseriesChart";

interface DetailPaneProps {
  profile: ProcessedProfile;
  signature: HangSignature | null;
  filter: string;
  timeseries: TimeseriesIndex | undefined;
}

export function DetailPane({
  profile,
  signature,
  filter,
  timeseries,
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
