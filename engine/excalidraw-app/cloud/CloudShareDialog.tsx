import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import { useState } from "react";

type ShareState =
  | { status: "idle"; url: null; message: null }
  | { status: "creating"; url: null; message: null }
  | { status: "ready"; url: string; message: "Link copied" | null }
  | { status: "error"; url: string | null; message: string };

export const CloudShareDialog = ({
  title,
  initialUrl = null,
  onClose,
  onCreateLink,
}: {
  title: string;
  initialUrl?: string | null;
  onClose: () => void;
  onCreateLink: () => Promise<string | null>;
}) => {
  const [state, setState] = useState<ShareState>(
    initialUrl
      ? { status: "ready", url: initialUrl, message: null }
      : { status: "idle", url: null, message: null },
  );

  const createLink = async () => {
    setState({ status: "creating", url: null, message: null });
    try {
      const url = await onCreateLink();
      setState(
        url
          ? { status: "ready", url, message: null }
          : {
              status: "error",
              url: null,
              message: "The share link could not be created. Try again.",
            },
      );
    } catch {
      setState({
        status: "error",
        url: null,
        message: "The share link could not be created. Try again.",
      });
    }
  };

  const copyLink = async () => {
    if (!state.url) {
      return;
    }
    try {
      await navigator.clipboard.writeText(state.url);
      setState({ status: "ready", url: state.url, message: "Link copied" });
    } catch {
      setState({
        status: "error",
        url: state.url,
        message: "Copy the link manually from the field.",
      });
    }
  };

  return (
    <Dialog size="small" title={`Share “${title}”`} onCloseRequest={onClose}>
      <div className="cloud-share-dialog">
        <p>Anyone with this link can view this board.</p>
        {state.url ? (
          <div className="cloud-share-dialog__link">
            <input
              aria-label="View-only share link"
              readOnly
              value={state.url}
              onFocus={(event) => event.currentTarget.select()}
            />
            <button type="button" onClick={() => void copyLink()}>
              Copy link
            </button>
          </div>
        ) : (
          <button
            className="cloud-share-dialog__create"
            type="button"
            disabled={state.status === "creating"}
            onClick={() => void createLink()}
          >
            {state.status === "creating" ? "Creating…" : "Create link"}
          </button>
        )}
        {state.message && (
          <div
            className={`cloud-share-dialog__message cloud-share-dialog__message--${state.status}`}
            role="status"
          >
            {state.message}
          </div>
        )}
      </div>
    </Dialog>
  );
};
