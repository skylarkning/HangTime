import { Route, Routes } from "react-router-dom";
import { Header } from "@/components/Header";
import { Explorer } from "@/views/Explorer";
import { Overview } from "@/views/Overview";
import { useViewState } from "@/state/useViewState";
import { useProcessedProfile } from "@/queries/hooks";
import type { ThreadKind } from "@/data/dataSource";

export function App() {
  const { state } = useViewState();
  // Read from cache (already requested by the active view) just to label the header.
  const query = useProcessedProfile(state.thread as ThreadKind, state.date);

  return (
    <div className="app">
      {/* Fall back to the requested build so the picker stays reachable when
          that build has no artifact -- otherwise the only way out is the URL. */}
      <Header
        date={query.data?.date ?? (state.date === "current" ? undefined : state.date)}
        thread={state.thread}
      />
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/top-hangs" element={<Explorer />} />
        <Route path="*" element={<Overview />} />
      </Routes>
    </div>
  );
}
