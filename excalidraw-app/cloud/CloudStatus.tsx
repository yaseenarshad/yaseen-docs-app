import { useState } from "react";

import type { CloudSaveStatus } from "./useCloudDiagram";

const statusLabels: Record<CloudSaveStatus, string> = {
  loading: "Opening…",
  saved: "Saved",
  saving: "Saving…",
  conflict: "Cloud changed",
  error: "Save failed",
  viewer: "View only",
};

export const CloudStatus = ({
  title,
  status,
  errorMessage,
  canShare,
  onShare,
}: {
  title: string;
  status: CloudSaveStatus;
  errorMessage: string | null;
  canShare: boolean;
  onShare: () => Promise<string | null>;
}) => {
  const [shareLabel, setShareLabel] = useState("Share");

  return (
    <div className="cloud-status" title={errorMessage ?? undefined}>
      <div className="cloud-status__identity">
        <strong>{title}</strong>
        <span className={`cloud-status__state cloud-status__state--${status}`}>
          {statusLabels[status]}
        </span>
      </div>
      {canShare && (
        <button
          className="cloud-status__share"
          type="button"
          onClick={async () => {
            setShareLabel("Creating…");
            try {
              const url = await onShare();
              if (!url) {
                setShareLabel("Share");
                return;
              }
              await navigator.clipboard.writeText(url);
              setShareLabel("Link copied");
              window.setTimeout(() => setShareLabel("Share"), 1800);
            } catch {
              setShareLabel("Try again");
            }
          }}
        >
          {shareLabel}
        </button>
      )}
    </div>
  );
};
