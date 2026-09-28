import clsx from "clsx";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Popover } from "radix-ui";

import {
  CLASSES,
  FONT_FAMILY,
  deriveStylesPanelMode,
} from "@excalidraw/common";

import {
  getSmartShapeMetadata,
  hasStrokeColor,
  hasVectorStrokeWidth,
  isArrowElement,
  isImageElement,
  isInitializedImageElement,
  isNonDeletedElement,
  isTextElement,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  NonDeletedElementsMap,
  NonDeletedSceneElementsMap,
} from "@excalidraw/element/types";

import { actionToggleZenMode } from "../actions";

import { t } from "../i18n";
import {
  canChangeRoundness,
  canHaveArrowheads,
  getTargetElements,
  hasBackground,
  hasFreedrawMode,
  hasStrokeStyle,
  hasStrokeWidth,
} from "../scene";

import {
  canChangeTextBackgroundPadding,
  getFormValue,
} from "../actions/actionProperties";

import { useTextEditorFocus } from "../hooks/useTextEditorFocus";

import { actionToggleViewMode } from "../actions/actionToggleViewMode";

import "./Actions.scss";

import { useExcalidrawContainer } from "./App";
import Stack from "./Stack";
import { Tooltip } from "./Tooltip";
import { PropertiesPopover } from "./PropertiesPopover";
import { LaserToolbarSection } from "./LaserToolbarSection";
import {
  sharpArrowIcon,
  roundArrowIcon,
  elbowArrowIcon,
  TextSizeIcon,
  adjustmentsIcon,
  DotsHorizontalIcon,
  pencilIcon,
} from "./icons";

import { Island } from "./Island";

import { getShapeActionPredicates } from "./shapeActionPredicates";

import type { ShapeActionPredicates } from "./shapeActionPredicates";
import type { AppClassProperties, UIAppState, AppState } from "../types";
import type { ActionManager } from "../actions/manager";
import type { ImageBackgroundRemovalProgress } from "../types";

// re-exported for consumers outside the styles panel (e.g. CommandPalette)
export {
  canChangeStrokeColor,
  canChangeBackgroundColor,
} from "./shapeActionPredicates";

// Common CSS class combinations
const PROPERTIES_CLASSES = clsx([
  CLASSES.SHAPE_ACTIONS_THEME_SCOPE,
  "properties-content",
]);

const isUnboundTextElement = (element: ExcalidrawElement) =>
  isTextElement(element) && !element.containerId;

const hasExclusiveVectorStrokeTarget = (
  appState: UIAppState,
  targetElements: readonly ExcalidrawElement[],
) => {
  if (targetElements.length === 0) {
    return hasVectorStrokeWidth(appState.activeTool.type);
  }

  const vectorIds = new Set(
    targetElements
      .filter((element) => hasVectorStrokeWidth(element.type))
      .map((element) => element.id),
  );

  return (
    vectorIds.size > 0 &&
    targetElements.every(
      (element) =>
        hasVectorStrokeWidth(element.type) ||
        (isTextElement(element) &&
          !!element.containerId &&
          vectorIds.has(element.containerId)),
    )
  );
};

export const ImageBackgroundRemovalAction = ({
  app,
  targetElements,
  compact = false,
}: {
  app: AppClassProperties;
  targetElements: readonly ExcalidrawElement[];
  compact?: boolean;
}) => {
  const controllerRef = useRef<AbortController | null>(null);
  const [progress, setProgress] =
    useState<ImageBackgroundRemovalProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const element =
    targetElements.length === 1 &&
    isInitializedImageElement(targetElements[0]) &&
    isNonDeletedElement(targetElements[0]) &&
    !targetElements[0].locked
      ? targetElements[0]
      : null;
  const file = element ? app.files[element.fileId] : null;
  const supported =
    file?.mimeType === "image/jpeg" ||
    file?.mimeType === "image/png" ||
    file?.mimeType === "image/webp";
  const cachedImage = element
    ? app.imageCache.get(element.fileId)?.image
    : null;
  const resolvedImage =
    typeof HTMLImageElement !== "undefined" &&
    cachedImage instanceof HTMLImageElement
      ? cachedImage
      : null;
  const oversized =
    !!resolvedImage &&
    resolvedImage.naturalWidth * resolvedImage.naturalHeight > 10_000_000;
  const sourceKey = element
    ? `${element.id}:${element.fileId}:${element.version}`
    : "none";

  useEffect(
    () => () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    },
    [sourceKey],
  );

  const handler = app.props.onImageBackgroundRemoval;
  if (!handler || !element || !file || !supported) {
    return null;
  }

  const running = !!progress;
  const label = running
    ? progress.message
    : error
    ? "Retry background removal"
    : "Remove background";

  return (
    <div
      className={clsx("image-background-removal", {
        "image-background-removal--compact": compact,
      })}
    >
      <button
        type="button"
        className="image-background-removal__button"
        disabled={running || oversized}
        aria-busy={running}
        title={
          oversized ? "Images must be 10 megapixels or smaller." : undefined
        }
        onClick={async () => {
          const controller = new AbortController();
          controllerRef.current = controller;
          setError(null);
          setProgress({
            stage: "preparing",
            message: "Preparing local model…",
          });
          try {
            await handler({
              element,
              file,
              signal: controller.signal,
              onProgress: setProgress,
            });
            setProgress(null);
          } catch (caught) {
            setProgress(null);
            if (
              !(caught instanceof DOMException && caught.name === "AbortError")
            ) {
              setError(
                caught instanceof Error
                  ? caught.message
                  : "Local background removal failed. Your image was not changed.",
              );
            }
          } finally {
            if (controllerRef.current === controller) {
              controllerRef.current = null;
            }
          }
        }}
      >
        {label}
        {running && progress.progress !== undefined
          ? ` ${Math.round(progress.progress * 100)}%`
          : ""}
      </button>
      {oversized && (
        <span className="image-background-removal__message" role="status">
          Images must be 10 megapixels or smaller.
        </span>
      )}
      {error && (
        <span
          className="image-background-removal__message"
          role="alert"
          aria-live="polite"
        >
          {error}
        </span>
      )}
      {running && (
        <span
          className="image-background-removal__sr-status"
          aria-live="polite"
        >
          {label}
        </span>
      )}
    </div>
  );
};

