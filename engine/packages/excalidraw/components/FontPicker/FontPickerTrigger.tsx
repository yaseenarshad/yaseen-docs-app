import { Popover } from "radix-ui";

import { MOBILE_ACTION_BUTTON_BG } from "@excalidraw/common";

import type { FontFamilyValues } from "@excalidraw/element/types";

import { t } from "../../i18n";
import { IconButton } from "../IconButton";
import { TextIcon } from "../icons";

import { useExcalidrawSetAppState } from "../App";

interface FontPickerTriggerProps {
  selectedFontFamily: FontFamilyValues | null;
  isOpened?: boolean;
  compactMode?: boolean;
  /** YAZ-3943 demo 2: a button with the font's name in place of the "A" icon. */
  label?: string;
}

export const FontPickerTrigger = ({
  selectedFontFamily,
  isOpened = false,
  compactMode = false,
  label,
}: FontPickerTriggerProps) => {
  const setAppState = useExcalidrawSetAppState();
  const closeIfOpen = () =>
    setAppState((appState) => ({
      openPopup:
        appState.openPopup === "fontFamily" ? null : appState.openPopup,
    }));

  if (label !== undefined) {
    return (
      <Popover.Trigger asChild>
        <div data-openpopup="fontFamily" className="properties-trigger">
          <button
            type="button"
            className="font-picker__name properties-trigger"
            title={t("labels.showFonts")}
            aria-label={`${t("labels.showFonts")}: ${label}`}
            aria-pressed={isOpened}
            data-testid="font-family-show-fonts"
            onClick={closeIfOpen}
          >
            {label}
          </button>
        </div>
      </Popover.Trigger>
    );
  }

  const compactStyle = compactMode
    ? {
        ...MOBILE_ACTION_BUTTON_BG,
        width: "2rem",
        height: "2rem",
      }
    : {};

  return (
    <Popover.Trigger asChild>
      <div data-openpopup="fontFamily" className="properties-trigger">
        <IconButton
          type="toggle"
          icon={TextIcon}
          title={t("labels.showFonts")}
          aria-label={t("labels.showFonts")}
          className="standalone properties-trigger"
          data-testid="font-family-show-fonts"
          checked={isOpened}
          onSelect={closeIfOpen}
          style={{
            border: "none",
            ...compactStyle,
          }}
        />
      </div>
    </Popover.Trigger>
  );
};
