import { Header } from "@/components/Header";
import { Explorer } from "@/views/Explorer";
import { useViewState } from "@/state/useViewState";
import { useProcessedProfile } from "@/queries/hooks";
import type { ThreadKind } from "@/data/dataSource";

export function App() {
  const { state } = useViewState();
  // Read from cache (already requested by Explorer) just to label the header.
  const query = useProcessedProfile(state.thread as ThreadKind, state.date);

  return (
    <div className="app">
      <Header date={query.data?.date} thread={state.thread} />
      <Explorer />
    </div>
  );
}
