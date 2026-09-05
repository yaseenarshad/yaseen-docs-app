import { pointFrom } from "@excalidraw/math";

import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  COLOR_PALETTE,
  CORNER_RADIUS,
  DEFAULT_ELEMENT_BACKGROUND_COLOR_PALETTE,
  DEFAULT_ELEMENT_BACKGROUND_COLOR_INDEX,
  DEFAULT_ELEMENT_BACKGROUND_PICKS,
  DEFAULT_ELEMENT_STROKE_COLOR_PALETTE,
  DEFAULT_ELEMENT_STROKE_COLOR_INDEX,
  DEFAULT_ELEMENT_STROKE_PICKS,
  DEFAULT_TEXT_STROKE_PICKS,
  ARROW_TYPE,
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  DEFAULT_NEW_TEXT_ALIGN,
  FONT_FAMILY,
  ROUNDNESS,
  STROKE_WIDTH_KEYS,
  VERTICAL_ALIGN,
  CODES,
  KEYS,
  randomInteger,
  arrayToMap,
  getFontString,
  getLineHeight,
  isTransparent,
  getStrokeWidthByKey,
  VECTOR_STROKE_WIDTH,
  WRITING_STROKE_WIDTH,
  normalizeVectorStrokeWidth,
  getRelativeImageBorderWidth,
  reduceToCommonValue,
  invariant,
  FONT_SIZES,
  type StrokeWidthKey,
  type ColorPickerColor,
} from "@excalidraw/common";

import {
  areSelectedLinesStyled,
  canBecomePolygon,
  getNonDeletedElements,
  isNonDeletedElement,
  toggleSelectedLineStyles,
} from "@excalidraw/element";

import {
  bindBindingElement,
  calculateFixedPointForElbowArrowBinding,
  updateBoundElements,
} from "@excalidraw/element";

import { LinearElementEditor } from "@excalidraw/element";

import { newElementWith } from "@excalidraw/element";
import { getArrowheadForPicker } from "@excalidraw/element";

import {
  getBoundTextElement,
  getTextBackgroundNominalPadding,
  getTextBackgroundPaddingScaleFromNominalPx,
  getScaledTextRoundness,
  redrawTextBoundingBox,
} from "@excalidraw/element";

import {
  isArrowElement,
  isBoundToContainer,
  isElbowArrow,
  isFrameLikeElement,
  hasVectorStrokeWidth,
  isImageElement,
  isLinearElement,
  isLineElement,
  isTextElement,
  isUsingAdaptiveRadius,
  canChangeCornerRadius,
  canChangeCornerRadiusForElement,
  getRequestedCornerRadius,
  getDefaultCornerRadiusForElementType,
  normalizeCornerRadius,
} from "@excalidraw/element";

import { hasStrokeColor } from "@excalidraw/element";

import {
  updateElbowArrowPoints,
  CaptureUpdateAction,
  toggleLinePolygonState,
} from "@excalidraw/element";

import { deriveStylesPanelMode } from "@excalidraw/common";

import type { LocalPoint, Radians } from "@excalidraw/math";

import type {
  Arrowhead,
  ElementsMap,
  ExcalidrawBindableElement,
  ExcalidrawElement,
  ExcalidrawFreeDrawElement,
  ExcalidrawLinearElement,
  ExcalidrawTextElement,
  FontFamilyValues,
  StrokeVariability,
  NonDeleted,
  NonDeletedExcalidrawElement,
  TextAlign,
  VerticalAlign,
} from "@excalidraw/element/types";

import type { ElementUpdate, Scene } from "@excalidraw/element";

import type { CaptureUpdateActionType } from "@excalidraw/element";

import { trackEvent } from "../analytics";
import { getTextBackgroundRadiusForFontSize } from "../textCreation";
import {
  getTextListMode,
  setTextListMode,
  type TextListMode,
} from "../textList";
import { RadioSelection } from "../components/RadioSelection";
import { IconButton } from "../components/IconButton";
import { ColorPicker } from "../components/ColorPicker/ColorPicker";
import { FontPicker } from "../components/FontPicker/FontPicker";
import { IconPicker } from "../components/IconPicker";
import { Range } from "../components/Range";
import {
  ArrowheadArrowIcon,
  ArrowheadBarIcon,
  ArrowheadCircleIcon,
  ArrowheadTriangleIcon,
  ArrowheadNoneIcon,
  StrokeStyleDashedIcon,
  StrokeStyleDottedIcon,
  TextAlignTopIcon,
  TextAlignBottomIcon,
  TextAlignMiddleIcon,
  FillHachureIcon,
  FillCrossHatchIcon,
  FillSolidIcon,
  SloppinessArchitectIcon,
  SloppinessArtistIcon,
  SloppinessCartoonistIcon,
  StrokeWidthBaseIcon,
  StrokeWidthBoldIcon,
  StrokeWidthExtraBoldIcon,
  FontSizeSmallIcon,
  FontSizeMediumIcon,
  FontSizeLargeIcon,
  FontSizeExtraLargeIcon,
  EdgeSharpIcon,
  EdgeRoundIcon,
  TextAlignLeftIcon,
  TextAlignCenterIcon,
  TextAlignRightIcon,
  FillZigZagIcon,
  ArrowheadTriangleOutlineIcon,
  ArrowheadCircleOutlineIcon,
  ArrowheadDiamondIcon,
  ArrowheadDiamondOutlineIcon,
  fontSizeIcon,
  sharpArrowIcon,
  roundArrowIcon,
  elbowArrowIcon,
  ArrowheadCardinalityExactlyOneIcon,
  ArrowheadCardinalityManyIcon,
  ArrowheadCardinalityOneIcon,
  ArrowheadCardinalityOneOrManyIcon,
  ArrowheadCardinalityZeroOrManyIcon,
  ArrowheadCardinalityZeroOrOneIcon,
  strokeVariabilityConstantIcon,
  strokeVariabilityVariableIcon,
} from "../components/icons";

import { Fonts } from "../fonts";
import { getLanguage, t } from "../i18n";
import {
  canHaveArrowheads,
  getSelectedElements,
  getTargetElements,
  isSomeElementSelected,
} from "../scene";

import {
  withCaretPositionPreservation,
  restoreCaretPosition,
} from "../hooks/useTextEditorFocus";

import { getShortcutKey } from "../shortcut";

import { register } from "./register";

import type { Action } from "./types";
import type { AppClassProperties, AppState, Primitive } from "../types";

const FONT_SIZE_RELATIVE_INCREASE_STEP = 0.1;

const getStylesPanelInfo = (app: AppClassProperties) => {
  const stylesPanelMode = deriveStylesPanelMode(app.editorInterface);
  return {
    stylesPanelMode,
    isCompact: stylesPanelMode !== "full",
    isMobile: stylesPanelMode === "mobile",
  } as const;
};

export const changeProperty = (
  elements: readonly ExcalidrawElement[],
  appState: AppState,
  callback: (element: NonDeletedExcalidrawElement) => ExcalidrawElement,
  includeBoundText = false,
) => {
  const selectedElementIds = arrayToMap(
    getSelectedElements(elements, appState, {
      includeBoundTextElement: includeBoundText,
    }),
  );

  return elements.map((element) => {
    if (
      selectedElementIds.get(element.id) ||
      element.id === appState.editingTextElement?.id
    ) {
      // selected & editing elements are non-deleted
      if (!isNonDeletedElement(element)) {
        // SAFETY: This should never happen, but log it just in case
        console.error(
          "[NONDELETED][INVARIANT] changeProperty(): skipping deleted selected/editing element",
        );
      }
      return callback(element as NonDeletedExcalidrawElement);
    }
    return element;
  });
};

export const getFormValue = function <T extends Primitive>(
  elements: readonly ExcalidrawElement[],
  app: AppClassProperties,
  /**
   * input value (usually the element attribute value,
   * but depends on what the action's PanelComponent input expects)
   */
  getValue: (element: ExcalidrawElement) => T,
  elementPredicate: true | ((element: ExcalidrawElement) => boolean),
  defaultValue: T | ((isSomeElementSelected: boolean) => T),
): T {
  const editingTextElement = app.state.editingTextElement;
  const nonDeletedElements = getNonDeletedElements(elements);

  let ret: T | null = null;

  if (editingTextElement) {
    ret = getValue(editingTextElement);
  }

  if (!ret) {
    const hasSelection = isSomeElementSelected(nonDeletedElements, app.state);

    if (hasSelection) {
      const selectedElements = app.scene.getSelectedElements(app.state);
      const targetElements =
        elementPredicate === true
          ? selectedElements
          : selectedElements.filter((el) => elementPredicate(el));

      ret =
        reduceToCommonValue(targetElements, getValue) ??
        (typeof defaultValue === "function"
          ? defaultValue(true)
          : defaultValue);
    } else {
      ret =
        typeof defaultValue === "function" ? defaultValue(false) : defaultValue;
    }
  }

  return ret;
};

const offsetElementAfterFontResize = (
  prevElement: ExcalidrawTextElement,
  nextElement: ExcalidrawTextElement,
  scene: Scene,
) => {
  if (isBoundToContainer(nextElement) || !nextElement.autoResize) {
    return nextElement;
  }
  return scene.mutateElement(nextElement, {
    x:
      prevElement.textAlign === "left"
        ? prevElement.x
        : prevElement.x +
          (prevElement.width - nextElement.width) /
            (prevElement.textAlign === "center" ? 2 : 1),
    // centering vertically is non-standard, but for Excalidraw I think
    // it makes sense
    y: prevElement.y + (prevElement.height - nextElement.height) / 2,
  });
};

export const changeFontSize = (
  elements: readonly ExcalidrawElement[],
  appState: AppState,
  app: AppClassProperties,
  getNewFontSize: (element: ExcalidrawTextElement) => number,
  fallbackValue?: ExcalidrawTextElement["fontSize"],
) => {
  const newFontSizes = new Set<number>();

  const updatedElements = changeProperty(
    elements,
    appState,
    (oldElement) => {
      if (isTextElement(oldElement)) {
        const newFontSize = getNewFontSize(oldElement);
        newFontSizes.add(newFontSize);

        let newElement: ExcalidrawTextElement = newElementWith(oldElement, {
          fontSize: newFontSize,
          roundness: getScaledTextRoundness(oldElement, newFontSize),
        });
        redrawTextBoundingBox(
          newElement,
          app.scene.getContainerElement(oldElement),
          app.scene,
        );

        newElement = offsetElementAfterFontResize(
          oldElement,
          newElement,
          app.scene,
        );

        return newElement;
      }
      return oldElement;
    },
    true,
  );

  // Update arrow elements after text elements have been updated
  getSelectedElements(elements, appState, {
    includeBoundTextElement: true,
  }).forEach((element) => {
    if (isTextElement(element)) {
      updateBoundElements(element, app.scene);
    }
  });

  return {
    elements: updatedElements,
    appState: {
      ...appState,
      // update state only if we've set all select text elements to
      // the same font size
      currentItemFontSize:
        newFontSizes.size === 1
          ? [...newFontSizes][0]
          : fallbackValue ?? appState.currentItemFontSize,
    },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  };
};

// -----------------------------------------------------------------------------

export const actionChangeStrokeColor = register<
  Pick<AppState, "currentItemStrokeColor">
