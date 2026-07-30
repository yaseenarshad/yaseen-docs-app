import clsx from "clsx";
import { useEffect, useRef } from "react";

import { COLOR_PALETTE } from "@excalidraw/common";

import type { ColorPaletteCustom } from "@excalidraw/common";

import { useAtom } from "../../editor-jotai";
import { t } from "../../i18n";

import HotkeyLabel from "./HotkeyLabel";
import {
  activeColorPickerSectionAtom,
  getColorNameAndShadeFromColor,
  getSemanticColorHotkey,
} from "./colorPickerUtils";

import type { TranslationKeys } from "../../i18n";

interface PickerColorListProps {
  palette: ColorPaletteCustom;
  color: string | null;
  onChange: (color: string) => void;
  activeShade: number;
  showHotKey?: boolean;
}

const PickerColorList = ({
  palette,
  color,
  onChange,
  activeShade,
  showHotKey = true,
}: PickerColorListProps) => {
  const colorObj = getColorNameAndShadeFromColor({
    color,
    palette,
  });
  const [activeColorPickerSection, setActiveColorPickerSection] = useAtom(
    activeColorPickerSectionAtom,
  );

  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (btnRef.current && activeColorPickerSection === "baseColors") {
      btnRef.current.focus();
    }
  }, [colorObj?.colorName, activeColorPickerSection]);

  return (
    <div className="color-picker-content--default">
      {Object.entries(palette).map(([key, value]) => {
        const color =
          (Array.isArray(value) ? value[activeShade] : value) || "transparent";

        const keybinding = getSemanticColorHotkey({
          colorName: key,
          colorValue: value,
        });
        const label = t(
          `colors.${key.replace(/\d+/, "")}` as unknown as TranslationKeys,
          null,
          "",
        );

        return (
          <button
            ref={colorObj?.colorName === key ? btnRef : undefined}
            tabIndex={-1}
            type="button"
            className={clsx(
              "color-picker__button color-picker__button--large has-outline",
              {
                active: colorObj?.colorName === key,
                "is-transparent": color === "transparent" || !color,
                "is-canonical-white": color === COLOR_PALETTE.white,
              },
            )}
            onClick={() => {
              onChange(color);
              setActiveColorPickerSection("baseColors");
            }}
            title={`${label}${color.startsWith("#") ? ` ${color}` : ""}${
              keybinding ? ` — ${keybinding}` : ""
            }`}
            aria-label={`${label}${keybinding ? ` — ${keybinding}` : ""}`}
            style={color ? { "--swatch-color": color } : undefined}
            data-testid={`color-${key}`}
            key={key}
          >
            <div className="color-picker__button-outline" />
            {showHotKey && keybinding && (
              <HotkeyLabel color={color} keyLabel={keybinding} />
            )}
          </button>
        );
      })}
    </div>
  );
};

export default PickerColorList;
