import clsx from "clsx";

import {
  COLOR_OUTLINE_CONTRAST_THRESHOLD,
  COLOR_PALETTE,
  DEFAULT_CANVAS_BACKGROUND_PICKS,
  DEFAULT_ELEMENT_BACKGROUND_PICKS,
  DEFAULT_ELEMENT_STROKE_PICKS,
  isColorDark,
} from "@excalidraw/common";

import { t } from "../../i18n";

import { getColorNameAndShadeFromColor } from "./colorPickerUtils";

import type { TranslationKeys } from "../../i18n";

import type { ColorPickerType } from "./colorPickerUtils";

interface TopPicksProps {
  onChange: (color: string) => void;
  type: ColorPickerType;
  activeColor: string | null;
  topPicks?: readonly string[];
  /** YAZ-3943 demo 2: false: no tooltip (the text toolbar's swatches); the aria-label stays. */
  titles?: boolean;
  /** YAZ-4074 6B: a swatch's name for a screen reader, by color (the highlight's "Highlight yellow"). */
  labels?: Readonly<Record<string, string>>;
  /**
   * YAZ-4277 demo: a mark on each swatch says what the color is for: an "A"
   * in the color on white (text color), a dark "A" on the color (highlight),
   * or a small box in the color on white (the box's fill).
   */
  letter?: SwatchLetter;
}

export type SwatchLetter = "color" | "on-color" | "box";

export const TopPicks = ({
  onChange,
  type,
  activeColor,
  topPicks,
  titles = true,
  labels,
  letter,
}: TopPicksProps) => {
  let colors;
  if (type === "elementStroke") {
    colors = DEFAULT_ELEMENT_STROKE_PICKS;
  }

  if (type === "elementBackground") {
    colors = DEFAULT_ELEMENT_BACKGROUND_PICKS;
  }

  if (type === "canvasBackground") {
    colors = DEFAULT_CANVAS_BACKGROUND_PICKS;
  }

  // this one can overwrite defaults
  if (topPicks) {
    colors = topPicks;
  }

  if (!colors) {
    console.error("Invalid type for TopPicks");
    return null;
  }

  return (
    <div className="color-picker__top-picks">
      {colors.map((color: string) => {
        const colorName = getColorNameAndShadeFromColor({
          color,
          palette: COLOR_PALETTE,
        })?.colorName;
        const name =
          labels?.[color] ??
          (colorName ? t(`colors.${colorName}` as TranslationKeys) : color);
        const label =
          letter === "color" && !labels?.[color]
            ? `Text ${name.toLowerCase()}`
            : name;

        return (
          <button
            className={clsx("color-picker__button", {
              active: color === activeColor,
              "is-transparent": color === "transparent" || !color,
              "is-canonical-white": color === COLOR_PALETTE.white,
              "has-outline":
                letter === "color" ||
                letter === "box" ||
                !isColorDark(color, COLOR_OUTLINE_CONTRAST_THRESHOLD),
              [`color-picker__button--letter-${letter}`]: !!letter,
            })}
            style={{ "--swatch-color": color }}
            key={color}
            type="button"
            title={titles ? label : undefined}
            aria-label={label}
            aria-pressed={color === activeColor}
            onClick={() => onChange(color)}
            data-testid={`color-top-pick-${color}`}
          >
            {letter === "box" ? (
              <span className="color-picker__box" aria-hidden="true" />
            ) : (
              letter && (
                <span className="color-picker__letter" aria-hidden="true">
                  A
                </span>
              )
            )}
            <div className="color-picker__button-outline" />
          </button>
        );
      })}
    </div>
  );
};
