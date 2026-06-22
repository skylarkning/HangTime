/**
 * Fetches the list of known BHR bugs from Bugzilla. Bugs are tagged in their
 * whiteboard with `[bhr:<signature>]`; we map each signature substring to its
 * bug so the processing layer can merge matching hangs into a bug row.
 *
 * Ported from fqueze/hang-stats `bhr.js` fetchBugs.
 */

import type { KnownBug } from "@/processing/types";

const BUGZILLA_QUERY =
  "https://bugzilla.mozilla.org/rest/bug?include_fields=id,summary,status,whiteboard" +
  "&bug_status=UNCONFIRMED&bug_status=NEW&bug_status=ASSIGNED&bug_status=REOPENED" +
  "&f1=classification&field0-0-0=status_whiteboard&o1=notequals&type0-0-0=substring" +
  "&v1=Graveyard&value0-0-0=[bhr%3A";

interface BugzillaBug {
  id: number;
  summary: string;
  status: string;
  whiteboard: string;
}

/** Maps a `[bhr:<signature>]` inner signature to its bug. */
export type BugMap = Map<string, KnownBug>;

export async function fetchBugs(): Promise<BugMap> {
  // Time-bound the request so a slow/unreachable Bugzilla can't stall the app;
  // the caller treats a rejection as "no bugs" and renders without merging.
  const res = await fetch(BUGZILLA_QUERY, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    throw new Error(`Bugzilla query failed: ${res.status}`);
  }
  const data = (await res.json()) as { bugs: BugzillaBug[] };
  const bugMap: BugMap = new Map();
  for (const bug of data.bugs) {
    const knownBug: KnownBug = {
      id: bug.id,
      status: bug.status,
      summary: bug.summary,
      signatures: [],
    };
    for (const match of bug.whiteboard.matchAll(/\[bhr:(.*?)\]/g)) {
      const [fullTag, signature] = match;
      bugMap.set(signature, knownBug);
      knownBug.signatures.push(fullTag);
    }
  }
  return bugMap;
}
