import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

import type { CSSProperties, RefObject } from "react";

export const BOARD_PREVIEW_DWELL_MS = 400;

export type BoardPreviewSummary =
  | {
      status: "legacy";
    }
  | {
      status: "empty";
      version: number;
      updatedAt?: number;
    }
  | {
      status: "available";
      version: number;
      url: string;
      mimeType?: string;
      width?: number;
      height?: number;
      updatedAt?: number;
    };

export type BoardPreviewLoadState = "loading" | "loaded" | "failed";

type MeasuredRect = Pick<
  DOMRect,
  "left" | "right" | "top" | "bottom" | "width" | "height"
>;

type BoardPreviewLayout = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const PREVIEW_GAP = 16;
const PREVIEW_WIDTH_RATIO = 0.575;
const PREVIEW_HEIGHT_RATIO = 0.68;
const PREVIEW_MAX_VIEWPORT_HEIGHT_RATIO = 0.7;
const PREVIEW_MIN_HEIGHT = 220;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

const calculateBoardPreviewLayout = ({
  root,
  sidebar,
  direction,
}: {
  root: MeasuredRect;
  sidebar: MeasuredRect;
  direction: "ltr" | "rtl";
}): BoardPreviewLayout => {
  const usableWidth =
    direction === "rtl"
      ? Math.max(0, Math.min(sidebar.left, root.right) - root.left)
      : Math.max(0, root.right - Math.max(sidebar.right, root.left));
  const maximumWidth = Math.max(0, usableWidth - PREVIEW_GAP * 2);
  const width = Math.min(
    Math.round(usableWidth * PREVIEW_WIDTH_RATIO),
    maximumWidth,
  );
  const maximumHeight = Math.max(
    0,
    Math.round(root.height * PREVIEW_MAX_VIEWPORT_HEIGHT_RATIO),
  );
  const height = Math.min(
    maximumHeight,
    Math.max(PREVIEW_MIN_HEIGHT, Math.round(width * PREVIEW_HEIGHT_RATIO)),
  );
  const left =
    direction === "rtl"
      ? clamp(
          sidebar.left - PREVIEW_GAP - width,
          root.left + PREVIEW_GAP,
          root.right - PREVIEW_GAP - width,
        )
      : clamp(
          sidebar.right + PREVIEW_GAP,
          root.left + PREVIEW_GAP,
          root.right - PREVIEW_GAP - width,
        );
  const top = clamp(
    Math.round(root.top + (root.height - height) / 2),
    root.top + PREVIEW_GAP,
    root.bottom - PREVIEW_GAP - height,
  );

  return { left, top, width, height };
};

export const BoardPreviewOverlay = ({
  boardId,
  title,
  preview,
  loadState,
  anchorRef,
  onImageLoad,
  onImageError,
}: {
  boardId: string;
  title: string;
  preview: BoardPreviewSummary;
  loadState: BoardPreviewLoadState;
  anchorRef: RefObject<HTMLElement | null>;
  onImageLoad: () => void;
  onImageError: () => void;
}) => {
  const [layout, setLayout] = useState<BoardPreviewLayout | null>(null);
  const anchor = anchorRef.current;
  const editorRoot = anchor?.closest<HTMLElement>(".excalidraw") ?? null;
  const sidebar = anchor?.closest<HTMLElement>(".sidebar") ?? null;
  const portalTarget = editorRoot ?? document.body;

  useLayoutEffect(() => {
    const updateLayout = () => {
      const measuredRootRect = editorRoot?.getBoundingClientRect();
      const rootRect =
        measuredRootRect &&
        measuredRootRect.width > 0 &&
        measuredRootRect.height > 0
          ? measuredRootRect
          : {
              left: 0,
              right: window.innerWidth,
              top: 0,
              bottom: window.innerHeight,
              width: window.innerWidth,
              height: window.innerHeight,
            };
      const sidebarRect =
        sidebar?.getBoundingClientRect() ??
        anchor?.getBoundingClientRect() ??
        rootRect;
      const direction =
        (editorRoot &&
          window.getComputedStyle(editorRoot).direction === "rtl") ||
        document.documentElement.dir === "rtl"
          ? "rtl"
          : "ltr";
      setLayout(
        calculateBoardPreviewLayout({
          root: rootRect,
          sidebar: sidebarRect,
          direction,
        }),
      );
    };

    updateLayout();
    window.addEventListener("resize", updateLayout);
    window.addEventListener("scroll", updateLayout, true);
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateLayout);
    if (editorRoot) {
      resizeObserver?.observe(editorRoot);
    }
    if (sidebar) {
      resizeObserver?.observe(sidebar);
    }

    return () => {
      window.removeEventListener("resize", updateLayout);
      window.removeEventListener("scroll", updateLayout, true);
      resizeObserver?.disconnect();
    };
  }, [anchor, editorRoot, sidebar]);

  if (!layout || layout.width <= 0 || layout.height <= 0) {
    return null;
  }

  const style: CSSProperties = {
    left: layout.left,
    top: layout.top,
    width: layout.width,
    height: layout.height,
  };
  const showImage =
    preview.status === "available" &&
    (loadState === "loading" || loadState === "loaded");

  return createPortal(
    <aside
      className={`board-preview-overlay board-preview-overlay--${preview.status} board-preview-overlay--${loadState}`}
      style={style}
      role="status"
      aria-label={`Preview of ${title}`}
      aria-live="polite"
      aria-atomic="true"
      data-board-id={boardId}
    >
      <header className="board-preview-overlay__header">
        <strong>{title}</strong>
        <span>Board preview</span>
      </header>
      <div className="board-preview-overlay__stage">
        {preview.status === "legacy" ? (
          <p>Preview available after this board is opened once</p>
        ) : preview.status === "empty" ? (
          <p>Empty board</p>
        ) : loadState === "failed" ? (
          <p>Preview unavailable</p>
        ) : (
          <>
            {showImage && (
              <img
                src={preview.url}
                alt={`Preview of ${title}`}
                width={preview.width}
                height={preview.height}
                draggable={false}
                onLoad={onImageLoad}
                onError={onImageError}
              />
            )}
            {loadState === "loading" && (
              <p className="board-preview-overlay__loading">Loading preview…</p>
            )}
          </>
        )}
      </div>
    </aside>,
    portalTarget,
  );
};
