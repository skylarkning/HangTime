/**
 * Which build is on screen, and how its data was gathered, as a labelled row
 * at the top of each view. It used to be a small pill in the header, easy to
 * miss for something that decides everything below it.
 *
 * Views render it in their loading and error states too: a build with no
 * artifact shows an error, and the picker has to stay reachable there or the
 * only way back is editing the URL.
 */

import { useViewState } from "@/state/useViewState";
import { BuildPicker } from "./BuildPicker";
import { InfoTip } from "./InfoTip";

interface BuildBarProps {
  /** The build shown, "YYYYMMDD"; absent while the latest is still loading. */
  date?: string;
}

export function BuildBar({ date }: BuildBarProps) {
  const { state, update } = useViewState();
  // Until the data arrives, a requested build still has a name; "current" doesn't.
  const shown = date ?? (state.date === "current" ? undefined : state.date);

  return (
    <div className="build-bar">
      <span className="build-bar-label">
        Build date
        <InfoTip label="Build date">
          The Firefox Nightly build whose hangs you&rsquo;re looking at, named by the
          day it was built: the first eight digits of its build ID (build{" "}
          <code>20261009…</code> is the 9 October 2026 Nightly). Each build&rsquo;s
          hangs are gathered and shown on their own.
          <span className="eg">
            Pick another date to load that build. A build is processed about four
            days after it ships, so the newest few days may not exist yet.
          </span>
        </InfoTip>
      </span>
      {shown ? (
        <BuildPicker
          date={shown}
          pinned={state.date !== "current"}
          onSelect={(next) => update({ date: next })}
          onReset={() => update({ date: "" })}
        />
      ) : (
        <span className="build-bar-pending">Loading the latest build…</span>
      )}
      <span className="build-bar-agg">
        Grouped by build date
        <InfoTip label="Grouped by build date">
          Hang reports can be grouped two ways. By <b>build date</b> (build ID):
          the Nightly build the report came from, which pins a hang to the exact
          code users were running. By <b>submission date</b>: the day the report
          reached Mozilla, which mixes many builds together.
          <span className="eg">
            HangTime groups by build date, so each build here, and each day on the
            charts, is one Nightly build&rsquo;s hangs. A build&rsquo;s reports keep
            arriving for days after it ships; submission dates are only used to
            collect the ones received up to five days after the build date, so a
            report sent later than that isn&rsquo;t counted.
          </span>
        </InfoTip>
      </span>
    </div>
  );
}
