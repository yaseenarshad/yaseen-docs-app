import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  applyFramesVisibility,
  readFramesVisiblePreference,
} from "../frames/framesVisibility";

import {
  publishPresentationFrameLifecycle,
  type PresentationFrameLifecyclePhase,
} from "./events";
import { getOrderedPresentationFrames } from "./slides";

import "./PresentationPlayer.scss";

export const PRESENTATION_TRANSITION_DURATION = 460;

const PRESENTATION_ACTIVE_BODY_CLASS = "yaseendraw-presentation-active";
/**
 * Keyed on by `PresentationPlayer.scss` to bring the editor chrome back and
 * stop the overlay from swallowing pointer events.
 */
const PRESENTATION_TOOLS_BODY_CLASS = "yaseendraw-presentation-tools";

/**
 * Pins the viewport to the slide. Dropped while tools are shown so the
 * presenter can pan, zoom and draw; re-applied on every navigation.
 */
const PRESENTATION_VIEWPORT_LOCK = {
  scroll: true,
  zoom: true,
  overscroll: false,
} as const;

/**
 * Excalidraw's text editor is a `textarea` and the chrome is full of inputs, so
 * the presentation shortcuts stand down while focus is inside one of them —
 * otherwise typing "t" or pressing an arrow would navigate instead of edit.
 */
const isTextEntryTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable);

