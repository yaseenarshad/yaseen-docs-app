import {
  CLASSES,
  KEYS,
  MIME_TYPES,
  POINTER_BUTTON,
  THEME,
  applyDarkModeFilter,
  getFontString,
  isDarwin,
  isTestEnv,
  isWritableElement,
  viewportCoordsToSceneCoords,
} from "@excalidraw/common";
import { pointFrom, pointRotateRads, type Radians } from "@excalidraw/math";

import {
  getContainerElement,
  getFoldedLines,
  getHiddenLines,
  getLineHeightInPx,
  getStyledVisualLineOffsetX,
  getStyledVisualLineStart,
  getStyledVisualSelectionGeometry,
  getTextElementAngle,
  getTextElementStyledLines,
  getTextLayoutMaxWidth,
  getTextLinkRanges,
  getToggledFoldedLines,
  hasTextList,
  isFoldableLine,
  isTextElement,
  parseTextListLine,
} from "@excalidraw/element";

import type { StyledVisualLine } from "@excalidraw/element";

import type {
  ExcalidrawTextContainer,
  ExcalidrawTextElement,
  NonDeleted,
} from "@excalidraw/element/types";

import { actionSaveToActiveFile } from "../actions";
import {
  actionClearSelectedTextFormatting,
  actionDecreaseFontSize,
  actionIncreaseFontSize,
} from "../actions/actionProperties";
import { textFieldKeyFor } from "../keyRemap";
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

/**
 * Puts a 1 px node over a rectangle in board px, by a transform. The overlay
 * is scaled by the zoom, and layout snaps a box's edges to whole board px: at
 * 3000% a 0.05 px caret drew 0 or 30 px wide. A transform is never snapped.
 */
const placeOverlayRect = (
  node: HTMLElement,
  rect: Readonly<{ left: number; top: number; width: number; height: number }>,
) =>
  Object.assign(node.style, {
    position: "absolute",
    left: "0",
    top: "0",
    width: "1px",
    height: "1px",
    transformOrigin: "0 0",
    transform: `translate(${rect.left}px, ${rect.top}px) scale(${rect.width}, ${rect.height})`,
  });

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

/** A letter of a word, for a double click. */
const isWordCharacter = (character: string) =>
  /[\p{L}\p{M}\p{N}_]/u.test(character);

/** A press this soon and this near (screen px) to the last one adds a click. */
const MULTI_CLICK_MS = 500;
const MULTI_CLICK_PX = 4;
/**
 * A press on the board this near (screen px) to the box in edit goes to the
 * box. Zoomed out, the box is a few px tall: a press just past its edge took
 * the board, which ended the edit, and the next press started a new one.
 */
const NEAR_BOX_PX = 8;

/** The word at `at`: its letters, or the one other character there. */
const getWordRange = (text: string, at: number): [number, number] => {
  let start = at;
  let end = at;
  while (start > 0 && isWordCharacter(text.charAt(start - 1))) {
    start--;
  }
  while (end < text.length && isWordCharacter(text.charAt(end))) {
    end++;
  }
  if (start === end && end < text.length && text.charAt(end) !== "\n") {
    end++;
  }
  return [start, end];
};

/**
 * The line at `at`, without its newline. A list item's line starts after its
 * indent and marker (`•`, `○`, `▪`, `☐`, `☑`, `1.`), as a note selects it.
 */
const getLineRange = (text: string, at: number): [number, number] => {
  const lineStart = text.lastIndexOf("\n", at - 1) + 1;
  const newline = text.indexOf("\n", at);
  const lineEnd = newline === -1 ? text.length : newline;
  const parsed = parseTextListLine(text.slice(lineStart, lineEnd));
  return [
    parsed.markerKind === "none" ? lineStart : lineEnd - parsed.content.length,
    lineEnd,
  ];
};

/**
 * The parts of a selection on letters, one per line: never an item's indent
 * or marker (demo round 2: "only the text and not all the way to the
 * bullet"). Empty for a caret.
 */
