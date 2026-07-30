import { useEffect, useRef, useState } from "react";

import type { CloudSaveStatus } from "./useCloudBoard";

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
  canRename,
  onRename,
}: {
  title: string;
  status: CloudSaveStatus;
  errorMessage: string | null;
  canRename: boolean;
  onRename: (title: string) => Promise<void>;
}) => {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditingTitle) {
      setDraftTitle(title);
    }
  }, [isEditingTitle, title]);

  useEffect(() => {
    if (isEditingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [isEditingTitle]);

  const finishTitleEdit = async () => {
    const nextTitle = draftTitle.trim() || "Untitled board";
    setDraftTitle(nextTitle);
    setIsEditingTitle(false);
    if (nextTitle !== title) {
      await onRename(nextTitle);
    }
  };

  return (
    <div className="cloud-status" title={errorMessage ?? undefined}>
      <div className="cloud-status__identity">
        {isEditingTitle ? (
          <input
            ref={titleInputRef}
            className="cloud-status__title-input"
            aria-label="Board title"
            value={draftTitle}
            maxLength={120}
            onChange={(event) => setDraftTitle(event.target.value)}
            onBlur={() => void finishTitleEdit()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setDraftTitle(title);
                setIsEditingTitle(false);
              }
            }}
          />
        ) : (
          <button
            className="cloud-status__title"
            type="button"
            disabled={!canRename}
            title={canRename ? "Rename board" : title}
            onClick={() => setIsEditingTitle(true)}
          >
            {title}
          </button>
        )}
        <span className={`cloud-status__state cloud-status__state--${status}`}>
          {statusLabels[status]}
        </span>
      </div>
    </div>
  );
};