const createSessionId = () =>
  `presentation-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

export const PresentationPlayer = ({
  excalidrawAPI,
  initialFrameId,
  onExit,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
  initialFrameId?: string | null;
  onExit: () => void;
}) => {
  const initialSlides = useMemo(
    () => getOrderedPresentationFrames(excalidrawAPI.getSceneElements()),
    [excalidrawAPI],
  );
  const initialIndex = Math.max(
    initialSlides.findIndex(({ frame }) => frame.id === initialFrameId),
    0,
  );
  const [slides, setSlides] = useState(initialSlides);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isTransitioning, setIsTransitioning] = useState(true);
  const [toolsVisible, setToolsVisible] = useState(false);
  const slidesRef = useRef(initialSlides);
  const currentIndexRef = useRef(initialIndex);
  const currentFrameIdRef = useRef<string | null>(null);
  const activeFrameIdRef = useRef<string | null>(null);
  const transitionTimerRef = useRef<number | null>(null);
  const transitionTokenRef = useRef(0);
  const sessionIdRef = useRef(createSessionId());
  const didExitRef = useRef(false);
  const effectGenerationRef = useRef(0);
  const overlayRef = useRef<HTMLDivElement>(null);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  const publish = useCallback(
    ({
      frameId,
      order,
      phase,
      reason,
    }: {
      frameId: string | null;
      order: number | null;
      phase: PresentationFrameLifecyclePhase;
      reason: string;
    }) =>
      publishPresentationFrameLifecycle({
        sessionId: sessionIdRef.current,
        frameId,
        order,
        slideCount: slidesRef.current.length,
        phase,
        reason,
      }),
    [],
  );

  const clearTransition = useCallback(() => {
    transitionTokenRef.current += 1;
    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
  }, []);

  const navigateTo = useCallback(
    (requestedIndex: number, reason: string) => {
      const currentSlides = slidesRef.current;
      if (currentSlides.length === 0 || didExitRef.current) {
        return;
      }
      const nextIndex = Math.min(
        Math.max(requestedIndex, 0),
        currentSlides.length - 1,
      );
      const next = currentSlides[nextIndex];
      if (!next) {
        return;
      }

      clearTransition();
      if (activeFrameIdRef.current) {
        const previousIndex = currentSlides.findIndex(
          ({ frame }) => frame.id === activeFrameIdRef.current,
        );
        publish({
          frameId: activeFrameIdRef.current,
          order: previousIndex >= 0 ? previousIndex + 1 : null,
          phase: "inactive",
          reason,
        });
        activeFrameIdRef.current = null;
      }

      const token = transitionTokenRef.current;
      currentIndexRef.current = nextIndex;
      currentFrameIdRef.current = next.frame.id;
      setCurrentIndex(nextIndex);
      setIsTransitioning(true);
      publish({
        frameId: next.frame.id,
        order: nextIndex + 1,
        phase: "transitioning",
        reason,
      });
      excalidrawAPI.setViewport({
        target: next.frame.id,
        fit: "contain",
        animation: { duration: PRESENTATION_TRANSITION_DURATION },
        lock: PRESENTATION_VIEWPORT_LOCK,
        offsets: { ui: true },
      });
      transitionTimerRef.current = window.setTimeout(() => {
        if (
          transitionTokenRef.current !== token ||
          didExitRef.current ||
          currentFrameIdRef.current !== next.frame.id
        ) {
          return;
        }
        transitionTimerRef.current = null;
        activeFrameIdRef.current = next.frame.id;
        setIsTransitioning(false);
        publish({
          frameId: next.frame.id,
          order: nextIndex + 1,
          phase: "active",
          reason,
        });
      }, PRESENTATION_TRANSITION_DURATION + 16);
    },
    [clearTransition, excalidrawAPI, publish],
  );

  const exit = useCallback(
    (reason = "exit") => {
      if (didExitRef.current) {
        return;
      }
      didExitRef.current = true;
      clearTransition();
      const currentFrameId = currentFrameIdRef.current;
      if (currentFrameId) {
        publish({
          frameId: currentFrameId,
          order: currentIndexRef.current + 1,
          phase: "inactive",
          reason,
        });
      }
      publish({
        frameId: null,
        order: null,
        phase: "ended",
        reason,
      });
      excalidrawAPI.setViewport(null);
      applyFramesVisibility(excalidrawAPI, readFramesVisiblePreference());
      onExitRef.current();
    },
    [clearTransition, excalidrawAPI, publish],
  );

  const step = useCallback(
    (amount: -1 | 1, reason: string) =>
      navigateTo(currentIndexRef.current + amount, reason),
    [navigateTo],
  );

  /**
   * Tools shown means the canvas is the presenter's again: the chrome comes
   * back, the overlay stops swallowing pointer events (both via the body class)
   * and the viewport is re-issued without the lock. Hiding them puts the lock
   * back. Navigation always re-locks, without touching this state.
   */
  const setToolsVisibility = useCallback(
    (visible: boolean) => {
      setToolsVisible(visible);
      // Written straight to the DOM instead of from an effect so the
      // chrome-hiding CSS has already resolved when `setViewport` measures
      // `[data-viewport-ui]` for its `offsets: { ui: true }`.
      document.body.classList.toggle(PRESENTATION_TOOLS_BODY_CLASS, visible);
      const frameId = currentFrameIdRef.current;
      if (!frameId) {
        return;
      }
      excalidrawAPI.setViewport({
        target: frameId,
        fit: "contain",
        offsets: { ui: true },
        ...(visible ? {} : { lock: PRESENTATION_VIEWPORT_LOCK }),
      });
    },
    [excalidrawAPI],
  );

  const toggleTools = useCallback(
    () => setToolsVisibility(!toolsVisible),
    [setToolsVisibility, toolsVisible],
  );

  useEffect(() => {
    const effectGeneration = ++effectGenerationRef.current;
    didExitRef.current = false;
    overlayRef.current?.focus();
    document.body.classList.add(PRESENTATION_ACTIVE_BODY_CLASS);
    // Before the first `setViewport` so the opening slide never flashes a
    // frame outline or name label.
    applyFramesVisibility(excalidrawAPI, false);
    navigateTo(initialIndex, "start");

    const unsubscribe = excalidrawAPI.onChange(
      (nextElements: readonly ExcalidrawElement[]) => {
        const nextSlides = getOrderedPresentationFrames(nextElements);
        const oldIndex = currentIndexRef.current;
        const currentFrameId = currentFrameIdRef.current;
        slidesRef.current = nextSlides;
        setSlides(nextSlides);
        if (nextSlides.length === 0) {
          exit("all-frames-deleted");
          return;
        }
        const survivingIndex = nextSlides.findIndex(
          ({ frame }) => frame.id === currentFrameId,
        );
        if (survivingIndex >= 0) {
          currentIndexRef.current = survivingIndex;
          setCurrentIndex(survivingIndex);
          return;
        }
        navigateTo(Math.min(oldIndex, nextSlides.length - 1), "frame-deleted");
      },
    );

    return () => {
      unsubscribe();
      document.body.classList.remove(
        PRESENTATION_ACTIVE_BODY_CLASS,
        PRESENTATION_TOOLS_BODY_CLASS,
      );
      // Strict Mode performs a setup → cleanup → setup replay in development.
      // Defer terminal cleanup by one microtask so a replaying setup can claim
      // the same session without publishing a false `ended` event or leaving
      // the remounted controls inert.
      queueMicrotask(() => {
        if (
          // This must read the latest generation after the microtask; capturing
          // the cleanup-time value would break the Strict Mode replay guard.
          // eslint-disable-next-line react-hooks/exhaustive-deps
          effectGenerationRef.current !== effectGeneration ||
          didExitRef.current
        ) {
          return;
        }
        didExitRef.current = true;
        clearTransition();
        excalidrawAPI.setViewport(null);
        applyFramesVisibility(excalidrawAPI, readFramesVisiblePreference());
        publish({
          frameId: null,
          order: null,
          phase: "ended",
          reason: "unmounted",
        });
      });
    };
  }, [clearTransition, excalidrawAPI, exit, initialIndex, navigateTo, publish]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (didExitRef.current || isTextEntryTarget(event.target)) {
        return;
      }
      const key = event.key;
      let handled = true;
      if (
        key === "ArrowRight" ||
        key === "PageDown" ||
        key === " " ||
        key === "Spacebar"
      ) {
        step(1, "next");
      } else if (key === "ArrowLeft" || key === "PageUp") {
        step(-1, "previous");
      } else if (key === "Home") {
        navigateTo(0, "home");
      } else if (key === "End") {
        navigateTo(slidesRef.current.length - 1, "end");
      } else if (key === "Escape") {
        exit("escape");
      } else if (key === "t" || key === "T") {
        toggleTools();
      } else if (key === "Tab" && !toolsVisible) {
        // With tools shown the overlay is no longer modal, so the trap would
        // make the toolbar unreachable by keyboard.
        const controls =
          overlayRef.current?.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          );
        if (controls?.length) {
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            first.focus();
          } else {
            handled = false;
          }
        }
      } else {
        handled = false;
      }

      if (handled) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [exit, navigateTo, step, toggleTools, toolsVisible]);

  const current = slides[currentIndex];
  if (!current) {
    return null;
  }
  const name = current.frame.name?.trim() || `Slide ${currentIndex + 1}`;

  return createPortal(
    <div
      ref={overlayRef}
      className="presentation-player"
      role="dialog"
      aria-modal={!toolsVisible}
      aria-label="Presentation mode"
      tabIndex={-1}
      onClick={(event) => {
        // The overlay is `pointer-events: none` while tools are shown, so this
        // rarely fires then — the guard keeps click-half navigation off for any
        // event that still reaches it.
        if (toolsVisible || event.target !== event.currentTarget) {
          return;
        }
        if (event.clientX < window.innerWidth / 2) {
          step(-1, "click-previous");
        } else {
          step(1, "click-next");
        }
      }}
    >
      <div className="presentation-player__status" aria-live="polite">
        {isTransitioning ? "Moving to" : "Showing"} {name}
      </div>
      <div className="presentation-player__status" aria-live="polite">
        {toolsVisible ? "Tools shown" : "Tools hidden"}
      </div>
      <div
        className="presentation-player__controls"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Previous slide"
          disabled={currentIndex === 0}
          onClick={() => step(-1, "previous-button")}
        >
          ←
        </button>
        <div className="presentation-player__progress">
          <strong>{name}</strong>
          <span>
            {currentIndex + 1} / {slides.length}
          </span>
        </div>
        <button
          type="button"
          aria-label="Next slide"
          disabled={currentIndex === slides.length - 1}
          onClick={() => step(1, "next-button")}
        >
          →
        </button>
        <button
          type="button"
          aria-label={toolsVisible ? "Hide tools" : "Show tools"}
          aria-pressed={toolsVisible}
          onClick={toggleTools}
        >
          Tools
        </button>
        <button
          type="button"
          className="presentation-player__exit"
          onClick={() => exit("exit-button")}
        >
          Exit
        </button>
      </div>
    </div>,
    document.body,
  );
};
