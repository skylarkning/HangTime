import { useRef } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Header } from "@/components/Header";
import { UpdateBanner } from "@/components/UpdateBanner";
import { Explorer } from "@/views/Explorer";
import { Guide } from "@/views/Guide";
import { Overview } from "@/views/Overview";
import { useViewState } from "@/state/useViewState";
import { useProcessedProfile } from "@/queries/hooks";
import type { ThreadKind } from "@/data/dataSource";

export function App() {
  const { state } = useViewState();
  // Read from cache (already requested by the active view), to tell the update
  // banner whether anything has been shown yet.
  const query = useProcessedProfile(state.thread as ThreadKind, state.date);
  // Latches once any build has been shown, so a later build switch, which also
  // has no data for a moment, doesn't count as a first load.
  const shownData = useRef(false);
  if (query.data) {
    shownData.current = true;
  }

  return (
    <div className="app">
      <Header thread={state.thread} />
      <UpdateBanner firstLoad={!shownData.current} />
      <Routes>
        <Route path="/" element={<ToTopHangs />} />
        <Route path="/top-hangs" element={<Explorer />} />
        <Route path="/overview" element={<Overview />} />
        <Route path="/guide" element={<Guide />} />
        <Route path="*" element={<ToTopHangs />} />
      </Routes>
    </div>
  );
}

/**
 * HangTime opens on Top Hangs. The bare address, and any unknown route, lands
 * there with its query (build, thread, …) kept. Overview used to live at "/",
 * so an old Overview link now opens Top Hangs instead.
 */
function ToTopHangs() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: "/top-hangs", search }} replace />;
}