/**
 * The "arrange" (z-order) fieldset, identical across every styles-panel layout.
 */
const LayersFieldset = ({
  renderAction,
}: {
  renderAction: ActionManager["renderAction"];
}) => (
  <fieldset>
    <legend>{t("labels.layers")}</legend>
    <div className="buttonList">
      {renderAction("sendToBack")}
      {renderAction("sendBackward")}
      {renderAction("bringForward")}
      {renderAction("bringToFront")}
    </div>
  </fieldset>
);

/**
 * Full styles panel: the wide, always-expanded layout used on desktop when the
 * UI is in "full" mode.
 */
export const SelectedShapeActions = ({
  appState,
  elementsMap,
  renderAction,
  app,
}: {
  appState: UIAppState;
  elementsMap: NonDeletedElementsMap | NonDeletedSceneElementsMap;
  renderAction: ActionManager["renderAction"];
  app: AppClassProperties;
}) => {
  const targetElements = getTargetElements(elementsMap, appState);
  const predicates = getShapeActionPredicates(
    appState,
    targetElements,
    elementsMap,
    app,
  );
  const isImageSelection =
    targetElements.length > 0 && targetElements.every(isImageElement);
  const isExclusiveVectorStrokeTarget = hasExclusiveVectorStrokeTarget(
    appState,
    targetElements,
  );
  const hasExclusiveTextTarget =
    (!!appState.editingTextElement &&
      !appState.editingTextElement.containerId) ||
    (targetElements.length > 0 && targetElements.every(isUnboundTextElement));
  const hasSmartShape =
    targetElements.length === 1 &&
    !targetElements[0].locked &&
    !!getSmartShapeMetadata(targetElements[0]);

  return (
    <div className="selected-shape-actions">
      <div>
        {predicates.strokeColor &&
          !isImageSelection &&
          renderAction("changeStrokeColor")}
      </div>
      {predicates.backgroundColor && (
        <div>{renderAction("changeBackgroundColor")}</div>
      )}
      {predicates.fill && renderAction("changeFillStyle")}

      {predicates.strokeWidth &&
        !isImageSelection &&
        renderAction(
          isExclusiveVectorStrokeTarget
            ? "changeVectorStrokeWidth"
            : "changeStrokeWidth",
        )}

      {predicates.strokeStyle && <>{renderAction("changeStrokeStyle")}</>}

      {predicates.freedrawMode && renderAction("changeFreedrawMode")}

      {predicates.sloppiness && <>{renderAction("changeSloppiness")}</>}

      {predicates.roundness && <>{renderAction("changeRoundness")}</>}

      {predicates.arrowType && <>{renderAction("changeArrowType")}</>}

      {predicates.text && !hasExclusiveTextTarget && (
        <>
          <fieldset>{renderAction("changeFontFamily")}</fieldset>
          {renderAction("changeFontSize")}
          {renderAction("changeTextStyle")}
          {renderAction("changeLineHeight")}
          {predicates.textAlign && renderAction("changeTextAlign")}
        </>
      )}

      {predicates.verticalAlign && renderAction("changeVerticalAlign")}
      {predicates.arrowheads && <>{renderAction("changeArrowhead")}</>}

      {predicates.opacity && renderAction("changeOpacity")}
      {hasSmartShape && renderAction("changeSmartShape")}

      {predicates.layers && <LayersFieldset renderAction={renderAction} />}

      {predicates.showExtraActions && (
        <fieldset>
          <legend>{t("labels.actions")}</legend>
          <div className="buttonList">
            {renderAction("duplicateSelection")}
            {renderAction("deleteSelectedElements")}
            {renderAction("group")}
            {renderAction("ungroup")}
            {predicates.link && renderAction("hyperlink")}
            {predicates.cropEditor && renderAction("cropEditor")}
            {predicates.lineEditor && renderAction("toggleLinearEditor")}
          </div>
        </fieldset>
      )}
    </div>
  );
};

