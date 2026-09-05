import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CaptureUpdateAction } from "@excalidraw/excalidraw";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  DragHandleIcon,
  MoveSlideDownIcon,
  MoveSlideUpIcon,
  RenameIcon,
} from "./icons";
import {
  getOrderedPresentationFrames,
  renamePresentationFrame,
  reorderPresentationFrames,
} from "./slides";

import "./PresentationSidebar.scss";

import type { PointerEvent as ReactPointerEvent } from "react";

/** How close to a list edge a drag has to get before the list scrolls itself. */
const AUTO_SCROLL_MARGIN = 24;
const AUTO_SCROLL_SPEED = 8;

const slideName = (name: string | null, order: number) =>
  name?.trim() || `Slide ${order}`;

/** The live drag: which slide is held, where it started, where it would land. */
type SlideDrag = {
  frameId: string;
  fromIndex: number;
  toIndex: number;
};

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
  const [drag, setDrag] = useState<SlideDrag | null>(null);
  const [liveMessage, setLiveMessage] = useState("");
  const listRef = useRef<HTMLOListElement>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const pointerYRef = useRef(0);
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

  /** Where the held slide would land if the pointer were released at `clientY`. */
  const updateDropIndex = useCallback(
    (clientY: number) => {
      const landing = slides.findIndex(({ frame }) => {
        const rect = rowRefs.current.get(frame.id)?.getBoundingClientRect();
        return rect ? clientY < rect.top + rect.height / 2 : false;
      });
      const toIndex = landing < 0 ? slides.length - 1 : landing;
      setDrag((current) =>
        !current || current.toIndex === toIndex
          ? current
          : { ...current, toIndex },
      );
    },
    [slides],
  );

  const draggedFrameId = drag?.frameId ?? null;

  // Everything that has to keep running for as long as a slide is held: the
  // edge auto-scroll, the Escape abort, and dropping the drag if the slide
  // disappears from the scene under it.
  useEffect(() => {
    if (!draggedFrameId) {
      return;
    }
    if (!slides.some(({ frame }) => frame.id === draggedFrameId)) {
      setDrag(null);
      return;
    }

    const abortOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrag(null);
      }
    };
    window.addEventListener("keydown", abortOnEscape);

    let frameRequest = requestAnimationFrame(function scrollNearEdges() {
      const list = listRef.current;
      if (list) {
        const { top, bottom } = list.getBoundingClientRect();
        const y = pointerYRef.current;
        const speed =
          y < top + AUTO_SCROLL_MARGIN
            ? -AUTO_SCROLL_SPEED
            : y > bottom - AUTO_SCROLL_MARGIN
            ? AUTO_SCROLL_SPEED
            : 0;
        if (speed !== 0) {
          list.scrollTop += speed;
          updateDropIndex(y);
        }
      }
      frameRequest = requestAnimationFrame(scrollNearEdges);
    });

    return () => {
      window.removeEventListener("keydown", abortOnEscape);
      cancelAnimationFrame(frameRequest);
    };
  }, [draggedFrameId, slides, updateDropIndex]);

  const startDrag = (
    event: ReactPointerEvent<HTMLElement>,
    frameId: string,
    index: number,
  ) => {
    if (event.pointerType === "mouse" && event.button > 0) {
      // Right/middle click is not a drag.
      return;
    }
    // Keep the browser from starting a text selection or a scroll gesture on
    // top of the drag.
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointerYRef.current = event.clientY;
    setDrag({ frameId, fromIndex: index, toIndex: index });
  };

  const trackDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drag) {
      return;
    }
    pointerYRef.current = event.clientY;
    updateDropIndex(event.clientY);
  };

  const dropSlide = () => {
    if (drag && drag.toIndex !== drag.fromIndex) {
      const ids = slides.map(({ frame }) => frame.id);
      const [movedId] = ids.splice(drag.fromIndex, 1);
      ids.splice(drag.toIndex, 0, movedId);
      persistOrder(ids, `Slide moved to position ${drag.toIndex + 1}`);
    }
    setDrag(null);
  };

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
      <ol className="presentation-sidebar__slides" ref={listRef}>
        {slides.map(({ frame, order }, index) => {
          const name = slideName(frame.name, order);
          // The insertion line sits on the edge of the row the held slide
          // would take over — above it when moving up, below it when down.
          const dropEdge =
            drag && drag.toIndex === index && drag.toIndex !== drag.fromIndex
              ? drag.toIndex < drag.fromIndex
                ? "before"
                : "after"
              : null;
          return (
            <li
              key={frame.id}
              data-testid={`presentation-slide-${frame.id}`}
              ref={(row) => {
                if (row) {
                  rowRefs.current.set(frame.id, row);
                } else {
                  rowRefs.current.delete(frame.id);
                }
              }}
              className={clsx("presentation-sidebar__slide", {
                "presentation-sidebar__slide--active":
                  activeFrameId === frame.id,
                "presentation-sidebar__slide--dragging":
                  drag?.frameId === frame.id,
                "presentation-sidebar__slide--drop-before":
                  dropEdge === "before",
                "presentation-sidebar__slide--drop-after": dropEdge === "after",
              })}
              onKeyDown={(event) => {
                if (!canEdit || !event.altKey) {
                  return;
                }
                if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                  event.preventDefault();
                  moveSlide(frame.id, event.key === "ArrowUp" ? -1 : 1);
                }
              }}
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
                  {canEdit && (
                    <button
                      type="button"
                      className="presentation-sidebar__handle"
                      aria-label={`Reorder slide ${order}`}
                      title="Drag to reorder, or Alt+↑ / Alt+↓"
                      onPointerDown={(event) =>
                        startDrag(event, frame.id, index)
                      }
                      onPointerMove={trackDrag}
                      onPointerUp={dropSlide}
                      onPointerCancel={() => setDrag(null)}
                    >
                      {DragHandleIcon}
                    </button>
                  )}
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
