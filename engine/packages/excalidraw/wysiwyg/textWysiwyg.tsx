import {
  CODES,
  KEYS,
  CLASSES,
  POINTER_BUTTON,
  THEME,
  isWritableElement,
  getFontString,
  getFontFamilyString,
  isTestEnv,
  MIME_TYPES,
  applyDarkModeFilter,
  isRTL,
  viewportCoordsToSceneCoords,
} from "@excalidraw/common";
import { pointFrom, pointRotateRads, type Radians } from "@excalidraw/math";

import {
  getTextFromElements,
  originalContainerCache,
  updateBoundElements,
  updateOriginalContainerCache,
} from "@excalidraw/element";

import { LinearElementEditor } from "@excalidraw/element";
import { bumpVersion } from "@excalidraw/element";
import {
  getBoundTextElementId,
  getContainerElement,
  getTextElementAngle,
  redrawTextBoundingBox,
  getBoundTextMaxHeight,
  getBoundTextMaxWidth,
  getTextLayoutMaxWidth,
  computeContainerDimensionForBoundText,
  computeBoundTextPosition,
  getBoundTextElement,
} from "@excalidraw/element";
import { getTextWidth } from "@excalidraw/element";
import { getLineHeightInPx } from "@excalidraw/element";
import {
  getTextBackgroundGeometry,
  getStyledVisualLineOffsetX,
  getStyledVisualLineStart,
  getStyledVisualSelectionGeometry,
  getLogicalLineIndexAtOffset,
  getTextElementStyledLines,
  getTextLinkRanges,
  getTextRangeToolbarKey,
  hasHostLinks,
  getTextHighlightFill,
  getInsertedTextRange,
  getTextRunsInRange,
  remapTextRunsForTextEdit,
  setPastedTextRuns,
} from "@excalidraw/element";

import { normalizeText } from "@excalidraw/element";
import { wrapText } from "@excalidraw/element";
import {
  isArrowElement,
  isBoundToContainer,
  isTextElement,
} from "@excalidraw/element";

import type { StyledVisualLine } from "@excalidraw/element";

import type {
  ExcalidrawLinearElement,
  ExcalidrawTextElementWithContainer,
  ExcalidrawTextElement,
  NonDeleted,
  ExcalidrawTextContainer,
  ExcalidrawTextRun,
} from "@excalidraw/element/types";

import { actionSaveToActiveFile } from "../actions";

import {
  parseClipboard,
  parseDataTransferEvent,
  parseDataTransferEventMimeTypes,
} from "../clipboard";
import {
  actionDecreaseFontSize,
  actionIncreaseFontSize,
  actionToggleTextBold,
  actionToggleTextHighlight,
  actionToggleTextItalic,
  actionToggleTextStrikethrough,
  actionToggleTextUnderline,
} from "../actions/actionProperties";
import {
  actionResetZoom,
  actionZoomIn,
  actionZoomOut,
} from "../actions/actionCanvas";

import {
  continueTextListItem,
  formatPastedTextForList,
  getBulletMarkerForDepth,
  getTextListMode,
  indentTextList,
  normalizeTextLists,
  parseTextListLine,
} from "../textList";

import { getPendingTextStyle, takePendingTextStyle } from "./pendingTextStyle";
import { textFieldKeyFor } from "../keyRemap";

import { getStyledHtml, parseStyledHtml } from "./styledClipboard";
import {
  createLinkPillOverlay,
  getLinkToDelete,
  isInsideLink,
  keepLinksWhole,
} from "./linkPill";

import type { ParsedDataTranferList } from "../clipboard";
import type App from "../components/App";
import type { AppState } from "../types";

const getTransform = (
  width: number,
  height: number,
  angle: number,
  appState: AppState,
  maxWidth: number,
  maxHeight: number,
) => {
  const { zoom } = appState;
  const degree = (180 * angle) / Math.PI;
  let translateX = (width * (zoom.value - 1)) / 2;
  let translateY = (height * (zoom.value - 1)) / 2;
  if (width > maxWidth && zoom.value !== 1) {
    translateX = (maxWidth * (zoom.value - 1)) / 2;
  }
  if (height > maxHeight && zoom.value !== 1) {
    translateY = (maxHeight * (zoom.value - 1)) / 2;
  }
  return `translate(${translateX}px, ${translateY}px) scale(${zoom.value}) rotate(${degree}deg)`;
};

const getLineDirection = (text: string, offset: number) => {
  const hardLineStart = text.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const hardLineEnd = text.indexOf("\n", offset);
  const hardLineText = text.slice(
    hardLineStart,
    hardLineEnd === -1 ? text.length : hardLineEnd,
  );

  return isRTL(hardLineText) ? "rtl" : "ltr";
};

const getCaretBoundaryOffsets = (text: string) => {
  const offsets = [0];
  let offset = 0;

  for (const char of Array.from(text)) {
    offset += char.length;
    offsets.push(offset);
  }

  return offsets;
};

const getLineCaretOffsetFromNativeLayout = ({
  text,
  font,
  lineHeightPx,
  direction,
  targetX,
}: {
  text: string;
  font: ReturnType<typeof getFontString>;
  lineHeightPx: number;
  direction: "ltr" | "rtl";
  targetX: number;
}) => {
  if (!text || !document.body || typeof document.createRange !== "function") {
    return null;
  }

  const offsets = getCaretBoundaryOffsets(text);
  const mirror = document.createElement("div");
  const textNode = document.createTextNode(text);
  const range = document.createRange();
  const positions: number[] = [];

  mirror.dir = direction;
  Object.assign(mirror.style, {
    position: "fixed",
    top: "0",
    left: "0",
    margin: 0,
    padding: 0,
    border: 0,
    opacity: "0",
    pointerEvents: "none",
    whiteSpace: "pre",
    font,
    lineHeight: `${lineHeightPx}px`,
  });
  mirror.append(textNode);
  document.body.append(mirror);

  try {
    for (const offset of offsets) {
      range.setStart(textNode, offset);
      range.setEnd(textNode, offset);
      const caretRect = range.getBoundingClientRect();

      if (!Number.isFinite(caretRect.left)) {
        return null;
      }

      positions.push(caretRect.left);
    }
  } catch {
    return null;
  } finally {
    mirror.remove();
  }

  const leftEdge = Math.min(...positions);
  let closestOffset = offsets[0];
  let closestDistance = Infinity;

  for (let index = 0; index < offsets.length; index++) {
    const distance = Math.abs(positions[index] - leftEdge - targetX);

    if (distance < closestDistance) {
      closestDistance = distance;
      closestOffset = offsets[index];
    }
  }

  return closestOffset;
};

type SubmitHandler = () => void;

