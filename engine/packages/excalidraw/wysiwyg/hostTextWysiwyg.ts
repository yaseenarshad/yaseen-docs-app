import {
  CLASSES,
  KEYS,
  POINTER_BUTTON,
  THEME,
  applyDarkModeFilter,
  getFontString,
  isTestEnv,
  isWritableElement,
  viewportCoordsToSceneCoords,
} from "@excalidraw/common";
import { pointFrom, pointRotateRads, type Radians } from "@excalidraw/math";

import {
  getContainerElement,
  getLineHeightInPx,
  getStyledVisualLineOffsetX,
  getStyledVisualLineStart,
  getStyledVisualSelectionGeometry,
  getTextElementAngle,
  getTextElementStyledLines,
  getTextLayoutMaxWidth,
  isTextElement,
} from "@excalidraw/element";

import type { StyledVisualLine } from "@excalidraw/element";

import type {
  ExcalidrawTextContainer,
  ExcalidrawTextElement,
  NonDeleted,
} from "@excalidraw/element/types";

import {
  fitEditedTextContainer,
  submitEditedTextContainer,
} from "./editedTextContainer";
import { getTransform } from "./textWysiwyg";

import type { textWysiwyg } from "./textWysiwyg";
import type { HostTextEditor, HostTextSelection } from "../types";

/** YAZ-4277 D10: the caret's width on screen, at any zoom. */
export const CARET_SCREEN_PX = 1.5;

/** The caret's width in board px: 1.5 px on screen at this zoom (the math of `getResponsiveTextFontSize`). */
export const getCaretWidth = (zoom: number) => CARET_SCREEN_PX / zoom;

/**
 * YAZ-4277 D1: a text box edited by the host's editor (`textEditor`), with
 * the inputs and outputs of `textWysiwyg`. The canvas keeps drawing the box,
 * so no letter moves when the edit starts or ends; the editor in the root is
 * invisible. The caret, the selection and a click use the canvas layout.
 */
