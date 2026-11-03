import {
  CLASSES,
  KEYS,
  MIME_TYPES,
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
  getTextLinkRanges,
  hasTextList,
  isTextElement,
} from "@excalidraw/element";

import type { StyledVisualLine } from "@excalidraw/element";

import type {
  ExcalidrawTextContainer,
  ExcalidrawTextElement,
  NonDeleted,
} from "@excalidraw/element/types";

import { actionSaveToActiveFile } from "../actions";
import {
  actionDecreaseFontSize,
  actionIncreaseFontSize,
} from "../actions/actionProperties";
import {
  actionResetZoom,
  actionZoomIn,
  actionZoomOut,
} from "../actions/actionCanvas";

import {
  fitEditedTextContainer,
  submitEditedTextContainer,
} from "./editedTextContainer";
import { getLinkToDelete, keepLinksWhole } from "./linkPill";

import type App from "../components/App";
import type { AppState, HostTextEditor, HostTextSelection } from "../types";

/** YAZ-4277 D10: the caret's width on screen, at any zoom. */
export const CARET_SCREEN_PX = 1.5;

/** The caret's width in board px: 1.5 px on screen at this zoom (the math of `getResponsiveTextFontSize`). */
export const getCaretWidth = (zoom: number) => CARET_SCREEN_PX / zoom;

/** The CSS transform that puts a box-sized node over the box: scaled by the zoom from its top left, turned about its center. */
const getTransform = (
  width: number,
  height: number,
  angle: number,
  appState: AppState,
) => {
  const { zoom } = appState;
  const degree = (180 * angle) / Math.PI;
  const translateX = (width * (zoom.value - 1)) / 2;
  const translateY = (height * (zoom.value - 1)) / 2;
  return `translate(${translateX}px, ${translateY}px) scale(${zoom.value}) rotate(${degree}deg)`;
};

/** The edit of a text box that is open, for the engine's pickers: they give it the focus back. */
let openEditor: {
  focus: () => void;
  pauseBlur: (duration: number) => void;
} | null = null;

/** YAZ-4277 1D: the open text editor gets the focus back (after the font picker or a color pick). */
export const focusOpenTextEditor = () => openEditor?.focus();

/** A blur of the open text editor in the next `duration` ms does not end the edit (a picker opens). */
export const pauseOpenTextEditorBlur = (duration: number) =>
  openEditor?.pauseBlur(duration);

/** True while a text box is open in the editor. */
export const isTextEditorOpen = () => openEditor !== null;

/** A letter of a word, for a double click. */
const isWordCharacter = (character: string) =>
  /[\p{L}\p{M}\p{N}_]/u.test(character);