export const ContextualPropertiesToolbar = ({
  appState,
  elementsMap,
  renderAction,
  app,
}: {
  appState: UIAppState;
  elementsMap: NonDeletedElementsMap | NonDeletedSceneElementsMap;
  renderAction: ActionManager["renderAction"];
  app: AppClassProperties;
}) => {
  const targetElements = getTargetElements(elementsMap, appState);
  const hasFullStylesPanel =
    deriveStylesPanelMode(app.editorInterface) === "full";
  const isLaserTarget =
    hasFullStylesPanel && appState.activeTool.type === "laser";

  if (isLaserTarget) {
    return appState.viewModeEnabled ? null : (
      <Island
        className="contextual-properties-toolbar"
        padding={1}
        data-prevent-outside-click
        data-viewport-ui="top"
        role="toolbar"
        aria-label="Laser properties"
      >
        <LaserToolbarSection
          app={app}
          appState={appState}
          renderAction={renderAction}
        />
      </Island>
    );
  }

  const isTextTarget =
    hasFullStylesPanel &&
    (appState.activeTool.type === "text" ||
      (!!appState.editingTextElement &&
        !appState.editingTextElement.containerId) ||
      (targetElements.length > 0 &&
        targetElements.every(isUnboundTextElement)));
  const isImageTarget =
    targetElements.length > 0 && targetElements.every(isImageElement);
  const isExclusiveVectorStrokeTarget = hasExclusiveVectorStrokeTarget(
    appState,
    targetElements,
  );
  const isSupportedVectorTool = hasVectorStrokeWidth(appState.activeTool.type);
  const isSupportedVectorSelection =
    isExclusiveVectorStrokeTarget ||
    (targetElements.length > 0 &&
      targetElements.every((element) => element.type === "freedraw"));
  const isVectorPropertiesTarget =
    hasFullStylesPanel &&
    !isTextTarget &&
    !isImageTarget &&
    (isSupportedVectorTool ||
      appState.activeTool.type === "freedraw" ||
      isSupportedVectorSelection);
  const isGeneralSelectionTarget =
    hasFullStylesPanel &&
    targetElements.length > 0 &&
    !isTextTarget &&
    !isImageTarget &&
    !isVectorPropertiesTarget;
  const predicates = getShapeActionPredicates(
    appState,
    targetElements,
    elementsMap,
    app,
  );
  const hasSmartShape =
    targetElements.length === 1 &&
    !targetElements[0].locked &&
    !!getSmartShapeMetadata(targetElements[0]);

  if (
    appState.viewModeEnabled ||
    (!isTextTarget &&
      !isImageTarget &&
      !isVectorPropertiesTarget &&
      !isGeneralSelectionTarget)
  ) {
    return null;
  }
  const textTarget =
    targetElements.find(isTextElement) ?? appState.editingTextElement;
  const fontFamilyName =
    Object.entries(FONT_FAMILY).find(
      ([, value]) =>
        value === (textTarget?.fontFamily ?? appState.currentItemFontFamily),
    )?.[0] ?? "Assistant";

  return (
    <Island
      className="contextual-properties-toolbar"
      padding={1}
      data-prevent-outside-click
      data-viewport-ui="top"
      role="toolbar"
      aria-label="Element properties"
    >
      {isTextTarget && (
        <>
          <span className="contextual-properties-toolbar__label">
            Text color
          </span>
          {renderAction("changeStrokeColor", { contextToolbar: true })}
          <ContextualToolbarDivider />
          <div className="contextual-properties-toolbar__font">
            <span>{fontFamilyName}</span>
            {renderAction("changeFontFamily", { contextToolbar: true })}
          </div>
          <ContextualToolbarDivider />
          {renderAction("changeFontSize", { contextToolbar: true })}
          <ContextualToolbarDivider />
          {renderAction("changeTextStyle", { contextToolbar: true })}
          <ContextualToolbarDivider />
          {renderAction("changeTextAlign", { contextToolbar: true })}
          <ContextualToolbarDivider />
          {renderAction("changeLineHeight", { contextToolbar: true })}
          <ContextualSecondaryProperties
            renderAction={renderAction}
            showBackgroundColor={predicates.backgroundColor}
            showRoundness={predicates.roundness}
            showOpacity={predicates.opacity}
            showTextBackgroundPadding={targetElements.some(
              canChangeTextBackgroundPadding,
            )}
          />
        </>
      )}
      {isImageTarget && (
        <>
          <span className="contextual-properties-toolbar__label">Border</span>
          {renderAction("changeStrokeColor", { contextToolbar: true })}
          <ContextualToolbarDivider />
          {renderAction("changeVectorStrokeWidth", { contextToolbar: true })}
          <ContextualToolbarDivider />
          <ImageBackgroundRemovalAction
            app={app}
            targetElements={targetElements}
          />
          <ContextualSecondaryProperties
            renderAction={renderAction}
            showRoundness={predicates.roundness}
            showOpacity={predicates.opacity}
          />
        </>
      )}
      {isVectorPropertiesTarget && (
        <>
          {predicates.strokeColor &&
            renderAction("changeStrokeColor", { contextToolbar: true })}
          {predicates.backgroundColor && (
            <>
              <ContextualToolbarDivider />
              {renderAction("changeBackgroundColor", {
                contextToolbar: true,
              })}
            </>
          )}
          {predicates.strokeWidth && isExclusiveVectorStrokeTarget && (
            <>
              <ContextualToolbarDivider />
              {renderAction("changeVectorStrokeWidth", {
                contextToolbar: true,
              })}
            </>
          )}
          {predicates.fill && (
            <>
              <ContextualToolbarDivider />
              {renderAction("changeFillStyle", { contextToolbar: true })}
            </>
          )}
          {predicates.strokeWidth && !isExclusiveVectorStrokeTarget && (
            <>
              <ContextualToolbarDivider />
              {renderAction("changeStrokeWidth", { contextToolbar: true })}
            </>
          )}
          {predicates.arrowType && (
            <>
              <ContextualToolbarDivider />
              {renderAction("changeArrowType", { contextToolbar: true })}
            </>
          )}
          {predicates.arrowheads && (
            <>
              <ContextualToolbarDivider />
              {renderAction("changeArrowhead", { contextToolbar: true })}
            </>
          )}
          {predicates.text && (
            <>
              <ContextualToolbarDivider />
              {renderAction("changeFontFamily", { contextToolbar: true })}
              {renderAction("changeFontSize", { contextToolbar: true })}
              {renderAction("changeTextStyle", { contextToolbar: true })}
              {renderAction("changeLineHeight", { contextToolbar: true })}
              {predicates.textAlign &&
                renderAction("changeTextAlign", { contextToolbar: true })}
            </>
          )}
          {predicates.verticalAlign && (
            <>
              <ContextualToolbarDivider />
              {renderAction("changeVerticalAlign", { contextToolbar: true })}
            </>
          )}
          {hasSmartShape && (
            <>
              <ContextualToolbarDivider />
              {renderAction("changeSmartShape", { contextToolbar: true })}
            </>
          )}
          <ContextualSecondaryProperties
            renderAction={renderAction}
            showFreedrawMode={predicates.freedrawMode}
            showStrokeStyle={predicates.strokeStyle}
            showSloppiness={predicates.sloppiness}
            showRoundness={predicates.roundness}
            showOpacity={predicates.opacity}
          />
        </>
      )}
      {isGeneralSelectionTarget && (
        <>
          {targetElements.every((element) => hasStrokeColor(element.type)) &&
            renderAction("changeStrokeColor", { contextToolbar: true })}
          {targetElements.every((element) => hasBackground(element.type)) && (
            <>
              <ContextualToolbarDivider />
              {renderAction("changeBackgroundColor", {
                contextToolbar: true,
              })}
            </>
          )}
          {targetElements.every((element) => hasBackground(element.type)) &&
            predicates.fill && (
              <>
                <ContextualToolbarDivider />
                {renderAction("changeFillStyle", { contextToolbar: true })}
              </>
            )}
          {targetElements.every((element) => hasStrokeWidth(element.type)) && (
            <>
              <ContextualToolbarDivider />
              {renderAction(
                isExclusiveVectorStrokeTarget
                  ? "changeVectorStrokeWidth"
                  : "changeStrokeWidth",
                { contextToolbar: true },
              )}
            </>
          )}
          {targetElements.every((element) => hasFreedrawMode(element.type)) && (
            <>
              <ContextualToolbarDivider />
              {renderAction("changeFreedrawMode", { contextToolbar: true })}
            </>
          )}
          {targetElements.every((element) =>
            canHaveArrowheads(element.type),
          ) && (
            <>
              <ContextualToolbarDivider />
              {renderAction("changeArrowType", { contextToolbar: true })}
              {renderAction("changeArrowhead", { contextToolbar: true })}
            </>
          )}
          {predicates.text && (
            <>
              <ContextualToolbarDivider />
              {renderAction("changeFontFamily", { contextToolbar: true })}
              {renderAction("changeFontSize", { contextToolbar: true })}
              {renderAction("changeTextStyle", { contextToolbar: true })}
              {renderAction("changeLineHeight", { contextToolbar: true })}
              {predicates.textAlign &&
                renderAction("changeTextAlign", { contextToolbar: true })}
            </>
          )}
          {predicates.verticalAlign && (
            <>
              <ContextualToolbarDivider />
              {renderAction("changeVerticalAlign", { contextToolbar: true })}
            </>
          )}
          <ContextualSecondaryProperties
            renderAction={renderAction}
            showStrokeStyle={targetElements.every((element) =>
              hasStrokeStyle(element.type),
            )}
            showSloppiness={
              predicates.sloppiness &&
              targetElements.every((element) => hasStrokeStyle(element.type))
            }
            showRoundness={targetElements.every((element) =>
              canChangeRoundness(element.type),
            )}
            showOpacity={predicates.opacity}
          />
        </>
      )}
    </Island>
  );
};

