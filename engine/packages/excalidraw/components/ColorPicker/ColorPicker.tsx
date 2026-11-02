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
  saveCaretPosition,
  restoreCaretPosition,
  temporarilyDisableTextEditorBlur,
} from "../../hooks/useTextEditorFocus";

import { ColorInput } from "./ColorInput";
import { Picker } from "./Picker";
import PickerHeading from "./PickerHeading";
import { TopPicks } from "./TopPicks";
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
  const isMobileMode = stylesPanelMode === "mobile";
  const [, setActiveColorPickerSection] = useAtom(activeColorPickerSectionAtom);

  const [eyeDropperState, setEyeDropperState] = useAtom(activeEyeDropperAtom);

  const colorInputJSX = (
    <div>
      <PickerHeading>{t("colorPicker.hexCode")}</PickerHeading>
      <ColorInput
        color={color || ""}
        label={label}
        onChange={(color) => {
          onChange(color);
        }}
        colorPickerType={type}
        placeholder={t("colorPicker.color")}
      />
    </div>
  );

  const colorPickerContentRef = useRef<HTMLDivElement>(null);

  const focusPickerContent = () => {
    colorPickerContentRef.current?.focus();
  };

  return (
    <PropertiesPopover
      container={container}
      style={{ maxWidth: "13rem" }}
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
        if (close) {
          close();
        } else if (getOpenPopup() === type) {
          updateData({ openPopup: null });
        }
        setActiveColorPickerSection(null);

        // Refocus text editor when popover closes if we were editing text
        if (appState.editingTextElement) {
          setTimeout(() => {
            const textEditor = document.querySelector(
              ".excalidraw-wysiwyg",
            ) as HTMLTextAreaElement;
            if (textEditor) {
              textEditor.focus();
            }
          }, 0);
        }
      }}
    >
      {palette ? (
        <Picker
          ref={colorPickerContentRef}
          palette={palette}
          color={color}
          onChange={(changedColor) => {
            // Save caret position before color change if editing text
            const savedSelection = appState.editingTextElement
              ? saveCaretPosition()
              : null;

            onChange(changedColor);

            // Restore caret position after color change if editing text
            if (appState.editingTextElement && savedSelection) {
              restoreCaretPosition(savedSelection);
            }
          }}
          onEyeDropperToggle={(force) => {
            setEyeDropperState((state) => {
              if (force) {
                state = state || {
                  keepOpenOnAlt: true,
                  onSelect: onChange,
                  colorPickerType: type,
                };
                state.keepOpenOnAlt = true;
                return state;
              }

              return force === false || state
                ? null
                : {
                    keepOpenOnAlt: false,
                    onSelect: onChange,
                    colorPickerType: type,
                  };
            });
          }}
          onEscape={(event) => {
            if (eyeDropperState) {
              setEyeDropperState(null);
            } else {
              // close explicitly on Escape
              if (close) {
                close();
              } else {
                updateData({ openPopup: null });
              }
            }
          }}
          type={type}
          elements={elements}
          updateData={updateData}
          showTitle={isCompactMode}
          showHotKey={!isMobileMode}
        >
          {colorInputJSX}
        </Picker>
      ) : (
        colorInputJSX
      )}
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
 * YAZ-3943 demo 2: the ▾ after the text toolbar's three picks, in the toolbar's one popover (`ToolbarPopover`):
 * more picks, "None" when the host has one, and "Custom…", which opens the full picker. The ▾ marks a color not
 * among the three; mixed colors mark nothing (YAZ-3943 demo 2). No tooltip: it would cover the popover.
 */
const MoreColors = ({
  color,
  label,
  type,
  topPicks,
  morePicks,
  onChange,
  editingTextElement,
  onCustom,
  onNone,
  pickLabels,
}: {
  color: string | null;
  label: string;
  type: ColorPickerType;
  topPicks: readonly string[];
  morePicks: readonly string[];
  onChange: (color: string) => void;
  editingTextElement: boolean;
  onCustom: () => void;
  onNone?: () => void;
  pickLabels?: Readonly<Record<string, string>>;
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
        <TopPicks
          activeColor={color}
          onChange={onChange}
          type={type}
          topPicks={morePicks}
          titles={false}
          labels={pickLabels}
        />
        {onNone && (
          <button
            type="button"
            className="color-picker__custom"
            onClick={() => {
              setOpen(false);
              onNone();
            }}
          >
            None
          </button>
        )}
        <button
          type="button"
          className="color-picker__custom"
          onClick={() => {
            setOpen(false);
            onCustom();
          }}
        >
          Custom…
        </button>
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
            // the text toolbar's swatches have no tooltip (YAZ-3943 demo 2)
            titles={!morePicks}
            labels={pickLabels}
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
                  morePicks={morePicks}
                  onChange={onChange}
                  editingTextElement={!!appState.editingTextElement}
                  onCustom={openPopup}
                  onNone={onNone}
                  pickLabels={pickLabels}
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
