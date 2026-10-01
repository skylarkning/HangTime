/**
 * The Guide tab: what HangTime shows, where the numbers come from, and a
 * walk-through of each view. Static content, so it reads fine while the day's
 * artifact is still loading behind it.
 *
 * The app runs under a HashRouter, so in-page anchors (#section) would be read
 * as routes; the contents list scrolls to each section instead.
 */

import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

const ISSUES_URL = "https://github.com/skylarkning/HangTime/issues/new/choose";

const SECTIONS: { id: string; title: string }[] = [
  { id: "about", title: "What is HangTime?" },
  { id: "quick-start", title: "Quick start" },
  { id: "overview-page", title: "The Overview page" },
  { id: "top-hangs-page", title: "The Top Hangs page" },
  { id: "hang-detail", title: "Reading a hang's details" },
  { id: "trends", title: "How trends are worked out" },
  { id: "annotations", title: "Hang annotations" },
  { id: "builds", title: "Builds and shareable links" },
  { id: "glossary", title: "Glossary" },
  { id: "help", title: "Questions and feedback" },
];

/**
 * Every hang annotation Firefox can record, found by searching mozilla-central
 * (2026-09-18) for BackgroundHangAnnotator implementations, AddAnnotation
 * calls, and annotations built directly in the hang monitor. The aggregation
 * job passes them through unchanged.
 */
const ANNOTATIONS: {
  name: string;
  where?: string;
  meaning: ReactNode;
  example: ReactNode;
}[] = [
  {
    name: "PaintPending",
    meaning: (
      <>
        A repaint was waiting when the hang started, so the screen stayed frozen
        on its last frame. Most hangs delay a paint, so most carry this; one{" "}
        <em>without</em> it is the unusual case.
      </>
    ),
    example: (
      <>
        A page changes what's on screen, then runs a script for two seconds. The
        change can't be drawn until the script finishes, so the hang carries{" "}
        <code>PaintPending</code>.
      </>
    ),
  },
  {
    name: "UserInteracting",
    meaning: (
      <>
        The user clicked, typed, scrolled or otherwise used Firefox in the 5
        seconds before the hang, so they very likely noticed it. A good signal for
        which hangs hurt most.
      </>
    ),
    example: (
      <>
        Someone is typing in a form. A second after their last key press, Firefox
        freezes for half a second.
      </>
    ),
  },
  {
    name: "BeforeStartupCrashAndHangTrackingEnded",
    where: "Parent process",
    meaning: (
      <>
        Firefox was still starting up: the hang came before Firefox marked
        startup as finished, which happens once the first window has opened and
        settled. Points at slow startup work.
      </>
    ),
    example: (
      <>
        Firefox launches and restores 40 tabs from the last session. It hangs
        while still setting them up.
      </>
    ),
  },
  {
    name: "ShutdownImpending",
    where: "Parent process",
    meaning: <>Firefox was already shutting down when the hang happened.</>,
    example: (
      <>
        The user quits Firefox, and it hangs while closing windows and saving the
        session.
      </>
    ),
  },
  {
    name: "ExternalCPUHigh",
    where: "Windows and macOS only",
    meaning: (
      <>
        Other programs were using nearly all of the computer's processor: more
        than every core but one, and at least half. The hang may say more about an
        overloaded machine than about Firefox's code.
      </>
    ),
    example: (
      <>
        On an 8-core laptop, a video export is using over 87.5% of the processor
        when Firefox hangs.
      </>
    ),
  },
  {
    name: "browser.tabs.opening",
    meaning: (
      <>
        A new tab was being opened. The value gives the stage:{" "}
        <code>initting</code> (the tab was being created), then{" "}
        <code>animated</code> or <code>not-animated</code> (it was opening, with
        or without the tab animation).
      </>
    ),
    example: (
      <>
        The user presses Ctrl+T and the new tab takes 300 ms to appear while it
        slides into the tab strip: <code>browser.tabs.opening = animated</code>.
      </>
    ),
  },
  {
    name: "Unrecovered",
    meaning: (
      <>
        Firefox never recovered: it was still stuck when it was closed or killed.
        The hang monitor saved the report and sent it on the next launch, with the
        duration recorded as the 8-second cap.
      </>
    ),
    example: (
      <>
        A page freezes Firefox completely and the user force-quits it. The next
        time Firefox starts, that hang is reported as <code>Unrecovered</code>.
      </>
    ),
  },
  {
    name: "PendingInput",
    where: "Web-page (content) processes only",
    meaning: (
      <>
        How many clicks, key presses and other input events were waiting to be
        handled when the hang happened. The value is the count.
      </>
    ),
    example: (
      <>
        A page's script blocks its process while the user clicks three times:{" "}
        <code>PendingInput = 3</code>.
      </>
    ),
  },
  {
    name: "PaintWhileInterruptingJS",
    where: "Web-page (content) processes only",
    meaning: (
      <>
        Firefox had paused a page's long-running script so it could draw a tab
        the user had just switched to.
      </>
    ),
    example: (
      <>
        The user switches to a tab whose page is stuck in a heavy script. Firefox
        interrupts the script to show the tab, and hangs while doing so.
      </>
    ),
  },
];