const ContextualToolbarDivider = () => (
  <div className="contextual-properties-toolbar__divider" aria-hidden="true" />
);

export const ContextualToolbarPopover = ({
  label,
  icon,
  children,
}: {
  label: string;
  icon: ReactNode;
  children: ReactNode;
}) => {
  const { container } = useExcalidrawContainer();

  return (
    <Popover.Root>
      <Tooltip label={label}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="contextual-properties-toolbar__popover-trigger"
            aria-label={label}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
          >
            {icon}
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal container={container}>
        <Popover.Content
          className={clsx(PROPERTIES_CLASSES, "focus-visible-none")}
          data-prevent-outside-click
          side="bottom"
          align="center"
          sideOffset={8}
          collisionBoundary={container ?? undefined}
          onPointerDown={(event) => event.stopPropagation()}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          style={{ zIndex: "var(--zIndex-ui-styles-popup)" }}
        >
          <Island
            className="contextual-properties-toolbar__popover"
            padding={3}
          >
            {children}
          </Island>
          <Popover.Arrow
            width={20}
            height={10}
            style={{
              fill: "var(--popup-bg-color)",
              filter: "drop-shadow(rgba(0, 0, 0, 0.05) 0px 3px 2px)",
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

const ContextualSecondaryProperties = ({
  renderAction,
  showBackgroundColor = false,
  showFreedrawMode = false,
  showStrokeStyle = false,
  showSloppiness = false,
  showRoundness = false,
  showOpacity = false,
  showTextBackgroundPadding = false,
}: {
  renderAction: ActionManager["renderAction"];
  showBackgroundColor?: boolean;
  showFreedrawMode?: boolean;
  showStrokeStyle?: boolean;
  showSloppiness?: boolean;
  showRoundness?: boolean;
  showOpacity?: boolean;
  showTextBackgroundPadding?: boolean;
}) => {
  if (
    !showBackgroundColor &&
    !showFreedrawMode &&
    !showStrokeStyle &&
    !showSloppiness &&
    !showRoundness &&
    !showOpacity &&
    !showTextBackgroundPadding
  ) {
    return null;
  }

  return (
    <>
      <ContextualToolbarDivider />
      <ContextualToolbarPopover
        label="More properties"
        icon={DotsHorizontalIcon}
      >
        <div className="contextual-properties-toolbar__secondary-properties">
          {showBackgroundColor &&
            renderAction("changeBackgroundColor", { contextToolbar: true })}
          {showFreedrawMode &&
            renderAction("changeFreedrawMode", { contextToolbar: true })}
          {showStrokeStyle &&
            renderAction("changeStrokeStyle", { contextToolbar: true })}
          {showSloppiness &&
            renderAction("changeSloppiness", { contextToolbar: true })}
          {showRoundness &&
            renderAction("changeRoundness", { contextToolbar: true })}
          {showTextBackgroundPadding &&
            renderAction("changeTextBackgroundPadding", {
              contextToolbar: true,
            })}
          {showOpacity && (
            <div className="contextual-properties-toolbar__secondary-properties__opacity">
              {renderAction("changeOpacity", { contextToolbar: true })}
            </div>
          )}
        </div>
      </ContextualToolbarPopover>
    </>
  );
};

const CombinedShapeProperties = ({
  appState,
  renderAction,
  setAppState,
  predicates,
  container,
  hasSmartShape,
  isExclusiveVectorStrokeTarget,
  app,
  targetElements,
}: {
  appState: UIAppState;
  renderAction: ActionManager["renderAction"];
  setAppState: React.Component<any, AppState>["setState"];
  predicates: ShapeActionPredicates;
  container: HTMLDivElement | null;
  hasSmartShape: boolean;
  isExclusiveVectorStrokeTarget: boolean;
  app: AppClassProperties;
  targetElements: readonly ExcalidrawElement[];
}) => {
  const shouldShowCombinedProperties =
    predicates.hasSelection ||
    (appState.activeTool.type !== "selection" &&
      appState.activeTool.type !== "eraser" &&
      appState.activeTool.type !== "hand" &&
      appState.activeTool.type !== "laser" &&
      appState.activeTool.type !== "lasso");
  const isOpen = appState.openPopup === "compactStrokeStyles";

  if (!shouldShowCombinedProperties) {
    return null;
  }

  return (
    <div className="compact-action-item">
      <Popover.Root
        open={isOpen}
        onOpenChange={(open) => {
          if (open) {
            setAppState({ openPopup: "compactStrokeStyles" });
          } else {
            setAppState({ openPopup: null });
          }
        }}
      >
        <Popover.Trigger asChild>
          <button
            type="button"
            className={clsx("compact-action-button properties-trigger", {
              active: isOpen,
            })}
            title={t("labels.stroke")}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();

              setAppState({
                openPopup: isOpen ? null : "compactStrokeStyles",
              });
            }}
          >
            {adjustmentsIcon}
          </button>
        </Popover.Trigger>
        {isOpen && (
          <PropertiesPopover
            className={PROPERTIES_CLASSES}
            container={container}
            style={{ maxWidth: "13rem" }}
            onClose={() => {}}
          >
            <div className="selected-shape-actions">
              {predicates.fill && renderAction("changeFillStyle")}
              {predicates.strokeWidth &&
                renderAction(
                  isExclusiveVectorStrokeTarget
                    ? "changeVectorStrokeWidth"
                    : "changeStrokeWidth",
                )}
              {
                /* in compact UI the freedraw pressure setting is rendered as a
                  standalone cycle button in the compact actions list; we render
                  it in the combined properties popup as well for clarity
                */
                predicates.freedrawMode && renderAction("changeFreedrawMode")
              }
              {predicates.strokeStyle && (
                <>{renderAction("changeStrokeStyle")}</>
              )}
              {predicates.sloppiness && <>{renderAction("changeSloppiness")}</>}
              {predicates.roundness && renderAction("changeRoundness")}
              {predicates.opacity && renderAction("changeOpacity")}
              {hasSmartShape && renderAction("changeSmartShape")}
              <ImageBackgroundRemovalAction
                app={app}
                targetElements={targetElements}
                compact
              />
            </div>
          </PropertiesPopover>
        )}
      </Popover.Root>
    </div>
  );
};

const CombinedArrowProperties = ({
  appState,
  renderAction,
  setAppState,
  targetElements,
  predicates,
  container,
  app,
}: {
  appState: UIAppState;
  renderAction: ActionManager["renderAction"];
  setAppState: React.Component<any, AppState>["setState"];
  targetElements: ExcalidrawElement[];
  predicates: ShapeActionPredicates;
  container: HTMLDivElement | null;
  app: AppClassProperties;
}) => {
  if (!predicates.arrowType) {
    return null;
  }

  const isOpen = appState.openPopup === "compactArrowProperties";

  return (
    <div className="compact-action-item">
      <Popover.Root
        open={isOpen}
        onOpenChange={(open) => {
          if (open) {
            setAppState({ openPopup: "compactArrowProperties" });
          } else {
            setAppState({ openPopup: null });
          }
        }}
      >
        <Popover.Trigger asChild>
          <button
            type="button"
            className={clsx("compact-action-button properties-trigger", {
              active: isOpen,
            })}
            title={t("labels.arrowtypes")}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();

              setAppState({
                openPopup: isOpen ? null : "compactArrowProperties",
              });
            }}
          >
            {(() => {
              // Show an icon based on the current arrow type
              const arrowType = getFormValue(
                targetElements,
                app,
                (element) => {
                  if (isArrowElement(element)) {
                    return element.elbowed
                      ? "elbow"
                      : element.roundness
                      ? "round"
                      : "sharp";
                  }
                  return null;
                },
                (element) => isArrowElement(element),
                (hasSelection) =>
                  hasSelection ? null : appState.currentItemArrowType,
              );

              if (arrowType === "elbow") {
                return elbowArrowIcon;
              }
              if (arrowType === "round") {
                return roundArrowIcon;
              }
              return sharpArrowIcon;
            })()}
          </button>
        </Popover.Trigger>
        {isOpen && (
          <PropertiesPopover
            container={container}
            className="properties-content"
            style={{ maxWidth: "13rem" }}
            onClose={() => {}}
          >
            {renderAction("changeArrowProperties")}
          </PropertiesPopover>
        )}
      </Popover.Root>
    </div>
  );
};