export const textWysiwyg = ({
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
  /**
   * textWysiwyg only deals with `originalText`
   *
   * Note: `text`, which can be wrapped and therefore different from `originalText`,
   *       is derived from `originalText`
   */
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
}): SubmitHandler => {
  let currentTextLayout: {
    angle: Radians;
    elementWidth: number;
    font: ReturnType<typeof getFontString>;
    height: number;
    lineHeightPx: number;
    textAlign: ExcalidrawTextElement["textAlign"];
    width: number;
    x: number;
    y: number;
    color: string;
    hasVisualLineOverlay: boolean;
    visualLines: readonly StyledVisualLine[];
  } | null = null;

  const textPropertiesUpdated = (
    updatedTextElement: ExcalidrawTextElement,
    editable: HTMLTextAreaElement,
  ) => {
    if (!editable.style.fontFamily || !editable.style.fontSize) {
      return false;
    }
    const currentFont = editable.style.fontFamily.replace(/"/g, "");
    if (
      getFontFamilyString({ fontFamily: updatedTextElement.fontFamily }) !==
      currentFont
    ) {
      return true;
    }
    if (`${updatedTextElement.fontSize}px` !== editable.style.fontSize) {
      return true;
    }
    if (
      (updatedTextElement.fontWeight ?? "normal") !==
      (editable.style.fontWeight || "normal")
    ) {
      return true;
    }
    return false;
  };

  let LAST_THEME = app.state.theme;

  const updateWysiwygStyle = () => {
    LAST_THEME = app.state.theme;

    const appState = app.state;
    const updatedTextElement = app.scene.getElement<
      NonDeleted<ExcalidrawTextElement>
    >(element.id);

    if (!updatedTextElement) {
      return;
    }
    const { textAlign, verticalAlign } = updatedTextElement;
    const elementsMap = app.scene.getNonDeletedElementsMap();
    if (updatedTextElement && isTextElement(updatedTextElement)) {
      let coordX = updatedTextElement.x;
      let coordY = updatedTextElement.y;
      const container = getContainerElement<
        NonDeleted<ExcalidrawTextElement>,
        NonDeleted<ExcalidrawTextContainer>
      >(updatedTextElement, app.scene.getNonDeletedElementsMap());

      let width = updatedTextElement.width;

      // set to element height by default since that's
      // what is going to be used for unbounded text
      let height = updatedTextElement.height;

      let maxWidth = updatedTextElement.width;
      let maxHeight = updatedTextElement.height;

      if (container && updatedTextElement.containerId) {
        if (isArrowElement(container)) {
          const boundTextCoords =
            LinearElementEditor.getBoundTextElementPosition(
              container,
              updatedTextElement as ExcalidrawTextElementWithContainer,
              elementsMap,
            );
          coordX = boundTextCoords.x;
          coordY = boundTextCoords.y;
        }
        const propertiesUpdated = textPropertiesUpdated(
          updatedTextElement,
          editable,
        );

        let originalContainerData;
        if (propertiesUpdated) {
          originalContainerData = updateOriginalContainerCache(
            container.id,
            container.height,
          );
        } else {
          originalContainerData = originalContainerCache[container.id];
          if (!originalContainerData) {
            originalContainerData = updateOriginalContainerCache(
              container.id,
              container.height,
            );
          }
        }

        maxWidth = getBoundTextMaxWidth(container, updatedTextElement);
        maxHeight = getBoundTextMaxHeight(
          container,
          updatedTextElement as ExcalidrawTextElementWithContainer,
        );

        // autogrow container height if text exceeds
        if (!isArrowElement(container) && height > maxHeight) {
          const targetContainerHeight = computeContainerDimensionForBoundText(
            height,
            container.type,
          );

          app.scene.mutateElement(container, { height: targetContainerHeight });
          updateBoundElements(container, app.scene);
          return;
        } else if (
          // autoshrink container height until original container height
          // is reached when text is removed
          !isArrowElement(container) &&
          container.height > originalContainerData.height &&
          height < maxHeight
        ) {
          const targetContainerHeight = computeContainerDimensionForBoundText(
            height,
            container.type,
          );
          app.scene.mutateElement(container, { height: targetContainerHeight });
          updateBoundElements(container, app.scene);
        } else {
          const { x, y } = computeBoundTextPosition(
            container,
            updatedTextElement as ExcalidrawTextElementWithContainer,
            elementsMap,
          );
          coordX = x;
          coordY = y;
        }
      }
      const [viewportX, viewportY] = getViewportCoords(coordX, coordY);

      if (!container) {
        maxWidth = (appState.width - 8 - viewportX) / appState.zoom.value;
        if (updatedTextElement.autoResize) {
          width = Math.min(width, maxWidth);
        }
      } else {
        width += 0.5;
      }

      // add 5% buffer otherwise it causes wysiwyg to jump
      height *= 1.05;

      const font = getFontString(updatedTextElement);
      const angle = getTextElementAngle(updatedTextElement, container);
      const lineHeightPx = getLineHeightInPx(
        updatedTextElement.fontSize,
        updatedTextElement.lineHeight,
      );
      // Make sure text editor height doesn't go beyond viewport
      const editorMaxHeight =
        (appState.height - viewportY) / appState.zoom.value;
      const transform = getTransform(
        width,
        height,
        angle,
        appState,
        maxWidth,
        editorMaxHeight,
      );
      const color = applyDarkModeFilter(
        updatedTextElement.strokeColor,
        appState.theme === THEME.DARK,
      );
      const background = getTextBackgroundGeometry(updatedTextElement);
      if (background) {
        Object.assign(textBackgroundOverlay.style, {
          display: "block",
          width: `${updatedTextElement.width}px`,
          height: `${updatedTextElement.height}px`,
          left: `${viewportX}px`,
          top: `${viewportY}px`,
          transform: getTransform(
            updatedTextElement.width,
            updatedTextElement.height,
            angle,
            appState,
            updatedTextElement.width,
            updatedTextElement.height,
          ),
          opacity: updatedTextElement.opacity / 100,
        });
        Object.assign(textBackgroundFill.style, {
          left: `${background.x}px`,
          top: `${background.y}px`,
          width: `${background.width}px`,
          height: `${background.height}px`,
          borderRadius: `${background.radius}px`,
          backgroundColor: applyDarkModeFilter(
            updatedTextElement.backgroundColor,
            appState.theme === THEME.DARK,
          ),
        });
      } else {
        textBackgroundOverlay.style.display = "none";
      }
      // YAZ-3718 D1: text with runs takes the canvas width, so it reuses the
      // layout that refreshTextDimensions made on this keystroke
      const hasPerLineStyles =
        !!updatedTextElement.textRuns ||
        hasHostLinks(updatedTextElement.originalText);
      const visualLines = getTextElementStyledLines(
        updatedTextElement,
        !hasPerLineStyles
          ? whiteSpace === "pre-wrap"
            ? width
            : Infinity
          : getTextLayoutMaxWidth(updatedTextElement, container),
        editable.value,
      );
      const hasHangingIndent = visualLines.some(
        (line) => line.horizontalOffset > 0,
      );
      const hasVisualLineOverlay = hasPerLineStyles || hasHangingIndent;
      const wholeTextDecorations = [
        updatedTextElement.textDecoration === "underline" ? "underline" : null,
        updatedTextElement.strikethrough === true ? "line-through" : null,
      ].filter(Boolean);
      Object.assign(editable.style, {
        font,
        // must be defined *after* font ¯\_(ツ)_/¯
        lineHeight: updatedTextElement.lineHeight,
        width: `${width}px`,
        height: `${height}px`,
        left: `${viewportX}px`,
        top: `${viewportY}px`,
        transform,
        textAlign,
        verticalAlign,
        fontWeight: updatedTextElement.fontWeight ?? "normal",
        textDecoration: wholeTextDecorations.join(" ") || "none",
        color: hasVisualLineOverlay ? "transparent" : color,
        caretColor: hasVisualLineOverlay ? "transparent" : color,
        opacity: updatedTextElement.opacity / 100,
        maxHeight: `${editorMaxHeight}px`,
      });
      Object.assign(underlineOverlay.style, {
        width: `${width}px`,
        height: `${height}px`,
        left: `${viewportX}px`,
        top: `${viewportY}px`,
        transform,
        opacity: updatedTextElement.opacity / 100,
        maxHeight: `${editorMaxHeight}px`,
      });
      editable.classList.toggle(
        "excalidraw-wysiwyg-visual-selection",
        hasVisualLineOverlay,
      );
      currentTextLayout = {
        angle: angle as Radians,
        elementWidth: updatedTextElement.width,
        font,
        height: updatedTextElement.height,
        lineHeightPx,
        textAlign,
        width,
        x: coordX,
        y: coordY,
        color,
        hasVisualLineOverlay,
        visualLines,
      };
      underlineOverlay.replaceChildren();

      for (const [index, line] of visualLines.entries()) {
        if (!hasVisualLineOverlay || !line.text) {
          continue;
        }

        const left = getStyledVisualLineStart(line, width, textAlign);
        if (line.segments) {
          // YAZ-3718 D1: each segment with its own style, as on the canvas
          for (const segment of line.segments) {
            if (segment.link) {
              // YAZ-4039 D15: the pill stays a pill in the editor
              underlineOverlay.appendChild(
                createLinkPillOverlay(
                  segment,
                  left + segment.x,
                  index * lineHeightPx,
                  lineHeightPx,
                  appState.theme === THEME.DARK,
                ),
              );
              continue;
            }
            const styledSegment = document.createElement("span");
            styledSegment.className = [
              "excalidraw-wysiwyg-styled-line",
              segment.underlined ? "excalidraw-wysiwyg-line-underline" : "",
            ]
              .filter(Boolean)
              .join(" ");
            styledSegment.textContent = segment.text;
            Object.assign(styledSegment.style, {
              position: "absolute",
              left: `${left + segment.x}px`,
              top: `${index * lineHeightPx}px`,
              width: `${segment.width}px`,
              height: `${lineHeightPx}px`,
              color: segment.color
                ? applyDarkModeFilter(
                    segment.color,
                    appState.theme === THEME.DARK,
                  )
                : color,
              // YAZ-4102 3E: the fill behind the letters, as on the canvas
              background: segment.highlight
                ? getTextHighlightFill(segment.highlight)
                : "",
              font: segment.font,
              lineHeight: `${lineHeightPx}px`,
              textAlign: "left",
              // YAZ-4100 3C: a right-to-left segment's letters in their order
              direction: line.rtl ? "rtl" : "",
              textDecoration: [
                segment.underlined ? "underline" : null,
                segment.strikethrough ? "line-through" : null,
              ]
                .filter(Boolean)
                .join(" "),
              whiteSpace: "pre",
              zIndex: "1",
            });
            underlineOverlay.appendChild(styledSegment);
          }
          continue;
        }
        const styledLine = document.createElement("span");
        styledLine.className = [
          "excalidraw-wysiwyg-styled-line",
          line.underlined ? "excalidraw-wysiwyg-line-underline" : "",
        ]
          .filter(Boolean)
          .join(" ");
        styledLine.textContent = line.text;
        Object.assign(styledLine.style, {
          position: "absolute",
          left: `${left}px`,
          top: `${index * lineHeightPx}px`,
          width: `${line.width}px`,
          height: `${lineHeightPx}px`,
          color,
          font: line.font,
          fontWeight: line.bold ? "bold" : "normal",
          lineHeight: `${lineHeightPx}px`,
          textAlign: "left",
          textDecoration: [
            line.underlined ? "underline" : null,
            line.strikethrough ? "line-through" : null,
          ]
            .filter(Boolean)
            .join(" "),
          whiteSpace: "pre",
          zIndex: "1",
        });
        underlineOverlay.appendChild(styledLine);
      }
      renderVisualSelection();
      editable.scrollTop = 0;
      // For some reason updating font attribute doesn't set font family
      // hence updating font family explicitly for test environment
      if (isTestEnv()) {
        editable.style.fontFamily = getFontFamilyString(updatedTextElement);
      }

      app.scene.mutateElement(updatedTextElement, { x: coordX, y: coordY });
    }
  };

  const editable = document.createElement("textarea");
  const underlineOverlay = document.createElement("div");
  const textBackgroundOverlay = document.createElement("div");
  const textBackgroundFill = document.createElement("div");

  textBackgroundOverlay.className =
    "excalidraw-wysiwyg-text-background-overlay";
  textBackgroundFill.className = "excalidraw-wysiwyg-text-background";
  Object.assign(textBackgroundOverlay.style, {
    position: "absolute",
    pointerEvents: "none",
    overflow: "visible",
    transformOrigin: "center center",
    zIndex: "var(--zIndex-wysiwyg)",
  });
  Object.assign(textBackgroundFill.style, {
    position: "absolute",
    pointerEvents: "none",
  });
  textBackgroundOverlay.appendChild(textBackgroundFill);

  underlineOverlay.className = "excalidraw-wysiwyg-underlines";
  Object.assign(underlineOverlay.style, {
    position: "absolute",
    pointerEvents: "none",
    background: "transparent",
    overflow: "hidden",
    zIndex: "var(--zIndex-wysiwyg)",
  });

  editable.dir = "auto";
  editable.tabIndex = 0;
  editable.dataset.type = "wysiwyg";
  // prevent line wrapping on Safari
  editable.wrap = "off";
  editable.classList.add("excalidraw-wysiwyg");

  let whiteSpace = "pre";
  let wordBreak = "normal";

  if (isBoundToContainer(element) || !element.autoResize) {
    whiteSpace = "pre-wrap";
    wordBreak = "break-word";
  }
  Object.assign(editable.style, {
    position: "absolute",
    display: "inline-block",
    minHeight: "1em",
    backfaceVisibility: "hidden",
    margin: 0,
    padding: 0,
    border: 0,
    outline: 0,
    resize: "none",
    background: "transparent",
    overflow: "hidden",
    // must be specified because in dark mode canvas creates a stacking context
    zIndex: "var(--zIndex-wysiwyg)",
    wordBreak,
    // prevent line wrapping (`whitespace: nowrap` doesn't work on FF)
    whiteSpace,
    overflowWrap: "break-word",
    boxSizing: "content-box",
  });
  editable.value = element.originalText;
  let previousEditableValue = editable.value;
  /** YAZ-4103 3F: ⌘⇧V was pressed for the next paste: it stays plain. */
  let plainPasteKey = false;
  /** YAZ-4103 3F: the styles of a styled paste, for the input it makes. */
  let pendingPastedRuns: {
    start: number;
    text: string;
    textRuns: readonly ExcalidrawTextRun[];
  } | null = null;
  let pendingInsertedLine: number | null = null;
  /**
   * YAZ-4071 7L: letters that ⌘Z or ⌘⇧Z can bring back, with their runs: a
   * cut or replaced selection, and a styled paste. The browser's undo gives
   * back the text only. The newest are last; a few are enough.
   */
  const restorableTexts: {
    text: string;
    textRuns: readonly ExcalidrawTextRun[];
  }[] = [];
  const rememberText = (
    text: string,
    textRuns: readonly ExcalidrawTextRun[],
  ) => {
    restorableTexts.push({ text, textRuns });
    if (restorableTexts.length > 20) {
      restorableTexts.shift();
    }
  };
  /** The letters `start`..`end` of the editor, with their runs. */
  const rememberRemovedText = (start: number, end: number) => {
    const runs = (
      app.scene.getElement(element.id) as ExcalidrawTextElement | null
    )?.textRuns;
    if (runs?.length) {
      rememberText(
        editable.value.slice(start, end),
        getTextRunsInRange(runs, start, end),
      );
    }
  };
  /** A typed edit over a selection (typing, Backspace, a plain cut): a caret alone costs one check. */
  const handleBeforeInput = (event: Event) => {
    if (
      editable.selectionStart !== editable.selectionEnd &&
      !(event as InputEvent).inputType?.startsWith("history")
    ) {
      rememberRemovedText(editable.selectionStart, editable.selectionEnd);
    }
  };
  /** The letters that ⌘Z or ⌘⇧Z just brought back, if they are remembered. */
  const getRestoredText = () => {
    const { start, end } = getInsertedTextRange(
      previousEditableValue,
      editable.value,
    );
    const text = editable.value.slice(start, end);
    for (let index = restorableTexts.length - 1; index >= 0; index--) {
      if (text && restorableTexts[index].text === text) {
        return { start, text, textRuns: restorableTexts[index].textRuns };
      }
    }
    return null;
  };
  /** YAZ-4071 7D: Tab or Shift-Tab changed the start of each selected line. */
  let pendingEachLine = false;

  function renderVisualSelection() {
    underlineOverlay
      .querySelectorAll(
        ".excalidraw-wysiwyg-selection, .excalidraw-wysiwyg-caret",
      )
      .forEach((node) => node.remove());

    const layout = currentTextLayout;
    if (!layout?.hasVisualLineOverlay) {
      return;
    }

    const geometry = getStyledVisualSelectionGeometry({
      lines: layout.visualLines,
      containerWidth: layout.width,
      textAlign: layout.textAlign,
      lineHeightPx: layout.lineHeightPx,
      selectionStart: editable.selectionStart,
      selectionEnd: editable.selectionEnd,
    });

    for (const rectangle of geometry.rectangles) {
      const selection = document.createElement("span");
      selection.className = "excalidraw-wysiwyg-selection";
      Object.assign(selection.style, {
        position: "absolute",
        left: `${rectangle.left}px`,
        top: `${rectangle.top}px`,
        width: `${rectangle.width}px`,
        height: `${rectangle.height}px`,
        zIndex: "0",
      });
      underlineOverlay.appendChild(selection);
    }

    if (geometry.caret) {
      const caret = document.createElement("span");
      caret.className = "excalidraw-wysiwyg-caret";
      Object.assign(caret.style, {
        position: "absolute",
        left: `${geometry.caret.left}px`,
        top: `${geometry.caret.top}px`,
        width: "1px",
        height: `${geometry.caret.height}px`,
        backgroundColor: layout.color,
        zIndex: "2",
      });
      underlineOverlay.appendChild(caret);
    }
  }

  updateWysiwygStyle();

  /** The visual line under a scene point, and the point's x from its start. */
  const getLinePointFromSceneCoords = (sceneCoords: {
    x: number;
    y: number;
  }) => {
    if (!currentTextLayout) {
      return null;
    }

    const layout = currentTextLayout;
    const center = pointFrom(
      layout.x + layout.elementWidth / 2,
      layout.y + layout.height / 2,
    );
    const [unrotatedX, unrotatedY] = pointRotateRads(
      pointFrom(sceneCoords.x, sceneCoords.y),
      center,
      -layout.angle as Radians,
    );
    const localX = unrotatedX - layout.x;
    const localY = unrotatedY - layout.y;
    const lines = layout.visualLines;
    const lineIndex = Math.max(
      0,
      Math.min(lines.length - 1, Math.floor(localY / layout.lineHeightPx)),
    );
    const line = lines[lineIndex];
    const lineStartX = getStyledVisualLineStart(
      line,
      layout.width,
      layout.textAlign,
    );
    return { layout, line, relativeX: localX - lineStartX };
  };

  const getCaretIndexFromSceneCoords = (sceneCoords: {
    x: number;
    y: number;
  }) => {
    const point = getLinePointFromSceneCoords(sceneCoords);
    if (!point) {
      return null;
    }
    const { layout, line, relativeX } = point;
    const direction = getLineDirection(editable.value, line.start);

    if (!line.text) {
      return line.start;
    }

    if (line.segments) {
      // YAZ-3718 D1: the letter edge nearest to the click, from segment widths
      // (YAZ-4039 D15: never inside a pill)
      const links = line.segments.filter((segment) => segment.link);
      let closest = line.start;
      let closestDistance = Infinity;
      for (const offset of getCaretBoundaryOffsets(line.text)) {
        if (isInsideLink(links, line.start + offset)) {
          continue;
        }
        const distance = Math.abs(
          getStyledVisualLineOffsetX(line, line.start + offset) - relativeX,
        );
        if (distance < closestDistance) {
          closestDistance = distance;
          closest = line.start + offset;
        }
      }
      return closest;
    }

    const lineCaretOffset = getLineCaretOffsetFromNativeLayout({
      text: line.text,
      font: line.font,
      lineHeightPx: layout.lineHeightPx,
      direction,
      targetX: relativeX,
    });

    return line.start + (lineCaretOffset || 0);
  };

  const getCaretIndexFromInitialSceneCoords = () => {
    if (!initialCaretSceneCoords) {
      return null;
    }

    return getCaretIndexFromSceneCoords(initialCaretSceneCoords);
  };

  let pendingInitialSelection = (() => {
    const caretIndex = getCaretIndexFromInitialSceneCoords();

    if (caretIndex === null) {
      return null;
    }

    return {
      start: caretIndex,
      end: caretIndex,
    };
  })();

  let visualSelectionAnchor: number | null = null;
  let visualSelectionPointerId: number | null = null;

  /** YAZ-4039 D15: a caret moved into a pill goes to its edge. */
  let lastSelection = {
    start: editable.selectionStart,
    end: editable.selectionEnd,
  };
  const keepCaretOutOfLinks = () => {
    const links = getTextLinkRanges(editable.value);
    if (links.length) {
      const next = keepLinksWhole(
        links,
        { start: editable.selectionStart, end: editable.selectionEnd },
        lastSelection,
      );
      if (
        next.start !== editable.selectionStart ||
        next.end !== editable.selectionEnd
      ) {
        editable.setSelectionRange(
          next.start,
          next.end,
          editable.selectionDirection,
        );
      }
    }
    lastSelection = {
      start: editable.selectionStart,
      end: editable.selectionEnd,
    };
  };

  /** The caret's box on screen, for the host's `[[` picker. */
  const getCaretClientRect = () => {
    const box = editable.getBoundingClientRect();
    const zoom = app.state.zoom.value;
    const layout = currentTextLayout;
    const caret = layout
      ? getStyledVisualSelectionGeometry({
          lines: layout.visualLines,
          containerWidth: layout.width,
          textAlign: layout.textAlign,
          lineHeightPx: layout.lineHeightPx,
          selectionStart: editable.selectionEnd,
          selectionEnd: editable.selectionEnd,
        }).caret
      : null;
    const left = box.left + (caret?.left ?? 0) * zoom;
    const top = box.top + (caret?.top ?? 0) * zoom;
    return {
      left,
      top,
      right: left,
      bottom: top + (caret?.height ?? layout?.lineHeightPx ?? 0) * zoom,
    };
  };

  const replaceEditorText = (start: number, end: number, text: string) => {
    rememberRemovedText(start, end);
    editable.focus();
    editable.setSelectionRange(start, end);
    // YAZ-4071 7L: the browser's own edit is on the text box's undo stack, so
    // ⌘Z takes back a styled paste or cut (`setRangeText` is not)
    if (!document.execCommand?.(text ? "insertText" : "delete", false, text)) {
      editable.setRangeText(text, start, end, "end");
      editable.dispatchEvent(new Event("input"));
    }
  };

  /**
   * YAZ-4039 D12: puts `text` in place of the link `raw` later (a Create row's
   * new ID): in this editor while it is open, the caret kept where it was,
   * else in the saved box. True when `raw` was found.
   */
  const replaceEditorLink = (raw: string, text: string) => {
    if (isDestroyed) {
      return app.replaceHostLinkText(element.id, -1, -1, raw, text);
    }
    const at = editable.value.indexOf(raw);
    if (at < 0) {
      return false;
    }
    const end = at + raw.length;
    const delta = text.length - raw.length;
    const map = (offset: number) =>
      offset >= end ? offset + delta : offset > at ? at + text.length : offset;
    const { selectionStart, selectionEnd } = editable;
    // the caret at the edit while the input handler moves the runs, then back
    editable.setRangeText(text, at, end, "end");
    editable.dispatchEvent(new Event("input"));
    editable.setSelectionRange(map(selectionStart), map(selectionEnd));
    return true;
  };

  /** YAZ-4039 D12: the host's `[[` picker follows the text and the caret. */
  const reportEditor = (typed: boolean) => {
    app.props.hostLinks?.onEditorChange?.({
      text: editable.value,
      caret: editable.selectionEnd,
      typed,
      caretRect: getCaretClientRect,
      replace: replaceEditorText,
      replaceLink: replaceEditorLink,
    });
  };

  // YAZ-4101 3D: the toolbar shows the selected letters' style (B, I, U, S,
  // the color, the highlight), so it draws again when that style changes. A
  // box with no runs has one style: it never asks.
  let toolbarStyle = "";
  const refreshToolbarStyle = () => {
    const runs = (
      app.scene.getElement(element.id) as ExcalidrawTextElement | null
    )?.textRuns;
    const style = runs?.length
      ? getTextRangeToolbarKey(
          runs,
          editable.value,
          editable.selectionStart,
          editable.selectionEnd,
        )
      : "";
    if (style !== toolbarStyle) {
      toolbarStyle = style;
      app.refreshTextEditorToolbar();
    }
  };

  const handleSelectionMoved = () => {
    keepCaretOutOfLinks();
    renderVisualSelection();
    refreshToolbarStyle();
  };

  const handleDocumentSelectionChange = () => {
    if (document.activeElement === editable) {
      keepCaretOutOfLinks();
      // YAZ-3718 D10: a moved caret drops the style for the next letters
      getPendingTextStyle(editable);
      renderVisualSelection();
      reportEditor(false);
      refreshToolbarStyle();
    }
  };

  /** YAZ-4039 D15: right-click on a pill in the editor gives the link menu. */
  const handleEditableContextMenu = (event: MouseEvent) => {
    const onContextMenu = app.props.hostLinks?.onContextMenu;
    const point = onContextMenu
      ? getLinePointFromSceneCoords(
          viewportCoordsToSceneCoords(event, app.state),
        )
      : null;
    const segment = point?.line.segments?.find(
      (segment) =>
        segment.link &&
        point.relativeX >= segment.x &&
        point.relativeX <= segment.x + segment.width,
    );
    if (!onContextMenu || !segment?.link) {
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
        // the menu's click closes this editor first, so the edit goes to the box
        replace: (text) =>
          app.replaceHostLinkText(
            element.id,
            segment.start,
            segment.end,
            `[[${inner}]]`,
            text,
          ),
      },
      event,
    );
    if (shown) {
      event.preventDefault();
    }
  };

  const updateVisualSelectionFromPointer = (event: PointerEvent) => {
    if (
      visualSelectionAnchor === null ||
      (visualSelectionPointerId !== null &&
        event.pointerId !== visualSelectionPointerId)
    ) {
      return;
    }

    const sceneCoords = viewportCoordsToSceneCoords(event, app.state);
    const caretIndex = getCaretIndexFromSceneCoords(sceneCoords);
    if (caretIndex === null) {
      return;
    }

    if (caretIndex < visualSelectionAnchor) {
      editable.setSelectionRange(caretIndex, visualSelectionAnchor, "backward");
    } else {
      editable.setSelectionRange(visualSelectionAnchor, caretIndex, "forward");
    }
    renderVisualSelection();
  };

  const stopVisualSelectionDrag = () => {
    if (
      visualSelectionPointerId !== null &&
      editable.hasPointerCapture?.(visualSelectionPointerId)
    ) {
      editable.releasePointerCapture(visualSelectionPointerId);
    }
    visualSelectionAnchor = null;
    visualSelectionPointerId = null;
    window.removeEventListener("pointermove", updateVisualSelectionFromPointer);
    window.removeEventListener("pointerup", stopVisualSelectionDrag);
    window.removeEventListener("pointercancel", stopVisualSelectionDrag);
  };

  const handleEditablePointerDown = (event: PointerEvent) => {
    event.stopPropagation();

    if (
      (event.button !== POINTER_BUTTON.MAIN &&
        event.button !== POINTER_BUTTON.TOUCH) ||
      !currentTextLayout?.hasVisualLineOverlay
    ) {
      return;
    }

    const sceneCoords = viewportCoordsToSceneCoords(event, app.state);
    const caretIndex = getCaretIndexFromSceneCoords(sceneCoords);
    if (caretIndex === null) {
      return;
    }

    event.preventDefault();
    editable.focus();
    stopVisualSelectionDrag();
    visualSelectionPointerId = event.pointerId;
    editable.setPointerCapture?.(event.pointerId);

    visualSelectionAnchor = event.shiftKey
      ? editable.selectionDirection === "backward"
        ? editable.selectionEnd
        : editable.selectionStart
      : caretIndex;
    editable.setSelectionRange(
      Math.min(visualSelectionAnchor, caretIndex),
      Math.max(visualSelectionAnchor, caretIndex),
      caretIndex < visualSelectionAnchor ? "backward" : "forward",
    );
    renderVisualSelection();
    window.addEventListener("pointermove", updateVisualSelectionFromPointer);
    window.addEventListener("pointerup", stopVisualSelectionDrag);
    window.addEventListener("pointercancel", stopVisualSelectionDrag);
  };

  // Chromium sends `detail: 0` on every pointerdown, so the click count comes
  // from `click`. It still fires after the pointerdown above calls
  // preventDefault(), and it follows the OS double-click speed. A plain
  // pointerdown above leaves a caret, so a range here means the pointer was
  // dragged before the release: keep what the drag selected.
  const handleEditableClick = (event: MouseEvent) => {
    if (
      event.detail < 2 ||
      !currentTextLayout?.hasVisualLineOverlay ||
      editable.selectionStart !== editable.selectionEnd
    ) {
      return;
    }

    const sceneCoords = viewportCoordsToSceneCoords(event, app.state);
    const caretIndex = getCaretIndexFromSceneCoords(sceneCoords);
    if (caretIndex === null) {
      return;
    }

    let start = caretIndex;
    let end = caretIndex;
    if (event.detail >= 3) {
      start = editable.value.lastIndexOf("\n", caretIndex - 1) + 1;
      const nextLineBreak = editable.value.indexOf("\n", caretIndex);
      end = nextLineBreak === -1 ? editable.value.length : nextLineBreak;
    } else {
      const isWordCharacter = (character: string) =>
        /[\p{L}\p{M}\p{N}_]/u.test(character);
      while (
        start > 0 &&
        isWordCharacter(editable.value.slice(start - 1, start))
      ) {
        start--;
      }
      while (
        end < editable.value.length &&
        isWordCharacter(editable.value.slice(end, end + 1))
      ) {
        end++;
      }
    }

    visualSelectionAnchor = null;
    editable.setSelectionRange(start, end, "forward");
    renderVisualSelection();
  };

  // YAZ-4103 3F: letters copied with styles keep them in a note (its HTML);
  // letters with no style other than color copy as the browser does
  const copyStyledText = (event: ClipboardEvent, cut: boolean) => {
    const { selectionStart, selectionEnd, value } = editable;
    const html =
      selectionStart < selectionEnd && event.clipboardData
        ? getStyledHtml(
            value,
            (app.scene.getElement(element.id) as ExcalidrawTextElement | null)
              ?.textRuns,
            selectionStart,
            selectionEnd,
          )
        : null;
    if (!html) {
      return;
    }
    event.preventDefault();
    event.clipboardData!.setData(
      MIME_TYPES.text,
      value.slice(selectionStart, selectionEnd),
    );
    event.clipboardData!.setData(MIME_TYPES.html, html);
    if (cut) {
      replaceEditorText(selectionStart, selectionEnd, "");
    }
  };
  editable.oncopy = (event) => copyStyledText(event, false);
  editable.oncut = (event) => copyStyledText(event, true);

  if (onChange) {
    editable.onpaste = async (event) => {
      // we need to synchronously get the MIME types so we can preventDefault()
      // in the same tick (FF requires that)
      const mimeTypes = parseDataTransferEventMimeTypes(event);
      // YAZ-4103 3F: ⌘⇧V stays plain
      const isPlainPaste = plainPasteKey;
      plainPasteKey = false;

      // YAZ-4039 D12: a pasted page path or `yaseendocs://` link is a link
      const pastedLink = app.props.hostLinks?.pasteLink?.(
        event.clipboardData?.getData(MIME_TYPES.text).trim() ?? "",
      );
      if (pastedLink) {
        event.preventDefault();
        replaceEditorText(
          editable.selectionStart,
          editable.selectionEnd,
          pastedLink,
        );
        return;
      }

      const pasteSelectionStart = editable.selectionStart;
      const pasteSelectionEnd = editable.selectionEnd;
      const pasteLineStart =
        editable.value.lastIndexOf("\n", pasteSelectionStart - 1) + 1;
      const pasteLineEndIndex = editable.value.indexOf(
        "\n",
        pasteSelectionStart,
      );
      const pasteLineEnd =
        pasteLineEndIndex === -1 ? editable.value.length : pasteLineEndIndex;
      const pasteLine = parseTextListLine(
        editable.value.slice(pasteLineStart, pasteLineEnd),
      );
      const pasteListMode = getTextListMode(
        editable.value,
        pasteLineStart,
        pasteLineEnd,
      );
      const isListPaste =
        pasteLine.markerKind !== "none" &&
        (pasteListMode === "bullet" || pasteListMode === "numbered");

      // YAZ-4103 3F: a paste from a note keeps its letter styles (and its
      // `[[links]]`, which are text); a list line pastes as before
      const styled =
        isPlainPaste ||
        isListPaste ||
        mimeTypes.has(MIME_TYPES.excalidrawClipboard) ||
        mimeTypes.has(MIME_TYPES.excalidraw)
          ? null
          : parseStyledHtml(
              event.clipboardData?.getData(MIME_TYPES.html) ?? "",
            );
      if (styled) {
        event.preventDefault();
        pendingPastedRuns = {
          start: pasteSelectionStart,
          text: styled.text,
          textRuns: styled.textRuns,
        };
        // YAZ-4071 7L: ⌘⇧Z after ⌘Z pastes it again
        rememberText(styled.text, styled.textRuns);
        replaceEditorText(pasteSelectionStart, pasteSelectionEnd, styled.text);
        return;
      }

      if (isListPaste) {
        event.preventDefault();
      }

      const insertPastedText = (pastedText: string) => {
        if (!isListPaste) {
          return false;
        }
        const formattedLines = formatPastedTextForList(
          pastedText,
          pasteListMode,
          pasteLine.depth,
        ).split("\n");
        const firstLine = parseTextListLine(formattedLines[0] ?? "").content;
        const insertion = [firstLine, ...formattedLines.slice(1)].join("\n");
        // YAZ-4071 7L: undoable, as a plain paste
        replaceEditorText(pasteSelectionStart, pasteSelectionEnd, insertion);
        return true;
      };

      let dataList: ParsedDataTranferList | null = null;

      // when copy/pasting excalidraw elements, only paste the text content
      //
      // Note that these custom MIME types only work within the same family
      // of browsers, so won't work e.g. between chrome and firefox. We could
      // parse the text/plain for existence of excalidraw instead, but this
      // is an edge case
      if (
        mimeTypes.has(MIME_TYPES.excalidrawClipboard) ||
        mimeTypes.has(MIME_TYPES.excalidraw)
      ) {
        // must be called in the same tick
        event.preventDefault();

        dataList = await parseDataTransferEvent(event);

        try {
          const parsed = await parseClipboard(dataList);

          if (parsed.elements) {
            const text = getTextFromElements(parsed.elements);
            if (text) {
              if (insertPastedText(text)) {
                return;
              }
              // YAZ-4071 7L: undoable, as a plain paste
              replaceEditorText(
                editable.selectionStart,
                editable.selectionEnd,
                text,
              );
            }
          }

          // if excalidraw elements don't contain any text elements,
          // don't paste anything
          return;
        } catch {
          console.warn("failed to parse excalidraw clipboard data");
        }
      }

      dataList = dataList || (await parseDataTransferEvent(event));

      const textItem = dataList.findByType(MIME_TYPES.text);
      if (!textItem) {
        return;
      }
      const text = normalizeText(textItem.value);
      if (!text) {
        return;
      }
      if (insertPastedText(text)) {
        return;
      }
      const container = getContainerElement(
        element,
        app.scene.getNonDeletedElementsMap(),
      );

      const font = getFontString({
        fontSize: app.state.currentItemFontSize,
        fontFamily: app.state.currentItemFontFamily,
      });
      if (container) {
        const boundTextElement = getBoundTextElement(
          container,
          app.scene.getNonDeletedElementsMap(),
        );
        const wrappedText = wrapText(
          `${editable.value}${text}`,
          font,
          getBoundTextMaxWidth(container, boundTextElement),
        );
        const width = getTextWidth(wrappedText, font);
        editable.style.width = `${width}px`;
      }
    };

    editable.oninput = (event) => {
      // YAZ-3943 demo 2: `- ` or `* ` typed at a line's start is a bullet
      // line; its replacement is its own input event
      if (applyListInputRule()) {
        return;
      }
      const normalized = normalizeText(editable.value);
      if (editable.value !== normalized) {
        const selectionStart = editable.selectionStart;
        editable.value = normalized;
        // put the cursor at some position close to where it was before
        // normalization (otherwise it'll end up at the end of the text)
        editable.selectionStart = selectionStart;
        editable.selectionEnd = selectionStart;
      }
      const normalizedList = normalizeTextLists(
        editable.value,
        editable.selectionStart,
        editable.selectionEnd,
      );
      if (editable.value !== normalizedList.text) {
        editable.value = normalizedList.text;
        editable.setSelectionRange(
          normalizedList.selectionStart,
          normalizedList.selectionEnd,
        );
      }
      const currentElement = app.scene.getElement(
        element.id,
      ) as ExcalidrawTextElement | null;
      const edit = {
        caret: editable.selectionEnd,
        insertedLine: pendingInsertedLine ?? undefined,
        eachLine: pendingEachLine,
        // YAZ-3718 D10: B, I, U, S or a color pressed with only a caret
        insertStyle: takePendingTextStyle(
          editable,
          editable.selectionEnd -
            (editable.value.length - previousEditableValue.length),
        ),
      };
      pendingInsertedLine = null;
      pendingEachLine = false;
      const remappedTextRuns = remapTextRunsForTextEdit(
        previousEditableValue,
        editable.value,
        currentElement?.textRuns,
        edit,
      );
      // YAZ-4103 3F: the pasted letters take the styles they were copied with
      // YAZ-4071 7L: letters that ⌘Z or ⌘⇧Z brought back take their own runs
      const pasted =
        pendingPastedRuns ??
        (restorableTexts.length &&
        (event as InputEvent).inputType?.startsWith("history")
          ? getRestoredText()
          : null);
      pendingPastedRuns = null;
      const nextTextRuns =
        pasted &&
        editable.value.slice(
          pasted.start,
          pasted.start + pasted.text.length,
        ) === pasted.text
          ? setPastedTextRuns(
              remappedTextRuns,
              editable.value.length,
              pasted.start,
              pasted.text.length,
              pasted.textRuns,
            )
          : remappedTextRuns;
      previousEditableValue = editable.value;
      onChange({
        nextOriginalText: editable.value,
        nextFontWeight: currentElement?.fontWeight,
        nextTextDecoration: currentElement?.textDecoration,
        nextStrikethrough: currentElement?.strikethrough,
        nextFontStyle: currentElement?.fontStyle,
        nextTextRuns,
      });
      lastSelection = {
        start: editable.selectionStart,
        end: editable.selectionEnd,
      };
      reportEditor(true);
    };
  }

  /**
   * YAZ-3943 demo 2: a list started by typing, as in notes. `- ` or `* ` just
   * typed at the start of a line becomes the box's bullet (`• `), through the
   * browser's own insert, so ⌘Z gives the typed text back. A list makes the
   * box read from the left.
   */
  const applyListInputRule = () => {
    const caret = editable.selectionEnd;
    if (
      editable.selectionStart !== caret ||
      editable.value.length !== previousEditableValue.length + 1 ||
      editable.value[caret - 1] !== " "
    ) {
      return false;
    }
    const lineStart = editable.value.lastIndexOf("\n", caret - 1) + 1;
    const typed = editable.value.slice(lineStart, caret);
    const bullet = /^([ \t]*)[-*] $/.exec(typed);
    if (bullet) {
      const indent = bullet[1];
      const depth = Math.floor(indent.replace(/\t/g, "    ").length / 4);
      startTextList();
      editable.setSelectionRange(lineStart + indent.length, caret);
      const marker = `${getBulletMarkerForDepth(depth)} `;
      if (!document.execCommand?.("insertText", false, marker)) {
        editable.setRangeText(marker, lineStart + indent.length, caret, "end");
        editable.dispatchEvent(new Event("input"));
      }
      return true;
    }
    // `1. ` is a numbered line already (`parseTextListLine`): it only turns
    // the box to the left (Yasin: "Yes, keep it").
    if (/^[ \t]*\d+\. $/.test(typed)) {
      startTextList();
    }
    return false;
  };

  /** YAZ-3943 demo 2: a list reads from the left. */
  const startTextList = () => {
    const current = app.scene.getElement(element.id) as ExcalidrawTextElement;
    if (current && current.textAlign !== "left") {
      app.scene.mutateElement(current, { textAlign: "left" });
      updateWysiwygStyle();
    }
  };

  const handleTextListEnter = () => {
    const { selectionStart, selectionEnd, value } = editable;
    const change = continueTextListItem(value, selectionStart, selectionEnd);
    if (!change) {
      return false;
    }

    // A numbered Enter renumbers the items below, so the input handler cannot find
    // the new line by a text diff: name it here, and it copies the item above.
    if (change.text.split("\n").length > value.split("\n").length) {
      pendingInsertedLine = getLogicalLineIndexAtOffset(
        change.text,
        change.selectionStart,
      );
    }
    editable.value = change.text;
    editable.setSelectionRange(change.selectionStart, change.selectionEnd);

    editable.dispatchEvent(new Event("input"));
    return true;
  };

  editable.onkeydown = (event) => {
    if (event[KEYS.CTRL_OR_CMD] && event.code === CODES.V) {
      plainPasteKey = event.shiftKey;
    }
    // YAZ-4039 D12: the host's open `[[` picker takes ↑, ↓, Enter and Esc
    if (app.props.hostLinks?.onEditorKeyDown?.(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    // YAZ-4039 D15: Backspace after a pill, or Delete before it, selects the
    // whole pill, so the key deletes it as one unit
    if (
      (event.key === KEYS.BACKSPACE || event.key === KEYS.DELETE) &&
      editable.selectionStart === editable.selectionEnd
    ) {
      const link = getLinkToDelete(
        getTextLinkRanges(editable.value),
        editable.selectionStart,
        event.key,
      );
      if (link) {
        editable.setSelectionRange(link.start, link.end);
      }
    }
    if (!event.shiftKey && actionZoomIn.keyTest(event)) {
      event.preventDefault();
      app.actionManager.executeAction(actionZoomIn);
      updateWysiwygStyle();
    } else if (!event.shiftKey && actionZoomOut.keyTest(event)) {
      event.preventDefault();
      app.actionManager.executeAction(actionZoomOut);
      updateWysiwygStyle();
    } else if (!event.shiftKey && actionResetZoom.keyTest(event)) {
      event.preventDefault();
      app.actionManager.executeAction(actionResetZoom);
      updateWysiwygStyle();
    } else if (actionDecreaseFontSize.keyTest(event)) {
      app.actionManager.executeAction(actionDecreaseFontSize);
    } else if (actionIncreaseFontSize.keyTest(event)) {
      app.actionManager.executeAction(actionIncreaseFontSize);
    } else if (
      actionToggleTextBold.keyTest(
        event,
        app.state,
        app.scene.getElementsIncludingDeleted(),
        app,
      )
    ) {
      event.preventDefault();
      app.actionManager.executeAction(actionToggleTextBold, "keyboard");
      updateWysiwygStyle();
    } else if (
      actionToggleTextItalic.keyTest(
        event,
        app.state,
        app.scene.getElementsIncludingDeleted(),
        app,
      )
    ) {
      event.preventDefault();
      app.actionManager.executeAction(actionToggleTextItalic, "keyboard");
      updateWysiwygStyle();
    } else if (
      actionToggleTextStrikethrough.keyTest(
        event,
        app.state,
        app.scene.getElementsIncludingDeleted(),
        app,
      )
    ) {
      event.preventDefault();
      app.actionManager.executeAction(
        actionToggleTextStrikethrough,
        "keyboard",
      );
      updateWysiwygStyle();
    } else if (
      actionToggleTextUnderline.keyTest(
        event,
        app.state,
        app.scene.getElementsIncludingDeleted(),
        app,
      )
    ) {
      event.preventDefault();
      app.actionManager.executeAction(actionToggleTextUnderline, "keyboard");
      updateWysiwygStyle();
    } else if (
      // a key the user gave it in Settings › Hotkeys, else ⌘⇧H
      textFieldKeyFor(actionToggleTextHighlight.name, event) ??
      actionToggleTextHighlight.keyTest(event, app.state)
    ) {
      // YAZ-4102 3E: ⌘⇧H, as in notes
      event.preventDefault();
      app.actionManager.executeAction(actionToggleTextHighlight, "keyboard");
      updateWysiwygStyle();
    } else if (event.key === KEYS.ESCAPE) {
      event.preventDefault();
      submittedViaKeyboard = true;
      handleSubmit();
    } else if (actionSaveToActiveFile.keyTest(event)) {
      event.preventDefault();
      handleSubmit();
      app.actionManager.executeAction(actionSaveToActiveFile);
    } else if (event.key === KEYS.ENTER && event[KEYS.CTRL_OR_CMD]) {
      event.preventDefault();
      if (event.isComposing || event.keyCode === 229) {
        return;
      }
      submittedViaKeyboard = true;
      handleSubmit();
    } else if (
      event.key === KEYS.ENTER &&
      !event.shiftKey &&
      !event.isComposing &&
      event.keyCode !== 229 &&
      handleTextListEnter()
    ) {
      event.preventDefault();
    } else if (
      event.key === KEYS.TAB ||
      (event[KEYS.CTRL_OR_CMD] &&
        (event.code === CODES.BRACKET_LEFT ||
          event.code === CODES.BRACKET_RIGHT))
    ) {
      event.preventDefault();
      if (event.isComposing) {
        return;
      }
      const direction =
        event.shiftKey || event.code === CODES.BRACKET_LEFT ? -1 : 1;
      const listMode = getTextListMode(
        editable.value,
        editable.selectionStart,
        editable.selectionEnd,
      );
      if (listMode !== "plain") {
        const change = indentTextList(
          editable.value,
          editable.selectionStart,
          editable.selectionEnd,
          direction,
        );
        editable.value = change.text;
        editable.setSelectionRange(change.selectionStart, change.selectionEnd);
      } else if (direction === -1) {
        outdent();
      } else {
        indent();
      }
      pendingEachLine = true;
      // We must send an input event to resize the element
      editable.dispatchEvent(new Event("input"));
    }
  };

  const TAB_SIZE = 4;
  const TAB = " ".repeat(TAB_SIZE);
  const RE_LEADING_TAB = new RegExp(`^ {1,${TAB_SIZE}}`);
  const indent = () => {
    const { selectionStart, selectionEnd } = editable;
    const linesStartIndices = getSelectedLinesStartIndices();

    let value = editable.value;
    linesStartIndices.forEach((startIndex: number) => {
      const startValue = value.slice(0, startIndex);
      const endValue = value.slice(startIndex);

      value = `${startValue}${TAB}${endValue}`;
    });

    editable.value = value;

    editable.selectionStart = selectionStart + TAB_SIZE;
    editable.selectionEnd = selectionEnd + TAB_SIZE * linesStartIndices.length;
  };

  const outdent = () => {
    const { selectionStart, selectionEnd } = editable;
    const linesStartIndices = getSelectedLinesStartIndices();
    const removedTabs: number[] = [];

    let value = editable.value;
    linesStartIndices.forEach((startIndex) => {
      const tabMatch = value
        .slice(startIndex, startIndex + TAB_SIZE)
        .match(RE_LEADING_TAB);

      if (tabMatch) {
        const startValue = value.slice(0, startIndex);
        const endValue = value.slice(startIndex + tabMatch[0].length);

        // Delete a tab from the line
        value = `${startValue}${endValue}`;
        removedTabs.push(startIndex);
      }
    });

    editable.value = value;

    if (removedTabs.length) {
      if (selectionStart > removedTabs[removedTabs.length - 1]) {
        editable.selectionStart = Math.max(
          selectionStart - TAB_SIZE,
          removedTabs[removedTabs.length - 1],
        );
      } else {
        // If the cursor is before the first tab removed, ex:
        // Line| #1
        //     Line #2
        // Lin|e #3
        // we should reset the selectionStart to his initial value.
        editable.selectionStart = selectionStart;
      }
      editable.selectionEnd = Math.max(
        editable.selectionStart,
        selectionEnd - TAB_SIZE * removedTabs.length,
      );
    }
  };

  /**
   * @returns indices of start positions of selected lines, in reverse order
   */
  const getSelectedLinesStartIndices = () => {
    let { selectionStart, selectionEnd, value } = editable;

    // chars before selectionStart on the same line
    const startOffset = value.slice(0, selectionStart).match(/[^\n]*$/)![0]
      .length;
    // put caret at the start of the line
    selectionStart = selectionStart - startOffset;

    const selected = value.slice(selectionStart, selectionEnd);

    return selected
      .split("\n")
      .reduce(
        (startIndices, line, idx, lines) =>
          startIndices.concat(
            idx
              ? // curr line index is prev line's start + prev line's length + \n
                startIndices[idx - 1] + lines[idx - 1].length + 1
              : // first selected line
                selectionStart,
          ),
        [] as number[],
      )
      .reverse();
  };

  const stopEvent = (event: Event) => {
    if (event.target instanceof HTMLCanvasElement) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  // using a state variable instead of passing it to the handleSubmit callback
  // so that we don't need to create separate a callback for event handlers
  let submittedViaKeyboard = false;
  const handleSubmit = () => {
    // prevent double submit
    if (isDestroyed) {
      return;
    }

    isDestroyed = true;
    // cleanup must be run before onSubmit otherwise when app blurs the wysiwyg
    // it'd get stuck in an infinite loop of blur→onSubmit after we re-focus the
    // wysiwyg on update
    cleanup();
    const updateElement = app.scene.getElement(
      element.id,
    ) as ExcalidrawTextElement;
    if (!updateElement) {
      return;
    }
    const container = getContainerElement(
      updateElement,
      app.scene.getNonDeletedElementsMap(),
    );

    if (container) {
      if (editable.value.trim()) {
        const boundTextElementId = getBoundTextElementId(container);
        if (!boundTextElementId || boundTextElementId !== element.id) {
          app.scene.mutateElement(container, {
            boundElements: (container.boundElements || []).concat({
              type: "text",
              id: element.id,
            }),
          });
        } else if (isArrowElement(container)) {
          // updating an arrow label may change bounds, prevent stale cache:
          bumpVersion(container);
        }
      } else {
        app.scene.mutateElement(container, {
          boundElements: container.boundElements?.filter(
            (ele) =>
              !isTextElement(
                ele as ExcalidrawTextElement | ExcalidrawLinearElement,
              ),
          ),
        });
      }

      redrawTextBoundingBox(updateElement, container, app.scene);
    }

    onSubmit({
      viaKeyboard: submittedViaKeyboard,
      nextOriginalText: editable.value,
      nextFontWeight: updateElement.fontWeight,
      nextTextDecoration: updateElement.textDecoration,
      nextStrikethrough: updateElement.strikethrough,
      nextFontStyle: updateElement.fontStyle,
      nextTextRuns: updateElement.textRuns,
    });
  };

  const cleanup = () => {
    // remove events to ensure they don't late-fire
    editable.onblur = null;
    editable.oninput = null;
    editable.onkeydown = null;
    editable.removeEventListener("select", renderVisualSelection);
    editable.removeEventListener("beforeinput", handleBeforeInput);
    editable.removeEventListener("keyup", handleSelectionMoved);
    editable.removeEventListener("pointerdown", handleEditablePointerDown);
    editable.removeEventListener("click", handleEditableClick);
    editable.removeEventListener("contextmenu", handleEditableContextMenu);
    app.props.hostLinks?.onEditorChange?.(null);
    document.removeEventListener(
      "selectionchange",
      handleDocumentSelectionChange,
    );
    stopVisualSelectionDrag();

    if (observer) {
      observer.disconnect();
    }

    window.removeEventListener("resize", updateWysiwygStyle);
    window.removeEventListener("wheel", stopEvent, true);
    window.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointerup", bindBlurEvent);
    window.removeEventListener("blur", handleSubmit);
    window.removeEventListener("beforeunload", handleSubmit);
    unbindUpdate();
    unsubOnChange();
    unbindOnScroll();

    textBackgroundOverlay.remove();
    underlineOverlay.remove();
    editable.remove();
  };

  const bindBlurEvent = (event?: MouseEvent) => {
    window.removeEventListener("pointerup", bindBlurEvent);
    // Deferred so that the pointerdown that initiates the wysiwyg doesn't
    // trigger the blur on ensuing pointerup.
    // Also to handle cases such as picking a color which would trigger a blur
    // in that same tick.
    const target = event?.target;

    const isPropertiesTrigger =
      target instanceof HTMLElement &&
      target.classList.contains("properties-trigger");
    const isPropertiesContent =
      (target instanceof HTMLElement || target instanceof SVGElement) &&
      !!(target as Element).closest(".properties-content");
    const inShapeActionsMenu =
      (target instanceof HTMLElement || target instanceof SVGElement) &&
      (!!(target as Element).closest(`.${CLASSES.SHAPE_ACTIONS_MENU}`) ||
        !!(target as Element).closest(".compact-shape-actions-island") ||
        !!(target as Element).closest(".contextual-properties-toolbar"));

    setTimeout(() => {
      // If we interacted within shape actions menu or its popovers/triggers,
      // keep submit disabled and don't steal focus back to textarea.
      if (inShapeActionsMenu || isPropertiesTrigger || isPropertiesContent) {
        return;
      }

      // Otherwise, re-enable submit on blur and refocus the editor.
      editable.onblur = handleSubmit;
      editable.focus();
      if (pendingInitialSelection) {
        editable.setSelectionRange(
          pendingInitialSelection.start,
          pendingInitialSelection.end,
        );
        pendingInitialSelection = null;
      }
    });
  };

  const temporarilyDisableSubmit = () => {
    editable.onblur = null;
    window.addEventListener("pointerup", bindBlurEvent);
    // handle edge-case where pointerup doesn't fire e.g. due to user
    // alt-tabbing away
    window.addEventListener("blur", handleSubmit);
  };

  // prevent blur when changing properties from the menu
  const onPointerDown = (event: MouseEvent) => {
    const target = event?.target;

    // panning canvas
    if (event.button === POINTER_BUTTON.WHEEL) {
      // trying to pan by clicking inside text area itself -> handle here
      if (target instanceof HTMLTextAreaElement) {
        event.preventDefault();
        app.handleCanvasPanUsingWheelOrSpaceDrag(event);
      }

      temporarilyDisableSubmit();
      return;
    }

    const isPropertiesTrigger =
      target instanceof HTMLElement &&
      target.classList.contains("properties-trigger");
    const isPropertiesContent =
      (target instanceof HTMLElement || target instanceof SVGElement) &&
      !!(target as Element).closest(".properties-content");

    if (
      ((event.target instanceof HTMLElement ||
        event.target instanceof SVGElement) &&
        (event.target.closest(
          `.${CLASSES.SHAPE_ACTIONS_MENU}, .${CLASSES.ZOOM_ACTIONS}`,
        ) ||
          event.target.closest(
            ".compact-shape-actions-island, .contextual-properties-toolbar",
          )) &&
        !isWritableElement(event.target)) ||
      isPropertiesTrigger ||
      isPropertiesContent
    ) {
      temporarilyDisableSubmit();
    } else if (
      event.target instanceof HTMLCanvasElement &&
      // Vitest simply ignores stopPropagation, capture-mode, or rAF
      // so without introducing crazier hacks, nothing we can do
      !isTestEnv()
    ) {
      // On mobile, blur event doesn't seem to always fire correctly,
      // so we want to also submit on pointerdown outside the wysiwyg.
      // Done in the next frame to prevent pointerdown from creating a new text
      // immediately (if tools locked) so that users on mobile have chance
      // to submit first (to hide virtual keyboard).
      // Note: revisit if we want to differ this behavior on Desktop
      requestAnimationFrame(() => {
        handleSubmit();
      });
    }
  };

  // FIXME after we start emitting updates from Store for appState.theme
  const unsubOnChange = app.onChangeEmitter.on((elements) => {
    if (app.state.theme !== LAST_THEME) {
      updateWysiwygStyle();
    }
  });

  // handle updates of textElement properties of editing element
  const unbindUpdate = app.scene.onUpdate(() => {
    // YAZ-4071 7C: the list button sets this editor's text and moves the runs
    // itself, so the next typed letter is an edit of that text
    if (
      (app.scene.getElement(element.id) as ExcalidrawTextElement | null)
        ?.originalText === editable.value
    ) {
      previousEditableValue = editable.value;
    }
    const selectionStart = editable.selectionStart;
    const selectionEnd = editable.selectionEnd;
    updateWysiwygStyle();
    const isPopupOpened = !!document.activeElement?.closest(
      ".properties-content",
    );
    if (!isPopupOpened) {
      editable.focus();
      editable.setSelectionRange(selectionStart, selectionEnd);
    }
  });

  const unbindOnScroll = app.onScrollChangeEmitter.on(() => {
    updateWysiwygStyle();
  });

  // ---------------------------------------------------------------------------

  let isDestroyed = false;

  if (autoSelect && !pendingInitialSelection) {
    // select on init (focusing is done separately inside the bindBlurEvent()
    // because we need it to happen *after* the blur event from `pointerdown`)
    editable.select();
  }
  bindBlurEvent();

  // reposition wysiwyg in case of canvas is resized. Using ResizeObserver
  // is preferred so we catch changes from host, where window may not resize.
  let observer: ResizeObserver | null = null;
  if (canvas && "ResizeObserver" in window) {
    observer = new window.ResizeObserver(() => {
      updateWysiwygStyle();
    });
    observer.observe(canvas);
  } else {
    window.addEventListener("resize", updateWysiwygStyle);
  }

  editable.addEventListener("select", renderVisualSelection);
  editable.addEventListener("beforeinput", handleBeforeInput);
  // `selectionchange` is the canonical signal, but some browser/host
  // combinations do not emit it consistently for native textarea keyboard
  // navigation. Repaint on keyup as a harmless fallback so the custom caret
  // used by styled text cannot appear frozen.
  editable.addEventListener("keyup", handleSelectionMoved);
  editable.addEventListener("pointerdown", handleEditablePointerDown);
  editable.addEventListener("click", handleEditableClick);
  editable.addEventListener("contextmenu", handleEditableContextMenu);
  document.addEventListener("selectionchange", handleDocumentSelectionChange);

  // rAF (+ capture to by doubly sure) so we don't catch te pointerdown that
  // triggered the wysiwyg
  requestAnimationFrame(() => {
    window.addEventListener("pointerdown", onPointerDown, { capture: true });
  });
  window.addEventListener("beforeunload", handleSubmit);
  const editorContainer = excalidrawContainer?.querySelector(
    ".excalidraw-textEditorContainer",
  );
  editorContainer?.appendChild(textBackgroundOverlay);
  editorContainer?.appendChild(underlineOverlay);
  editorContainer?.appendChild(editable);

  return handleSubmit;
};