export const hostTextWysiwyg = ({
  textEditor,
  onChange,
  onSubmit,
  getViewportCoords,
  element,
  canvas,
  excalidrawContainer,
  app,
  autoSelect = true,
  initialCaretSceneCoords = null,
}: Parameters<typeof textWysiwyg>[0] & {
  textEditor: HostTextEditor;
}) => {
  const root = document.createElement("div");
  const overlay = document.createElement("div");
  root.className = "excalidraw-host-text-editor";
  overlay.className = "excalidraw-host-text-editor-overlay";
  for (const node of [root, overlay]) {
    Object.assign(node.style, {
      position: "absolute",
      margin: 0,
      padding: 0,
      transformOrigin: "center center",
      zIndex: "var(--zIndex-wysiwyg)",
    });
  }
  overlay.style.pointerEvents = "none";

  let text = element.originalText;
  let selection: HostTextSelection = { anchor: text.length, head: text.length };
  let layout: {
    lines: readonly StyledVisualLine[];
    x: number;
    y: number;
    width: number;
    height: number;
    angle: number;
    textAlign: ExcalidrawTextElement["textAlign"];
    lineHeightPx: number;
    color: string;
  } | null = null;
  let lastFont = "";
  let isDestroyed = false;

  const getElement = () => {
    const current = app.scene.getElement<NonDeleted<ExcalidrawTextElement>>(
      element.id,
    );
    return current && isTextElement(current) ? current : null;
  };

  /** The caret and the selection, drawn from the canvas layout. */
  const renderSelection = () => {
    overlay.replaceChildren();
    if (!layout) {
      return;
    }
    const geometry = getStyledVisualSelectionGeometry({
      lines: layout.lines,
      containerWidth: layout.width,
      textAlign: layout.textAlign,
      lineHeightPx: layout.lineHeightPx,
      selectionStart: selection.anchor,
      selectionEnd: selection.head,
    });
    for (const rectangle of geometry.rectangles) {
      const span = document.createElement("span");
      span.className = "excalidraw-wysiwyg-selection";
      Object.assign(span.style, {
        position: "absolute",
        left: `${rectangle.left}px`,
        top: `${rectangle.top}px`,
        width: `${rectangle.width}px`,
        height: `${rectangle.height}px`,
      });
      overlay.appendChild(span);
    }
    if (geometry.caret) {
      // a new caret each time, so its blink starts again where it moved to
      const caret = document.createElement("span");
      caret.className = "excalidraw-wysiwyg-caret";
      Object.assign(caret.style, {
        position: "absolute",
        left: `${geometry.caret.left}px`,
        top: `${geometry.caret.top}px`,
        width: `${getCaretWidth(app.state.zoom.value)}px`,
        height: `${geometry.caret.height}px`,
        backgroundColor: layout.color,
      });
      overlay.appendChild(caret);
    }
  };

  const update = () => {
    const current = getElement();
    if (!current) {
      return;
    }
    const container = getContainerElement<
      NonDeleted<ExcalidrawTextElement>,
      NonDeleted<ExcalidrawTextContainer>
    >(current, app.scene.getNonDeletedElementsMap());
    let { x, y } = current;
    if (container && current.containerId) {
      const font = getFontString(current);
      const fit = fitEditedTextContainer(
        app,
        current,
        container,
        !!lastFont && font !== lastFont,
      );
      lastFont = font;
      if (!fit) {
        return;
      }
      ({ x, y } = fit);
    }
    const [viewportX, viewportY] = getViewportCoords(x, y);
    const angle = getTextElementAngle(current, container);
    const maxWidth = getTextLayoutMaxWidth(current, container);
    const lineHeightPx = getLineHeightInPx(
      current.fontSize,
      current.lineHeight,
    );
    // the box as the canvas draws it: its own size, turned about its center
    const box = {
      left: `${viewportX}px`,
      top: `${viewportY}px`,
      width: `${current.width}px`,
      height: `${current.height}px`,
      transform: getTransform(
        current.width,
        current.height,
        angle,
        app.state,
        current.width,
        current.height,
      ),
    };
    Object.assign(overlay.style, box, { opacity: current.opacity / 100 });
    // YAZ-4277 D1: the editor wraps as the textarea did; only ↑ and ↓ see it
    Object.assign(root.style, box, {
      width: `${maxWidth === Infinity ? current.width : maxWidth}px`,
      font: getFontString(current),
      lineHeight: `${lineHeightPx}px`,
      textAlign: current.textAlign,
      whiteSpace: maxWidth === Infinity ? "pre" : "pre-wrap",
      overflowWrap: "break-word",
    });
    layout = {
      lines: getTextElementStyledLines(current, maxWidth, current.originalText),
      x,
      y,
      width: current.width,
      height: current.height,
      angle,
      textAlign: current.textAlign,
      lineHeightPx,
      color: applyDarkModeFilter(
        current.strokeColor,
        app.state.theme === THEME.DARK,
      ),
    };
    renderSelection();
    if (container && (x !== current.x || y !== current.y)) {
      app.scene.mutateElement(current, { x, y });
    }
  };

  /** The text offset nearest to a board point, from the canvas layout. */
  const getOffsetAt = (point: { x: number; y: number }) => {
    if (!layout) {
      return null;
    }
    const [localX, localY] = pointRotateRads(
      pointFrom(point.x, point.y),
      pointFrom(layout.x + layout.width / 2, layout.y + layout.height / 2),
      -layout.angle as Radians,
    );
    const { lines } = layout;
    const line =
      lines[
        Math.max(
          0,
          Math.min(
            lines.length - 1,
            Math.floor((localY - layout.y) / layout.lineHeightPx),
          ),
        )
      ];
    if (!line) {
      return 0;
    }
    const relativeX =
      localX -
      layout.x -
      getStyledVisualLineStart(line, layout.width, layout.textAlign);
    let closest = line.start;
    let closestDistance = Infinity;
    for (let offset = line.start; offset <= line.end; offset++) {
      // never between the two halves of a surrogate pair
      if (/[\uDC00-\uDFFF]/.test(text.charAt(offset))) {
        continue;
      }
      const distance = Math.abs(
        getStyledVisualLineOffsetX(line, offset) - relativeX,
      );
      if (distance < closestDistance) {
        closestDistance = distance;
        closest = offset;
      }
    }
    return closest;
  };

  if (initialCaretSceneCoords) {
    update();
    const offset = getOffsetAt(initialCaretSceneCoords);
    if (offset !== null) {
      selection = { anchor: offset, head: offset };
    }
  } else if (autoSelect) {
    selection = { anchor: 0, head: text.length };
  }

  const session = textEditor.mount({
    root,
    text,
    textRuns: element.textRuns,
    selection,
    onChange: (nextText, nextTextRuns) => {
      if (isDestroyed) {
        return;
      }
      const current = getElement();
      text = nextText;
      onChange?.({
        nextOriginalText: nextText,
        nextFontWeight: current?.fontWeight,
        nextTextDecoration: current?.textDecoration,
        nextStrikethrough: current?.strikethrough,
        nextFontStyle: current?.fontStyle,
        nextTextRuns,
      });
    },
    onSelectionChange: (next) => {
      selection = next;
      renderSelection();
    },
  });

  // a click or a drag puts the selection, from the canvas layout
  let dragAnchor: number | null = null;
  const onDragMove = (event: PointerEvent) => {
    const offset = getOffsetAt(viewportCoordsToSceneCoords(event, app.state));
    if (dragAnchor !== null && offset !== null) {
      session.setSelection({ anchor: dragAnchor, head: offset });
    }
  };
  const stopDrag = () => {
    dragAnchor = null;
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", stopDrag);
    window.removeEventListener("pointercancel", stopDrag);
  };
  const onRootPointerDown = (event: PointerEvent) => {
    event.stopPropagation();
    if (
      event.button !== POINTER_BUTTON.MAIN &&
      event.button !== POINTER_BUTTON.TOUCH
    ) {
      return;
    }
    const offset = getOffsetAt(viewportCoordsToSceneCoords(event, app.state));
    if (offset === null) {
      return;
    }
    event.preventDefault();
    stopDrag();
    session.focus();
    dragAnchor = event.shiftKey ? selection.anchor : offset;
    session.setSelection({ anchor: dragAnchor, head: offset });
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("pointercancel", stopDrag);
  };

  let submittedViaKeyboard = false;
  // before the editor's own keys: Escape and ⌘Enter end the edit
  const onRootKeyDown = (event: KeyboardEvent) => {
    if (
      event.key === KEYS.ESCAPE ||
      (event.key === KEYS.ENTER &&
        event[KEYS.CTRL_OR_CMD] &&
        !event.isComposing &&
        event.keyCode !== 229)
    ) {
      event.preventDefault();
      submittedViaKeyboard = true;
      handleSubmit();
    }
  };

  const handleSubmit = () => {
    if (isDestroyed) {
      return;
    }
    isDestroyed = true;
    cleanup();
    const current = getElement();
    if (!current) {
      return;
    }
    submitEditedTextContainer(app, current, text);
    onSubmit({
      viaKeyboard: submittedViaKeyboard,
      nextOriginalText: text,
      nextFontWeight: current.fontWeight,
      nextTextDecoration: current.textDecoration,
      nextStrikethrough: current.strikethrough,
      nextFontStyle: current.fontStyle,
      nextTextRuns: current.textRuns,
    });
  };

  // the focus left the editor: the edit ends, unless a toolbar took it
  let submitOnBlur = false;
  const onRootFocusOut = (event: FocusEvent) => {
    if (submitOnBlur && !root.contains(event.relatedTarget as Node | null)) {
      handleSubmit();
    }
  };

  const isToolbarTarget = (target: EventTarget | null) =>
    (target instanceof HTMLElement || target instanceof SVGElement) &&
    (target.classList.contains("properties-trigger") ||
      !!target.closest(
        `.properties-content, .${CLASSES.SHAPE_ACTIONS_MENU}, .compact-shape-actions-island, .contextual-properties-toolbar`,
      ));

  const bindBlurEvent = (event?: MouseEvent) => {
    window.removeEventListener("pointerup", bindBlurEvent);
    const fromToolbar = isToolbarTarget(event?.target ?? null);
    setTimeout(() => {
      if (fromToolbar || isDestroyed) {
        return;
      }
      submitOnBlur = true;
      session.focus();
    });
  };

  const temporarilyDisableSubmit = () => {
    submitOnBlur = false;
    window.addEventListener("pointerup", bindBlurEvent);
    // the pointerup may never come (a switch to another app)
    window.addEventListener("blur", handleSubmit);
  };

  const onWindowPointerDown = (event: MouseEvent) => {
    const { target } = event;
    if (event.button === POINTER_BUTTON.WHEEL) {
      temporarilyDisableSubmit();
      return;
    }
    if (
      (isToolbarTarget(target) ||
        ((target instanceof HTMLElement || target instanceof SVGElement) &&
          !!target.closest(`.${CLASSES.ZOOM_ACTIONS}`))) &&
      !isWritableElement(target)
    ) {
      temporarilyDisableSubmit();
    } else if (target instanceof HTMLCanvasElement && !isTestEnv()) {
      // a click on the board ends the edit, the frame after, as the textarea
      requestAnimationFrame(handleSubmit);
    }
  };

  const unbindUpdate = app.scene.onUpdate(() => {
    update();
    if (
      !document.activeElement?.closest(".properties-content") &&
      !root.contains(document.activeElement)
    ) {
      session.focus();
    }
  });
  const unbindScroll = app.onScrollChangeEmitter.on(update);
  let lastTheme = app.state.theme;
  const unbindChange = app.onChangeEmitter.on(() => {
    if (app.state.theme !== lastTheme) {
      lastTheme = app.state.theme;
      update();
    }
  });
  const observer =
    canvas && "ResizeObserver" in window
      ? new window.ResizeObserver(update)
      : null;
  observer?.observe(canvas);

  const cleanup = () => {
    stopDrag();
    root.removeEventListener("pointerdown", onRootPointerDown);
    root.removeEventListener("keydown", onRootKeyDown, true);
    root.removeEventListener("focusout", onRootFocusOut);
    window.removeEventListener("pointerdown", onWindowPointerDown, true);
    window.removeEventListener("pointerup", bindBlurEvent);
    window.removeEventListener("blur", handleSubmit);
    window.removeEventListener("beforeunload", handleSubmit);
    unbindUpdate();
    unbindScroll();
    unbindChange();
    observer?.disconnect();
    session.destroy();
    root.remove();
    overlay.remove();
  };

  root.addEventListener("pointerdown", onRootPointerDown);
  root.addEventListener("keydown", onRootKeyDown, true);
  root.addEventListener("focusout", onRootFocusOut);
  // the pointerdown that started the edit is not one to end it
  requestAnimationFrame(() => {
    if (!isDestroyed) {
      window.addEventListener("pointerdown", onWindowPointerDown, true);
    }
  });
  window.addEventListener("beforeunload", handleSubmit);
  const editorContainer = excalidrawContainer?.querySelector(
    ".excalidraw-textEditorContainer",
  );
  editorContainer?.appendChild(root);
  editorContainer?.appendChild(overlay);
  update();
  bindBlurEvent();

  return handleSubmit;
};