/**
 * YAZ-4277 D1: a text box edited by the host's editor (`textEditor`). The
 * canvas keeps drawing the box, so no letter moves when the edit starts or
 * ends; the editor in the root is invisible. The caret, the selection, a
 * click and ↑ / ↓ use the canvas layout. Escape, ⌘Enter, blur and a click on
 * the board end the edit.
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
}: {
  textEditor: HostTextEditor;
  onChange?: (data: {
    nextOriginalText: string;
    nextFontWeight: ExcalidrawTextElement["fontWeight"];
    nextTextDecoration: ExcalidrawTextElement["textDecoration"];
    nextStrikethrough: ExcalidrawTextElement["strikethrough"];
    nextFontStyle: ExcalidrawTextElement["fontStyle"];
    nextTextRuns: ExcalidrawTextElement["textRuns"];
  }) => void;
  onSubmit: (data: {
    viaKeyboard: boolean;
    nextOriginalText: string;
    nextFontWeight: ExcalidrawTextElement["fontWeight"];
    nextTextDecoration: ExcalidrawTextElement["textDecoration"];
    nextStrikethrough: ExcalidrawTextElement["strikethrough"];
    nextFontStyle: ExcalidrawTextElement["fontStyle"];
    nextTextRuns: ExcalidrawTextElement["textRuns"];
  }) => void;
  getViewportCoords: (x: number, y: number) => [number, number];
  element: ExcalidrawTextElement;
  canvas: HTMLCanvasElement;
  excalidrawContainer: HTMLDivElement | null;
  app: App;
  autoSelect?: boolean;
  initialCaretSceneCoords?: { x: number; y: number } | null;
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
      transform: getTransform(current.width, current.height, angle, app.state),
    };
    Object.assign(overlay.style, box, { opacity: current.opacity / 100 });
    // YAZ-4277 D1: the editor lays out its lines near the canvas ones; the
    // engine never reads them (a click and ↑ / ↓ use the canvas layout)
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

  /** The text offset on `line` nearest to `relativeX` from the line's start. */
  const getOffsetOnLine = (line: StyledVisualLine, relativeX: number) => {
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
    return getOffsetOnLine(
      line,
      localX -
        layout.x -
        getStyledVisualLineStart(line, layout.width, layout.textAlign),
    );
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

  // ---------------------------------------------------------------------------
  // YAZ-4039 D12, D15: page links. The host's `[[` picker follows the text and
  // the caret; a pill is one unit for the caret.

  const getCaretClientRect = () => {
    const caret = overlay.querySelector(".excalidraw-wysiwyg-caret");
    const box = (caret ?? overlay).getBoundingClientRect();
    return {
      left: box.left,
      top: box.top,
      right: box.left,
      bottom: box.bottom,
    };
  };

  const replaceLink = (raw: string, next: string) => {
    if (isDestroyed) {
      return app.replaceHostLinkText(element.id, -1, -1, raw, next);
    }
    const at = text.indexOf(raw);
    if (at < 0) {
      return false;
    }
    // the caret stays where the user left it (a Create row's new ID comes later)
    const end = at + raw.length;
    const map = (offset: number) =>
      offset >= end
        ? offset + next.length - raw.length
        : offset > at
        ? at + next.length
        : offset;
    const kept = { anchor: map(selection.anchor), head: map(selection.head) };
    session.replaceText(at, end, next);
    session.setSelection(kept);
    return true;
  };

  const reportEditor = (typed: boolean) => {
    app.props.hostLinks?.onEditorChange?.({
      text,
      caret: selection.head,
      typed,
      caretRect: getCaretClientRect,
      replace: (start, end, next) => session.replaceText(start, end, next),
      replaceLink,
    });
  };

  let lastSelection = { start: selection.anchor, end: selection.head };
  /** ↑ / ↓ keep the x they started from, as a text field does. */
  let goalX: number | null = null;
  let keepGoalX = false;
  /** A caret or a selection end inside a pill goes to its edge. */
  const keepCaretOutOfLinks = (next: HostTextSelection) => {
    const links = getTextLinkRanges(text);
    const kept = links.length
      ? keepLinksWhole(
          links,
          { start: next.anchor, end: next.head },
          lastSelection,
        )
      : { start: next.anchor, end: next.head };
    lastSelection = kept;
    if (kept.start !== next.anchor || kept.end !== next.head) {
      session.setSelection({ anchor: kept.start, head: kept.end });
      return true;
    }
    return false;
  };

  const session = textEditor.mount({
    root,
    text,
    textRuns: element.textRuns,
    selection,
    onChange: (nextText, nextTextRuns, nextSelection) => {
      if (isDestroyed) {
        return;
      }
      selection = nextSelection;
      lastSelection = { start: nextSelection.anchor, end: nextSelection.head };
      goalX = null;
      const current = getElement();
      // a list makes the box read from the left (YAZ-3943 demo 2)
      if (
        current &&
        current.textAlign !== "left" &&
        !current.containerId &&
        !hasTextList(text) &&
        hasTextList(nextText)
      ) {
        app.scene.mutateElement(current, { textAlign: "left" });
      }
      text = nextText;
      onChange?.({
        nextOriginalText: nextText,
        nextFontWeight: current?.fontWeight,
        nextTextDecoration: current?.textDecoration,
        nextStrikethrough: current?.strikethrough,
        nextFontStyle: current?.fontStyle,
        nextTextRuns,
      });
      renderSelection();
      reportEditor(true);
    },
    onSelectionChange: (next) => {
      selection = next;
      if (keepCaretOutOfLinks(next)) {
        return;
      }
      goalX = keepGoalX ? goalX : null;
      renderSelection();
      reportEditor(false);
    },
  });

  // ---------------------------------------------------------------------------
  // the pointer: a click or a drag puts the selection, a double click selects
  // a word and a triple click a line, from the canvas layout

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

  // Chromium sends `detail: 0` on pointerdown: the count comes from `click`
  const onRootClick = (event: MouseEvent) => {
    if (event.detail < 2 || selection.anchor !== selection.head) {
      return;
    }
    const at = getOffsetAt(viewportCoordsToSceneCoords(event, app.state));
    if (at === null) {
      return;
    }
    let start = at;
    let end = at;
    if (event.detail >= 3) {
      start = text.lastIndexOf("\n", at - 1) + 1;
      const lineEnd = text.indexOf("\n", at);
      end = lineEnd === -1 ? text.length : lineEnd;
    } else {
      while (start > 0 && isWordCharacter(text.charAt(start - 1))) {
        start--;
      }
      while (end < text.length && isWordCharacter(text.charAt(end))) {
        end++;
      }
    }
    session.setSelection({ anchor: start, head: end });
  };

  /** YAZ-4039 D15: right-click on a pill in the editor gives the link menu. */
  const onRootContextMenu = (event: MouseEvent) => {
    const onContextMenu = app.props.hostLinks?.onContextMenu;
    if (!onContextMenu || !layout) {
      return;
    }
    const point = viewportCoordsToSceneCoords(event, app.state);
    const [localX, localY] = pointRotateRads(
      pointFrom(point.x, point.y),
      pointFrom(layout.x + layout.width / 2, layout.y + layout.height / 2),
      -layout.angle as Radians,
    );
    const line =
      layout.lines[Math.floor((localY - layout.y) / layout.lineHeightPx)];
    const relativeX = line
      ? localX -
        layout.x -
        getStyledVisualLineStart(line, layout.width, layout.textAlign)
      : 0;
    const segment = line?.segments?.find(
      (piece) =>
        piece.link &&
        relativeX >= piece.x &&
        relativeX <= piece.x + piece.width,
    );
    if (!segment?.link) {
      return;
    }
    const { inner } = segment.link;
    const shown = onContextMenu(
      {
        elementId: element.id,
        inner,
        start: segment.start,
        end: segment.end,
        rect: {
          left: event.clientX,
          top: event.clientY,
          right: event.clientX,
          bottom: event.clientY,
        },
        // the menu's click ends this edit first, so the edit goes to the box
        replace: (next) =>
          app.replaceHostLinkText(
            element.id,
            segment.start,
            segment.end,
            `[[${inner}]]`,
            next,
          ),
      },
      event,
    );
    if (shown) {
      event.preventDefault();
    }
  };

  // ---------------------------------------------------------------------------
  // the keys the engine owns, before the editor's own keys

  /** ↑ / ↓ by the lines the canvas draws. */
  const moveLine = (direction: -1 | 1, extend: boolean) => {
    if (!layout || !layout.lines.length) {
      return false;
    }
    const { lines } = layout;
    const head = selection.head;
    let index = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].start <= head) {
        index = i;
      }
    }
    const line = lines[index];
    const x =
      goalX ??
      getStyledVisualLineStart(line, layout.width, layout.textAlign) +
        getStyledVisualLineOffsetX(line, head);
    const target = lines[index + direction];
    const offset = !target
      ? direction < 0
        ? 0
        : text.length
      : getOffsetOnLine(
          target,
          x - getStyledVisualLineStart(target, layout.width, layout.textAlign),
        );
    goalX = x;
    keepGoalX = true;
    session.setSelection({
      anchor: extend ? selection.anchor : offset,
      head: offset,
    });
    keepGoalX = false;
    return true;
  };

  let submittedViaKeyboard = false;
  const onRootKeyDown = (event: KeyboardEvent) => {
    // YAZ-4039 D12: the host's open `[[` picker takes ↑, ↓, Enter and Esc
    if (app.props.hostLinks?.onEditorKeyDown?.(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
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
      return;
    }
    if (
      (event.key === KEYS.ARROW_UP || event.key === KEYS.ARROW_DOWN) &&
      !event[KEYS.CTRL_OR_CMD] &&
      !event.altKey &&
      !event.isComposing
    ) {
      if (moveLine(event.key === KEYS.ARROW_UP ? -1 : 1, event.shiftKey)) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    // YAZ-4039 D15: Backspace after a pill, or Delete before it, takes it whole
    if (
      (event.key === KEYS.BACKSPACE || event.key === KEYS.DELETE) &&
      selection.anchor === selection.head
    ) {
      const link = getLinkToDelete(
        getTextLinkRanges(text),
        selection.head,
        event.key,
      );
      if (link) {
        lastSelection = { start: link.start, end: link.end };
        session.setSelection({ anchor: link.start, head: link.end });
      }
      return;
    }
    const action =
      (!event.shiftKey &&
        [actionZoomIn, actionZoomOut, actionResetZoom].find((candidate) =>
          candidate.keyTest?.(event),
        )) ||
      [actionDecreaseFontSize, actionIncreaseFontSize].find((candidate) =>
        candidate.keyTest?.(event),
      );
    if (action) {
      event.preventDefault();
      event.stopPropagation();
      app.actionManager.executeAction(action);
      update();
    } else if (actionSaveToActiveFile.keyTest?.(event)) {
      event.preventDefault();
      handleSubmit();
      app.actionManager.executeAction(actionSaveToActiveFile);
    }
  };

  /** YAZ-4039 D12: a pasted page path or `yaseendocs://` link is a link. */
  const onRootPaste = (event: ClipboardEvent) => {
    const pastedLink = app.props.hostLinks?.pasteLink?.(
      event.clipboardData?.getData(MIME_TYPES.text).trim() ?? "",
    );
    if (pastedLink) {
      event.preventDefault();
      event.stopPropagation();
      const start = Math.min(selection.anchor, selection.head);
      const end = Math.max(selection.anchor, selection.head);
      session.replaceText(start, end, pastedLink);
    }
  };

  // ---------------------------------------------------------------------------
  // the end of the edit

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
      // a click on the board ends the edit, the frame after
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
    root.removeEventListener("click", onRootClick);
    root.removeEventListener("contextmenu", onRootContextMenu);
    root.removeEventListener("keydown", onRootKeyDown, true);
    root.removeEventListener("paste", onRootPaste, true);
    root.removeEventListener("focusout", onRootFocusOut);
    window.removeEventListener("pointerdown", onWindowPointerDown, true);
    window.removeEventListener("pointerup", bindBlurEvent);
    window.removeEventListener("blur", handleSubmit);
    window.removeEventListener("beforeunload", handleSubmit);
    unbindUpdate();
    unbindScroll();
    unbindChange();
    observer?.disconnect();
    app.props.hostLinks?.onEditorChange?.(null);
    if (openEditor === opened) {
      openEditor = null;
    }
    session.destroy();
    root.remove();
    overlay.remove();
  };

  root.addEventListener("pointerdown", onRootPointerDown);
  root.addEventListener("click", onRootClick);
  root.addEventListener("contextmenu", onRootContextMenu);
  root.addEventListener("keydown", onRootKeyDown, true);
  root.addEventListener("paste", onRootPaste, true);
  root.addEventListener("focusout", onRootFocusOut);
  // the pointerdown that started the edit is not one to end it
  requestAnimationFrame(() => {
    if (!isDestroyed) {
      window.addEventListener("pointerdown", onWindowPointerDown, true);
    }
  });
  window.addEventListener("beforeunload", handleSubmit);
  const opened = {
    focus: () => session.focus(),
    pauseBlur: (duration: number) => {
      if (!submitOnBlur) {
        return;
      }
      submitOnBlur = false;
      setTimeout(() => {
        if (!isDestroyed) {
          submitOnBlur = true;
        }
      }, duration);
    },
  };
  openEditor = opened;
  const editorContainer = excalidrawContainer?.querySelector(
    ".excalidraw-textEditorContainer",
  );
  editorContainer?.appendChild(root);
  editorContainer?.appendChild(overlay);
  update();
  bindBlurEvent();

  return handleSubmit;
};
