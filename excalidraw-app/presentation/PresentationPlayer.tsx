import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import {
  ArrowRightIcon,
  CloseIcon,
} from "@excalidraw/excalidraw/components/icons";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { SetViewportOptions } from "@excalidraw/excalidraw/viewport";

import {
  applyFramesVisibility,
  readFramesVisiblePreference,
} from "../frames/framesVisibility";

import { getPresentationViewportOffsets } from "./camera";
import {
  publishPresentationFrameLifecycle,
  type PresentationFrameLifecyclePhase,
} from "./events";
import { OverviewIcon, ToolsIcon } from "./icons";
import { findSlideIndexAtPoint, getOrderedPresentationFrames } from "./slides";

import "./PresentationPlayer.scss";

import type { OrderedPresentationFrame } from "./slides";

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
 * The camera reserve is a fraction of the window, so every resize has to be
 * followed by a re-fit. Resizing fires a burst of events and each re-fit is a
 * full viewport write, so only the trailing one lands.
 */
const PRESENTATION_RESIZE_DEBOUNCE = 100;

/**
 * Excalidraw's text editor is a `textarea` and the chrome is full of inputs, so
 * the presentation shortcuts stand down while focus is inside one of them —
 * otherwise pressing an arrow (or Shift+T) would navigate instead of edit.
 *
 * Deliberately wider than `@excalidraw/common`'s `isWritableElement`: with the
 * tools shown, focus can land on a colour swatch or a slider, where an arrow
 * belongs to the control and not to the deck.
 */
const isTextEntryTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable);

/** Every frame at once — the `setViewport` target while in overview. */
const deckViewportTarget = (slides: readonly OrderedPresentationFrame[]) =>
  slides.map(({ frame }) => frame);

