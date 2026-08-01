import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CaptureUpdateAction } from "@excalidraw/excalidraw";

import type {
  ExcalidrawElement,
  ExcalidrawFrameElement,
} from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  getOrderedPresentationFrames,
  renamePresentationFrame,
  reorderPresentationFrames,
} from "./slides";

import "./PresentationSidebar.scss";

const SLIDE_DRAG_MIME = "application/x-yaseendraw-slide-id";

const frameName = (frame: ExcalidrawFrameElement, order: number) =>
  frame.name?.trim() || `Slide ${order}`;

const LazyFramePreview = ({
  frame,
  order,
  elements,
}: {
  frame: ExcalidrawFrameElement;
  order: number;
  elements: readonly ExcalidrawElement[];
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(
    () => typeof IntersectionObserver === "undefined",
  );

  useEffect(() => {
    const container = containerRef.current;
    if (
      !container ||
      isVisible ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setIsVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [isVisible]);

  const children = elements.filter(
    (element) => !element.isDeleted && element.frameId === frame.id,
  );
  return (
    <div ref={containerRef} className="presentation-sidebar__preview-shell">
      {isVisible ? (
        <svg
          className="presentation-sidebar__preview"
          viewBox={`${frame.x} ${frame.y} ${frame.width} ${frame.height}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`Preview of ${frameName(frame, order)}`}
        >
          <rect
            x={frame.x}
            y={frame.y}
            width={frame.width}
            height={frame.height}
            fill="#f8f7f3"
          />
          {children.slice(0, 80).map((element) => {
            if (element.type === "text") {
              return (
                <text
                  key={element.id}
                  x={element.x}
                  y={element.y + Math.min(element.fontSize, element.height)}
                  fill={element.strokeColor || "#14251f"}
                  fontSize={Math.max(element.fontSize, 12)}
                  fontWeight={element.fontWeight}
                >
                  {element.text.split("\n")[0].slice(0, 80)}
                </text>
              );
            }
            return (
              <rect
                key={element.id}
                x={element.x}
                y={element.y}
                width={Math.max(element.width, 1)}
                height={Math.max(element.height, 1)}
                rx={
                  element.type === "image" || element.type === "iframe" ? 18 : 4
                }
                fill={
                  element.type === "image" || element.type === "iframe"
                    ? "#d8eee5"
                    : element.backgroundColor === "transparent"
                    ? "#ffffff"
                    : element.backgroundColor
                }
                stroke={element.strokeColor || "#d8ded9"}
                strokeWidth={Math.max(element.strokeWidth, 1)}
              />
            );
          })}
        </svg>
      ) : (
        <span className="presentation-sidebar__preview-loading">
          Preview loads when visible
        </span>
      )}
    </div>
  );
};

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
        <div>
          <h2 id="presentation-title">Presentation</h2>
          <p>{slides.length} slides · drag to reorder</p>
        </div>
      </header>
      <ol className="presentation-sidebar__slides">
        {slides.map(({ frame, order }, index) => {
          const name = frameName(frame, order);
          return (
            <li
              key={frame.id}
              data-testid={`presentation-slide-${frame.id}`}
              className={`presentation-sidebar__slide${
                activeFrameId === frame.id
                  ? " presentation-sidebar__slide--active"
                  : ""
              }`}
              draggable={canEdit}
              onDragStart={(event) => {
                event.dataTransfer.setData(SLIDE_DRAG_MIME, frame.id);
              }}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes(SLIDE_DRAG_MIME)) {
                  event.preventDefault();
                }
              }}
              onDrop={(event) => {
                if (!canEdit) {
                  return;
                }
                event.preventDefault();
                const sourceId = event.dataTransfer.getData(SLIDE_DRAG_MIME);
                const ids = slides.map(({ frame: item }) => item.id);
                const sourceIndex = ids.indexOf(sourceId);
                const targetIndex = ids.indexOf(frame.id);
                if (
                  sourceIndex < 0 ||
                  targetIndex < 0 ||
                  sourceIndex === targetIndex
                ) {
                  return;
                }
                ids.splice(sourceIndex, 1);
                const insertionIndex =
                  sourceIndex < targetIndex ? targetIndex : targetIndex;
                ids.splice(insertionIndex, 0, sourceId);
                persistOrder(
                  ids,
                  `Slide moved to position ${insertionIndex + 1}`,
                );
              }}
            >
              <button
                type="button"
                className="presentation-sidebar__card"
                aria-label={`Go to slide ${order}`}
                aria-current={activeFrameId === frame.id ? "true" : undefined}
                onClick={() => focusFrame(frame.id)}
              >
                <LazyFramePreview
                  frame={frame}
                  order={order}
                  elements={elements}
                />
                <span className="presentation-sidebar__card-copy">
                  <span className="presentation-sidebar__number">{order}</span>
                  <strong title={name}>{name}</strong>
                </span>
              </button>
              {canEdit && (
                <div className="presentation-sidebar__actions">
                  <button
                    type="button"
                    aria-label={`Move slide ${order} up`}
                    disabled={index === 0}
                    onClick={() => moveSlide(frame.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move slide ${order} down`}
                    disabled={index === slides.length - 1}
                    onClick={() => moveSlide(frame.id, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`Rename slide ${order}`}
                    onClick={() => {
                      const nextName = window
                        .prompt("Rename slide", name)
                        ?.trim();
                      if (!nextName) {
                        return;
                      }
                      excalidrawAPI.updateScene({
                        elements: renamePresentationFrame(
                          excalidrawAPI.getSceneElements(),
                          frame.id,
                          nextName,
                        ),
                        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
                      });
                      setLiveMessage(`Slide ${order} renamed to ${nextName}`);
                    }}
                  >
                    Rename
                  </button>
                </div>
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