const CombinedTextProperties = ({
  appState,
  renderAction,
  setAppState,
  predicates,
  container,
}: {
  appState: UIAppState;
  renderAction: ActionManager["renderAction"];
  setAppState: React.Component<any, AppState>["setState"];
  predicates: ShapeActionPredicates;
  container: HTMLDivElement | null;
}) => {
  const { saveCaretPosition, restoreCaretPosition } = useTextEditorFocus();
  const isOpen = appState.openPopup === "compactTextProperties";

  return (
    <div className="compact-action-item">
      <Popover.Root
        open={isOpen}
        onOpenChange={(open) => {
          if (open) {
            if (appState.editingTextElement) {
              saveCaretPosition();
            }
            setAppState({ openPopup: "compactTextProperties" });
          } else {
            setAppState({ openPopup: null });
            if (appState.editingTextElement) {
              restoreCaretPosition();
            }
          }
        }}
      >
        <Popover.Trigger asChild>
          <button
            type="button"
            className={clsx("compact-action-button properties-trigger", {
              active: isOpen,
            })}
            title={t("labels.textAlign")}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();

              if (isOpen) {
                setAppState({ openPopup: null });
              } else {
                if (appState.editingTextElement) {
                  saveCaretPosition();
                }
                setAppState({ openPopup: "compactTextProperties" });
              }
            }}
          >
            {TextSizeIcon}
          </button>
        </Popover.Trigger>
        {appState.openPopup === "compactTextProperties" && (
          <PropertiesPopover
            className={PROPERTIES_CLASSES}
            container={container}
            style={{ maxWidth: "13rem" }}
            // Improve focus handling for text editing scenarios
            preventAutoFocusOnTouch={!!appState.editingTextElement}
            onClose={() => {
              // Refocus text editor when popover closes with caret restoration
              if (appState.editingTextElement) {
                restoreCaretPosition();
              }
            }}
          >
            <div className="selected-shape-actions">
              {predicates.text && renderAction("changeFontSize")}
              {predicates.text && renderAction("changeTextStyle")}
              {predicates.text && renderAction("changeLineHeight")}
              {predicates.textAlign && renderAction("changeTextAlign")}
              {predicates.verticalAlign && renderAction("changeVerticalAlign")}
            </div>
          </PropertiesPopover>
        )}
      </Popover.Root>
    </div>
  );
};

