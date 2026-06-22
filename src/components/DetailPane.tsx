import type { HangSignature, ProcessedProfile } from "@/processing/types";
import { resolveFrames } from "@/processing/select";
import { isOwnCode } from "@/frames";
import { Highlight } from "./Highlight";

interface DetailPaneProps {
  profile: ProcessedProfile;
  signature: HangSignature | null;
  filter: string;
}

export function DetailPane({ profile, signature, filter }: DetailPaneProps) {
  if (!signature) {
    return <div className="detail-empty">Select a hang to see its stack.</div>;
  }
  const frames = resolveFrames(profile, signature.frameKeys);

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
      <h3>Hang annotations</h3>
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