>({
  name: "changeStrokeColor",
  label: "labels.stroke",
  trackEvent: false,
  perform: (elements, appState, value) => {
    const selectedElements = getSelectedElements(elements, appState);
    const shouldPreserveImageBorderColor =
      value?.currentItemStrokeColor !== undefined &&
      isTransparent(value.currentItemStrokeColor) &&
      selectedElements.length > 0 &&
      selectedElements.every(isImageElement);
    const selectedVisibleImageBorderColors = new Set(
      shouldPreserveImageBorderColor
        ? selectedElements
            .map((element) => element.strokeColor)
            .filter((color) => !isTransparent(color))
        : [],
    );
    const imageBorderColorToRemember =
      selectedVisibleImageBorderColors.size === 1
        ? [...selectedVisibleImageBorderColors][0]
        : appState.currentItemStrokeColor;

    return {
      ...(value?.currentItemStrokeColor && {
        elements: changeProperty(
          elements,
          appState,
          (el) => {
            if (!hasStrokeColor(el.type)) {
              return el;
            }
            // First activation of an image border: size the width relative
            // to the image (GRO-1545). Re-coloring a visible border keeps it.
            const isImageBorderActivation =
              isImageElement(el) &&
              isTransparent(el.strokeColor) &&
              !isTransparent(value.currentItemStrokeColor);
            return newElementWith(el, {
              strokeColor: value.currentItemStrokeColor,
              ...(isImageBorderActivation
                ? {
                    strokeWidth: getRelativeImageBorderWidth(
                      el.width,
                      el.height,
                    ),
                  }
                : null),
            });
          },
          true,
        ),
      }),
      appState: {
        ...appState,
        ...value,
        ...(shouldPreserveImageBorderColor
          ? { currentItemStrokeColor: imageBorderColorToRemember }
          : null),
      },
      captureUpdate: !!value?.currentItemStrokeColor
        ? CaptureUpdateAction.IMMEDIATELY
        : CaptureUpdateAction.EVENTUALLY,
    };
  },
  PanelComponent: ({ elements, appState, updateData, app, data }) => {
    const { stylesPanelMode } = getStylesPanelInfo(app);
    const targetElements = getTargetElements(elements, appState);
    const hasExclusiveTextTarget =
      targetElements.length > 0 && targetElements.every(isTextElement);

    return (
      <>
        {stylesPanelMode === "full" && !data?.contextToolbar && (
          <h3 aria-hidden="true">{t("labels.stroke")}</h3>
        )}
        <ColorPicker
          topPicks={
            hasExclusiveTextTarget
              ? DEFAULT_TEXT_STROKE_PICKS
              : DEFAULT_ELEMENT_STROKE_PICKS
          }
          palette={DEFAULT_ELEMENT_STROKE_COLOR_PALETTE}
          type="elementStroke"
          label={t("labels.stroke")}
          color={getFormValue(
            elements,
            app,
            (element) => element.strokeColor,
            true,
            (hasSelection) =>
              !hasSelection ? appState.currentItemStrokeColor : null,
          )}
          onChange={(color) => updateData({ currentItemStrokeColor: color })}
          elements={elements}
          appState={appState}
          updateData={updateData}
        />
      </>
    );
  },
});

const getSemanticColorProperty = (element: ExcalidrawElement) => {
  if (
    element.type === "rectangle" ||
    element.type === "ellipse" ||
    element.type === "diamond" ||
    isFrameLikeElement(element)
  ) {
    return "backgroundColor" as const;
  }

  if (
    element.type === "text" ||
    element.type === "line" ||
    element.type === "arrow" ||
    element.type === "freedraw" ||
    element.type === "image"
  ) {
    return "strokeColor" as const;
  }

  return null;
};