const CombinedExtraActions = ({
  appState,
  renderAction,
  predicates,
  setAppState,
  container,
  showDuplicate,
  showDelete,
}: {
  appState: UIAppState;
  renderAction: ActionManager["renderAction"];
  predicates: ShapeActionPredicates;
  setAppState: React.Component<any, AppState>["setState"];
  container: HTMLDivElement | null;
  showDuplicate?: boolean;
  showDelete?: boolean;
}) => {
  const isOpen = appState.openPopup === "compactOtherProperties";

  if (!predicates.showExtraActions) {
    return null;
  }

  return (
    <div className="compact-action-item">
      <Popover.Root
        open={isOpen}
        onOpenChange={(open) => {
          if (open) {
            setAppState({ openPopup: "compactOtherProperties" });
          } else {
            setAppState({ openPopup: null });
          }
        }}
      >
        <Popover.Trigger asChild>
          <button
            type="button"
            className={clsx("compact-action-button properties-trigger", {
              active: isOpen,
            })}
            title={t("labels.actions")}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setAppState({
                openPopup: isOpen ? null : "compactOtherProperties",
              });
            }}
          >
            {DotsHorizontalIcon}
          </button>
        </Popover.Trigger>
        {isOpen && (
          <PropertiesPopover
            className={PROPERTIES_CLASSES}
            container={container}
            style={{
              maxWidth: "12rem",
              justifyContent: "center",
              alignItems: "center",
            }}
            onClose={() => {}}
          >
            <div className="selected-shape-actions">
              {predicates.layers && (
                <LayersFieldset renderAction={renderAction} />
              )}

              <fieldset>
                <legend>{t("labels.actions")}</legend>
                <div className="buttonList">
                  {renderAction("group")}
                  {renderAction("ungroup")}
                  {predicates.linkSingleOnly && renderAction("hyperlink")}
                  {predicates.cropEditor && renderAction("cropEditor")}
                  {showDuplicate && renderAction("duplicateSelection")}
                  {showDelete && renderAction("deleteSelectedElements")}
                </div>
              </fieldset>
            </div>
          </PropertiesPopover>
        )}
      </Popover.Root>
    </div>
  );
};

