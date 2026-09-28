import clsx from "clsx";

import {
  LASER_COLORS,
  LASER_SIZES,
  LASER_TRAIL_MODES,
} from "@excalidraw/common";

import type { LaserSize, LaserTrailMode } from "@excalidraw/common";

import { useEmitter } from "../hooks/useEmitter";
import { getShortcutKey } from "../shortcut";

import "./LaserToolbarSection.scss";

import type { ActionManager } from "../actions/manager";
import type { AppClassProperties, UIAppState } from "../types";

const MODES: Record<LaserTrailMode, { label: string; title: string }> = {
  fade: { label: "Fade", title: "Fade: marks fade right after you draw them" },
  hold: {
    label: "Hold",
    title: "Hold: marks stay while you keep marking, then fade together",
  },
  sticky: { label: "Sticky", title: "Sticky: marks stay until you clear them" },
};

const COLOR_NAMES: Record<typeof LASER_COLORS[number], string> = {
  "#ff0000": "Red",
  "#ffd400": "Yellow",
  "#00c853": "Green",
  "#2979ff": "Blue",
  "#d500f9": "Purple",
};

const SIZE_NAMES: Record<LaserSize, string> = {
  S: "Small",
  M: "Medium",
  L: "Large",
};

export const LaserToolbarSection = ({
  app,
  appState,
  renderAction,
}: {
  app: AppClassProperties;
  appState: UIAppState;
  renderAction: ActionManager["renderAction"];
}) => {
  const { canKeep, canClear } = useEmitter(
    app.laserTrails.onChange,
    app.laserTrails.getSnapshot(),
  );
  const undoHint = getShortcutKey("CtrlOrCmd+Z");
  const redoHint = getShortcutKey("CtrlOrCmd+Shift+Z");

  return (
    <>
      <fieldset className="context-fieldset">
        <legend>Laser trail</legend>
        <div
          className="laser-toolbar__segmented"
          role="radiogroup"
          aria-label="Laser trail"
        >
          {LASER_TRAIL_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={appState.laserTrailMode === mode}
              className={clsx("laser-toolbar__segment", {
                active: appState.laserTrailMode === mode,
              })}
              title={
                mode === "sticky"
                  ? `${MODES[mode].title} (undo ${undoHint})`
                  : MODES[mode].title
              }
              data-testid={`laser-mode-${mode}`}
              onClick={() => app.setAppState({ laserTrailMode: mode })}
            >
              {MODES[mode].label}
            </button>
          ))}
        </div>
      </fieldset>
      <div
        className="contextual-properties-toolbar__divider"
        aria-hidden="true"
      />
      <fieldset className="context-fieldset">
        <legend>Laser color</legend>
        <div
          className="laser-toolbar__swatches"
          role="radiogroup"
          aria-label="Laser color"
        >
          {LASER_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={appState.laserColor === color}
              aria-label={COLOR_NAMES[color]}
              title={COLOR_NAMES[color]}
              className={clsx("laser-toolbar__swatch", {
                active: appState.laserColor === color,
              })}
              style={{ "--swatch-color": color } as React.CSSProperties}
              data-testid={`laser-color-${color}`}
              onClick={() => app.setAppState({ laserColor: color })}
            />
          ))}
        </div>
      </fieldset>
      <div
        className="contextual-properties-toolbar__divider"
        aria-hidden="true"
      />
      <fieldset className="context-fieldset">
        <legend>Laser size</legend>
        <div
          className="laser-toolbar__segmented"
          role="radiogroup"
          aria-label="Laser size"
        >
          {(Object.keys(LASER_SIZES) as LaserSize[]).map((size) => (
            <button
              key={size}
              type="button"
              role="radio"
              aria-checked={appState.laserSize === size}
              aria-label={SIZE_NAMES[size]}
              title={SIZE_NAMES[size]}
              className={clsx("laser-toolbar__segment", {
                active: appState.laserSize === size,
              })}
              data-testid={`laser-size-${size}`}
              onClick={() => app.setAppState({ laserSize: size })}
            >
              {size}
            </button>
          ))}
        </div>
      </fieldset>
      <div
        className="contextual-properties-toolbar__divider"
        aria-hidden="true"
      />
      <div className="laser-toolbar__history">
        {renderAction("undo", {
          size: "small",
          title: `Undo laser marks (${undoHint})`,
          testId: "laser-button-undo",
        })}
        {renderAction("redo", {
          size: "small",
          title: `Redo (${redoHint})`,
          testId: "laser-button-redo",
        })}
      </div>
      <div
        className="contextual-properties-toolbar__divider"
        aria-hidden="true"
      />
      <button
        type="button"
        className="laser-toolbar__button"
        aria-label="Keep marks"
        title="Keep the visible marks until cleared (↵)"
        data-testid="laser-keep"
        disabled={!canKeep}
        onClick={() => app.laserTrails.keep()}
      >
        Keep
      </button>
      <button
        type="button"
        className="laser-toolbar__button"
        aria-label="Make marks permanent"
        title="Make the marks part of the drawing (⇧↵)"
        data-testid="laser-make-permanent"
        disabled={!canClear}
        onClick={() => app.makeLaserMarksPermanent()}
      >
        Make permanent
      </button>
      <button
        type="button"
        className="laser-toolbar__button"
        aria-label="Clear marks"
        title={`Clear all marks (undo ${undoHint})`}
        data-testid="laser-clear"
        disabled={!canClear}
        onClick={() => app.laserTrails.clear()}
      >
        Clear
      </button>
    </>
  );
};