export const actionApplySelectedSemanticColor = register<{
  colorName: ColorPickerColor;
  target?: "primary" | "stroke";
}>({
  name: "applySelectedSemanticColor",
  label: "labels.stroke",
  trackEvent: false,
  perform: (elements, appState, value) => {
    if (!value) {
      return false;
    }

    let supportedElementCount = 0;
    const paletteValue = COLOR_PALETTE[value.colorName];
    const updatedElements = changeProperty(elements, appState, (element) => {
      const property =
        value.target === "stroke"
          ? isTextElement(element)
            ? element.containerId === null
              ? ("backgroundColor" as const)
              : null
            : hasStrokeColor(element.type)
            ? ("strokeColor" as const)
            : null
          : getSemanticColorProperty(element);
      if (!property) {
        return element;
      }

      supportedElementCount++;
      const color = Array.isArray(paletteValue)
        ? paletteValue[
            property === "backgroundColor"
              ? DEFAULT_ELEMENT_BACKGROUND_COLOR_INDEX
              : DEFAULT_ELEMENT_STROKE_COLOR_INDEX
          ]
        : paletteValue;

      return newElementWith(element, {
        [property]: color,
        ...(property === "backgroundColor" &&
        isTextElement(element) &&
        !isTransparent(color) &&
        !element.roundness
          ? {
              roundness: {
                type: ROUNDNESS.ADAPTIVE_RADIUS,
                value: getTextBackgroundRadiusForFontSize(element.fontSize),
              },
            }
          : null),
      });
    });

    if (!supportedElementCount) {
      return {
        appState: {
          ...appState,
          toast: {
            message:
              value.target === "stroke"
                ? "The selected elements do not support alternate color shortcuts."
                : "The selected elements do not support direct color shortcuts.",
            duration: 3000,
          },
        },
        captureUpdate: CaptureUpdateAction.EVENTUALLY,
      };
    }

    return {
      elements: updatedElements,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
});

export const actionClearSelectedTextFormatting = register({
  name: "clearSelectedTextFormatting",
  label: "Clear selected text colors",
  trackEvent: false,
  perform: (elements, appState) => {
    const updatedElements = changeProperty(
      elements,
      appState,
      (element) =>
        isTextElement(element)
          ? newElementWith(element, {
              strokeColor: COLOR_PALETTE.black,
              backgroundColor: COLOR_PALETTE.transparent,
              backgroundPaddingScale: undefined,
              roundness: null,
            })
          : element,
      true,
    );

    return {
      elements: updatedElements,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  keyPriority: 100,
  keyTest: (event, appState, elements) =>
    event[KEYS.CTRL_OR_CMD] &&
    !event.altKey &&
    !event.shiftKey &&
    event.key === "\\" &&
    (isTextElement(appState.editingTextElement) ||
      getSelectedElements(elements, appState, {
        includeBoundTextElement: true,
      }).some(isTextElement)),
});

export const actionChangeBackgroundColor = register<
  Pick<AppState, "currentItemBackgroundColor" | "viewBackgroundColor">
>({
  name: "changeBackgroundColor",
  label: "labels.changeBackground",
  trackEvent: false,
  perform: (elements, appState, value, app) => {
    if (!value?.currentItemBackgroundColor) {
      return {
        appState: {
          ...appState,
          ...value,
        },
        captureUpdate: CaptureUpdateAction.EVENTUALLY,
      };
    }

    let nextElements;

    const selectedElements = app.scene.getSelectedElements(appState);
    const shouldEnablePolygon =
      !isTransparent(value.currentItemBackgroundColor) &&
      selectedElements.every(
        (el) => isLineElement(el) && canBecomePolygon(el.points),
      );

    if (shouldEnablePolygon) {
      const selectedElementsMap = arrayToMap(selectedElements);
      nextElements = elements.map((el) => {
        if (selectedElementsMap.has(el.id) && isLineElement(el)) {
          return newElementWith(el, {
            backgroundColor: value.currentItemBackgroundColor,
            ...toggleLinePolygonState(el, true),
          });
        }
        return el;
      });
    } else {
      nextElements = changeProperty(elements, appState, (el) =>
        isTextElement(el) && el.containerId !== null
          ? el
          : newElementWith(el, {
              backgroundColor: value.currentItemBackgroundColor,
              ...(isTextElement(el) &&
              !isTransparent(value.currentItemBackgroundColor) &&
              !el.roundness
                ? {
                    roundness: {
                      type: ROUNDNESS.ADAPTIVE_RADIUS,
                      value: getTextBackgroundRadiusForFontSize(el.fontSize),
                    },
                  }
                : null),
            }),
      );
    }

    return {
      elements: nextElements,
      appState: {
        ...appState,
        ...value,
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  PanelComponent: ({ elements, appState, updateData, app, data }) => {
    const { stylesPanelMode } = getStylesPanelInfo(app);

    return (
      <>
        {stylesPanelMode === "full" && !data?.contextToolbar && (
          <h3 aria-hidden="true">{t("labels.background")}</h3>
        )}
        <ColorPicker
          topPicks={DEFAULT_ELEMENT_BACKGROUND_PICKS}
          palette={DEFAULT_ELEMENT_BACKGROUND_COLOR_PALETTE}
          type="elementBackground"
          label={t("labels.background")}
          color={getFormValue(
            elements,
            app,
            (element) => element.backgroundColor,
            true,
            (hasSelection) =>
              !hasSelection ? appState.currentItemBackgroundColor : null,
          )}
          onChange={(color) =>
            updateData({ currentItemBackgroundColor: color })
          }
          elements={elements}
          appState={appState}
          updateData={updateData}
        />
      </>
    );
  },
});

export const actionChangeFillStyle = register<ExcalidrawElement["fillStyle"]>({
  name: "changeFillStyle",
  label: "labels.fill",
  trackEvent: false,
  perform: (elements, appState, value, app) => {
    trackEvent(
      "element",
      "changeFillStyle",
      `${value} (${
        app.editorInterface.formFactor === "phone" ? "mobile" : "desktop"
      })`,
    );
    return {
      elements: changeProperty(elements, appState, (el) =>
        newElementWith(el, {
          fillStyle: value,
        }),
      ),
      appState: { ...appState, currentItemFillStyle: value },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  PanelComponent: ({ elements, appState, updateData, app }) => {
    const selectedElements = getSelectedElements(elements, appState);
    const allElementsZigZag =
      selectedElements.length > 0 &&
      selectedElements.every((el) => el.fillStyle === "zigzag");

    return (
      <fieldset>
        <legend>{t("labels.fill")}</legend>
        <div className="buttonList">
          <RadioSelection
            type="button"
            options={[
              {
                value: "hachure",
                text: `${
                  allElementsZigZag ? t("labels.zigzag") : t("labels.hachure")
                } (${getShortcutKey("Alt-Click")})`,
                icon: allElementsZigZag ? FillZigZagIcon : FillHachureIcon,
                active: allElementsZigZag ? true : undefined,
                testId: `fill-hachure`,
              },
              {
                value: "cross-hatch",
                text: t("labels.crossHatch"),
                icon: FillCrossHatchIcon,
                testId: `fill-cross-hatch`,
              },
              {
                value: "solid",
                text: t("labels.solid"),
                icon: FillSolidIcon,
                testId: `fill-solid`,
              },
            ]}
            value={getFormValue(
              elements,
              app,
              (element) => element.fillStyle,
              (element) => element.hasOwnProperty("fillStyle"),
              (hasSelection) =>
                hasSelection ? null : appState.currentItemFillStyle,
            )}
            onClick={(value, event) => {
              const nextValue =
                event.altKey &&
                value === "hachure" &&
                selectedElements.every((el) => el.fillStyle === "hachure")
                  ? "zigzag"
                  : value;

              updateData(nextValue);
            }}
          />
        </div>
      </fieldset>
    );
  },
});

const getStrokeWidthKeyForElement = (
  element: ExcalidrawElement,
): StrokeWidthKey | null => {
  return (
    STROKE_WIDTH_KEYS.find(
      (key) => getStrokeWidthByKey(element.type, key) === element.strokeWidth,
    ) ?? null
  );
};

const getStrokeWidthForElement = (
  element: ExcalidrawElement,
  strokeWidthKey: StrokeWidthKey,
): ExcalidrawElement["strokeWidth"] => {
  return getStrokeWidthByKey(element.type, strokeWidthKey);
};

export const actionChangeStrokeWidth = register<StrokeWidthKey>({
  name: "changeStrokeWidth",
  label: "labels.strokeWidth",
  trackEvent: false,
  perform: (elements, appState, value) => {
    invariant(value, "actionChangeStrokeWidth: value must be defined");

    return {
      elements: changeProperty(elements, appState, (el) =>
        newElementWith(el, {
          strokeWidth: getStrokeWidthForElement(el, value),
        }),
      ),
      appState: { ...appState, currentItemStrokeWidthKey: value },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  PanelComponent: ({ elements, appState, updateData, app, data }) => (
    <fieldset className={data?.contextToolbar ? "context-fieldset" : ""}>
      {!data?.contextToolbar && <legend>{t("labels.strokeWidth")}</legend>}
      <div className="buttonList">
        <RadioSelection<StrokeWidthKey>
          group="stroke-width"
          options={[
            {
              value: "thin",
              text: t("labels.thin"),
              icon: StrokeWidthBaseIcon,
              testId: "strokeWidth-thin",
            },
            {
              value: "medium",
              text: t("labels.medium"),
              icon: StrokeWidthBoldIcon,
              testId: "strokeWidth-medium",
            },
            {
              value: "bold",
              text: t("labels.bold"),
              icon: StrokeWidthExtraBoldIcon,
              testId: "strokeWidth-bold",
            },
          ]}
          value={getFormValue(
            elements,
            app,
            getStrokeWidthKeyForElement,
            (element) => element.hasOwnProperty("strokeWidth"),
            (hasSelection) =>
              hasSelection ? null : appState.currentItemStrokeWidthKey,
          )}
          onChange={(value) => updateData(value)}
        />
      </div>
    </fieldset>
  ),
});

const getStrokeWidthProfile = (
  selectedElements: readonly ExcalidrawElement[],
  appState: Pick<AppState, "writingMode" | "activeTool">,
) => {
  const writing =
    appState.writingMode &&
    (selectedElements.length > 0
      ? selectedElements.every((element) => element.type === "freedraw")
      : appState.activeTool.type === "freedraw");
  return {
    settings: writing ? WRITING_STROKE_WIDTH : VECTOR_STROKE_WIDTH,
    preference: writing
      ? ("currentItemWritingStrokeWidth" as const)
      : ("currentItemVectorStrokeWidth" as const),
  };
};

const LinearStrokeWidthInput = ({
  value,
  onChange,
  settings,
}: {
  value: number | null;
  onChange: (value: number) => void;
  settings: typeof VECTOR_STROKE_WIDTH | typeof WRITING_STROKE_WIDTH;
}) => {
  const [inputValue, setInputValue] = useState(value?.toString() ?? "");
  const cancelledRef = useRef(false);

  useEffect(() => {
    setInputValue(value?.toString() ?? "");
  }, [value]);

  const commit = () => {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }

    if (!inputValue.trim()) {
      setInputValue(value?.toString() ?? "");
      return;
    }

    const parsed = Number(inputValue);
    if (!Number.isFinite(parsed)) {
      setInputValue(value?.toString() ?? "");
      return;
    }

    const nextValue = normalizeVectorStrokeWidth(parsed, settings);
    setInputValue(nextValue.toString());
    if (nextValue !== value) {
      onChange(nextValue);
    }
  };

  return (
    <div
      className="linear-stroke-width-custom"
      data-prevent-outside-click
      onPointerDown={(event) => event.stopPropagation()}
    >
      <label>
        <input
          aria-label="Exact stroke width"
          data-testid="linear-stroke-width-input"
          type="number"
          inputMode="decimal"
          min={settings.min}
          max={settings.max}
          step={settings.step}
          value={inputValue}
          placeholder="Mixed"
          onChange={(event) => setInputValue(event.target.value)}
          onBlur={commit}
          onWheel={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === KEYS.ENTER) {
              event.preventDefault();
              commit();
            } else if (event.key === KEYS.ESCAPE) {
              event.preventDefault();
              cancelledRef.current = true;
              setInputValue(value?.toString() ?? "");
              event.currentTarget.blur();
            }
          }}
        />
        <span>px</span>
      </label>
    </div>
  );
};

export const actionChangeVectorStrokeWidth = register<number>({
  name: "changeVectorStrokeWidth",
  label: "labels.strokeWidth",
  trackEvent: false,
  perform: (elements, appState, value) => {
    invariant(
      value !== undefined,
      "actionChangeVectorStrokeWidth: value must be defined",
    );

    const selectedElements = getSelectedElements(elements, appState);
    if (
      selectedElements.length > 0 &&
      !selectedElements.every((element) => hasVectorStrokeWidth(element.type))
    ) {
      return false;
    }

    const { settings, preference } = getStrokeWidthProfile(
      selectedElements,
      appState,
    );
    const strokeWidth = normalizeVectorStrokeWidth(value, settings);
    const shouldActivateImageBorder = selectedElements.some(
      (element) =>
        isImageElement(element) && isTransparent(element.strokeColor),
    );
    const visibleImageStrokeColor = isTransparent(
      appState.currentItemStrokeColor,
    )
      ? COLOR_PALETTE.black
      : appState.currentItemStrokeColor;
    return {
      elements: changeProperty(elements, appState, (element) => {
        if (!hasVectorStrokeWidth(element.type)) {
          return element;
        }

        return newElementWith(element, {
          strokeWidth,
          ...(isImageElement(element) && isTransparent(element.strokeColor)
            ? { strokeColor: visibleImageStrokeColor }
            : null),
        });
      }),
      appState: {
        ...appState,
        [preference]: strokeWidth,
        ...(shouldActivateImageBorder
          ? { currentItemStrokeColor: visibleImageStrokeColor }
          : null),
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  PanelComponent: ({ elements, appState, updateData, app, data }) => {
    const { settings, preference } = getStrokeWidthProfile(
      getSelectedElements(elements, appState),
      appState,
    );
    const value = getFormValue(
      elements,
      app,
      (element) => element.strokeWidth,
      (element) => hasVectorStrokeWidth(element.type),
      (hasSelection) => (hasSelection ? null : appState[preference]),
    );

    return (
      <fieldset
        className={clsx("linear-stroke-width-fieldset", {
          "linear-stroke-width-fieldset--contextual": data?.contextToolbar,
        })}
        data-prevent-outside-click
        onPointerDown={(event) => event.stopPropagation()}
      >
        {!data?.contextToolbar && <legend>{t("labels.strokeWidth")}</legend>}
        <div
          className="linear-stroke-width-presets"
          role="group"
          aria-label="Stroke width presets"
        >
          {settings.presets.map((preset, index) => (
            <IconButton
              key={preset}
              type="toggle"
              size="small"
              checked={value === preset}
              icon={
                [
                  StrokeWidthBaseIcon,
                  StrokeWidthBoldIcon,
                  StrokeWidthExtraBoldIcon,
                ][index]
              }
              aria-label={`Set stroke width to ${preset} px`}
              data-testid={`vector-stroke-width-preset-${preset}`}
              onSelect={() => updateData(preset)}
            />
          ))}
        </div>
        <Range
          ariaLabel={t("labels.strokeWidth")}
          className={clsx("linear-stroke-width-range", {
            "linear-stroke-width-range--contextual": data?.contextToolbar,
          })}
          label={null}
          value={value ?? appState[preference]}
          hasCommonValue={value !== null}
          onChange={(nextValue) => updateData(nextValue)}
          min={settings.min}
          max={settings.max}
          step={settings.step}
          minLabel={null}
          maxLabel={null}
          preventCanvasInteraction
          showValueBubble={false}
          testId="linear-stroke-width-slider"
        />
        {data?.contextToolbar ? (
          <div className="linear-stroke-width-contextual-meta">
            <LinearStrokeWidthInput
              value={value}
              settings={settings}
              onChange={(nextValue) => updateData(nextValue)}
            />
          </div>
        ) : (
          <LinearStrokeWidthInput
            value={value}
            settings={settings}
            onChange={(nextValue) => updateData(nextValue)}
          />
        )}
      </fieldset>
    );
  },
});

/** @deprecated Use actionChangeVectorStrokeWidth. */
export const actionChangeLinearStrokeWidth = actionChangeVectorStrokeWidth;

export const actionChangeSloppiness = register<ExcalidrawElement["roughness"]>({
  name: "changeSloppiness",
  label: "labels.sloppiness",
  trackEvent: false,
  perform: (elements, appState, value) => {
    return {
      elements: changeProperty(elements, appState, (el) =>
        newElementWith(el, {
          seed: randomInteger(),
          roughness: value,
        }),
      ),
      appState: { ...appState, currentItemRoughness: value },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  PanelComponent: ({ elements, appState, updateData, app, data }) => (
    <fieldset>
      <legend>{t("labels.sloppiness")}</legend>
      <div className="buttonList">
        <RadioSelection
          group="sloppiness"
          options={[
            {
              value: 0,
              text: t("labels.architect"),
              icon: SloppinessArchitectIcon,
            },
            {
              value: 1,
              text: t("labels.artist"),
              icon: SloppinessArtistIcon,
            },
            {
              value: 2,
              text: t("labels.cartoonist"),
              icon: SloppinessCartoonistIcon,
            },
          ]}
          value={getFormValue(
            elements,
            app,
            (element) => element.roughness,
            (element) => element.hasOwnProperty("roughness"),
            (hasSelection) =>
              hasSelection ? null : appState.currentItemRoughness,
          )}
          onChange={(value) => updateData(value)}
        />
      </div>
    </fieldset>
  ),
});

export const actionChangeFreedrawMode = register<StrokeVariability>({
  name: "changeFreedrawMode",
  label: "labels.pressure",
  trackEvent: false,
  perform: (elements, appState, value) => {
    const variability = value || "constant";

    return {
      elements: changeProperty(elements, appState, (el) => {
        if (el.type !== "freedraw") {
          return el;
        }
        return newElementWith(el, {
          strokeOptions: {
            ...el.strokeOptions,
            variability,
          },
        }) as ExcalidrawElement;
      }),
      appState: { ...appState, currentItemStrokeVariability: variability },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  PanelComponent: ({ elements, appState, updateData, app, data }) => {
    const strokeVariability =
      getFormValue(
        elements,
        app,
        (element) =>
          (element as ExcalidrawFreeDrawElement).strokeOptions?.variability,
        (element) => element.type === "freedraw",
        (hasSelection) =>
          hasSelection ? null : appState.currentItemStrokeVariability,
      ) ?? appState.currentItemStrokeVariability;

    // in the compact UI the pressure setting is rendered as a single button
    // that cycles between the two variability modes on click
    if (data?.cycle) {
      const isVariable = strokeVariability === "variable";
      return (
        <IconButton
          type="button"
          icon={
            isVariable
              ? strokeVariabilityVariableIcon
              : strokeVariabilityConstantIcon
          }
          title={t("labels.pressure")}
          aria-label={t("labels.pressure")}
          onClick={() => updateData(isVariable ? "constant" : "variable")}
        />
      );
    }

    return (
      <fieldset>
        <legend>{t("labels.pressure")}</legend>
        <div className="buttonList">
          <RadioSelection<StrokeVariability>
            group="strokeOptions.variability"
            options={[
              {
                value: "constant",
                text: t("labels.pressure_constant"),
                icon: strokeVariabilityConstantIcon,
              },
              {
                value: "variable",
                text: t("labels.pressure_variable"),
                icon: strokeVariabilityVariableIcon,
              },
            ]}
            value={strokeVariability}
            onChange={(value) => updateData(value)}
          />
        </div>
      </fieldset>
    );
  },
});

export const actionChangeStrokeStyle = register<
  ExcalidrawElement["strokeStyle"]
>({
  name: "changeStrokeStyle",
  label: "labels.strokeStyle",
  trackEvent: false,
  perform: (elements, appState, value) => {
    return {
      elements: changeProperty(elements, appState, (el) =>
        newElementWith(el, {
          strokeStyle: value,
        }),
      ),
      appState: { ...appState, currentItemStrokeStyle: value },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  PanelComponent: ({ elements, appState, updateData, app, data }) => (
    <fieldset>
      <legend>{t("labels.strokeStyle")}</legend>
      <div className="buttonList">
        <RadioSelection
          group="strokeStyle"
          options={[
            {
              value: "solid",
              text: t("labels.strokeStyle_solid"),
              icon: StrokeWidthBaseIcon,
            },
            {
              value: "dashed",
              text: t("labels.strokeStyle_dashed"),
              icon: StrokeStyleDashedIcon,
            },
            {
              value: "dotted",
              text: t("labels.strokeStyle_dotted"),
              icon: StrokeStyleDottedIcon,
            },
          ]}
          value={getFormValue(
            elements,
            app,
            (element) => element.strokeStyle,
            (element) => element.hasOwnProperty("strokeStyle"),
            (hasSelection) =>
              hasSelection ? null : appState.currentItemStrokeStyle,
          )}
          onChange={(value) => updateData(value)}
        />
      </div>
    </fieldset>
  ),
});

export const actionChangeOpacity = register<ExcalidrawElement["opacity"]>({
  name: "changeOpacity",
  label: "labels.opacity",
  trackEvent: false,
  perform: (elements, appState, value) => {
    return {
      elements: changeProperty(
        elements,
        appState,
        (el) =>
          newElementWith(el, {
            opacity: value,
          }),
        true,
      ),
      appState: { ...appState, currentItemOpacity: value },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  PanelComponent: ({ elements, appState, app, updateData, data }) => {
    const opacity = getFormValue(
      elements,
      app,
      (element) => element.opacity,
      true,
      (hasSelection) => (hasSelection ? null : appState.currentItemOpacity),
    );

    return (
      <Range
        label={t("labels.opacity")}
        value={opacity ?? appState.currentItemOpacity}
        hasCommonValue={opacity !== null}
        onChange={updateData}
        min={0}
        max={100}
        step={10}
        minLabel={data?.contextToolbar ? 0 : undefined}
        maxLabel={data?.contextToolbar ? 100 : undefined}
        preventCanvasInteraction={!!data?.contextToolbar}
        showMinValueInBubble={!!data?.contextToolbar}
        testId="opacity"
      />
    );
  },
});

export const canChangeTextBackgroundPadding = (
  element: ExcalidrawElement,
): element is ExcalidrawTextElement =>
  isTextElement(element) &&
  element.containerId === null &&
  !isTransparent(element.backgroundColor);

type TextBackgroundPaddingChange = {
  value: number;
  mode: "normalized" | "nominalPx";
  captureUpdate?: CaptureUpdateActionType;
};

const TextBackgroundPaddingInput = ({
  value,
  max,
  onChange,
}: {
  value: number | null;
  max: number;
  onChange: (value: number) => void;
}) => {
  const [inputValue, setInputValue] = useState(value?.toString() ?? "");
  const cancelledRef = useRef(false);

  useEffect(() => {
    setInputValue(value?.toString() ?? "");
  }, [value]);

  const commit = () => {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    const parsed = Number(inputValue);
    if (!Number.isFinite(parsed)) {
      setInputValue(value?.toString() ?? "");
      return;
    }
    const nextValue = Math.min(max, Math.max(0, parsed));
    setInputValue(nextValue.toString());
    onChange(nextValue);
  };

  return (
    <label className="text-background-padding-input" data-prevent-outside-click>
      <input
        aria-label="Exact fill padding"
        data-testid="text-background-padding-input"
        type="number"
        inputMode="decimal"
        min={0}
        max={max}
        step={0.5}
        value={inputValue}
        placeholder="Mixed"
        onChange={(event) => setInputValue(event.target.value)}
        onBlur={commit}
        onWheel={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === KEYS.ENTER) {
            event.preventDefault();
            commit();
          } else if (event.key === KEYS.ESCAPE) {
            event.preventDefault();
            cancelledRef.current = true;
            setInputValue(value?.toString() ?? "");
            event.currentTarget.blur();
          }
        }}
      />
      <span>px</span>
    </label>
  );
};

export const actionChangeTextBackgroundPadding =
  register<TextBackgroundPaddingChange>({
    name: "changeTextBackgroundPadding",
    label: "Change text fill padding",
    trackEvent: false,
    perform: (elements, appState, data) => {
      if (!data || !Number.isFinite(data.value)) {
        return false;
      }

      return {
        elements: changeProperty(elements, appState, (element) => {
          if (!canChangeTextBackgroundPadding(element)) {
            return element;
          }

          const backgroundPaddingScale =
            data.mode === "normalized"
              ? getTextBackgroundPaddingScaleFromNominalPx(
                  element.fontSize,
                  Math.min(1, Math.max(0, data.value)) * element.fontSize,
                )
              : getTextBackgroundPaddingScaleFromNominalPx(
                  element.fontSize,
                  data.value,
                );

          return newElementWith(element, { backgroundPaddingScale });
        }),
        captureUpdate: data.captureUpdate ?? CaptureUpdateAction.IMMEDIATELY,
      };
    },
    PanelComponent: ({ elements, appState, updateData }) => {
      const eligibleElements = getTargetElements(
        getNonDeletedElements(elements),
        appState,
      ).filter(canChangeTextBackgroundPadding);
      if (eligibleElements.length === 0) {
        return null;
      }

      const referenceElement = eligibleElements[0];
      const referenceValue = getTextBackgroundNominalPadding(referenceElement);
      const commonValue = reduceToCommonValue(
        eligibleElements,
        getTextBackgroundNominalPadding,
      );
      const exactMaximum = Math.min(
        ...eligibleElements.map((element) => element.fontSize),
      );
      const applyNormalizedValue = (
        nextValue: number,
        captureUpdate: CaptureUpdateActionType,
      ) =>
        updateData({
          value: nextValue / referenceElement.fontSize,
          mode: "normalized",
          captureUpdate,
        });

      return (
        <fieldset
          className="text-background-padding-fieldset"
          data-prevent-outside-click
          onPointerDown={(event) => event.stopPropagation()}
        >
          <legend>Fill padding</legend>
          <Range
            ariaLabel="Fill padding"
            className="text-background-padding-range"
            label={null}
            value={commonValue ?? referenceValue}
            hasCommonValue={commonValue !== null}
            onChange={(nextValue) =>
              applyNormalizedValue(nextValue, CaptureUpdateAction.EVENTUALLY)
            }
            onChangeEnd={(nextValue) =>
              applyNormalizedValue(nextValue, CaptureUpdateAction.IMMEDIATELY)
            }
            min={0}
            max={referenceElement.fontSize}
            step={0.5}
            minLabel={null}
            maxLabel={null}
            preventCanvasInteraction
            showValueBubble={false}
            testId="text-background-padding-slider"
          />
          <TextBackgroundPaddingInput
            value={commonValue}
            max={exactMaximum}
            onChange={(nextValue) =>
              updateData({
                value: nextValue,
                mode: "nominalPx",
                captureUpdate: CaptureUpdateAction.IMMEDIATELY,
              })
            }
          />
        </fieldset>
      );
    },
  });

export const actionChangeFontSize = register<ExcalidrawTextElement["fontSize"]>(
  {
    name: "changeFontSize",
    label: "labels.fontSize",
    trackEvent: false,
    perform: (elements, appState, value, app) => {
      return changeFontSize(
        elements,
        appState,
        app,
        () => {
          invariant(value, "actionChangeFontSize: Expected a font size value");
          return value;
        },
        value,
      );
    },
    PanelComponent: ({ elements, appState, updateData, app, data }) => {
      const { isCompact } = getStylesPanelInfo(app);
      const fontSize = getFormValue(
        elements,
        app,
        (element) => {
          if (isTextElement(element)) {
            return element.fontSize;
          }
          const boundTextElement = getBoundTextElement(
            element,
            app.scene.getNonDeletedElementsMap(),
          );
          return boundTextElement?.fontSize ?? null;
        },
        (element) =>
          isTextElement(element) ||
          getBoundTextElement(element, app.scene.getNonDeletedElementsMap()) !==
            null,
        (hasSelection) =>
          hasSelection
            ? null
            : appState.currentItemFontSize || DEFAULT_FONT_SIZE,
      );
      const updateFontSize = (value: number) => {
        withCaretPositionPreservation(
          () => updateData(value),
          isCompact,
          !!appState.editingTextElement,
          data?.onPreventClose,
        );
      };

      return (
        <fieldset className={data?.contextToolbar ? "context-fieldset" : ""}>
          {!data?.contextToolbar && <legend>{t("labels.fontSize")}</legend>}
          {!data?.contextToolbar && (
            <div className="buttonList">
              <RadioSelection
                group="font-size"
                options={[
                  {
                    value: FONT_SIZES.sm,
                    text: t("labels.small"),
                    icon: FontSizeSmallIcon,
                    testId: "fontSize-small",
                  },
                  {
                    value: FONT_SIZES.md,
                    text: t("labels.medium"),
                    icon: FontSizeMediumIcon,
                    testId: "fontSize-medium",
                  },
                  {
                    value: FONT_SIZES.lg,
                    text: t("labels.large"),
                    icon: FontSizeLargeIcon,
                    testId: "fontSize-large",
                  },
                  {
                    value: FONT_SIZES.xl,
                    text: t("labels.veryLarge"),
                    icon: FontSizeExtraLargeIcon,
                    testId: "fontSize-veryLarge",
                  },
                ]}
                value={fontSize}
                onChange={updateFontSize}
              />
            </div>
          )}
          <ExactFontSizeInput
            value={fontSize}
            onChange={updateFontSize}
            compact={data?.contextToolbar}
          />
        </fieldset>
      );
    },
  },
);

const ExactFontSizeInput = ({
  value,
  onChange,
  compact = false,
}: {
  value: number | null;
  onChange: (value: number) => void;
  compact?: boolean;
}) => {
  const [inputValue, setInputValue] = useState(value?.toString() ?? "");

  useEffect(() => {
    setInputValue(value?.toString() ?? "");
  }, [value]);

  const commit = () => {
    const parsed = Number(inputValue);
    if (!Number.isFinite(parsed)) {
      setInputValue(value?.toString() ?? "");
      return;
    }
    const nextValue = Math.min(512, Math.max(1, Math.round(parsed * 10) / 10));
    setInputValue(nextValue.toString());
    onChange(nextValue);
  };

  const nudge = (amount: number) => {
    const currentValue = Number(inputValue || value || DEFAULT_FONT_SIZE);
    const nextValue = Math.min(
      512,
      Math.max(1, Math.round((currentValue + amount) * 10) / 10),
    );
    setInputValue(nextValue.toString());
    onChange(nextValue);
  };

  return (
    <div
      className={clsx("font-size-custom", {
        "font-size-custom--compact": compact,
      })}
      data-prevent-outside-click
      onPointerDown={(event) => event.stopPropagation()}
    >
      {compact && (
        <button
          type="button"
          aria-label="Decrease font size"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={() => nudge(-1)}
        >
          −
        </button>
      )}
      <label>
        <input
          aria-label="Exact font size"
          type="number"
          min="1"
          max="512"
          step="0.1"
          value={inputValue}
          placeholder="Mixed"
          onChange={(event) => setInputValue(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === KEYS.ENTER) {
              event.preventDefault();
              commit();
            } else if (event.key === KEYS.ESCAPE) {
              setInputValue(value?.toString() ?? "");
            }
          }}
        />
        <span>px</span>
      </label>
      {compact && (
        <button
          type="button"
          aria-label="Increase font size"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={() => nudge(1)}
        >
          +
        </button>
      )}
    </div>
  );
};

type TextStyleChange =
  | { property: "fontWeight"; enabled: boolean }
  | { property: "textDecoration"; enabled: boolean }
  | { property: "strikethrough"; enabled: boolean }
  | {
      property: "listMode";
      mode: Exclude<TextListMode, "mixed">;
    };

type BooleanTextStyleProperty = Exclude<
  TextStyleChange["property"],
  "listMode"
>;

const getTextStyle = (
  element: ExcalidrawElement,
  property: TextStyleChange["property"],
  app: AppClassProperties,
) => {
  const currentElement =
    app.state.editingTextElement?.id === element.id
      ? app.scene.getElement(element.id) ?? element
      : element;
  const textElement = isTextElement(currentElement)
    ? currentElement
    : getBoundTextElement(element, app.scene.getNonDeletedElementsMap());
  if (!textElement) {
    return false;
  }
  const editable =
    app.state.editingTextElement?.id === textElement.id
      ? document.querySelector<HTMLTextAreaElement>(".excalidraw-wysiwyg")
      : null;
  if (property === "fontWeight") {
    return editable
      ? areSelectedLinesStyled({
          text: editable.value,
          lineStyles: textElement.lineBolds,
          selectionStart: editable.selectionStart,
          selectionEnd: editable.selectionEnd,
          wholeElementStyled: textElement.fontWeight === "bold",
        })
      : textElement.fontWeight === "bold";
  }
  if (property === "textDecoration") {
    return editable
      ? areSelectedLinesStyled({
          text: editable.value,
          lineStyles: textElement.lineUnderlines,
          selectionStart: editable.selectionStart,
          selectionEnd: editable.selectionEnd,
          wholeElementStyled: textElement.textDecoration === "underline",
        })
      : textElement.textDecoration === "underline";
  }
  if (property === "strikethrough") {
    return editable
      ? areSelectedLinesStyled({
          text: editable.value,
          lineStyles: textElement.lineStrikethroughs,
          selectionStart: editable.selectionStart,
          selectionEnd: editable.selectionEnd,
          wholeElementStyled: textElement.strikethrough === true,
        })
      : textElement.strikethrough === true;
  }

  return editable
    ? getTextListMode(
        editable.value,
        editable.selectionStart,
        editable.selectionEnd,
      )
    : getTextListMode(textElement.originalText);
};

const changeTextStyle = (
  elements: readonly ExcalidrawElement[],
  appState: AppState,
  value: TextStyleChange,
  app: AppClassProperties,
) => {
  const editable = appState.editingTextElement
    ? document.querySelector<HTMLTextAreaElement>(".excalidraw-wysiwyg")
    : null;
  const editableList = editable
    ? value.property === "listMode"
      ? setTextListMode(
          editable.value,
          editable.selectionStart,
          editable.selectionEnd,
          value.mode,
        )
      : null
    : null;
  const editableSelection = editable
    ? {
        start: editable.selectionStart,
        end: editable.selectionEnd,
      }
    : null;

  const updatedElements = changeProperty(
    elements,
    appState,
    (element) => {
      if (!isTextElement(element)) {
        return element;
      }
      if (value.property === "listMode") {
        const listChange =
          editableList && element.id === appState.editingTextElement?.id
            ? editableList
            : setTextListMode(
                element.originalText,
                0,
                element.originalText.length,
                value.mode,
              );
        let nextElement: ExcalidrawTextElement = newElementWith(element, {
          originalText: listChange.text,
          text: listChange.text,
        });
        redrawTextBoundingBox(
          nextElement,
          app.scene.getContainerElement(element),
          app.scene,
        );
        nextElement = offsetElementAfterFontResize(
          element,
          nextElement,
          app.scene,
        );
        return nextElement;
      }
      if (value.property === "textDecoration") {
        if (editable && element.id === appState.editingTextElement?.id) {
          return newElementWith(
            element,
            {
              textDecoration: "none",
              lineUnderlines: toggleSelectedLineStyles({
                text: editable.value,
                lineStyles: element.lineUnderlines,
                selectionStart: editable.selectionStart,
                selectionEnd: editable.selectionEnd,
                wholeElementStyled: element.textDecoration === "underline",
                enabled: value.enabled,
              }),
            },
            true,
          );
        }

        return newElementWith(
          element,
          {
            textDecoration: value.enabled ? "underline" : "none",
            lineUnderlines: undefined,
          },
          true,
        );
      }
      if (value.property === "fontWeight") {
        let nextElement: ExcalidrawTextElement =
          editable && element.id === appState.editingTextElement?.id
            ? newElementWith(
                element,
                {
                  fontWeight: "normal",
                  lineBolds: toggleSelectedLineStyles({
                    text: editable.value,
                    lineStyles: element.lineBolds,
                    selectionStart: editable.selectionStart,
                    selectionEnd: editable.selectionEnd,
                    wholeElementStyled: element.fontWeight === "bold",
                    enabled: value.enabled,
                  }),
                },
                true,
              )
            : newElementWith(
                element,
                {
                  fontWeight: value.enabled ? "bold" : "normal",
                  lineBolds: undefined,
                },
                true,
              );
        redrawTextBoundingBox(
          nextElement,
          app.scene.getContainerElement(element),
          app.scene,
        );
        nextElement = offsetElementAfterFontResize(
          element,
          nextElement,
          app.scene,
        );
        return nextElement;
      }
      if (editable && element.id === appState.editingTextElement?.id) {
        return newElementWith(
          element,
          {
            strikethrough: false,
            lineStrikethroughs: toggleSelectedLineStyles({
              text: editable.value,
              lineStyles: element.lineStrikethroughs,
              selectionStart: editable.selectionStart,
              selectionEnd: editable.selectionEnd,
              wholeElementStyled: element.strikethrough === true,
              enabled: value.enabled,
            }),
          },
          true,
        );
      }
      return newElementWith(
        element,
        {
          strikethrough: value.enabled,
          lineStrikethroughs: undefined,
        },
        true,
      );
    },
    true,
  );

  if (editable && editableList) {
    editable.value = editableList.text;
    editable.setSelectionRange(
      editableList.selectionStart,
      editableList.selectionEnd,
    );
    editable.focus();
  } else if (editable && editableSelection && value.property !== "listMode") {
    editable.setSelectionRange(editableSelection.start, editableSelection.end);
    editable.focus();
    queueMicrotask(() => {
      if (editable.isConnected) {
        editable.setSelectionRange(
          editableSelection.start,
          editableSelection.end,
        );
        editable.focus();
      }
    });
    restoreCaretPosition(editableSelection);
  }

  return {
    elements: updatedElements,
    appState,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  };
};

const toggleTextStyle = (
  elements: readonly ExcalidrawElement[],
  appState: AppState,
  property: BooleanTextStyleProperty,
  app: AppClassProperties,
) => {
  const targetElements = appState.editingTextElement
    ? [appState.editingTextElement]
    : getSelectedElements(elements, appState, {
        includeBoundTextElement: true,
      }).filter(isTextElement);
  const enabled =
    reduceToCommonValue(targetElements, (element) =>
      getTextStyle(element, property, app),
    ) !== true;

  return changeTextStyle(elements, appState, { property, enabled }, app);
};

const textStyleShortcutTest = (
  event: Parameters<NonNullable<Action["keyTest"]>>[0],
  appState: AppState,
  elements: readonly ExcalidrawElement[],
  app: AppClassProperties,
  code: typeof CODES.B | typeof CODES.U | typeof CODES.X,
) =>
  event[KEYS.CTRL_OR_CMD] &&
  !event.altKey &&
  event.shiftKey === (code === CODES.X) &&
  event.code === code &&
  (!!appState.editingTextElement ||
    getSelectedElements(elements, appState, {
      includeBoundTextElement: true,
    }).some(isTextElement));

export const actionChangeTextStyle = register<TextStyleChange>({
  name: "changeTextStyle",
  label: "labels.fontFamily",
  trackEvent: false,
  perform: (elements, appState, value, app) => {
    invariant(value, "actionChangeTextStyle: Expected a style value");

    return changeTextStyle(elements, appState, value, app);
  },
  PanelComponent: ({ elements, appState, updateData, app, data }) => {
    const { isCompact } = getStylesPanelInfo(app);
    const hasTextTarget = (element: ExcalidrawElement) =>
      isTextElement(element) ||
      getBoundTextElement(element, app.scene.getNonDeletedElementsMap()) !==
        null;
    const bold = getFormValue(
      elements,
      app,
      (element) => getTextStyle(element, "fontWeight", app),
      hasTextTarget,
      false,
    );
    const underline = getFormValue(
      elements,
      app,
      (element) => getTextStyle(element, "textDecoration", app),
      hasTextTarget,
      false,
    );
    const strikethrough = getFormValue(
      elements,
      app,
      (element) => getTextStyle(element, "strikethrough", app),
      hasTextTarget,
      false,
    );
    const listMode = getFormValue(
      elements,
      app,
      (element) => getTextStyle(element, "listMode", app),
      hasTextTarget,
      false,
    );
    const nextListMode =
      listMode === "bullet"
        ? "numbered"
        : listMode === "numbered"
        ? "plain"
        : "bullet";
    const updateStyle = (value: TextStyleChange) => {
      if (value.property === "listMode") {
        data?.onPreventClose?.();
        updateData(value);
        return;
      }
      withCaretPositionPreservation(
        () => updateData(value),
        isCompact,
        !!appState.editingTextElement,
        data?.onPreventClose,
      );
    };

    const controls = (
      <>
        <div className="buttonList">
          <RadioSelection<TextStyleChange>
            type="button"
            value={null}
            options={[
              {
                value: { property: "fontWeight", enabled: bold !== true },
                text: "Bold",
                icon: <strong aria-hidden="true">B</strong>,
                active: bold === true,
                testId: "textStyle-bold",
              },
              {
                value: {
                  property: "textDecoration",
                  enabled: underline !== true,
                },
                text: "Underline",
                icon: (
                  <span
                    aria-hidden="true"
                    style={{ textDecoration: "underline" }}
                  >
                    U
                  </span>
                ),
                active: underline === true,
                testId: "textStyle-underline",
              },
              {
                value: {
                  property: "strikethrough",
                  enabled: strikethrough !== true,
                },
                text: "Strikethrough",
                icon: (
                  <span
                    aria-hidden="true"
                    style={{ textDecoration: "line-through" }}
                  >
                    S
                  </span>
                ),
                active: strikethrough === true,
                testId: "textStyle-strikethrough",
              },
              {
                value: {
                  property: "listMode",
                  mode: nextListMode,
                },
                text:
                  listMode === "bullet"
                    ? "Bulleted list"
                    : listMode === "numbered"
                    ? "Numbered list"
                    : "List",
                icon: (
                  <span aria-hidden="true" className="text-bullets-icon">
                    <span>{listMode === "numbered" ? "1." : "•"}</span>
                    <span>≡</span>
                  </span>
                ),
                active: listMode === "bullet" || listMode === "numbered",
                testId: "textStyle-bullets",
              },
            ]}
            onClick={(value) => updateStyle(value)}
          />
        </div>
      </>
    );
    return data?.contextToolbar ? (
      <div className="context-fieldset">{controls}</div>
    ) : (
      <fieldset>
        <legend>Text style</legend>
        {controls}
      </fieldset>
    );
  },
});

export const actionToggleTextBold = register({
  name: "toggleTextBold",
  label: "Bold",
  trackEvent: false,
  perform: (elements, appState, _, app) =>
    toggleTextStyle(elements, appState, "fontWeight", app),
  keyTest: (event, appState, elements, app) =>
    textStyleShortcutTest(event, appState, elements, app, CODES.B),
});

export const actionToggleTextUnderline = register({
  name: "toggleTextUnderline",
  label: "Underline",
  trackEvent: false,
  perform: (elements, appState, _, app) =>
    toggleTextStyle(elements, appState, "textDecoration", app),
  keyTest: (event, appState, elements, app) =>
    textStyleShortcutTest(event, appState, elements, app, CODES.U),
});

export const actionToggleTextStrikethrough = register({
  name: "toggleTextStrikethrough",
  label: "Strikethrough",
  trackEvent: false,
  perform: (elements, appState, _, app) =>
    toggleTextStyle(elements, appState, "strikethrough", app),
  keyTest: (event, appState, elements, app) =>
    textStyleShortcutTest(event, appState, elements, app, CODES.X),
});

type ChangeLineHeightData = {
  lineHeight: number;
};

const clampLineHeight = (lineHeight: number) =>
  Math.min(3, Math.max(0.8, Math.round(lineHeight * 20) / 20));

const LineHeightInput = ({
  value,
  onChange,
  compact,
}: {
  value: number | null;
  onChange: (value: number) => void;
  compact: boolean;
}) => {
  const [inputValue, setInputValue] = useState(value?.toString() ?? "");

  useEffect(() => {
    setInputValue(value?.toString() ?? "");
  }, [value]);

  const commit = () => {
    const parsed = Number(inputValue);
    if (!Number.isFinite(parsed)) {
      setInputValue(value?.toString() ?? "");
      return;
    }
    const nextValue = clampLineHeight(parsed);
    setInputValue(nextValue.toString());
    onChange(nextValue);
  };

  const nudge = (amount: number) => {
    const currentValue = Number(inputValue || value || 1.25);
    const nextValue = clampLineHeight(currentValue + amount);
    setInputValue(nextValue.toString());
    onChange(nextValue);
  };

  return (
    <div
      className={clsx("line-height-custom", {
        "line-height-custom--compact": compact,
      })}
      data-prevent-outside-click
      onPointerDown={(event) => event.stopPropagation()}
    >
      {compact && (
        <button
          type="button"
          aria-label="Decrease line spacing"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={() => nudge(-0.05)}
        >
          −
        </button>
      )}
      <label>
        <span aria-hidden="true" className="line-height-custom__icon">
          ↕
        </span>
        <input
          aria-label="Line spacing"
          data-testid="text-line-height"
          type="number"
          min="0.8"
          max="3"
          step="0.05"
          value={inputValue}
          placeholder="Mixed"
          onChange={(event) => setInputValue(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === KEYS.ENTER) {
              event.preventDefault();
              commit();
            } else if (event.key === KEYS.ESCAPE) {
              setInputValue(value?.toString() ?? "");
            }
          }}
        />
      </label>
      {compact && (
        <button
          type="button"
          aria-label="Increase line spacing"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={() => nudge(0.05)}
        >
          +
        </button>
      )}
    </div>
  );
};

export const actionChangeLineHeight = register<ChangeLineHeightData>({
  name: "changeLineHeight",
  label: "Line spacing",
  trackEvent: false,
  perform: (elements, appState, value, app) => {
    invariant(value, "actionChangeLineHeight: Expected a line height");
    const lineHeight = clampLineHeight(value.lineHeight);
    const updatedElements = changeProperty(
      elements,
      appState,
      (element) => {
        if (!isTextElement(element)) {
          return element;
        }
        let nextElement: ExcalidrawTextElement = newElementWith(element, {
          lineHeight: lineHeight as ExcalidrawTextElement["lineHeight"],
        });
        redrawTextBoundingBox(
          nextElement,
          app.scene.getContainerElement(element),
          app.scene,
        );
        nextElement = offsetElementAfterFontResize(
          element,
          nextElement,
          app.scene,
        );
        return nextElement;
      },
      true,
    );

    getSelectedElements(elements, appState, {
      includeBoundTextElement: true,
    }).forEach((element) => {
      if (isTextElement(element)) {
        updateBoundElements(element, app.scene);
      }
    });

    return {
      elements: updatedElements,
      appState,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  PanelComponent: ({ elements, appState, updateData, app, data }) => {
    const { isCompact } = getStylesPanelInfo(app);
    const lineHeight = getFormValue(
      elements,
      app,
      (element) => {
        const textElement = isTextElement(element)
          ? element
          : getBoundTextElement(element, app.scene.getNonDeletedElementsMap());
        return textElement?.lineHeight ?? null;
      },
      (element) =>
        isTextElement(element) ||
        getBoundTextElement(element, app.scene.getNonDeletedElementsMap()) !==
          null,
      (hasSelection) =>
        hasSelection ? null : getLineHeight(appState.currentItemFontFamily),
    );
    const updateLineHeight = (nextLineHeight: number) => {
      withCaretPositionPreservation(
        () => updateData({ lineHeight: nextLineHeight }),
        isCompact,
        !!appState.editingTextElement,
        data?.onPreventClose,
      );
    };

    return (
      <fieldset className={data?.contextToolbar ? "context-fieldset" : ""}>
        {!data?.contextToolbar && <legend>Line spacing</legend>}
        <LineHeightInput
          value={lineHeight}
          onChange={updateLineHeight}
          compact={!!data?.contextToolbar}
        />
      </fieldset>
    );
  },
});

export const actionDecreaseFontSize = register({
  name: "decreaseFontSize",
  label: "labels.decreaseFontSize",
  icon: fontSizeIcon,
  trackEvent: false,
  perform: (elements, appState, value, app) => {
    return changeFontSize(elements, appState, app, (element) =>
      Math.round(
        // get previous value before relative increase (doesn't work fully
        // due to rounding and float precision issues)
        (1 / (1 + FONT_SIZE_RELATIVE_INCREASE_STEP)) * element.fontSize,
      ),
    );
  },
  keyTest: (event) => {
    return (
      event[KEYS.CTRL_OR_CMD] &&
      event.shiftKey &&
      // KEYS.COMMA needed for MacOS
      (event.key === KEYS.CHEVRON_LEFT || event.key === KEYS.COMMA)
    );
  },
});

export const actionIncreaseFontSize = register({
  name: "increaseFontSize",
  label: "labels.increaseFontSize",
  icon: fontSizeIcon,
  trackEvent: false,
  perform: (elements, appState, value, app) => {
    return changeFontSize(elements, appState, app, (element) =>
      Math.round(element.fontSize * (1 + FONT_SIZE_RELATIVE_INCREASE_STEP)),
    );
  },
  keyTest: (event) => {
    return (
      event[KEYS.CTRL_OR_CMD] &&
      event.shiftKey &&
      // KEYS.PERIOD needed for MacOS
      (event.key === KEYS.CHEVRON_RIGHT || event.key === KEYS.PERIOD)
    );
  },
});

type ChangeFontFamilyData = Partial<
  Pick<
    AppState,
    "openPopup" | "currentItemFontFamily" | "currentHoveredFontFamily"
  >
> & {
  /** cache of selected & editing elements populated on opened popup */
  cachedElements?: ElementsMap;
  /** flag to reset all elements to their cached versions  */
  resetAll?: true;
  /** flag to reset all containers to their cached versions */
  resetContainers?: true;
};

export const actionChangeFontFamily = register<{
  currentItemFontFamily: any;
  currentHoveredFontFamily: any;
}>({
  name: "changeFontFamily",
  label: "labels.fontFamily",
  trackEvent: false,
  perform: (elements, appState, value, app) => {
    const { cachedElements, resetAll, resetContainers, ...nextAppState } =
      value as ChangeFontFamilyData;

    if (resetAll) {
      const nextElements = changeProperty(
        elements,
        appState,
        (element) => {
          const cachedElement = cachedElements?.get(element.id);
          if (cachedElement) {
            const newElement = newElementWith(element, {
              ...cachedElement,
            } as ElementUpdate<NonDeletedExcalidrawElement>);

            return newElement;
          }

          return element;
        },
        true,
      );

      return {
        elements: nextElements,
        appState: {
          ...appState,
          ...nextAppState,
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      };
    }

    invariant(value, "actionChangeFontFamily: value must be defined");

    const { currentItemFontFamily, currentHoveredFontFamily } = value;

    let nextCaptureUpdateAction: CaptureUpdateActionType =
      CaptureUpdateAction.EVENTUALLY;
    let nextFontFamily: FontFamilyValues | undefined;
    let skipOnHoverRender = false;

    if (currentItemFontFamily) {
      nextFontFamily = currentItemFontFamily;
      nextCaptureUpdateAction = CaptureUpdateAction.IMMEDIATELY;
    } else if (currentHoveredFontFamily) {
      nextFontFamily = currentHoveredFontFamily;
      nextCaptureUpdateAction = CaptureUpdateAction.EVENTUALLY;

      const selectedTextElements = getSelectedElements(elements, appState, {
        includeBoundTextElement: true,
      }).filter((element) => isTextElement(element));

      // skip on hover re-render for more than 200 text elements or for text element with more than 5000 chars combined
      if (selectedTextElements.length > 200) {
        skipOnHoverRender = true;
      } else {
        let i = 0;
        let textLengthAccumulator = 0;

        while (
          i < selectedTextElements.length &&
          textLengthAccumulator < 5000
        ) {
          const textElement = selectedTextElements[i] as ExcalidrawTextElement;
          textLengthAccumulator += textElement?.originalText.length || 0;
          i++;
        }

        if (textLengthAccumulator > 5000) {
          skipOnHoverRender = true;
        }
      }
    }

    const result = {
      appState: {
        ...appState,
        ...nextAppState,
      },
      captureUpdate: nextCaptureUpdateAction,
    };

    if (nextFontFamily && !skipOnHoverRender) {
      const elementContainerMapping = new Map<
        ExcalidrawTextElement,
        ExcalidrawElement | null
      >();
      const fontLoadRequests = new Map<
        string,
        {
          characters: Set<string>;
          weight: "400" | "700";
        }
      >();

      const fontsCache = Array.from(Fonts.loadedFontsCache.values());
      const fontFamily = Object.entries(FONT_FAMILY).find(
        ([_, value]) => value === nextFontFamily,
      )?.[0];

      // following causes re-render so make sure we changed the family
      // otherwise it could cause unexpected issues, such as preventing opening the popover when in wysiwyg
      Object.assign(result, {
        elements: changeProperty(
          elements,
          appState,
          (oldElement) => {
            if (
              isTextElement(oldElement) &&
              (oldElement.fontFamily !== nextFontFamily ||
                currentItemFontFamily) // force update on selection
            ) {
              const newElement: ExcalidrawTextElement = newElementWith(
                oldElement,
                {
                  fontFamily: nextFontFamily,
                  lineHeight: getLineHeight(nextFontFamily!),
                },
              );

              const cachedContainer =
                cachedElements?.get(oldElement.containerId || "") || {};

              const container = app.scene.getContainerElement(oldElement);

              if (resetContainers && container && cachedContainer) {
                // reset the container back to it's cached version
                app.scene.mutateElement(container, { ...cachedContainer });
              }

              const fontString = getFontString({
                fontFamily: nextFontFamily,
                fontSize: 10,
                fontWeight: newElement.fontWeight,
              });
              const request = fontLoadRequests.get(fontString) ?? {
                characters: new Set<string>(),
                weight: newElement.fontWeight === "bold" ? "700" : "400",
              };
              for (const character of newElement.originalText) {
                request.characters.add(character);
              }
              fontLoadRequests.set(fontString, request);

              elementContainerMapping.set(newElement, container);

              return newElement;
            }

            return oldElement;
          },
          true,
        ),
      });

      const requests = Array.from(
        fontLoadRequests,
        ([font, { characters, weight }]) => ({
          font,
          text: Array.from(characters).join(""),
          weight,
        }),
      );
      // Hover previews run frequently, so skip the expensive FontFaceSet check
      // only when the exact authored weight has already been processed.
      const skipFontFaceCheck =
        Boolean(currentHoveredFontFamily && fontFamily) &&
        requests.every(({ weight }) =>
          fontsCache.some((signature) =>
            signature.startsWith(`${fontFamily}-normal-${weight}-`),
          ),
        );
      const missingRequests = skipFontFaceCheck
        ? []
        : requests.filter(
            ({ font, text }) => !window.document.fonts.check(font, text),
          );

      if (missingRequests.length === 0) {
        // we either skip the check (have at least one font face loaded) or do the check and find out all the font faces have loaded
        for (const [element, container] of elementContainerMapping) {
          // trigger synchronous redraw
          redrawTextBoundingBox(element, container, app.scene);
        }
      } else {
        // Otherwise load every required authored weight and redraw only after
        // all requested faces resolve.
        Promise.all(
          missingRequests.map(({ font, text }) =>
            window.document.fonts.load(font, text),
          ),
        ).then((loadedFontFaces) => {
          for (const [element, container] of elementContainerMapping) {
            // use latest element state to ensure we don't have closure over an old instance in order to avoid possible race conditions (i.e. font faces load out-of-order while rapidly switching fonts)
            const latestElement = app.scene.getElement(element.id);
            const latestContainer = container
              ? app.scene.getElement(container.id)
              : null;

            if (latestElement) {
              // trigger async redraw
              redrawTextBoundingBox(
                latestElement as ExcalidrawTextElement,
                latestContainer,
                app.scene,
              );
            }
          }

          // trigger update once we've mutated all the elements, which also updates our cache
          app.fonts.onLoaded(loadedFontFaces.flat());
        });
      }
    }

    return result;
  },
  PanelComponent: ({ elements, appState, app, updateData, data }) => {
    const cachedElementsRef = useRef<ElementsMap>(new Map());
    const prevSelectedFontFamilyRef = useRef<number | null>(null);
    // relying on state batching as multiple `FontPicker` handlers could be called in rapid succession and we want to combine them
    const [batchedData, setBatchedData] = useState<ChangeFontFamilyData>({});
    const isUnmounted = useRef(true);
    const { stylesPanelMode, isCompact } = getStylesPanelInfo(app);

    const selectedFontFamily = useMemo(() => {
      const getFontFamily = (
        elementsArray: readonly ExcalidrawElement[],
        elementsMap: ElementsMap,
      ) =>
        getFormValue(
          elementsArray,
          app,
          (element) => {
            if (isTextElement(element)) {
              return element.fontFamily;
            }
            const boundTextElement = getBoundTextElement(element, elementsMap);
            if (boundTextElement) {
              return boundTextElement.fontFamily;
            }
            return null;
          },
          (element) =>
            isTextElement(element) ||
            getBoundTextElement(element, elementsMap) !== null,
          (hasSelection) =>
            hasSelection
              ? null
              : appState.currentItemFontFamily || DEFAULT_FONT_FAMILY,
        );

      // popup opened, use cached elements
      if (
        batchedData.openPopup === "fontFamily" &&
        appState.openPopup === "fontFamily"
      ) {
        return getFontFamily(
          Array.from(cachedElementsRef.current?.values() ?? []),
          cachedElementsRef.current,
        );
      }

      // popup closed, use all elements
      if (!batchedData.openPopup && appState.openPopup !== "fontFamily") {
        return getFontFamily(elements, app.scene.getNonDeletedElementsMap());
      }

      // popup props are not in sync, hence we are in the middle of an update, so keeping the previous value we've had
      return prevSelectedFontFamilyRef.current;
    }, [batchedData.openPopup, appState, elements, app]);

    useEffect(() => {
      prevSelectedFontFamilyRef.current = selectedFontFamily;
    }, [selectedFontFamily]);

    useEffect(() => {
      if (Object.keys(batchedData).length) {
        updateData(batchedData);
        // reset the data after we've used the data
        setBatchedData({});
      }
      // call update only on internal state changes
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [batchedData]);

    useEffect(() => {
      isUnmounted.current = false;

      return () => {
        isUnmounted.current = true;
      };
    }, []);

    return (
      <>
        {stylesPanelMode === "full" && !data?.contextToolbar && (
          <legend>{t("labels.fontFamily")}</legend>
        )}
        <FontPicker
          isOpened={appState.openPopup === "fontFamily"}
          selectedFontFamily={selectedFontFamily}
          hoveredFontFamily={appState.currentHoveredFontFamily}
          compactMode={data?.contextToolbar || stylesPanelMode !== "full"}
          onSelect={(fontFamily) => {
            withCaretPositionPreservation(
              () => {
                setBatchedData({
                  openPopup: null,
                  currentHoveredFontFamily: null,
                  currentItemFontFamily: fontFamily,
                });
                // defensive clear so immediate close won't abuse the cached elements
                cachedElementsRef.current.clear();
              },
              isCompact,
              !!appState.editingTextElement,
            );
          }}
          onHover={(fontFamily) => {
            setBatchedData({
              currentHoveredFontFamily: fontFamily,
              cachedElements: new Map(cachedElementsRef.current),
              resetContainers: true,
            });
          }}
          onLeave={() => {
            setBatchedData({
              currentHoveredFontFamily: null,
              cachedElements: new Map(cachedElementsRef.current),
              resetAll: true,
            });
          }}
          onPopupChange={(open) => {
            if (open) {
              // open, populate the cache from scratch
              cachedElementsRef.current.clear();

              const { editingTextElement } = appState;

              // still check type to be safe
              if (editingTextElement?.type === "text") {
                // retrieve the latest version from the scene, as `editingTextElement` isn't mutated
                const latesteditingTextElement = app.scene.getElement(
                  editingTextElement.id,
                );

                // inside the wysiwyg editor
                cachedElementsRef.current.set(
                  editingTextElement.id,
                  newElementWith(
                    latesteditingTextElement || editingTextElement,
                    {},
                    true,
                  ),
                );
              } else {
                const selectedElements = getSelectedElements(
                  elements,
                  appState,
                  {
                    includeBoundTextElement: true,
                  },
                );

                for (const element of selectedElements) {
                  cachedElementsRef.current.set(
                    element.id,
                    newElementWith(element, {}, true),
                  );
                }
              }

              setBatchedData({
                ...batchedData,
                openPopup: "fontFamily",
              });
            } else {
              const fontFamilyData = {
                currentHoveredFontFamily: null,
                cachedElements: new Map(cachedElementsRef.current),
                resetAll: true,
              } as ChangeFontFamilyData;

              setBatchedData({
                ...fontFamilyData,
              });
              cachedElementsRef.current.clear();

              // Refocus text editor when font picker closes if we were editing text
              if (isCompact && appState.editingTextElement) {
                restoreCaretPosition(null); // Just refocus without saved position
              }
            }
          }}
        />
      </>
    );
  },
});

export const actionChangeTextAlign = register<TextAlign>({
  name: "changeTextAlign",
  label: "Change text alignment",
  trackEvent: false,
  perform: (elements, appState, value, app) => {
    return {
      elements: changeProperty(
        elements,
        appState,
        (oldElement) => {
          if (isTextElement(oldElement)) {
            const newElement: ExcalidrawTextElement = newElementWith(
              oldElement,
              { textAlign: value },
            );
            redrawTextBoundingBox(
              newElement,
              app.scene.getContainerElement(oldElement),
              app.scene,
            );
            return newElement;
          }

          return oldElement;
        },
        true,
      ),
      appState: {
        ...appState,
        currentItemTextAlign: DEFAULT_NEW_TEXT_ALIGN,
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  PanelComponent: ({ elements, appState, updateData, app, data }) => {
    const elementsMap = app.scene.getNonDeletedElementsMap();
    const { isCompact } = getStylesPanelInfo(app);

    return (
      <fieldset className={data?.contextToolbar ? "context-fieldset" : ""}>
        {!data?.contextToolbar && <legend>{t("labels.textAlign")}</legend>}
        <div className="buttonList">
          <RadioSelection<TextAlign | false>
            group="text-align"
            options={[
              {
                value: "left",
                text: t("labels.left"),
                icon: TextAlignLeftIcon,
                testId: "align-left",
              },
              {
                value: "center",
                text: t("labels.center"),
                icon: TextAlignCenterIcon,
                testId: "align-horizontal-center",
              },
              {
                value: "right",
                text: t("labels.right"),
                icon: TextAlignRightIcon,
                testId: "align-right",
              },
            ]}
            value={getFormValue(
              elements,
              app,
              (element) => {
                if (isTextElement(element)) {
                  return element.textAlign;
                }
                const boundTextElement = getBoundTextElement(
                  element,
                  elementsMap,
                );
                if (boundTextElement) {
                  return boundTextElement.textAlign;
                }
                return null;
              },
              (element) =>
                isTextElement(element) ||
                getBoundTextElement(element, elementsMap) !== null,
              (hasSelection) => (hasSelection ? null : DEFAULT_NEW_TEXT_ALIGN),
            )}
            onChange={(value) => {
              withCaretPositionPreservation(
                () => updateData(value),
                isCompact,
                !!appState.editingTextElement,
                data?.onPreventClose,
              );
            }}
          />
        </div>
      </fieldset>
    );
  },
});

export const actionChangeVerticalAlign = register<VerticalAlign>({
  name: "changeVerticalAlign",
  label: "Change vertical alignment",
  trackEvent: { category: "element" },
  perform: (elements, appState, value, app) => {
    return {
      elements: changeProperty(
        elements,
        appState,
        (oldElement) => {
          if (isTextElement(oldElement)) {
            const newElement: ExcalidrawTextElement = newElementWith(
              oldElement,
              { verticalAlign: value },
            );

            redrawTextBoundingBox(
              newElement,
              app.scene.getContainerElement(oldElement),
              app.scene,
            );
            return newElement;
          }

          return oldElement;
        },
        true,
      ),
      appState: {
        ...appState,
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  PanelComponent: ({ elements, appState, updateData, app, data }) => {
    const { isCompact } = getStylesPanelInfo(app);
    return (
      <fieldset>
        <div className="buttonList">
          <RadioSelection<VerticalAlign | false>
            group="text-align"
            options={[
              {
                value: VERTICAL_ALIGN.TOP,
                text: t("labels.alignTop"),
                icon: <TextAlignTopIcon theme={appState.theme} />,
                testId: "align-top",
              },
              {
                value: VERTICAL_ALIGN.MIDDLE,
                text: t("labels.centerVertically"),
                icon: <TextAlignMiddleIcon theme={appState.theme} />,
                testId: "align-middle",
              },
              {
                value: VERTICAL_ALIGN.BOTTOM,
                text: t("labels.alignBottom"),
                icon: <TextAlignBottomIcon theme={appState.theme} />,
                testId: "align-bottom",
              },
            ]}
            value={getFormValue(
              elements,
              app,
              (element) => {
                if (isTextElement(element) && element.containerId) {
                  return element.verticalAlign;
                }
                const boundTextElement = getBoundTextElement(
                  element,
                  app.scene.getNonDeletedElementsMap(),
                );
                if (boundTextElement) {
                  return boundTextElement.verticalAlign;
                }
                return null;
              },
              (element) =>
                isTextElement(element) ||
                getBoundTextElement(
                  element,
                  app.scene.getNonDeletedElementsMap(),
                ) !== null,
              (hasSelection) => (hasSelection ? null : VERTICAL_ALIGN.MIDDLE),
            )}
            onChange={(value) => {
              withCaretPositionPreservation(
                () => updateData(value),
                isCompact,
                !!appState.editingTextElement,
                data?.onPreventClose,
              );
            }}
          />
        </div>
      </fieldset>
    );
  },
});

const CornerRadiusInput = ({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number) => void;
}) => {
  const [inputValue, setInputValue] = useState(value?.toString() ?? "");
  const cancelledRef = useRef(false);

  useEffect(() => {
    setInputValue(value?.toString() ?? "");
  }, [value]);

  const commit = () => {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }

    const parsed = Number(inputValue);
    if (!inputValue.trim() || !Number.isFinite(parsed)) {
      setInputValue(value?.toString() ?? "");
      return;
    }

    const nextValue = normalizeCornerRadius(parsed);
    setInputValue(nextValue.toString());
    if (nextValue !== value) {
      onChange(nextValue);
    }
  };

  return (
    <label className="corner-radius-input" data-prevent-outside-click>
      <input
        aria-label="Exact corner radius"
        data-testid="corner-radius-input"
        type="number"
        inputMode="numeric"
        min={CORNER_RADIUS.min}
        max={CORNER_RADIUS.max}
        step={CORNER_RADIUS.step}
        value={inputValue}
        placeholder="Mixed"
        onChange={(event) => setInputValue(event.target.value)}
        onBlur={commit}
        onWheel={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === KEYS.ENTER) {
            event.preventDefault();
            commit();
          } else if (event.key === KEYS.ESCAPE) {
            event.preventDefault();
            cancelledRef.current = true;
            setInputValue(value?.toString() ?? "");
            event.currentTarget.blur();
          }
        }}
      />
      <span>px</span>
    </label>
  );
};

export const actionChangeRoundness = register<number | "sharp" | "round">({
  name: "changeRoundness",
  label: "Change edge roundness",
  trackEvent: false,
  perform: (elements, appState, value) => {
    if (typeof value === "number") {
      const selectedElements = getSelectedElements(elements, appState);
      if (
        selectedElements.length > 0 &&
        !selectedElements.every(canChangeCornerRadiusForElement)
      ) {
        return false;
      }

      const radius = normalizeCornerRadius(value);
      return {
        elements: changeProperty(elements, appState, (element) => {
          if (!canChangeCornerRadiusForElement(element)) {
            return element;
          }

          return newElementWith(element, {
            roundness:
              radius === CORNER_RADIUS.min
                ? null
                : {
                    type:
                      isTextElement(element) ||
                      isUsingAdaptiveRadius(element.type)
                        ? ROUNDNESS.ADAPTIVE_RADIUS
                        : ROUNDNESS.PROPORTIONAL_RADIUS,
                    value: radius,
                  },
          });
        }),
        appState: {
          ...appState,
          currentItemCornerRadius: radius,
        },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      };
    }

    return {
      elements: changeProperty(elements, appState, (el) => {
        if (isElbowArrow(el)) {
          return el;
        }

        return newElementWith(el, {
          roundness:
            value === "round"
              ? {
                  type: isUsingAdaptiveRadius(el.type)
                    ? ROUNDNESS.ADAPTIVE_RADIUS
                    : ROUNDNESS.PROPORTIONAL_RADIUS,
                }
              : null,
        });
      }),
      appState: {
        ...appState,
        currentItemRoundness: value,
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  PanelComponent: ({ elements, appState, updateData, app, renderAction }) => {
    const targetElements = getTargetElements(
      getNonDeletedElements(elements),
      appState,
    );

    const hasLegacyRoundness = targetElements.some(
      (el) => el.roundness?.type === ROUNDNESS.LEGACY,
    );

    const hasSelection = targetElements.length > 0;
    const usesContinuousCornerRadius = hasSelection
      ? targetElements.every(canChangeCornerRadiusForElement)
      : canChangeCornerRadius(appState.activeTool.type);

    if (usesContinuousCornerRadius) {
      const value = getFormValue(
        elements,
        app,
        getRequestedCornerRadius,
        canChangeCornerRadiusForElement,
        (selectionExists) =>
          selectionExists
            ? null
            : appState.currentItemCornerRadius ??
              getDefaultCornerRadiusForElementType(appState.activeTool.type),
      );

      return (
        <fieldset
          className="corner-radius-fieldset"
          data-prevent-outside-click
          onPointerDown={(event) => event.stopPropagation()}
        >
          <legend>Rounding</legend>
          <div
            className="corner-radius-presets"
            role="group"
            aria-label="Corner radius presets"
          >
            {CORNER_RADIUS.presets.map((preset) => (
              <button
                key={preset}
                type="button"
                aria-label={`Set corner radius to ${preset} px`}
                aria-pressed={value === preset}
                data-testid={`corner-radius-preset-${preset}`}
                onClick={() => updateData(preset)}
              >
                {preset}
              </button>
            ))}
          </div>
          <Range
            ariaLabel="Corner radius"
            className="corner-radius-range"
            label={null}
            value={
              value ??
              appState.currentItemCornerRadius ??
              getDefaultCornerRadiusForElementType(appState.activeTool.type)
            }
            hasCommonValue={value !== null}
            onChange={(nextValue) => updateData(nextValue)}
            min={CORNER_RADIUS.min}
            max={CORNER_RADIUS.max}
            step={CORNER_RADIUS.step}
            minLabel={null}
            maxLabel={null}
            preventCanvasInteraction
            showValueBubble={false}
            testId="corner-radius-slider"
          />
          <CornerRadiusInput
            value={value}
            onChange={(nextValue) => updateData(nextValue)}
          />
        </fieldset>
      );
    }

    if (
      hasSelection &&
      !targetElements.every((element) => isLineElement(element))
    ) {
      return null;
    }

    return (
      <fieldset>
        <legend>{t("labels.edges")}</legend>
        <div className="buttonList">
          <RadioSelection
            group="edges"
            options={[
              {
                value: "sharp",
                text: t("labels.sharp"),
                icon: EdgeSharpIcon,
              },
              {
                value: "round",
                text: t("labels.round"),
                icon: EdgeRoundIcon,
              },
            ]}
            value={getFormValue(
              elements,
              app,
              (element) =>
                hasLegacyRoundness
                  ? null
                  : element.roundness
                  ? "round"
                  : "sharp",
              (element) =>
                !isArrowElement(element) && element.hasOwnProperty("roundness"),
              (hasSelection) =>
                hasSelection ? null : appState.currentItemRoundness,
            )}
            onChange={(value) => updateData(value)}
          />
          {renderAction("togglePolygon")}
        </div>
      </fieldset>
    );
  },
});

const getArrowheadOptions = (flip: boolean) => {
  return {
    visibleSections: [
      {
        name: "default",
        options: [
          {
            value: null,
            text: t("labels.arrowhead_none"),
            keyBinding: "q",
            icon: <ArrowheadNoneIcon flip={flip} />,
          },
          {
            value: "arrow",
            text: t("labels.arrowhead_arrow"),
            keyBinding: "w",
            icon: <ArrowheadArrowIcon flip={flip} />,
          },
          {
            value: "triangle",
            text: t("labels.arrowhead_triangle"),
            icon: <ArrowheadTriangleIcon flip={flip} />,
            keyBinding: "e",
          },
          {
            value: "triangle_outline",
            text: t("labels.arrowhead_triangle_outline"),
            icon: <ArrowheadTriangleOutlineIcon flip={flip} />,
            keyBinding: "r",
          },
        ],
      },
    ],
    hiddenSections: [
      {
        name: "default",
        options: [
          {
            value: "circle",
            text: t("labels.arrowhead_circle"),
            keyBinding: "a",
            icon: <ArrowheadCircleIcon flip={flip} />,
          },
          {
            value: "circle_outline",
            text: t("labels.arrowhead_circle_outline"),
            keyBinding: "s",
            icon: <ArrowheadCircleOutlineIcon flip={flip} />,
          },
          {
            value: "diamond",
            text: t("labels.arrowhead_diamond"),
            icon: <ArrowheadDiamondIcon flip={flip} />,
            keyBinding: "d",
          },
          {
            value: "diamond_outline",
            text: t("labels.arrowhead_diamond_outline"),
            icon: <ArrowheadDiamondOutlineIcon flip={flip} />,
            keyBinding: "f",
          },
          {
            value: "bar",
            text: t("labels.arrowhead_bar"),
            keyBinding: "z",
            icon: <ArrowheadBarIcon flip={flip} />,
          },
        ],
      },
      {
        name: t("labels.cardinality"),
        options: [
          {
            value: "cardinality_one",
            text: t("labels.arrowhead_cardinality_one"),
            icon: <ArrowheadCardinalityOneIcon flip={flip} />,
            keyBinding: "x",
          },
          {
            value: "cardinality_many",
            text: t("labels.arrowhead_cardinality_many"),
            icon: <ArrowheadCardinalityManyIcon flip={flip} />,
            keyBinding: "c",
          },
          {
            value: "cardinality_one_or_many",
            text: t("labels.arrowhead_cardinality_one_or_many"),
            icon: <ArrowheadCardinalityOneOrManyIcon flip={flip} />,
            keyBinding: "v",
          },
          {
            value: "cardinality_exactly_one",
            text: t("labels.arrowhead_cardinality_exactly_one"),
            icon: <ArrowheadCardinalityExactlyOneIcon flip={flip} />,
            keyBinding: null,
          },
          {
            value: "cardinality_zero_or_one",
            text: t("labels.arrowhead_cardinality_zero_or_one"),
            icon: <ArrowheadCardinalityZeroOrOneIcon flip={flip} />,
            keyBinding: null,
          },
          {
            value: "cardinality_zero_or_many",
            text: t("labels.arrowhead_cardinality_zero_or_many"),
            icon: <ArrowheadCardinalityZeroOrManyIcon flip={flip} />,
            keyBinding: null,
          },
        ],
      },
    ],
  } as const;
};

export const actionChangeArrowhead = register<{
  position: "start" | "end";
  type: Arrowhead;
}>({
  name: "changeArrowhead",
  label: "Change arrowheads",
  trackEvent: false,
  perform: (elements, appState, value) => {
    invariant(value, "actionChangeArrowhead: value must be defined");

    return {
      elements: changeProperty(elements, appState, (el) => {
        if (isLinearElement(el)) {
          const { position, type } = value;

          if (position === "start") {
            const element: ExcalidrawLinearElement = newElementWith(el, {
              startArrowhead: type,
            });
            return element;
          } else if (position === "end") {
            const element: ExcalidrawLinearElement = newElementWith(el, {
              endArrowhead: type,
            });
            return element;
          }
        }

        return el;
      }),
      appState: {
        ...appState,
        [value.position === "start"
          ? "currentItemStartArrowhead"
          : "currentItemEndArrowhead"]: value.type,
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  PanelComponent: ({ elements, appState, updateData, app }) => {
    const isRTL = getLanguage().rtl;
    const startArrowheadOptions = useMemo(
      () => getArrowheadOptions(!isRTL),
      [isRTL],
    );
    const endArrowheadOptions = useMemo(
      () => getArrowheadOptions(!!isRTL),
      [isRTL],
    );

    return (
      <fieldset>
        <legend>{t("labels.arrowheads")}</legend>
        <div className="iconSelectList buttonList">
          <IconPicker
            visibleSections={startArrowheadOptions.visibleSections}
            hiddenSections={startArrowheadOptions.hiddenSections}
            label="arrowhead_start"
            value={getFormValue<Arrowhead | null>(
              elements,
              app,
              (element) =>
                isLinearElement(element) && canHaveArrowheads(element.type)
                  ? getArrowheadForPicker(element.startArrowhead)
                  : appState.currentItemStartArrowhead,
              true,
              (hasSelection) =>
                hasSelection ? null : appState.currentItemStartArrowhead,
            )}
            onChange={(value) => updateData({ position: "start", type: value })}
          />
          <IconPicker
            visibleSections={endArrowheadOptions.visibleSections}
            hiddenSections={endArrowheadOptions.hiddenSections}
            label="arrowhead_end"
            value={getFormValue<Arrowhead | null>(
              elements,
              app,
              (element) =>
                isLinearElement(element) && canHaveArrowheads(element.type)
                  ? getArrowheadForPicker(element.endArrowhead)
                  : appState.currentItemEndArrowhead,
              true,
              (hasSelection) =>
                hasSelection ? null : appState.currentItemEndArrowhead,
            )}
            onChange={(value) => updateData({ position: "end", type: value })}
          />
        </div>
      </fieldset>
    );
  },
});

export const actionChangeArrowProperties = register({
  name: "changeArrowProperties",
  label: "Change arrow properties",
  trackEvent: false,
  perform: (elements, appState, value, app) => {
    // This action doesn't perform any changes directly
    // It's just a container for the arrow type and arrowhead actions
    return false;
  },
  PanelComponent: ({ elements, appState, updateData, app, renderAction }) => {
    return (
      <div className="selected-shape-actions">
        {renderAction("changeArrowhead")}
        {renderAction("changeArrowType")}
      </div>
    );
  },
});

export const actionChangeArrowType = register<keyof typeof ARROW_TYPE>({
  name: "changeArrowType",
  label: "Change arrow types",
  trackEvent: false,
  perform: (elements, appState, value, app) => {
    const newElements = changeProperty(elements, appState, (el) => {
      if (!isArrowElement(el)) {
        return el;
      }
      const elementsMap = app.scene.getNonDeletedElementsMap();
      const startPoint = LinearElementEditor.getPointAtIndexGlobalCoordinates(
        el,
        0,
        elementsMap,
      );
      const endPoint = LinearElementEditor.getPointAtIndexGlobalCoordinates(
        el,
        -1,
        elementsMap,
      );
      let newElement = newElementWith(el, {
        x: value === ARROW_TYPE.elbow ? startPoint[0] : el.x,
        y: value === ARROW_TYPE.elbow ? startPoint[1] : el.y,
        roundness:
          value === ARROW_TYPE.round
            ? {
                type: ROUNDNESS.PROPORTIONAL_RADIUS,
              }
            : null,
        elbowed: value === ARROW_TYPE.elbow,
        angle: value === ARROW_TYPE.elbow ? (0 as Radians) : el.angle,
        points:
          value === ARROW_TYPE.elbow || el.elbowed
            ? [
                LinearElementEditor.pointFromAbsoluteCoords(
                  {
                    ...el,
                    x: startPoint[0],
                    y: startPoint[1],
                    angle: 0 as Radians,
                  },
                  startPoint,
                  elementsMap,
                ),
                LinearElementEditor.pointFromAbsoluteCoords(
                  {
                    ...el,
                    x: startPoint[0],
                    y: startPoint[1],
                    angle: 0 as Radians,
                  },
                  endPoint,
                  elementsMap,
                ),
              ]
            : el.points,
      });

      if (isElbowArrow(newElement)) {
        newElement.fixedSegments = null;

        const elementsMap = app.scene.getNonDeletedElementsMap();

        app.dismissLinearEditor();

        const startGlobalPoint =
          LinearElementEditor.getPointAtIndexGlobalCoordinates(
            newElement,
            0,
            elementsMap,
          );
        const endGlobalPoint =
          LinearElementEditor.getPointAtIndexGlobalCoordinates(
            newElement,
            -1,
            elementsMap,
          );
        const startElement =
          newElement.startBinding &&
          (elementsMap.get(
            newElement.startBinding.elementId,
          ) as ExcalidrawBindableElement);
        const endElement =
          newElement.endBinding &&
          (elementsMap.get(
            newElement.endBinding.elementId,
          ) as ExcalidrawBindableElement);

        const startBinding =
          startElement && newElement.startBinding
            ? {
                // @ts-ignore TS cannot discern check above
                ...newElement.startBinding!,
                ...calculateFixedPointForElbowArrowBinding(
                  newElement,
                  startElement,
                  "start",
                  elementsMap,
                  appState.isBindingEnabled,
                ),
              }
            : null;
        const endBinding =
          endElement && newElement.endBinding
            ? {
                // @ts-ignore TS cannot discern check above
                ...newElement.endBinding,
                ...calculateFixedPointForElbowArrowBinding(
                  newElement,
                  endElement,
                  "end",
                  elementsMap,
                  appState.isBindingEnabled,
                ),
              }
            : null;

        newElement = {
          ...newElement,
          startBinding,
          endBinding,
          ...updateElbowArrowPoints(newElement, elementsMap, {
            points: [startGlobalPoint, endGlobalPoint].map(
              (p): LocalPoint =>
                pointFrom(p[0] - newElement.x, p[1] - newElement.y),
            ),
            startBinding,
            endBinding,
            fixedSegments: null,
          }),
        } as typeof newElement;
      } else {
        const elementsMap = app.scene.getNonDeletedElementsMap();
        if (newElement.startBinding) {
          const startElement = elementsMap.get(
            newElement.startBinding.elementId,
          ) as NonDeleted<ExcalidrawBindableElement>;
          if (startElement) {
            bindBindingElement(
              newElement,
              startElement,
              appState.bindMode === "inside" ? "inside" : "orbit",
              "start",
              app.scene,
            );
          }
        }
        if (newElement.endBinding) {
          const endElement = elementsMap.get(
            newElement.endBinding.elementId,
          ) as NonDeleted<ExcalidrawBindableElement>;
          if (endElement) {
            bindBindingElement(
              newElement,
              endElement,
              appState.bindMode === "inside" ? "inside" : "orbit",
              "end",
              app.scene,
            );
          }
        }
      }

      return newElement;
    });

    const newState = {
      ...appState,
      currentItemArrowType: value,
    };

    // Change the arrow type and update any other state settings for
    // the arrow.
    const selectedId = appState.selectedLinearElement?.elementId;
    if (selectedId) {
      const selected = newElements.find((el) => el.id === selectedId);
      if (selected) {
        newState.selectedLinearElement = new LinearElementEditor(
          selected as NonDeleted<ExcalidrawLinearElement>,
          arrayToMap(elements),
        );
      }
    }

    return {
      elements: newElements,
      appState: newState,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  PanelComponent: ({ elements, appState, updateData, app }) => {
    return (
      <fieldset>
        <legend>{t("labels.arrowtypes")}</legend>
        <div className="buttonList">
          <RadioSelection
            group="arrowtypes"
            options={[
              {
                value: ARROW_TYPE.sharp,
                text: t("labels.arrowtype_sharp"),
                icon: sharpArrowIcon,
                testId: "sharp-arrow",
              },
              {
                value: ARROW_TYPE.round,
                text: t("labels.arrowtype_round"),
                icon: roundArrowIcon,
                testId: "round-arrow",
              },
              {
                value: ARROW_TYPE.elbow,
                text: t("labels.arrowtype_elbowed"),
                icon: elbowArrowIcon,
                testId: "elbow-arrow",
              },
            ]}
            value={getFormValue(
              elements,
              app,
              (element) => {
                if (isArrowElement(element)) {
                  return element.elbowed
                    ? ARROW_TYPE.elbow
                    : element.roundness
                    ? ARROW_TYPE.round
                    : ARROW_TYPE.sharp;
                }

                return null;
              },
              (element) => isArrowElement(element),
              (hasSelection) =>
                hasSelection ? null : appState.currentItemArrowType,
            )}
            onChange={(value) => updateData(value)}
          />
        </div>
      </fieldset>
    );
  },
});