const getLetterRanges = (
  text: string,
  from: number,
  to: number,
): [number, number][] => {
  const ranges: [number, number][] = [];
  let at = from;
  while (at < to) {
    const [contentStart, lineEnd] = getLineRange(text, at);
    const start = Math.max(at, contentStart);
    const end = Math.min(to, lineEnd);
    if (end > start) {
      ranges.push([start, end]);
    }
    at = lineEnd + 1;
  }
  return ranges;
};

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
  // The invisible editor can lay out far bigger than the box (a tiny font:
  // the notes' px spacing, Chrome's minimum font size), so its caret sits off
  // screen and the browser scrolled the board's layers to it on each key.
  // Fixed, its scroll chain skips them: nothing scrolls (YAZ-4277 demo).
  root.style.position = "fixed";

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
  /** The styles last written on the root and the overlay: a key that moves nothing writes none (YAZ-4312 S5). */
  let lastStyles = "";
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
    const geometryOf = (selectionStart: number, selectionEnd: number) =>
      getStyledVisualSelectionGeometry({
        lines: layout!.lines,
        containerWidth: layout!.width,
        textAlign: layout!.textAlign,
        lineHeightPx: layout!.lineHeightPx,
        selectionStart,
        selectionEnd,
      });
    const geometry = geometryOf(selection.anchor, selection.head);
    // a selection covers letters only: one part per line, from after its
    // indent and marker (demo round 2)
    const rectangles =
      selection.anchor === selection.head
        ? []
        : getLetterRanges(
            text,
            Math.min(selection.anchor, selection.head),
            Math.max(selection.anchor, selection.head),
          ).flatMap(([start, end]) => geometryOf(start, end).rectangles);
    for (const rectangle of rectangles) {
      const span = document.createElement("span");
      span.className = "excalidraw-wysiwyg-selection";
      placeOverlayRect(span, rectangle);
      overlay.appendChild(span);
    }
    if (geometry.caret) {
      // a new caret each time, so its blink starts again where it moved to
      const caret = document.createElement("span");
      caret.className = "excalidraw-wysiwyg-caret";
      placeOverlayRect(caret, {
        ...geometry.caret,
        width: getCaretWidth(app.state.zoom.value),
      });
      caret.style.backgroundColor = layout.color;
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
    const overlayStyle = { ...box, opacity: `${current.opacity / 100}` };
    // YAZ-4277 D1: the editor lays out its lines near the canvas ones; the
    // engine never reads them (a click and ↑ / ↓ use the canvas layout)
    const rootStyle = {
      ...box,
      left: `${viewportX + app.state.offsetLeft}px`,
      top: `${viewportY + app.state.offsetTop}px`,
      width: `${maxWidth === Infinity ? current.width : maxWidth}px`,
      font: getFontString(current),
      lineHeight: `${lineHeightPx}px`,
      textAlign: current.textAlign,
      whiteSpace: maxWidth === Infinity ? "pre" : "pre-wrap",
      overflowWrap: "break-word",
    };
    const styles = [
      ...Object.values(overlayStyle),
      ...Object.values(rootStyle),
    ].join("\n");
    if (styles !== lastStyles) {
      lastStyles = styles;
      Object.assign(overlay.style, overlayStyle);
      Object.assign(root.style, rootStyle);
    }
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

  /**
   * YAZ-4277 demo: the screen box of the caret at `offset`, from the canvas
   * layout. The editor's pop-up toolbar and `/` menu anchor here: its own
   * invisible layout drifts from the canvas (far right at 3000%).
   */
  const getClientRectAt = (offset: number) => {
    if (!layout) {
      return null;
    }
    const { caret } = getStyledVisualSelectionGeometry({
      lines: layout.lines,
      containerWidth: layout.width,
      textAlign: layout.textAlign,
      lineHeightPx: layout.lineHeightPx,
      selectionStart: offset,
      selectionEnd: offset,
    });
    if (!caret) {
      return null;
    }
    // the browser turns the box's zoom and rotation into screen px
    const probe = document.createElement("span");
    placeOverlayRect(probe, {
      ...caret,
      width: getCaretWidth(app.state.zoom.value),
    });
    probe.style.visibility = "hidden";
    overlay.appendChild(probe);
    const box = probe.getBoundingClientRect();
    probe.remove();
    return {
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
    };
  };

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

  /**
   * YAZ-4306: a caret or a selection end in a line a fold hides goes on to the
   * first place shown, the way it moved: forward to the line after the fold,
   * back to the end of the folded bullet. True when it moved the selection.
   */
  const keepCaretOutOfFolds = (
    next: HostTextSelection,
    previousHead: number,
  ) => {
    const current = getElement();
    const hidden = current ? getHiddenLines(current, text) : null;
    if (!hidden) {
      return false;
    }
    const lineOf = (offset: number) => {
      let line = 0;
      for (
        let i = text.indexOf("\n");
        i !== -1 && i < offset;
        i = text.indexOf("\n", i + 1)
      ) {
        line++;
      }
      return line;
    };
    const lines = text.split("\n");
    const lineStart = (line: number) =>
      lines.slice(0, line).reduce((sum, value) => sum + value.length + 1, 0);
    const shown = (offset: number, forward: boolean) => {
      let line = lineOf(offset);
      if (!hidden.has(line)) {
        return offset;
      }
      while (hidden.has(line)) {
        line += forward ? 1 : -1;
      }
      if (line >= lines.length) {
        // nothing shown after the fold: the end of the folded bullet
        line = lineOf(offset);
        while (hidden.has(line)) {
          line--;
        }
        forward = false;
      }
      return forward ? lineStart(line) : lineStart(line) + lines[line].length;
    };
    const head = shown(next.head, next.head >= previousHead);
    const anchor =
      next.anchor === next.head
        ? head
        : shown(next.anchor, next.anchor >= next.head);
    if (head === next.head && anchor === next.anchor) {
      return false;
    }
    session.setSelection({ anchor, head });
    return true;
  };

  /** The folds the editor knows, so a fold the engine makes is sent only once. */
  let folds = getFoldedLines(element);

  const session = textEditor.mount({
    root,
    clientRectAt: (offset) => getClientRectAt(offset),
    text,
    textRuns: element.textRuns,
    foldedLines: folds,
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
      // the scene update of this change has drawn the caret and the selection
      reportEditor(true);
    },
    onFoldsChange: (nextFolds) => {
      if (isDestroyed) {
        return;
      }
      // folding off (YAZ-4277 demo): the note's ⌘↑ in the box folds nothing
      if (app.isFoldingOff() && nextFolds.length) {
        session.setFolds(folds);
        return;
      }
      // D3: no undo step; the box resizes to its visible lines
      folds = nextFolds;
      app.setTextFolds(element.id, nextFolds);
    },
    onSelectionChange: (next) => {
      const previousHead = selection.head;
      selection = next;
      if (
        keepCaretOutOfLinks(next) ||
        keepCaretOutOfFolds(next, previousHead)
      ) {
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
  /** After a double or a triple click: the drag goes by words or by lines. */
  let dragUnit: { range: [number, number]; of: typeof getWordRange } | null =
    null;
  /** The last press, for the click count (Chromium's pointerdown has none). */
  let lastPress: { time: number; x: number; y: number; count: number } | null =
    null;
  const onDragMove = (event: PointerEvent) => {
    const offset = getOffsetAt(viewportCoordsToSceneCoords(event, app.state));
    if (offset === null) {
      return;
    }
    if (dragUnit) {
      // the first word (or line) stays selected; a move inside it changes
      // nothing, so a shaky hand keeps the double click
      const [start, end] = dragUnit.range;
      const [nextStart, nextEnd] = dragUnit.of(text, offset);
      session.setSelection(
        nextStart >= start
          ? { anchor: start, head: Math.max(end, nextEnd) }
          : { anchor: end, head: nextStart },
      );
      return;
    }
    if (dragAnchor !== null) {
      session.setSelection({ anchor: dragAnchor, head: offset });
    }
  };
  const stopDrag = () => {
    dragAnchor = null;
    dragUnit = null;
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", stopDrag);
    window.removeEventListener("pointercancel", stopDrag);
  };
  /**
   * YAZ-4306, YAZ-4307: a click on this box's fold arrow folds or unfolds,
   * keeps the edit and the caret. True when it was one.
   */
  const toggleFoldAt = (event: MouseEvent) => {
    const hit = app.getFoldArrowTargetAt(
      viewportCoordsToSceneCoords(event, app.state),
    );
    const current = getElement();
    if (!hit?.onArrow || hit.elementId !== element.id || !current) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    app.setTextFolds(element.id, getToggledFoldedLines(current, hit.line));
    folds = getFoldedLines(getElement() ?? current);
    session.setFolds(folds);
    return true;
  };

  const onRootPointerDown = (event: PointerEvent) => {
    event.stopPropagation();
    if (
      event.button !== POINTER_BUTTON.MAIN &&
      event.button !== POINTER_BUTTON.TOUCH
    ) {
      return;
    }
    if (toggleFoldAt(event)) {
      return;
    }
    const offset = getOffsetAt(viewportCoordsToSceneCoords(event, app.state));
    if (offset === null) {
      return;
    }
    event.preventDefault();
    stopDrag();
    session.focus();
    const count =
      !event.shiftKey &&
      lastPress &&
      event.timeStamp - lastPress.time <= MULTI_CLICK_MS &&
      Math.hypot(event.clientX - lastPress.x, event.clientY - lastPress.y) <=
        MULTI_CLICK_PX
        ? Math.min(lastPress.count + 1, 3)
        : 1;
    lastPress = {
      time: event.timeStamp,
      x: event.clientX,
      y: event.clientY,
      count,
    };
    if (count > 1) {
      // a double click selects the word, a triple click the line, at the
      // press, as in a note
      const of = count === 2 ? getWordRange : getLineRange;
      const range = of(text, offset);
      dragUnit = { range, of };
      session.setSelection({ anchor: range[0], head: range[1] });
    } else {
      dragAnchor = event.shiftKey ? selection.anchor : offset;
      session.setSelection({ anchor: dragAnchor, head: offset });
    }
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("pointercancel", stopDrag);
  };

  /**
   * YAZ-4429: a click goes no further than the root. The editor's own nodes
   * (a list label, a fold chevron, a bullet that zooms) are invisible and
   * laid out at their own size; the press already placed the caret.
   */
  const onRootClick = (event: MouseEvent) => {
    event.stopPropagation();
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
  const moveLine = (direction: -1 | 1) => {
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
    session.setSelection({ anchor: offset, head: offset });
    keepGoalX = false;
    return true;
  };

  /**
   * D37, as amended in demo round 2 ("only select the line"): ⇧↓ moves the
   * head to the end of its line, or, at the end already, to the end of the
   * next shown line; ⇧↑ to the start of its line's text (after an item's
   * marker), or, there already, to the start of the previous shown line's
   * text. A line is the text between two newlines. The head never stops at a
   * line's start for ⇧↓ nor at its end for ⇧↑, so a selection never takes the
   * next line's indent or marker. A press toward the anchor never goes past it.
   */
  const extendByLine = (direction: -1 | 1) => {
    const { anchor, head } = selection;
    const [start, end] = getLineRange(text, head);
    const toward = direction > 0 ? anchor > head : anchor < head;
    let next: number;
    if (direction > 0 && head < end) {
      next = end;
    } else if (direction < 0 && head > start) {
      next = start;
    } else {
      const lines = text.split("\n");
      const current = getElement();
      const hidden = current ? getHiddenLines(current, text) : null;
      let line = text.slice(0, head).split("\n").length - 1 + direction;
      while (hidden?.has(line)) {
        line += direction;
      }
      if (line < 0 || line >= lines.length) {
        if (!toward) {
          return;
        }
        next = anchor;
      } else {
        const lineStart = lines
          .slice(0, line)
          .reduce((sum, value) => sum + value.length + 1, 0);
        const [targetStart, targetEnd] = getLineRange(text, lineStart);
        next = direction > 0 ? targetEnd : targetStart;
      }
    }
    if (toward && (direction > 0 ? next > anchor : next < anchor)) {
      next = anchor;
    }
    session.setSelection({ anchor, head: next });
  };

  /**
   * ⌘← / ⌘→ to the start or the end of the line the canvas draws (the
   * editor's own, unseen lines are not the drawn ones); the start of an
   * item's first line is after its bullet. ⌘↑ / ⌘↓ never leave the caret's
   * line (D35: between two newlines, over all its drawn lines): ⌘↑ to its
   * start, after an item's marker, and ⌘↓ to its end. On an item that folds
   * the note keys fold it instead (D9). ⇧ extends (⌘⇧↑ / ⌘⇧↓ never come
   * here, D37). False: not one of these keys here.
   */
  const moveToEdge = (key: string, extend: boolean) => {
    if (!layout || !layout.lines.length) {
      return false;
    }
    const head = selection.head;
    let offset: number;
    if (key === KEYS.ARROW_UP || key === KEYS.ARROW_DOWN) {
      const lineIndex = text.slice(0, head).split("\n").length - 1;
      if (isFoldableLine(text, lineIndex)) {
        return false;
      }
      // D35: each line is a unit (Yaseen)
      const [contentStart, lineEnd] = getLineRange(text, head);
      offset = key === KEYS.ARROW_UP ? contentStart : lineEnd;
    } else if (key === KEYS.ARROW_LEFT || key === KEYS.ARROW_RIGHT) {
      const { lines } = layout;
      let index = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].start <= head) {
          index = i;
        }
      }
      const line = lines[index];
      offset = line.end;
      if (key === KEYS.ARROW_LEFT) {
        offset = line.start;
        if (line.start === 0 || text.charAt(line.start - 1) === "\n") {
          const lineEnd = text.indexOf("\n", line.start);
          const { raw, content } = parseTextListLine(
            text.slice(line.start, lineEnd === -1 ? text.length : lineEnd),
          );
          offset = Math.min(line.start + raw.length - content.length, line.end);
        }
      }
    } else {
      return false;
    }
    session.setSelection({
      anchor: extend ? selection.anchor : offset,
      head: offset,
    });
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
    // D37: ⌘⇧↑ / ⌘⇧↓ do nothing in the box: Yaseen's window tool owns them
    if (
      event[KEYS.CTRL_OR_CMD] &&
      event.shiftKey &&
      (event.key === KEYS.ARROW_UP || event.key === KEYS.ARROW_DOWN)
    ) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (
      isDarwin &&
      event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.isComposing &&
      moveToEdge(event.key, event.shiftKey)
    ) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (
      (event.key === KEYS.ARROW_UP || event.key === KEYS.ARROW_DOWN) &&
      !event[KEYS.CTRL_OR_CMD] &&
      !event.altKey &&
      !event.isComposing
    ) {
      const direction = event.key === KEYS.ARROW_UP ? -1 : 1;
      if (event.shiftKey) {
        // D37: consumed even when nothing changes, as the note's key is
        extendByLine(direction);
        event.preventDefault();
        event.stopPropagation();
      } else if (moveLine(direction)) {
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
    // YAZ-4345 (D15): ⌘\ (or the user's key for it) resets the selected
    // letters to the box's own style
    if (
      textFieldKeyFor(actionClearSelectedTextFormatting.name, event) ??
      actionClearSelectedTextFormatting.keyTest?.(
        event,
        app.state,
        app.scene.getElementsIncludingDeleted(),
      )
    ) {
      event.preventDefault();
      event.stopPropagation();
      session.clearLetterStyles();
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
    // YAZ-4430: the board closed; each change is already in its scene
    if (app.unmounted) {
      return;
    }
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

  /**
   * True when the press is within `NEAR_BOX_PX` on screen of the box, on this
   * board (YAZ-4430: never a press on another board).
   */
  const isNearBox = (event: MouseEvent) => {
    if (
      !layout ||
      !excalidrawContainer?.contains(event.target as Node | null)
    ) {
      return false;
    }
    const point = viewportCoordsToSceneCoords(event, app.state);
    const [localX, localY] = pointRotateRads(
      pointFrom(point.x, point.y),
      pointFrom(layout.x + layout.width / 2, layout.y + layout.height / 2),
      -layout.angle as Radians,
    );
    const reach = NEAR_BOX_PX / app.state.zoom.value;
    return (
      localX >= layout.x - reach &&
      localX <= layout.x + layout.width + reach &&
      localY >= layout.y - reach &&
      localY <= layout.y + layout.height + reach
    );
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
    } else if (target instanceof HTMLCanvasElement && toggleFoldAt(event)) {
      // a fold arrow of this box: the edit goes on
    } else if (target instanceof HTMLCanvasElement && isNearBox(event)) {
      // just past the box's edge: a click, a double or a triple click in it
      onRootPointerDown(event as PointerEvent);
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

  /** The scroll of each `overflow: hidden` layer above the editor, at the edit's start. */
  const fixedLayers = new Map<HTMLElement, readonly [number, number]>();
  const keepLayersInPlace = (event: Event) => {
    const layer = event.target as HTMLElement;
    const at = fixedLayers.get(layer);
    if (at && (layer.scrollLeft !== at[0] || layer.scrollTop !== at[1])) {
      layer.scrollLeft = at[0];
      layer.scrollTop = at[1];
    }
  };

  const cleanup = () => {
    stopDrag();
    root.removeEventListener("pointerdown", onRootPointerDown, true);
    root.removeEventListener("click", onRootClick, true);
    root.removeEventListener("contextmenu", onRootContextMenu);
    root.removeEventListener("keydown", onRootKeyDown, true);
    root.removeEventListener("paste", onRootPaste, true);
    root.removeEventListener("focusout", onRootFocusOut);
    window.removeEventListener("pointerdown", onWindowPointerDown, true);
    window.removeEventListener("pointerup", bindBlurEvent);
    window.removeEventListener("blur", handleSubmit);
    window.removeEventListener("beforeunload", handleSubmit);
    document.removeEventListener("scroll", keepLayersInPlace, true);
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

  // YAZ-4429: before the editor's own nodes, which may stop the press
  root.addEventListener("pointerdown", onRootPointerDown, true);
  root.addEventListener("click", onRootClick, true);
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
  // the board's layers never scroll: a browser reveal of the invisible,
  // zoomed editor (a click under the box at 1665%) moved them up the window
  for (
    let layer = root.parentElement;
    layer && layer !== document.body;
    layer = layer.parentElement
  ) {
    const { overflowX, overflowY } = getComputedStyle(layer);
    if (/hidden|clip/.test(overflowX + overflowY)) {
      fixedLayers.set(layer, [layer.scrollLeft, layer.scrollTop]);
    }
  }
  document.addEventListener("scroll", keepLayersInPlace, true);
  update();
  bindBlurEvent();

  return handleSubmit;
};