/** A control's tooltip and its accessible name are always the same string. */
const labelled = (label: string) => ({ title: label, "aria-label": label });

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
  const [isOverview, setIsOverview] = useState(false);
  // The scene subscription, the document-level key handler and the transition
  // timer all outlive the render that created them, so the values they read
  // are mirrored into refs. `currentFrameIdRef` is the slide we are showing or
  // moving to; `activeFrameIdRef` is the one that has landed and published
  // `active`, which is only the same once the transition finishes.
  const slidesRef = useRef(initialSlides);
  const currentIndexRef = useRef(initialIndex);
  const currentFrameIdRef = useRef<string | null>(null);
  const activeFrameIdRef = useRef<string | null>(null);
  // Overview is free-form (D8): the canvas pans with the hand tool, so the tool
  // the presenter had before is remembered here and put back on the way out.
  const isOverviewRef = useRef(false);
  const toolBeforeOverviewRef = useRef<string | null>(null);
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

  /**
   * The only way this component moves the camera. Every presentation view is
   * the same call with a different target: fitted, offset by the camera
   * reserve (GRO-1929 D6), and locked unless the tools have the canvas.
   */
  const applyViewport = useCallback(
    (
      target: SetViewportOptions["target"],
      {
        locked,
        animation,
      }: { locked: boolean; animation: SetViewportOptions["animation"] },
    ) =>
      excalidrawAPI.setViewport({
        target,
        fit: "contain",
        animation,
        offsets: getPresentationViewportOffsets(),
        ...(locked ? { lock: PRESENTATION_VIEWPORT_LOCK } : {}),
      }),
    [excalidrawAPI],
  );

  /** Clears overview state and hands the tool back. Safe when not in overview. */
  const settleOverview = useCallback(() => {
    if (!isOverviewRef.current) {
      return;
    }
    isOverviewRef.current = false;
    setIsOverview(false);
    const previous = toolBeforeOverviewRef.current;
    toolBeforeOverviewRef.current = null;
    // `custom`/`image` cannot be re-activated blindly; selection is the safe default.
    const type =
      previous &&
      previous !== "custom" &&
      previous !== "image" &&
      previous !== "hand"
        ? previous
        : "selection";
    excalidrawAPI.setActiveTool({ type } as Parameters<
      typeof excalidrawAPI.setActiveTool
    >[0]);
  }, [excalidrawAPI]);

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

      // Navigating inside overview flies to the slide but stays in overview
      // (D8): free roam, border on, no lock. Leaving overview is explicit.
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
      applyViewport(next.frame.id, {
        locked: !isOverviewRef.current,
        animation: { duration: PRESENTATION_TRANSITION_DURATION },
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
    [applyViewport, clearTransition, publish],
  );

  /**
   * Everything that has to be undone whether the presenter left on purpose or
   * the component was simply unmounted: the camera, the frame outlines the
   * edit-mode preference owns, and the `ended` beat consumers wait for.
   */
  const endSession = useCallback(
    (reason: string) => {
      didExitRef.current = true;
      clearTransition();
      settleOverview();
      publish({ frameId: null, order: null, phase: "ended", reason });
      excalidrawAPI.setViewport(null);
      applyFramesVisibility(excalidrawAPI, readFramesVisiblePreference());
    },
    [clearTransition, excalidrawAPI, publish, settleOverview],
  );

  const exit = useCallback(
    (reason = "exit") => {
      if (didExitRef.current) {
        return;
      }
      if (currentFrameIdRef.current) {
        publish({
          frameId: currentFrameIdRef.current,
          order: currentIndexRef.current + 1,
          phase: "inactive",
          reason,
        });
      }
      endSession(reason);
      onExitRef.current();
    },
    [endSession, publish],
  );

  const step = useCallback(
    (amount: -1 | 1, reason: string) =>
      navigateTo(currentIndexRef.current + amount, reason),
    [navigateTo],
  );

  /**
   * Overview zooms out to the whole deck without leaving the presentation. The
   * lock stays on — panning is the tools toggle's job (D2) — and the current
   * slide does not change, so the lifecycle only gets a `transitioning` beat
   * for the frame we are still on. Consumers dedupe on session+frame, so that
   * beat costs an animation nothing.
   */
  const showOverview = useCallback(() => {
    const currentSlides = slidesRef.current;
    if (currentSlides.length < 2 || didExitRef.current) {
      return;
    }
    // Otherwise an in-flight transition would land its `active` beat, and play
    // the slide's animation, while the deck is zoomed out.
    clearTransition();
    isOverviewRef.current = true;
    setIsOverview(true);
    // Free-form (D8): no lock, and the hand tool so a drag pans instead of
    // marqueeing. Double-click on a slide is the way in (see the dblclick effect).
    toolBeforeOverviewRef.current = excalidrawAPI.getAppState().activeTool.type;
    excalidrawAPI.setActiveTool({ type: "hand" });
    publish({
      frameId: currentFrameIdRef.current,
      order: currentIndexRef.current + 1,
      phase: "transitioning",
      reason: "overview",
    });
    applyViewport(deckViewportTarget(currentSlides), {
      locked: false,
      animation: { duration: PRESENTATION_TRANSITION_DURATION },
    });
  }, [applyViewport, clearTransition, excalidrawAPI, publish]);

  /** Esc in overview: back to the whole deck, still free-form. */
  const resetOverview = useCallback(() => {
    applyViewport(deckViewportTarget(slidesRef.current), {
      locked: false,
      animation: { duration: PRESENTATION_TRANSITION_DURATION },
    });
  }, [applyViewport]);

  /** Out of overview: tool back, then re-fit and lock the slide we are on. */
  const leaveOverview = useCallback(() => {
    settleOverview();
    navigateTo(currentIndexRef.current, "overview-return");
  }, [navigateTo, settleOverview]);

  const toggleOverview = useCallback(
    () => (isOverview ? leaveOverview() : showOverview()),
    [isOverview, leaveOverview, showOverview],
  );

  /**
   * Re-fits whatever the viewport is already showing — the whole deck while
   * zoomed out, otherwise the current slide — with freshly measured offsets, so
   * toggling the tools in overview does not quietly zoom back into one frame
   * and a resize does not leave the slide fitted to the old window.
   */
  const refit = useCallback(
    ({ locked, animated }: { locked: boolean; animated: boolean }) => {
      const target = isOverview
        ? deckViewportTarget(slidesRef.current)
        : currentFrameIdRef.current;
      if (!target || didExitRef.current) {
        return;
      }
      applyViewport(target, {
        locked: locked && !isOverview,
        animation: animated,
      });
    },
    [applyViewport, isOverview],
  );

  /**
   * Tools shown means the canvas is the presenter's again: the chrome comes
   * back, the overlay stops swallowing pointer events (both via the body class)
   * and the viewport is re-issued without the lock. Hiding them puts the lock
   * back. Navigation always re-locks, without touching this state.
   */
  const toggleTools = useCallback(() => {
    const visible = !toolsVisible;
    setToolsVisible(visible);
    // Written straight to the DOM instead of from an effect so the
    // chrome-hiding CSS has already resolved when `setViewport` measures
    // `[data-viewport-ui]` for the `ui` half of its offsets.
    document.body.classList.toggle(PRESENTATION_TOOLS_BODY_CLASS, visible);
    // The reserve holds even with the tools out — only the lock is dropped, so
    // the presenter can pan away from the left-hand fit if they want to.
    refit({ locked: !visible, animated: true });
  }, [refit, toolsVisible]);

  useEffect(() => {
    const effectGeneration = ++effectGenerationRef.current;
    didExitRef.current = false;
    overlayRef.current?.focus();
    document.body.classList.add(PRESENTATION_ACTIVE_BODY_CLASS);
    // Before the first `setViewport` so the opening slide never flashes a
    // frame outline or name label.
    applyFramesVisibility(excalidrawAPI, false);
    navigateTo(initialIndex, "start");

    return () => {
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
        endSession("unmounted");
      });
    };
  }, [endSession, excalidrawAPI, initialIndex, navigateTo]);

  // The deck is whatever the scene says it is: frames added, removed or
  // reordered while presenting re-index the deck under the presenter, and the
  // slide they are on survives by id rather than by position.
  useEffect(
    () =>
      excalidrawAPI.onChange((nextElements: readonly ExcalidrawElement[]) => {
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
      }),
    [excalidrawAPI, exit, navigateTo],
  );

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
        // Space pans the canvas and activates whatever the chrome has focused,
        // so it only advances the slide while the tools are hidden.
        ((key === " " || key === "Spacebar") && !toolsVisible)
      ) {
        step(1, "next");
      } else if (key === "ArrowLeft" || key === "PageUp") {
        step(-1, "previous");
      } else if (key === "Home") {
        navigateTo(0, "home");
      } else if (key === "End") {
        navigateTo(slidesRef.current.length - 1, "end");
      } else if (key === "Escape") {
        // Esc steps back out of overview to the slide you left. It never ends
        // the presentation (D7): restarting a deck by accident is worse than
        // reaching for the ✕. On a slide it is left to Excalidraw.
        if (isOverview) {
          resetOverview();
        } else {
          handled = false;
        }
      } else if (event.shiftKey && (key === "t" || key === "T")) {
        // Shift, so plain `t` still reaches Excalidraw's text tool (GRO-1954).
        toggleTools();
      } else if (event.shiftKey && (key === "o" || key === "O")) {
        // Shift for the same reason as tools: plain `o` stays the ellipse tool.
        toggleOverview();
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
  }, [
    exit,
    isOverview,
    navigateTo,
    resetOverview,
    step,
    toggleOverview,
    toggleTools,
    toolsVisible,
  ]);

  // Overview: double-click the canvas → present the smallest slide under the
  // pointer. Captured on the document so Excalidraw never sees the dblclick
  // (which would otherwise start a text element or edit a shape).
  useEffect(() => {
    if (!isOverview) {
      return;
    }
    const handleDoubleClick = (event: MouseEvent) => {
      if (didExitRef.current || isTextEntryTarget(event.target)) {
        return;
      }
      const index = findSlideIndexAtPoint(
        viewportCoordsToSceneCoords(event, excalidrawAPI.getAppState()),
        slidesRef.current,
      );
      if (index === null) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      navigateTo(index, "overview-dblclick");
    };
    document.addEventListener("dblclick", handleDoubleClick, true);
    return () =>
      document.removeEventListener("dblclick", handleDoubleClick, true);
  }, [excalidrawAPI, isOverview, navigateTo]);

  useEffect(() => {
    let timer: number | null = null;
    const handleResize = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      timer = window.setTimeout(() => {
        timer = null;
        // Instantly, and with the lock exactly as the presenter left it: a
        // resize is not a navigation, it just re-measures the same view.
        refit({ locked: !toolsVisible, animated: false });
      }, PRESENTATION_RESIZE_DEBOUNCE);
    };
    window.addEventListener("resize", handleResize);
    return () => {
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      window.removeEventListener("resize", handleResize);
    };
  }, [refit, toolsVisible]);

  const current = slides[currentIndex];
  if (!current) {
    return null;
  }
  const name = current.frame.name?.trim() || `Slide ${currentIndex + 1}`;

  return createPortal(
    <div
      ref={overlayRef}
      className={
        isOverview
          ? "presentation-player presentation-player--overview"
          : "presentation-player"
      }
      role="dialog"
      aria-modal={!toolsVisible}
      aria-label="Presentation mode"
      tabIndex={-1}
      onClick={(event) => {
        // The overlay is `pointer-events: none` while tools are shown, so this
        // rarely fires then — the guard keeps both click behaviours off for any
        // event that still reaches it.
        // In overview the overlay is also `pointer-events: none` (free-form
        // canvas); a double-click is what presents a slide there.
        if (
          toolsVisible ||
          isOverview ||
          event.target !== event.currentTarget
        ) {
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
        {isOverview ? "Overview — " : ""}
        {`${isTransitioning ? "Moving to" : "Showing"} slide ${
          currentIndex + 1
        } of ${slides.length} — ${name}`}
      </div>
      <div className="presentation-player__status" aria-live="polite">
        {toolsVisible ? "Tools shown" : "Tools hidden"}
      </div>
      {/* No `stopPropagation`: the overlay only acts on its own clicks. */}
      <div className="presentation-player__controls">
        <button
          type="button"
          className="presentation-player__previous"
          {...labelled("Previous slide (←)")}
          disabled={currentIndex === 0}
          onClick={() => step(-1, "previous-button")}
        >
          {ArrowRightIcon}
        </button>
        <button
          type="button"
          {...labelled("Next slide (→)")}
          disabled={currentIndex === slides.length - 1}
          onClick={() => step(1, "next-button")}
        >
          {ArrowRightIcon}
        </button>
        <span className="presentation-player__divider" aria-hidden="true" />
        <button
          type="button"
          {...labelled(isOverview ? "Exit overview (⇧O)" : "Overview (⇧O)")}
          aria-pressed={isOverview}
          disabled={slides.length < 2}
          onClick={toggleOverview}
        >
          {OverviewIcon}
        </button>
        <button
          type="button"
          {...labelled(toolsVisible ? "Hide tools (⇧T)" : "Show tools (⇧T)")}
          aria-pressed={toolsVisible}
          onClick={toggleTools}
        >
          {ToolsIcon}
        </button>
        <span className="presentation-player__divider" aria-hidden="true" />
        <button
          type="button"
          {...labelled("Exit presentation")}
          onClick={() => exit("exit-button")}
        >
          {CloseIcon}
        </button>
      </div>
    </div>,
    document.body,
  );
};
