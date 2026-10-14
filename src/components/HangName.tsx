/**
 * How a hang is named in a list: what it is, then where it stopped.
 *
 * The first line is the evidence-based description ("Startup cache: lock
 * wait", in a lighter weight "during JS module loading"); the second is the
 * leaf frame the stack stopped on and the Firefox caller that made the call.
 * A bug-tracked row leads with the bug instead, since a person wrote that.
 */

import type { HangSignature, KnownBug, ProcessedProfile } from "@/processing/types";
import { activityText, hangTitle } from "@/data/hangAreas";
import { resolveFrames } from "@/processing/select";
import { frameLabel } from "@/frames";
import { Highlight } from "./Highlight";

interface HangNameProps {
  profile: ProcessedProfile;
  sig: HangSignature;
  filter: string;
}

export function HangName({ profile, sig, filter }: HangNameProps) {
  const { kind } = sig;
  const leaf = resolveFrames(profile, sig.frameKeys.slice(0, 1))[0];
  const callerIndex = kind.callerFrame > 0 ? sig.frameKeys[kind.callerFrame] : undefined;
  const caller = callerIndex === undefined ? "" : shortSymbol(profile.funcNames[callerIndex]);
  const title = hangTitle(kind);
  const activity = activityText(kind);

  return (
    <>
      <span className="hang-title">
        {sig.knownBug ? (
          <BugLink bug={sig.knownBug} />
        ) : (
          <>
            {title}
            {activity && <span className="hang-activity"> {activity}</span>}
          </>
        )}
      </span>
      <span className="hang-sub">
        {sig.knownBug && <span className="hang-sub-title">{title} · </span>}
        <Highlight text={frameLabel(leaf)} needle={filter} />
        {caller && (
          <span className="hang-caller" title="The Firefox code that made this call">
            {" ← "}
            <Highlight text={caller} needle={filter} />
          </span>
        )}
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
        Bug {bug.id}
      </a>{" "}
      {bug.summary}
    </>
  );
}

/** A frame's symbol without its argument list, for naming it in passing. */
export function shortSymbol(funcName: string): string {
  const paren = funcName.indexOf("(");
  return paren <= 0 ? funcName : funcName.slice(0, paren);
}
