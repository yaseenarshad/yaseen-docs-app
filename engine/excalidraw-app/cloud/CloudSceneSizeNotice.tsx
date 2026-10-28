import { useState } from "react";

import {
  BOARD_SCENE_WARNING_RAW_BYTES,
  MAX_BOARD_SCENE_RAW_BYTES,
} from "../../board-scenes/types";

import type { getBoardSceneSizeError } from "../../board-scenes/sizePolicy";

const megabytes = (bytes: number) =>
  `${(bytes / 1_000_000).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  })} MB`;

export const CloudSceneSizeNotice = ({
  rawSize,
  sizeError,
  backupUnavailable,
  onExport,
}: {
  rawSize: number | null;
  sizeError: ReturnType<typeof getBoardSceneSizeError>;
  backupUnavailable: boolean;
  onExport: () => Promise<void>;
}) => {
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  if (
    !sizeError &&
    !backupUnavailable &&
    (rawSize === null || rawSize < BOARD_SCENE_WARNING_RAW_BYTES)
  ) {
    return null;
  }
  const blocked = sizeError !== null;
  return (
    <section
      className={`cloud-scene-notice${
        blocked || backupUnavailable ? " cloud-scene-notice--error" : ""
      }`}
      aria-label="Board save notice"
    >
      <div role="status">
        <strong>
          {blocked
            ? "Latest changes aren’t saved"
            : backupUnavailable
            ? "Local backup unavailable"
            : "Board nearing its save limit"}
        </strong>
        {rawSize !== null && (
          <span>
            {megabytes(rawSize)} /{" "}
            {megabytes(sizeError?.maxRawSize ?? MAX_BOARD_SCENE_RAW_BYTES)}
          </span>
        )}
        {blocked && (
          <p>Export a backup, then remove some content to resume saving.</p>
        )}
        {backupUnavailable && (
          <p>
            {blocked ? "Local backup unavailable. " : ""}Keep this tab open
            until your changes are saved or exported.
          </p>
        )}
      </div>
      {(blocked || backupUnavailable) && (
        <>
          <button
            type="button"
            disabled={exporting}
            onClick={() => {
              setExporting(true);
              setExportFailed(false);
              void onExport()
                .catch((error: unknown) => {
                  if (
                    !(
                      error &&
                      typeof error === "object" &&
                      "name" in error &&
                      error.name === "AbortError"
                    )
                  ) {
                    setExportFailed(true);
                  }
                })
                .finally(() => setExporting(false));
            }}
          >
            {exporting ? "Exporting…" : "Export backup"}
          </button>
          <small>Hosted Docs and animations may still require this app.</small>
        </>
      )}
      {exportFailed && (
        <p role="alert">Export failed. Keep this tab open and try again.</p>
      )}
    </section>
  );
};
