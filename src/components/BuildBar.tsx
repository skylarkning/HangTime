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
import { useProcessedProfile } from "@/queries/hooks";
import { collectionWindow, scopeLabel } from "@/data/collection";
import type { ThreadKind } from "@/data/dataSource";
import { formatShortDate } from "@/format";
import { BuildPicker } from "./BuildPicker";
import { InfoTip } from "./InfoTip";

interface BuildBarProps {
  /** The build shown, "YYYYMMDD"; absent while the latest is still loading. */
  date?: string;
}

export function BuildBar({ date }: BuildBarProps) {
  const { state, update } = useViewState();
  const thread = state.thread as ThreadKind;
  // Read from cache: the view has already asked for this build. It names the
  // process and thread the hangs came from once they've loaded.
  const profile = useProcessedProfile(thread, state.date).data;
  // Until the data arrives, a requested build still has a name; "current" doesn't.
  const shown = date ?? (state.date === "current" ? undefined : state.date);
  const pinned = state.date !== "current";
  const window = shown ? collectionWindow(shown) : null;
  const lastDay = window ? formatShortDate(window.lastDay) : "";

  return (
    <div className="build-bar">
      <div className="build-bar-main">
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
            pinned={pinned}
            onSelect={(next) => update({ date: next })}
            onReset={() => update({ date: "" })}
          />
        ) : (
          <span className="build-bar-pending">Loading the latest build…</span>
        )}
        {shown &&
          (pinned ? (
            <button className="link build-bar-latest" onClick={() => update({ date: "" })}>
              Back to latest build
            </button>
          ) : (
            <span className="build-bar-fresh">Latest build</span>
          ))}
      </div>
      <div className="build-bar-facts">
        <span className="build-bar-scope">{scopeLabel(thread, profile)}</span>
        <span className="build-bar-agg">
          Collection window
          {window &&
            (window.open ? (
              <span
                className="build-bar-partial"
                title={
                  `Reports for this build count through ${lastDay}, and that day ` +
                  "hasn't started yet. It was processed early, so it is missing " +
                  "whole days of reports and reads lower than its neighbours."
                }
              >
                , window open to {lastDay}
              </span>
            ) : (
              <> ends {lastDay}</>
            ))}
          <InfoTip label="Grouped by build date">
            <p>The date shown is the planned submission-window end, not a verified
              last-report timestamp. The artifact does not publish its exact collection cutoff.</p>
            Hang reports can be grouped two ways. By <b>build date</b> (build ID):
            the Nightly build the report came from, which pins a hang to the exact
            code users were running. By <b>submission date</b>: the day the report
            reached Mozilla, which mixes many builds together.
            <span className="eg">
              HangTime groups by build date, so each build here, and each day on the
              charts, is one Nightly build&rsquo;s hangs. A build&rsquo;s reports keep
              arriving for days after it ships; submission dates are only used to
              collect the ones received within five days of the build date, so a
              report sent later than that isn&rsquo;t counted. The daily job
              processes a build on the last of those days, so reports sent late
              that day are usually missed. <b>Window open</b> means a build was
              processed before its last day: it is missing whole days of reports,
              so compare it with other builds carefully.
            </span>
          </InfoTip>
        </span>
      </div>
    </div>
  );
}
