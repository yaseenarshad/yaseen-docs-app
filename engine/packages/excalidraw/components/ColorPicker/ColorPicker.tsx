import { Popover } from "radix-ui";
import clsx from "clsx";
import { useRef, useEffect, useState } from "react";

import type { CSSProperties } from "react";

import {
  COLOR_OUTLINE_CONTRAST_THRESHOLD,
  COLOR_PALETTE,
  isColorDark,
  isWritableElement,
} from "@excalidraw/common";

import type { ColorPaletteCustom } from "@excalidraw/common";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { useAtom } from "../../editor-jotai";
import { t } from "../../i18n";
import { useExcalidrawContainer, useStylesPanelMode } from "../App";
import { ButtonSeparator } from "../ButtonSeparator";
import { ToolbarPopover } from "../ToolbarPopover";
import { activeEyeDropperAtom } from "../EyeDropper";
import { PropertiesPopover } from "../PropertiesPopover";
import { slashIcon, strokeIcon } from "../icons";
import {
  restoreCaretPosition,
  temporarilyDisableTextEditorBlur,
} from "../../hooks/useTextEditorFocus";

import { GoogleDocsGrid } from "./GoogleDocsGrid";
import { TopPicks } from "./TopPicks";

import type { SwatchLetter } from "./TopPicks";
import { activeColorPickerSectionAtom } from "./colorPickerUtils";

import "./ColorPicker.scss";

import type { ColorPickerType } from "./colorPickerUtils";

import type { AppState, UIAppState } from "../../types";

interface ColorPickerProps {
  type: ColorPickerType;
  /**
   * null indicates no color should be displayed as active
   * (e.g. when multiple shapes selected with different colors)
   */
  color: string | null;
  onChange: (color: string) => void;
  label: string;
  elements: readonly ExcalidrawElement[];
  appState: UIAppState;
  palette?: ColorPaletteCustom | null;
  topPicks?: readonly string[];
  updateData: (formData?: any) => void;
  /**
   * YAZ-3943 demo 2: the trigger is a small ▾ after the top picks, and its
   * popover starts with these picks, then the full picker (the text toolbar).
   */
  morePicks?: readonly string[];
  /** YAZ-3943 demo 2: a "None" in the ▾'s popover (the highlight). */
  onNone?: () => void;
  /** YAZ-4074 6B: the swatches' names by color, for a screen reader (the highlight's). */
  pickLabels?: Readonly<Record<string, string>>;
  /**
   * YAZ-3943 demo 2: the full picker's own open state, for a host whose action does not take `openPopup`
   * (the highlight). Absent: the app's `openPopup` as before.
   */
  popupOpen?: boolean;
  onPopupOpenChange?: (open: boolean) => void;
  /** YAZ-4277 demo: the swatches' "A" (`TopPicks`), so text color and highlight never look alike. */
  swatchLetter?: SwatchLetter;
}

const ColorPickerPopupContent = ({
  type,
  color,
  onChange,
  label,
  elements,
  palette = COLOR_PALETTE,
  updateData,
  getOpenPopup,
  appState,
  close,
}: Pick<
  ColorPickerProps,
  | "type"
  | "color"
  | "onChange"
  | "label"
  | "elements"
  | "palette"
  | "updateData"
  | "appState"
> & {
  getOpenPopup: () => AppState["openPopup"];
  /** YAZ-3943 demo 2: closes a picker with its own open state. */
  close?: () => void;
}) => {
  const { container } = useExcalidrawContainer();
  const stylesPanelMode = useStylesPanelMode();
  const isCompactMode = stylesPanelMode !== "full";
  const [, setActiveColorPickerSection] = useAtom(activeColorPickerSectionAtom);

  const [eyeDropperState, setEyeDropperState] = useAtom(activeEyeDropperAtom);
  const colorPickerContentRef = useRef<HTMLDivElement>(null);

  const focusPickerContent = () => {
    colorPickerContentRef.current?.focus();
  };

  const closePopup = () => {
    if (close) {
      close();
    } else if (getOpenPopup() === type) {
      updateData({ openPopup: null });
    }
    setActiveColorPickerSection(null);
  };

  const title = isCompactMode
    ? type === "elementStroke"
      ? t("labels.stroke")
      : type === "elementBackground"
      ? t("labels.background")
      : null
    : null;

  return (
    <PropertiesPopover
      container={container}
      style={{ maxWidth: "18rem" }}
      // Improve focus handling for text editing scenarios
      preventAutoFocusOnTouch={!!appState.editingTextElement}
      onFocusOutside={(event) => {
        // refocus due to eye dropper
        if (!isWritableElement(event.target)) {
          focusPickerContent();
        }
        event.preventDefault();
      }}
      onPointerDownOutside={(event) => {
        if (eyeDropperState) {
          // prevent from closing if we click outside the popover
          // while eyedropping (e.g. click when clicking the sidebar;
          // the eye-dropper-backdrop is prevented downstream)
          event.preventDefault();
        }
      }}
      onClose={() => {
        // only clear if we're still the active popup (avoid racing with switch)
        closePopup();

        // Refocus text editor when popover closes if we were editing text
        if (appState.editingTextElement) {
          restoreCaretPosition();
        }
      }}
    >
      <div
        ref={colorPickerContentRef}
        className="color-picker-content properties-content"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (eyeDropperState) {
              setEyeDropperState(null);
            } else {
              closePopup();
            }
          }
        }}
      >
        {title && <div className="color-picker__title">{title}</div>}
        <GoogleDocsGrid
          color={color}
          onChange={onChange}
          type={type}
          label={label}
          elements={elements}
          palette={palette}
          noneLabel={type === "elementBackground" ? "No fill" : null}
          onRequestClose={closePopup}
        />
      </div>
    </PropertiesPopover>
  );
};