const LinearEditorAction = ({
  renderAction,
  predicates,
}: {
  renderAction: ActionManager["renderAction"];
  predicates: ShapeActionPredicates;
}) => {
  if (!predicates.lineEditor) {
    return null;
  }

  return (
    <div className="compact-action-item">
      {renderAction("toggleLinearEditor")}
    </div>
  );
};

/**
 * Compact styles panel — the collapsed, popover-driven layout used on tablets
 * and on desktop when the UI is in "compact" mode.
 */
export const CompactShapeActions = ({
  appState,
  elementsMap,
  renderAction,
  app,
  setAppState,
}: {
  appState: UIAppState;
  elementsMap: NonDeletedElementsMap | NonDeletedSceneElementsMap;
  renderAction: ActionManager["renderAction"];
  app: AppClassProperties;
  setAppState: React.Component<any, AppState>["setState"];
}) => {
  const targetElements = getTargetElements(elementsMap, appState);
  const predicates = getShapeActionPredicates(
    appState,
    targetElements,
    elementsMap,
    app,
  );
  const { container } = useExcalidrawContainer();
  const hasSmartShape =
    targetElements.length === 1 &&
    !targetElements[0].locked &&
    !!getSmartShapeMetadata(targetElements[0]);
  const isExclusiveVectorStrokeTarget = hasExclusiveVectorStrokeTarget(
    appState,
    targetElements,
  );

  return (
    <div className="compact-shape-actions">
      {/* Stroke Color */}
      {predicates.strokeColor && (
        <div className={clsx("compact-action-item")}>
          {renderAction("changeStrokeColor")}
        </div>
      )}

      {/* Background Color */}
      {predicates.backgroundColor && (
        <div className="compact-action-item">
          {renderAction("changeBackgroundColor")}
        </div>
      )}

      {/* Freedraw pressure: standalone button cycling the variability mode */}
      {predicates.freedrawMode && (
        <div className="compact-action-item">
          {renderAction("changeFreedrawMode", { cycle: true })}
        </div>
      )}

      <CombinedShapeProperties
        appState={appState}
        renderAction={renderAction}
        setAppState={setAppState}
        predicates={predicates}
        container={container}
        hasSmartShape={hasSmartShape}
        isExclusiveVectorStrokeTarget={isExclusiveVectorStrokeTarget}
        app={app}
        targetElements={targetElements}
      />

      <CombinedArrowProperties
        appState={appState}
        renderAction={renderAction}
        setAppState={setAppState}
        targetElements={targetElements}
        predicates={predicates}
        container={container}
        app={app}
      />
      {/* Linear Editor */}
      {predicates.lineEditor && (
        <div className="compact-action-item">
          {renderAction("toggleLinearEditor")}
        </div>
      )}

      {/* Text Properties */}
      {predicates.text && (
        <>
          <div className="compact-action-item">
            {renderAction("changeFontFamily")}
          </div>
          <CombinedTextProperties
            appState={appState}
            renderAction={renderAction}
            setAppState={setAppState}
            predicates={predicates}
            container={container}
          />
        </>
      )}

      {/* Dedicated Copy Button */}
      {predicates.showExtraActions && (
        <div className="compact-action-item">
          {renderAction("duplicateSelection")}
        </div>
      )}

      {/* Dedicated Delete Button */}
      {predicates.showExtraActions && (
        <div className="compact-action-item">
          {renderAction("deleteSelectedElements")}
        </div>
      )}

      <CombinedExtraActions
        appState={appState}
        renderAction={renderAction}
        predicates={predicates}
        setAppState={setAppState}
        container={container}
      />
    </div>
  );
};

/**
 * Mobile styles panel — the horizontal action bar used on phones, with an
 * overflow measurement that promotes duplicate/delete out of the popover when
 * there is room.
 */
