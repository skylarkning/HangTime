/**
 * A tracked bug's title or an observed symbol first; stack context beneath.
 */

import type { HangSignature, KnownBug, ProcessedProfile } from "@/processing/types";
import { activityText, hangTitle } from "@/data/hangAreas";
import { resolveFrames } from "@/processing/select";
import { representativeFrameDepth, shortSymbol } from "@/frames";
import { Highlight } from "./Highlight";

interface HangNameProps {
  profile: ProcessedProfile;
  sig: HangSignature;
  filter: string;
}

export function HangName({ profile, sig, filter }: HangNameProps) {
  const { kind } = sig;
  const frames = resolveFrames(profile, sig.frameKeys);
  const depth = representativeFrameDepth(kind, frames);
  const frame = frames[depth];
  const title = hangTitle(kind);
  const activity = activityText(kind);

  return (
    <>
      <span className="hang-heading" title={frame ? `${frame.funcName} · frame ${depth} · ${frame.libName || "script"}. Representative frame, not a confirmed cause.` : undefined}>
        <span className={`hang-title${sig.knownBug ? " hang-bug-title" : ""}`}>
          {sig.knownBug ? <BugLink bug={sig.knownBug} /> :
            <Highlight text={frame ? shortSymbol(frame.funcName) : "(empty stack)"} needle={filter} />}
        </span>
        {frame && !sig.knownBug && <span className="hang-frame">frame {depth}</span>}
      </span>
      <span className="hang-sub" title={`${title} ${activity}`}>
        {sig.knownBug && frame && <><Highlight text={shortSymbol(frame.funcName)} needle={filter} /> · frame {depth} · </>}
        {title}{activity && <> {activity}</>}
      </span>
    </>
  );
}

function BugLink({ bug }: { bug: KnownBug }) {
  return (
    <>
      <a
        href={`https://bugzilla.mozilla.org/show_bug.cgi?id=${bug.id}`}
        title={`${bug.status}: ${bug.summary}`}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
      >
        Bug {bug.id}: {bug.summary}
      </a>
    </>
  );
}
