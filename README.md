# bhr-dashboard

A web dashboard for exploring Firefox **BHR (Background Hang Reporter)** data: the
daily-aggregated hang samples collected from Firefox users, used by the Performance
team to find and triage main-thread hangs.

This is a from-scratch successor to [fqueze/hang-stats](https://github.com/fqueze/hang-stats),
rebuilt so the dashboard can evolve without carrying the old tool's constraints.

> **Status: early scaffolding.** The repository is being set up. No app is wired up yet.

## What it does

BHR ships symbolicated, sampled stacks from Firefox to Mozilla's telemetry pipeline.
A daily aggregation job (now running out of `mozilla-central`) reduces those samples into
a compact, per-day profile artifact. This dashboard loads that artifact and lets you:

- Browse hang stacks as an interactive call tree.
- Filter by text, thread / process type, annotations, runnable, and platform.
- Normalize hang time and counts by usage hours to estimate real-world impact.
- Share a view via URL-encoded state.

## Data

The dashboard consumes the aggregation job's output artifact, a columnar
profiler-style profile (the same family as the Firefox Profiler's processed format):

- `threads[]`, each holding struct-of-arrays tables: `stringArray`, `stackTable`
  (parent-`prefix` linked list rooted at `(root)`), `funcTable`, `sampleTable`,
  `annotationsTable`, `dates[]`, and `libs[]`.
- `usageHoursByDate`, used to normalize raw sample counts.

Stacks are reconstructed by walking `prefix` pointers; the per-date `sampleHangMs` and
`sampleHangCount` arrays run parallel to `sampleTable`. Rare stacks are already pruned
into an `(other)` node by the aggregation job, so the tree arrives pre-trimmed.

## Tech stack

- **Vite** for dev server and build.
- **React** for the UI.
- **Redux** (Redux Toolkit) for application state.

The dashboard starts as a static site that fetches the daily artifact and explores it
client-side. All data access goes through a single `dataSource` module so a server-backed
or live-query source can be swapped in later without touching the UI.

## Development

Setup instructions will be added once the Vite + React + Redux scaffold lands.

## License

[MPL-2.0](LICENSE)
