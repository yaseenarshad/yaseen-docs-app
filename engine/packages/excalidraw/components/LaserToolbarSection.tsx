import clsx from "clsx";
import { useId } from "react";

import {
  LASER_COLORS,
  LASER_SIZES,
  LASER_TRAIL_MODES,
} from "@excalidraw/common";

import type { LaserColor, LaserSize, LaserTrailMode } from "@excalidraw/common";

import { useEmitter } from "../hooks/useEmitter";
import { getShortcutKey } from "../shortcut";

import { ContextualToolbarDivider } from "./Actions";
import { RadioGroup } from "./RadioGroup";

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

const COLOR_NAMES: Record<LaserColor, string> = {
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
  const { canKeep, hasMarks } = useEmitter(
    app.laserTrails.onChange,
    app.laserTrails.getSnapshot(),
  );
  // radio names are document-wide, and a host can mount several editors
  const id = useId();
  const undoHint = getShortcutKey("CtrlOrCmd+Z");
  const redoHint = getShortcutKey("CtrlOrCmd+Shift+Z");

  return (
    <>
      <fieldset className="context-fieldset">
        <legend>Laser trail</legend>
        <RadioGroup
          name={`${id}-laser-trail`}
          value={appState.laserTrailMode}
          onChange={(laserTrailMode) => app.setAppState({ laserTrailMode })}
          choices={LASER_TRAIL_MODES.map((mode) => ({
            value: mode,
            label: MODES[mode].label,
            ariaLabel:
              mode === "sticky"
                ? `${MODES[mode].title} (undo ${undoHint})`
                : MODES[mode].title,
          }))}
        />
      </fieldset>
      <ContextualToolbarDivider />
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
              style={{ "--swatch-color": color }}
              data-testid={`laser-color-${color}`}
              onClick={() => app.setAppState({ laserColor: color })}
            />
          ))}
        </div>
      </fieldset>
      <ContextualToolbarDivider />
      <fieldset className="context-fieldset">
        <legend>Laser size</legend>
        <RadioGroup
          name={`${id}-laser-size`}
          value={appState.laserSize}
          onChange={(laserSize) => app.setAppState({ laserSize })}
          choices={(Object.keys(LASER_SIZES) as LaserSize[]).map((size) => ({
            value: size,
            label: size,
            ariaLabel: SIZE_NAMES[size],
          }))}
        />
      </fieldset>
      <ContextualToolbarDivider />
      <div className="laser-toolbar__history">
        {renderAction("undo", {
          size: "small",
          title: `Undo laser marks (${undoHint})`,
          testId: "laser-button-undo",
        })}
        {renderAction("redo", {
          size: "small",
          title: `Redo laser marks (${redoHint})`,
          testId: "laser-button-redo",
        })}
      </div>
      <ContextualToolbarDivider />
      <button
        type="button"
        className="laser-toolbar__button"
        aria-label="Keep marks"
        title={`Keep the visible marks until cleared (${getShortcutKey(
          "Enter",
        )})`}
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
        title={`Make the marks part of the drawing (${getShortcutKey(
          "Shift+Enter",
        )})`}
        data-testid="laser-make-permanent"
        disabled={!hasMarks}
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
        disabled={!hasMarks}
        onClick={() => app.laserTrails.clear()}
      >
        Clear
      </button>
    </>
  );
};