const ColorPickerTrigger = ({
  label,
  color,
  type,
  mode = "background",
  onToggle,
  editingTextElement,
}: {
  color: string | null;
  label: string;
  type: ColorPickerType;
  mode?: "background" | "stroke";
  onToggle: () => void;
  editingTextElement?: boolean;
}) => {
  const stylesPanelMode = useStylesPanelMode();
  const isCompactMode = stylesPanelMode !== "full";
  const isMobileMode = stylesPanelMode === "mobile";
  const handleClick = (e: React.MouseEvent) => {
    // use pointerdown so we run before outside-close logic
    e.preventDefault();
    e.stopPropagation();

    // If editing text, temporarily disable the wysiwyg blur event
    if (editingTextElement) {
      temporarilyDisableTextEditorBlur();
    }

    onToggle();
  };

  return (
    <Popover.Trigger
      type="button"
      className={clsx("color-picker__button active-color properties-trigger", {
        "is-transparent": !color || color === "transparent",
        "is-canonical-white": color === COLOR_PALETTE.white,
        "has-outline":
          !color || !isColorDark(color, COLOR_OUTLINE_CONTRAST_THRESHOLD),
        "compact-sizing": isCompactMode,
        "mobile-border": isMobileMode,
      })}
      aria-label={label}
      style={color ? { "--swatch-color": color } : undefined}
      title={
        type === "elementStroke"
          ? t("labels.showStroke")
          : t("labels.showBackground")
      }
      data-openpopup={type}
      onClick={handleClick}
    >
      <div className="color-picker__button-outline">{!color && slashIcon}</div>
      {isCompactMode && color && mode === "stroke" && (
        <div className="color-picker__button-background">
          <span
            style={{
              color:
                color && isColorDark(color, COLOR_OUTLINE_CONTRAST_THRESHOLD)
                  ? "#fff"
                  : "#111",
            }}
          >
            {strokeIcon}
          </span>
        </div>
      )}
    </Popover.Trigger>
  );
};

/**
 * YAZ-3943 demo 2 / YAZ-6730: the ▾ after the toolbar's three picks opens the unified Google Docs
 * 10×8 colour grid directly in `ToolbarPopover` (matching Page, Table, and Drawing Text Box pickers).
 */