export const MobileShapeActions = ({
  appState,
  elementsMap,
  renderAction,
  app,
  setAppState,
}: {
  appState: UIAppState;
  elementsMap: NonDeletedElementsMap | NonDeletedSceneElementsMap;
  renderAction: ActionManager["renderAction"];
  app: AppClassProperties;
  setAppState: React.Component<any, AppState>["setState"];
}) => {
  const targetElements = getTargetElements(elementsMap, appState);
  const predicates = getShapeActionPredicates(
    appState,
    targetElements,
    elementsMap,
    app,
  );
  const { container } = useExcalidrawContainer();
  const hasSmartShape =
    targetElements.length === 1 &&
    !targetElements[0].locked &&
    !!getSmartShapeMetadata(targetElements[0]);
  const isExclusiveVectorStrokeTarget = hasExclusiveVectorStrokeTarget(
    appState,
    targetElements,
  );
  const mobileActionsRef = useRef<HTMLDivElement>(null);

  const ACTIONS_WIDTH =
    mobileActionsRef.current?.getBoundingClientRect()?.width ?? 0;

  // 7 actions + 2 for undo/redo
  const MIN_ACTIONS = 9;

  const GAP = 6;
  const WIDTH = 32;

  const MIN_WIDTH = MIN_ACTIONS * WIDTH + (MIN_ACTIONS - 1) * GAP;

  const ADDITIONAL_WIDTH = WIDTH + GAP;

  const showDeleteOutside = ACTIONS_WIDTH >= MIN_WIDTH + ADDITIONAL_WIDTH;
  const showDuplicateOutside =
    ACTIONS_WIDTH >= MIN_WIDTH + 2 * ADDITIONAL_WIDTH;

  return (
    <Island
      className="compact-shape-actions mobile-shape-actions"
      style={{
        flexDirection: "row",
        boxShadow: "none",
        padding: 0,
        zIndex: 2,
        backgroundColor: "transparent",
        height: WIDTH * 1.35,
        marginBottom: 4,
        alignItems: "center",
        gap: GAP,
        pointerEvents: "none",
      }}
      ref={mobileActionsRef}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          gap: GAP,
          flex: 1,
        }}
      >
        {predicates.strokeColor && (
          <div className={clsx("compact-action-item")}>
            {renderAction("changeStrokeColor")}
          </div>
        )}
        {predicates.backgroundColor && (
          <div className="compact-action-item">
            {renderAction("changeBackgroundColor")}
          </div>
        )}
        <CombinedShapeProperties
          appState={appState}
          renderAction={renderAction}
          setAppState={setAppState}
          predicates={predicates}
          container={container}
          hasSmartShape={hasSmartShape}
          isExclusiveVectorStrokeTarget={isExclusiveVectorStrokeTarget}
          app={app}
          targetElements={targetElements}
        />
        {/* Combined Arrow Properties */}
        <CombinedArrowProperties
          appState={appState}
          renderAction={renderAction}
          setAppState={setAppState}
          targetElements={targetElements}
          predicates={predicates}
          container={container}
          app={app}
        />
        {/* Linear Editor */}
        <LinearEditorAction
          renderAction={renderAction}
          predicates={predicates}
        />
        {/* Text Properties */}
        {predicates.text && (
          <>
            <div className="compact-action-item">
              {renderAction("changeFontFamily")}
            </div>
            <CombinedTextProperties
              appState={appState}
              renderAction={renderAction}
              setAppState={setAppState}
              predicates={predicates}
              container={container}
            />
          </>
        )}

        {/* Combined Other Actions */}
        <CombinedExtraActions
          appState={appState}
          renderAction={renderAction}
          predicates={predicates}
          setAppState={setAppState}
          container={container}
          showDuplicate={!showDuplicateOutside}
          showDelete={!showDeleteOutside}
        />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          gap: GAP,
        }}
      >
        <div className="compact-action-item">{renderAction("undo")}</div>
        <div className="compact-action-item">{renderAction("redo")}</div>
        {showDuplicateOutside && (
          <div className="compact-action-item">
            {renderAction("duplicateSelection")}
          </div>
        )}
        {showDeleteOutside && (
          <div className="compact-action-item">
            {renderAction("deleteSelectedElements")}
          </div>
        )}
      </div>
    </Island>
  );
};

export const ZoomActions = ({
  renderAction,
}: {
  renderAction: ActionManager["renderAction"];
}) => (
  <Stack.Col gap={1} className={CLASSES.ZOOM_ACTIONS}>
    <Stack.Row align="center">
      {renderAction("zoomOut")}
      {renderAction("resetZoom")}
      {renderAction("zoomIn")}
    </Stack.Row>
  </Stack.Col>
);

export const UndoRedoActions = ({
  renderAction,
  className,
}: {
  renderAction: ActionManager["renderAction"];
  className?: string;
}) => (
  <div className={`undo-redo-buttons ${className}`}>
    <div className="undo-button-container">
      <Tooltip label={t("buttons.undo")}>{renderAction("undo")}</Tooltip>
    </div>
    <div className="redo-button-container">
      <Tooltip label={t("buttons.redo")}> {renderAction("redo")}</Tooltip>
    </div>
  </div>
);

export const ExitZenModeButton = ({
  actionManager,
  showExitZenModeBtn,
}: {
  actionManager: ActionManager;
  showExitZenModeBtn: boolean;
}) => (
  <button
    type="button"
    className={clsx("disable-zen-mode", {
      "disable-zen-mode--visible": showExitZenModeBtn,
    })}
    onClick={() => actionManager.executeAction(actionToggleZenMode)}
  >
    {t("buttons.exitZenMode")}
  </button>
);

export const ExitViewModeButton = ({
  actionManager,
}: {
  actionManager: ActionManager;
}) => (
  <button
    type="button"
    className="disable-view-mode"
    onClick={() => actionManager.executeAction(actionToggleViewMode)}
  >
    {pencilIcon}
  </button>
);