function scrollTo(id: string) {
  document.getElementById(`guide-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function Section({ id, children }: { id: string; children: ReactNode }) {
  const title = SECTIONS.find((s) => s.id === id)?.title;
  return (
    <section className="guide-section" id={`guide-${id}`}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/** A labelled definition row, for the per-view walk-throughs. */
function Item({ name, children }: { name: ReactNode; children: ReactNode }) {
  return (
    <div className="guide-item">
      <dt>{name}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function Guide() {
  const { search } = useLocation();
  const overview = { pathname: "/", search };
  const topHangs = { pathname: "/top-hangs", search };

  return (
    <div className="guide">
      <nav className="guide-toc" aria-label="Guide contents">
        <div className="guide-toc-title">Guide</div>
        {SECTIONS.map((s) => (
          <button key={s.id} onClick={() => scrollTo(s.id)}>
            {s.title}
          </button>
        ))}
      </nav>

      <article className="guide-body">
        <header className="guide-intro">
          <h1>Using HangTime</h1>
          <p>
            HangTime shows where Firefox stops responding for real users, how often
            it happens, and whether it's getting better or worse. This guide covers
            where the data comes from and how to read each part of the dashboard.
          </p>
        </header>

        <Section id="about">
          <p>
            A <b>hang</b> is a stretch of time when a Firefox thread is busy and
            can't respond: the page won't scroll, clicks do nothing, the window
            feels frozen. Firefox's <b>Background Hang Reporter (BHR)</b> watches
            for these on Firefox Nightly. When one task keeps a thread busy for 128
            ms, BHR captures a <b>stack</b> (the chain of functions running at that
            moment), then records how long the task took to finish, up to 8
            seconds.
          </p>
          <p>
            Every day, an aggregation job in <code>mozilla-central</code> collects
            those reports for one Nightly build, symbolicates the stacks (turns
            memory addresses into function names), and groups identical stacks
            into <b>signatures</b>. HangTime loads that daily result and lets you
            rank, filter and dig into it.
          </p>
          <div className="guide-callout">
            <b>Two things to keep in mind.</b> The data is Nightly users only, so it
            shows problems early rather than measuring release users. And a build
            is aggregated about four days after it ships, so the newest builds
            appear with a short delay.
          </div>
        </Section>

        <Section id="quick-start">
          <p>A first pass through the dashboard, about five minutes:</p>
          <ol className="guide-steps">
            <li>
              <b>Get the big picture.</b> Open <Link to={overview}>Overview</Link>.
              The four numbers at the top tell you how much hanging there was on
              this build and whether it's rising.
            </li>
            <li>
              <b>Check what's changed.</b> In <em>Needs attention</em>, look at the{" "}
              <span className="chip red">Regressions</span> and{" "}
              <span className="chip blue">New</span> lists. These are usually the
              best place to start triaging.
            </li>
            <li>
              <b>Open a hang.</b> Click any hang name. It takes you to{" "}
              <Link to={topHangs}>Top Hangs</Link> with that hang selected and its
              details on the right.
            </li>
            <li>
              <b>Read its history.</b> The <em>History</em> chart shows the hang day
              by day. Tick <em>Fx releases</em> to see whether a jump lines up with
              a Firefox release, Beta or Nightly milestone.
            </li>
            <li>
              <b>Find the cause.</b> Scroll to <em>Stack</em>. Frame 0 is where the
              thread was stuck; the frames below it show how it got there.
            </li>
            <li>
              <b>Act on it.</b> If there's no bug yet, use <em>File a bug</em>. It
              opens Bugzilla with the summary, stack and data already filled in.
            </li>
          </ol>
        </Section>

        <Section id="overview-page">
          <p>
            <Link to={overview}>Overview</Link> is the health summary for one
            build. Every hang name on it links to that hang's details.
          </p>
          <dl className="guide-list">
            <Item name="Hang time">
              Total seconds threads spent hung on this build, added up across every
              reported hang. The chip beside it compares the last 7 days with the 7
              before.
            </Item>
            <Item name="Hangs">
              How many hangs were reported on this build, with the same 7-day
              comparison.
            </Item>
            <Item name="Distinct signatures">
              How many different stacks those hangs came from. Many hangs share a
              few causes, so this is far smaller than the hang count.
            </Item>
            <Item name="Tracked by a bug">
              The share of hang time whose signature already has a Bugzilla bug (a
              bug whose whiteboard carries a <code>[bhr:…]</code> tag). A low number
              means lots of hang time nobody has filed yet.
            </Item>
            <Item name="Hang volume over time">
              Daily hang time or count for the tracked top signatures. Use this to
              see the overall direction, not exact totals. Switch between{" "}
              <em>ms</em> and <em>count</em>, pick a window (7d to 365d), or drag
              across the chart to zoom in.
            </Item>
            <Item name="Top hangs by time">
              The eight signatures with the most hang time, with each one's share of
              the total and its trend. <em>All hangs →</em> opens the full list.
            </Item>
            <Item name="Needs attention">
              Hangs that are rising sharply (<em>regressions</em>) or that have just
              appeared (<em>new</em>), busiest first.
            </Item>
            <Item name="Where hangs happen">
              The share of hangs from Windows, macOS, Linux and other systems.
            </Item>
          </dl>
        </Section>

        <Section id="top-hangs-page">
          <p>
            <Link to={topHangs}>Top Hangs</Link> is the full list of signatures on
            the left, with the selected hang's details on the right.
          </p>
          <dl className="guide-list">
            <Item name="Filter box">
              Type part of a function or library name, for example{" "}
              <code>nsFrame</code> or <code>xul.dll</code>, to keep only the hangs
              whose stack contains it. Matches are highlighted. All-lowercase text
              matches any case; include a capital letter to match case exactly.
            </Item>
            <Item name="Sort">
              Rank by <em>Time</em> (total seconds, the default) or <em>Count</em>{" "}
              (number of hangs). Time favours long hangs; Count favours frequent
              ones.
            </Item>
            <Item name="Trend">
              Show only regressions, improvements, or new hangs.
            </Item>
            <Item name="Time (s) and Count">
              Seconds of hanging and number of hangs for that signature on this
              build. Hover a time to see its share of the total.
            </Item>
            <Item name="Trend column">
              How the last 7 days compare with the 7 before. See{" "}
              <button className="link" onClick={() => scrollTo("trends")}>
                How trends are worked out
              </button>
              .
            </Item>
            <Item name="Hang signature">
              The <b>leaf frame</b>: the function the thread was in when it hung,
              and its library. If a bug already covers the hang, the row shows the
              bug number and summary instead.
            </Item>
          </dl>
          <p className="guide-note">
            The list shows 50 rows at a time. Use <em>Show 50 more</em> at the
            bottom to see more.
          </p>
        </Section>

        <Section id="hang-detail">
          <p>
            Selecting a hang in Top Hangs fills the right-hand pane. From top to
            bottom:
          </p>
          <dl className="guide-list">
            <Item name="Bugzilla">
              Shown when the hang is tracked by a bug, with a link to it.
            </Item>
            <Item name="History">
              The hang's daily time or count across the window, with its peak day
              marked. For a bug that covers several stacks, grey dashed lines show
              the biggest ones, so you can see which stack is driving a change. Tick{" "}
              <em>Fx releases</em> to add Firefox milestones:{" "}
              <span className="guide-swatch" style={{ color: "#d76e00" }}>Release</span>,{" "}
              <span className="guide-swatch" style={{ color: "#0250bb" }}>Beta</span>{" "}
              and <span className="guide-swatch" style={{ color: "#058b00" }}>Nightly</span>.
              If a hang isn't among the top tracked signatures, there's no history
              to show.
            </Item>
            <Item name="Near-duplicate group">
              Hangs that are really the same problem but look different at the very
              top of the stack (one stuck in a lock, another in <code>memcpy</code>
              ) are grouped by their first meaningful Firefox frame. Open the group
              to see its variants, list every stack, or tick two and compare them
              side by side.
            </Item>
            <Item name="File a bug">
              Opens a new Bugzilla bug with the summary, stack, numbers and{" "}
              <code>[bhr:…]</code> whiteboard tag filled in. HangTime suggests a
              component by reading the stack; it's right about four times in five,
              so check it before filing. For a hang that already has a bug,{" "}
              <em>Copy hang summary</em> copies the latest numbers to paste into it.
            </Item>
            <Item name="Platform">
              This hang's share of Windows, macOS and Linux reports.
            </Item>
            <Item name="Affected clients">
              Roughly how many different users hit this hang: on this build, or
              over the last 7, 28 or 365 days. It's an estimate: users are counted
              with a method (HyperLogLog) that never needs their IDs, and a user who
              hangs on many days is counted once.
            </Item>
            <Item name="Hang annotations">
              Extra context Firefox saved with the hang. For example,{" "}
              <code>UserInteracting</code> means the user was actively using the
              browser when it froze. The percentage is the share of this hang's
              reports carrying that note. See{" "}
              <button className="link" onClick={() => scrollTo("annotations")}>
                Hang annotations
              </button>{" "}
              for the full list.
            </Item>
            <Item name="Stack">
              Every frame, starting at frame 0, where the thread was stuck, and
              ending at the outermost caller. Firefox's own code is in normal text;
              operating system and third-party libraries are dimmed, so the Firefox
              frames stand out.
            </Item>
          </dl>
        </Section>

        <Section id="trends">
          <p>
            A trend compares a hang's average over the <b>last 7 days</b> with its
            average over the <b>7 days before</b>. Single days are noisy, so a
            weekly average gives a steadier answer. Days with no data are left out
            instead of being counted as zero.
          </p>
          <table className="guide-table">
            <thead>
              <tr>
                <th>Badge</th>
                <th>Meaning</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><span className="trend-badge red">↑74%</span></td>
                <td>Up 50% or more. A regression worth a look.</td>
              </tr>
              <tr>
                <td><span className="trend-badge amber">↑31%</span></td>
                <td>Up between 20% and 50%. Rising, keep an eye on it.</td>
              </tr>
              <tr>
                <td><span className="trend-badge green">↓42%</span></td>
                <td>Down 20% or more. Improving.</td>
              </tr>
              <tr>
                <td><span className="trend-badge neutral">stable</span></td>
                <td>Within 20% either way.</td>
              </tr>
              <tr>
                <td><span className="trend-badge blue">new</span></td>
                <td>
                  Barely seen before, but real volume now (at least 20 hangs or 30
                  seconds in the last week). A single stray hang doesn't count.
                </td>
              </tr>
              <tr>
                <td><span className="trend-badge amber">↑ new</span></td>
                <td>Nothing in the previous 7 days, some activity in the last 7.</td>
              </tr>
            </tbody>
          </table>
          <p className="guide-note">
            Red and amber both count as regressions in the Trend filter and in
            Needs attention.
          </p>
          <p className="guide-note">
            Trends need the timeseries data. If it hasn't loaded, trend badges are
            blank and the Trend filter is greyed out.
          </p>
        </Section>

        <Section id="annotations">
          <p>
            When Firefox records a hang, it also notes what else was going on at
            that moment. These notes are <b>annotations</b>. They help tell a hang
            the user felt from one they didn't, or a slow computer from slow
            Firefox code. In a hang's details, each annotation shows the share of
            that hang's reports that carried it, and a hang can carry several.
          </p>
          <p>These are all the annotations Firefox can record:</p>
          <div className="guide-annotations">
            {ANNOTATIONS.map((a) => (
              <div key={a.name} className="guide-annotation">
                <div className="guide-annotation-head">
                  <code>{a.name}</code>
                  {a.where && <span className="chip neutral">{a.where}</span>}
                </div>
                <p>{a.meaning}</p>
                <p className="guide-example">
                  <span>Example</span>
                  {a.example}
                </p>
              </div>
            ))}
          </div>
          <p className="guide-note">
            HangTime shows main-thread hangs, so the two content-process
            annotations rarely or never appear in it. Firefox can also tag a hang
            with any user interaction it's timing, but{" "}
            <code>browser.tabs.opening</code> is the only one defined outside of
            tests.
          </p>
        </Section>

        <Section id="builds">
          <p>
            The <span className="pill">Build …</span> button in the top right shows
            which Nightly build you're looking at. Click it and pick a date to see
            an older build. <em>Back to latest build</em> returns to the newest one.
            A build only exists once the daily job has processed it, about four days
            after it shipped.
          </p>
          <p>
            Everything you set (build, filter, sort, trend and selected hang) is
            saved in the page address. <b>Copy the URL to share exactly what you're
            looking at</b>; whoever opens it sees the same view.
          </p>
          <p>
            The first load downloads about 25 MB and processes it in your browser,
            which takes a few seconds. The loading screen shows progress. Please
            don't refresh while it runs, because that starts the download over.
          </p>
        </Section>

        <Section id="glossary">
          <dl className="guide-list">
            <Item name="BHR">
              Background Hang Reporter, the part of Firefox that detects and reports
              hangs.
            </Item>
            <Item name="Hang">
              A task that kept a thread busy for 128 ms or more, so it couldn't
              respond. Durations are capped at 8 seconds.
            </Item>
            <Item name="Stack">
              The chain of function calls running when the hang happened.
            </Item>
            <Item name="Frame">One function in a stack.</Item>
            <Item name="Leaf frame">
              The innermost frame (frame 0): where the thread actually was.
            </Item>
            <Item name="Signature">
              One distinct stack. All hangs with the same stack, or tracked by the
              same bug, are one signature.
            </Item>
            <Item name="Build">
              A Nightly build, named by its date. Each build's hangs are collected
              and shown separately.
            </Item>
            <Item name="Main thread">
              The thread that runs Firefox's user interface and pages' scripts. A
              hang here freezes the window, which is why HangTime focuses on it.
            </Item>
            <Item name="Event loop">
              Firefox's cycle of picking up and running the next task. Some stacks
              contain nested event loops, which the near-duplicate group counts.
            </Item>
            <Item name={<code>[bhr:…]</code>}>
              The whiteboard tag on a Bugzilla bug that links it to a hang
              signature, so HangTime can show and merge it.
            </Item>
          </dl>
        </Section>

        <Section id="help">
          <p>
            Found something wrong, or want a feature or some data HangTime doesn't
            show yet? Use <b>Bug &amp; Feedback</b> in the top right, or{" "}
            <a href={ISSUES_URL} target="_blank" rel="noopener noreferrer">
              open an issue on GitHub
            </a>
            . The <em>i</em> buttons next to headings on each page also explain what
            that part shows.
          </p>
        </Section>
      </article>
    </div>
  );
}
