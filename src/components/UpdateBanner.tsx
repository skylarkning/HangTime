import { useEffect, useState } from "react";
import { alreadyReloadedInto, reloadInto, useUpdateCheck } from "@/state/useUpdateCheck";

interface UpdateBannerProps {
  /**
   * Nothing has been shown yet: the first load is still on the loading screen.
   * Reloading then loses nothing worth keeping, so it happens without asking.
   */
  firstLoad: boolean;
}

/** Offers a reload when a newer HangTime has been deployed. */
export function UpdateBanner({ firstLoad }: UpdateBannerProps) {
  const newer = useUpdateCheck();
  const [dismissed, setDismissed] = useState<string | null>(null);

  const silent = newer !== null && firstLoad && !alreadyReloadedInto(newer);
  useEffect(() => {
    if (silent && newer) {
      reloadInto(newer);
    }
  }, [silent, newer]);

  // Dismissing hides this build's notice; a later deploy shows it again.
  if (!newer || silent || dismissed === newer) {
    return null;
  }
  return (
    <div className="update-banner" role="status">
      <span>A new version of HangTime is available.</span>
      <button className="btn" onClick={() => reloadInto(newer)}>
        Reload
      </button>
      <span className="update-note">Reloading downloads the hang data again.</span>
      <button
        className="update-dismiss"
        aria-label="Dismiss"
        title="Dismiss"
        onClick={() => setDismissed(newer)}
      >
        ×
      </button>
    </div>
  );
}
