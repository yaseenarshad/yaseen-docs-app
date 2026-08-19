import { useCallback, useEffect, useMemo, useState } from "react";

import { CaptureUpdateAction } from "@excalidraw/excalidraw";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { MoveSlideDownIcon, MoveSlideUpIcon, RenameIcon } from "./icons";
import {
  getOrderedPresentationFrames,
  renamePresentationFrame,
  reorderPresentationFrames,
} from "./slides";

import "./PresentationSidebar.scss";

const slideName = (name: string | null, order: number) =>
  name?.trim() || `Slide ${order}`;

/**
 * Inline rename field. Uncontrolled on purpose: the scene is the source of
 * truth for the name, and this only owns the draft while it is open.
 */
const SlideNameInput = ({
  label,
  initialName,
  onCommit,
  onCancel,
}: {
  label: string;
  initialName: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) => (
  <input
    className="presentation-sidebar__rename"
    aria-label={label}
    defaultValue={initialName}
    autoFocus
    onKeyDown={(event) => {
      if (event.key === "Enter") {
        onCommit(event.currentTarget.value);
      } else if (event.key === "Escape") {
        onCancel();
      }
      // Row-level shortcuts (Alt+↑/↓) must not fire while typing a name.
      event.stopPropagation();
    }}
    onBlur={(event) => onCommit(event.currentTarget.value)}
  />
);

export const PresentationSidebar = ({
  excalidrawAPI,
  canEdit,
  onStartPresentation,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
  canEdit: boolean;
  onStartPresentation?: (initialFrameId: string | null) => void;
}) => {
  const [elements, setElements] = useState<readonly ExcalidrawElement[]>(() =>
    excalidrawAPI.getSceneElements(),
  );
  const [activeFrameId, setActiveFrameId] = useState<string | null>(() => {
    const selectedIds = excalidrawAPI.getAppState().selectedElementIds;
    return (
      excalidrawAPI
        .getSceneElements()
        .find(
          (element) =>
            element.type === "frame" && selectedIds[element.id] === true,
        )?.id ?? null
    );
  });
  const [renamingFrameId, setRenamingFrameId] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState("");
  const slides = useMemo(
    () => getOrderedPresentationFrames(elements),
    [elements],
  );

  useEffect(
    () =>
      excalidrawAPI.onChange((nextElements, appState) => {
        setElements(nextElements);
        const selectedFrame = nextElements.find(
          (element) =>
            element.type === "frame" &&
            !element.isDeleted &&
            appState.selectedElementIds[element.id] === true,
        );
        if (selectedFrame) {
          setActiveFrameId(selectedFrame.id);
        } else {
          setActiveFrameId((current) =>
            current &&
            nextElements.some(
              (element) => element.id === current && !element.isDeleted,
            )
              ? current
              : null,
          );
        }
      }),
    [excalidrawAPI],
  );

  const persistOrder = useCallback(
    (orderedFrameIds: readonly string[], announcement: string) => {
      if (!canEdit) {
        return;
      }
      const nextElements = reorderPresentationFrames(
        excalidrawAPI.getSceneElements(),
        orderedFrameIds,
      );
      excalidrawAPI.updateScene({
        elements: nextElements,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      setLiveMessage(announcement);
    },
    [canEdit, excalidrawAPI],
  );

  const moveSlide = useCallback(
    (frameId: string, direction: -1 | 1) => {
      const ids = slides.map(({ frame }) => frame.id);
      const index = ids.indexOf(frameId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) {
        return;
      }
      [ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]];
      persistOrder(ids, `Slide moved to position ${nextIndex + 1}`);
    },
    [persistOrder, slides],
  );

  const commitRename = useCallback(
    (frameId: string, order: number, nextName: string) => {
      setRenamingFrameId(null);
      const name = nextName.trim();
      if (!name) {
        return;
      }
      excalidrawAPI.updateScene({
        elements: renamePresentationFrame(
          excalidrawAPI.getSceneElements(),
          frameId,
          name,
        ),
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      setLiveMessage(`Slide ${order} renamed to ${name}`);
    },
    [excalidrawAPI],
  );

  const focusFrame = (frameId: string) => {
    setActiveFrameId(frameId);
    excalidrawAPI.setViewport({
      target: frameId,
      fit: "contain",
      animation: true,
      offsets: { ui: true },
    });
  };

  if (slides.length === 0) {
    return (
      <section className="presentation-sidebar presentation-sidebar--empty">
        <div>
          <h2>Presentation</h2>
          <p>Frames become slides. Create a frame to start your sequence.</p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => excalidrawAPI.setActiveTool({ type: "frame" })}
          >
            Create a frame
          </button>
        )}
      </section>
    );
  }

  return (
    <section
      className="presentation-sidebar"
      aria-labelledby="presentation-title"
    >
      <header className="presentation-sidebar__header">
        <h2 id="presentation-title">Presentation</h2>
        <p>
          {slides.length} {slides.length === 1 ? "slide" : "slides"}
        </p>
      </header>
      <ol className="presentation-sidebar__slides">
        {slides.map(({ frame, order }, index) => {
          const name = slideName(frame.name, order);
          return (
            <li
              key={frame.id}
              data-testid={`presentation-slide-${frame.id}`}
              className={`presentation-sidebar__slide${
                activeFrameId === frame.id
                  ? " presentation-sidebar__slide--active"
                  : ""
              }`}
            >
              {renamingFrameId === frame.id ? (
                <SlideNameInput
                  label={`Slide ${order} name`}
                  initialName={name}
                  onCommit={(nextName) =>
                    commitRename(frame.id, order, nextName)
                  }
                  onCancel={() => setRenamingFrameId(null)}
                />
              ) : (
                <>
                  <button
                    type="button"
                    className="presentation-sidebar__open"
                    aria-label={`Go to slide ${order}`}
                    aria-current={
                      activeFrameId === frame.id ? "true" : undefined
                    }
                    onClick={() => focusFrame(frame.id)}
                  >
                    <span className="presentation-sidebar__number">
                      {order}
                    </span>
                    <span className="presentation-sidebar__name" title={name}>
                      {name}
                    </span>
                  </button>
                  {canEdit && (
                    <div className="presentation-sidebar__actions">
                      <button
                        type="button"
                        aria-label={`Rename slide ${order}`}
                        onClick={() => setRenamingFrameId(frame.id)}
                      >
                        {RenameIcon}
                      </button>
                      <button
                        type="button"
                        aria-label={`Move slide ${order} up`}
                        disabled={index === 0}
                        onClick={() => moveSlide(frame.id, -1)}
                      >
                        {MoveSlideUpIcon}
                      </button>
                      <button
                        type="button"
                        aria-label={`Move slide ${order} down`}
                        disabled={index === slides.length - 1}
                        onClick={() => moveSlide(frame.id, 1)}
                      >
                        {MoveSlideDownIcon}
                      </button>
                    </div>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ol>
      {onStartPresentation && (
        <footer className="presentation-sidebar__footer">
          <button
            type="button"
            onClick={() => onStartPresentation(activeFrameId)}
          >
            <span aria-hidden="true">▶</span> Start presentation
          </button>
        </footer>
      )}
      <p className="presentation-sidebar__live" aria-live="polite">
        {liveMessage}
      </p>
    </section>
  );
};