const MoreColors = ({
  color,
  label,
  type,
  topPicks,
  elements,
  palette,
  onChange,
  editingTextElement,
  onNone,
}: {
  color: string | null;
  label: string;
  type: ColorPickerType;
  topPicks: readonly string[];
  elements: readonly ExcalidrawElement[];
  palette?: ColorPaletteCustom | null;
  onChange: (color: string) => void;
  editingTextElement: boolean;
  onNone?: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const other = !!color && color !== "transparent" && !topPicks.includes(color);
  // the text editor keeps its letters selected
  const keepEditor = () => {
    if (editingTextElement) {
      temporarilyDisableTextEditorBlur();
    }
  };
  return (
    <ToolbarPopover
      label={`${label}: more`}
      tooltip={false}
      icon={<span aria-hidden="true">▾</span>}
      className={clsx("text-toolbar-more", { "is-other": other })}
      style={other ? ({ "--swatch-color": color } as CSSProperties) : undefined}
      open={open}
      onOpenChange={setOpen}
      onTriggerPointerDown={keepEditor}
    >
      <div className="color-picker__more-popover" onPointerDown={keepEditor}>
        <GoogleDocsGrid
          color={color}
          onChange={onChange}
          type={type}
          label={label}
          elements={elements}
          palette={palette}
          noneLabel={onNone ? "None" : null}
          onNone={onNone}
          onRequestClose={() => setOpen(false)}
        />
      </div>
    </ToolbarPopover>
  );
};

export const ColorPicker = ({
  type,
  color,
  onChange,
  label,
  elements,
  palette = COLOR_PALETTE,
  topPicks,
  updateData,
  appState,
  morePicks,
  onNone,
  pickLabels,
  popupOpen,
  onPopupOpenChange,
  swatchLetter,
}: ColorPickerProps) => {
  const openRef = useRef(appState.openPopup);
  useEffect(() => {
    openRef.current = appState.openPopup;
  }, [appState.openPopup]);
  const stylesPanelMode = useStylesPanelMode();
  const isCompactMode = stylesPanelMode !== "full";
  const isOpen = popupOpen ?? appState.openPopup === type;
  const openPopup = () =>
    onPopupOpenChange
      ? onPopupOpenChange(true)
      : updateData({ openPopup: type });

  return (
    <div>
      <div
        role="dialog"
        aria-modal="true"
        className={clsx("color-picker-container", {
          "color-picker-container--no-top-picks": isCompactMode,
          "color-picker-container--more": !isCompactMode && !!morePicks,
        })}
      >
        {!isCompactMode && (
          <TopPicks
            activeColor={color}
            onChange={onChange}
            type={type}
            topPicks={topPicks}
            // the text toolbar's swatches have no tooltip (YAZ-3943 demo 2),
            // but lettered ones name their job ("Text red", YAZ-4277 demo)
            titles={!morePicks || !!swatchLetter || !!pickLabels}
            labels={pickLabels}
            letter={swatchLetter}
          />
        )}
        {!isCompactMode && !morePicks && <ButtonSeparator />}
        <Popover.Root
          open={isOpen}
          onOpenChange={(open) => {
            if (open) {
              openPopup();
            }
          }}
        >
          {!isCompactMode && morePicks ? (
            // the full picker opens at the ▾, from its "Custom…"
            <Popover.Anchor asChild>
              <span className="color-picker__more-anchor">
                <MoreColors
                  color={color}
                  label={label}
                  type={type}
                  topPicks={topPicks ?? []}
                  elements={elements}
                  palette={palette}
                  onChange={onChange}
                  editingTextElement={!!appState.editingTextElement}
                  onNone={onNone}
                />
              </span>
            </Popover.Anchor>
          ) : (
            /* serves as an active color indicator as well */
            <ColorPickerTrigger
              color={color}
              label={label}
              type={type}
              mode={type === "elementStroke" ? "stroke" : "background"}
              editingTextElement={!!appState.editingTextElement}
              onToggle={() => {
                // YAZ-4366: a host that keeps the open state (the Edit colors card) opens and closes it here
                if (onPopupOpenChange) {
                  onPopupOpenChange(!isOpen);
                  return;
                }
                // atomic switch: if another popup is open, close it first, then open this one next tick
                if (appState.openPopup === type) {
                  // toggle off on same trigger
                  updateData({ openPopup: null });
                } else if (appState.openPopup) {
                  updateData({ openPopup: type });
                } else {
                  // open this one
                  updateData({ openPopup: type });
                }
              }}
            />
          )}
          {/* popup content */}
          {isOpen && (
            <ColorPickerPopupContent
              close={
                onPopupOpenChange ? () => onPopupOpenChange(false) : undefined
              }
              type={type}
              color={color}
              onChange={onChange}
              label={label}
              elements={elements}
              palette={palette}
              updateData={updateData}
              getOpenPopup={() => openRef.current}
              appState={appState}
            />
          )}
        </Popover.Root>
      </div>
    </div>
  );
};
