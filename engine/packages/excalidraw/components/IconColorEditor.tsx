/**
 * Yaseen Docs (YAZ-4354 1D): the "Edit colors" mode of a many-color icon, on the
 * board: the numbers around the picture (one per color it shows now, with a line
 * to that color's part), the palette next to a click, and the strip below the
 * icon (scope, tint, outline, Reset colors, Done).
 *
 * A click on the canvas reaches `handlers.pick` first (App): the hidden pick map
 * names the part under it. No SVG of the icon goes into the page: the pick map
 * and the faded preview are pictures (`<img>` data), drawn on canvases.
 *
 * Each pick applies at once and is one undo step (`changeIconColors`); the tint
 * drag paints at most every 100 ms and is one undo step at its release.
 */
import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  DEFAULT_ELEMENT_STROKE_COLOR_PALETTE,
  DEFAULT_ELEMENT_STROKE_PICKS,
  isColorDark,
  sceneCoordsToViewportCoords,
} from "@excalidraw/common";
import {
  buildIconParts,
  currentTargetColors,
  getIconInfo,
  groupColorChange,
  groupIconColors,
  iconNaturalSize,
  iconPickPointOfScene,
  iconScenePointOfPick,
  loadIconPickMap,
  paintIcon,
  pickIconTarget,
  svgOfDataURL,
  svgToDataURL,
  tintIconColors,
} from "@excalidraw/element";

import type { IconPaintTarget, IconPickMap } from "@excalidraw/element";
import type { InitializedExcalidrawImageElement } from "@excalidraw/element/types";

import {
  actionChangeIconColors,
  currentIconRecipe,
  IconOutlineControls,
  IconSizeSlider,
} from "../actions/actionIconColors";

import { ColorPicker } from "./ColorPicker/ColorPicker";
import { Island } from "./Island";

import "./IconColorEditor.scss";

import type { IconColorsChange } from "../actions/actionIconColors";
import type { ActionManager } from "../actions/manager";
import type { AppClassProperties, AppState } from "../types";

/** What the App asks the mode; set while it is open. */
export type IconColorEditorHandlers = {
  /** a canvas click: true when it was inside the picture (the mode keeps it) */
  pick:
    | ((
        scene: { x: number; y: number },
        client: { x: number; y: number },
        justThisPart: boolean,
      ) => boolean)
    | null;
  /** Esc or Enter: true when the mode closed its palette (the mode stays) */
  escape: (() => boolean) | null;
};

type Palette = {
  /** where it opens, in container pixels */
  x: number;
  y: number;
  /** the group's color (a group is named by the color it shows) */
  color: string;
  /** the part that was clicked, or null for a number */
  target: IconPaintTarget | null;
  justThisPart: boolean;
};

const BADGE_GAP = 34;
const PALETTE_WIDTH = 236;

/** Spreads the numbers' angles so they never sit on top of each other. */
const spreadAngles = (angles: number[]) => {
  const order = angles.map((angle, i) => ({ angle, i }));
  order.sort((a, b) => a.angle - b.angle);
  const gap = Math.min(0.5, (2 * Math.PI) / Math.max(order.length, 1));
  for (let pass = 0; pass < 6; pass++) {
    for (let k = 1; k < order.length; k++) {
      if (order[k].angle - order[k - 1].angle < gap) {
        order[k].angle = order[k - 1].angle + gap;
      }
    }
  }
  const out = [...angles];
  for (const { angle, i } of order) {
    out[i] = angle;
  }
  return out;
};

export const IconColorEditor = ({
  app,
  actionManager,
  appState,
  element,
  handlers,
  onPreview,
  onDone,
}: {
  app: AppClassProperties;
  actionManager: ActionManager;
  appState: AppState;
  element: InitializedExcalidrawImageElement;
  handlers: IconColorEditorHandlers;
  onPreview: (image: HTMLImageElement | null) => void;
  onDone: () => void;
}) => {
  const file = app.files[element.fileId];
  const info = getIconInfo(file);
  const svgText = useMemo(
    () => (file ? svgOfDataURL(file.dataURL) : ""),
    [file],
  );
  // the parts never change while the mode is open: they are the original's
  const targets = useMemo(
    () => buildIconParts(svgText),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [element.id],
  );
  const outlineUnits = info.geometry?.outline ?? 0;
  const [pickMap, setPickMap] = useState<IconPickMap | null>(null);
  const [scope, setScope] = useState<"all" | "one">("all");
  const [palette, setPalette] = useState<Palette | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [tint, setTint] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const previews = useRef(new Map<string, HTMLImageElement>());
  const lastCount = useRef(0);

  // the pick map: once when the mode opens, again when the outline changes the picture's box
  useEffect(() => {
    let live = true;
    loadIconPickMap(svgText, outlineUnits)
      .then((result) => live && setPickMap(result?.map ?? null))
      .catch(() => live && setPickMap(null));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [element.id, outlineUnits]);

  const recipe = currentIconRecipe(element, app.files);
  const groups = groupIconColors(targets, recipe, pickMap?.areas);
  const natural = info.geometry ? iconNaturalSize(info) : null;

  const toContainer = (scene: { x: number; y: number }) => {
    const point = sceneCoordsToViewportCoords(
      { sceneX: scene.x, sceneY: scene.y },
      appState,
    );
    return {
      x: point.x - appState.offsetLeft,
      y: point.y - appState.offsetTop,
    };
  };

  const apply = (change: IconColorsChange) =>
    actionManager.executeAction(actionChangeIconColors, "ui", {
      ...change,
      elementIds: [element.id],
    });

  const groupByColor = (color: string) =>
    groups.find((group) => group.color === color) ?? null;

  const pickColor = (color: string | null) => {
    if (!palette) {
      return;
    }
    const target = palette.target;
    if (target && (palette.justThisPart || scope === "one")) {
      apply({ parts: { [target.key]: color } });
    } else {
      const group = groupByColor(palette.color);
      if (group) {
        apply(groupColorChange(group, color));
      }
    }
    setPalette({ ...palette, color: color ?? palette.color });
  };

  // the App's clicks and keys reach the mode through these
  handlers.pick = (scene, client, justThisPart) => {
    if (!natural) {
      return false;
    }
    const point = iconPickPointOfScene(element, natural, scene);
    if (!point) {
      return false;
    }
    const index = pickMap ? pickIconTarget(pickMap, point.x, point.y) : -1;
    const target = index >= 0 ? targets[index] : null;
    if (!target) {
      setPalette(null);
      return true;
    }
    const color = currentTargetColors(target, recipe)[0];
    setPalette({
      x: client.x - appState.offsetLeft,
      y: client.y - appState.offsetTop,
      color,
      target,
      justThisPart,
    });
    return true;
  };
  handlers.escape = () => {
    if (palette) {
      setPalette(null);
      return true;
    }
    return false;
  };
  useEffect(
    () => () => {
      handlers.pick = null;
      handlers.escape = null;
      onPreview(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // the faded preview while a number is pointed at
  const recipeKey = JSON.stringify(recipe);
  useEffect(() => {
    const group = hovered ? groupByColor(hovered) : null;
    if (!group || !svgText) {
      onPreview(null);
      return;
    }
    const key = `${recipeKey}|${group.color}`;
    const cached = previews.current.get(key);
    if (cached) {
      onPreview(cached);
      return;
    }
    let live = true;
    const image = new Image();
    image.onload = () => {
      if (previews.current.size > 32) {
        previews.current.clear();
      }
      previews.current.set(key, image);
      if (live) {
        onPreview(image);
      }
    };
    image.src = svgToDataURL(
      paintIcon(svgText, recipe, outlineUnits, {
        fadeExcept: new Set(group.keys),
      }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hovered, recipeKey]);

  if (!natural) {
    return null;
  }

  // the numbers: around the picture, each pointing at its color's biggest part
  const center = toContainer({
    x: element.x + element.width / 2,
    y: element.y + element.height / 2,
  });
  const radius =
    (Math.max(element.width, element.height) / 2) * appState.zoom.value +
    BADGE_GAP;
  const anchors = groups.map((group) => {
    let best = -1;
    for (const key of group.keys) {
      const i = targets.findIndex((t) => t.key === key);
      if (
        i >= 0 &&
        (best < 0 || (pickMap?.areas[i] ?? 0) > (pickMap?.areas[best] ?? 0))
      ) {
        best = i;
      }
    }
    const pick = best >= 0 ? pickMap?.anchors[best] : null;
    const scene = pick ? iconScenePointOfPick(element, natural, pick) : null;
    return scene ? toContainer(scene) : center;
  });
  const angles = spreadAngles(
    anchors.map((anchor, i) =>
      Math.hypot(anchor.x - center.x, anchor.y - center.y) < 4
        ? -Math.PI / 2 + i * 0.7
        : Math.atan2(anchor.y - center.y, anchor.x - center.x),
    ),
  );
  const badges = groups.map((group, i) => ({
    group,
    number: i + 1,
    anchor: anchors[i],
    x: center.x + Math.cos(angles[i]) * radius,
    y: center.y + Math.sin(angles[i]) * radius,
  }));

  const activeGroup = palette ? groupByColor(palette.color) : null;
  // while a pick paints (async), the new color has no number yet: the card stays, with the last count
  if (activeGroup) {
    lastCount.current = activeGroup.keys.length;
  }
  const paletteNumber = activeGroup ? groups.indexOf(activeGroup) + 1 : "";
  const partCount = activeGroup ? activeGroup.keys.length : lastCount.current;
  // a shaded part shows chips, one per color inside it
  const chips =
    palette?.target?.gradient && !recipe.parts?.[palette.target.key]
      ? [...new Set(currentTargetColors(palette.target, recipe))]
      : [];
  const justThisPart =
    !!palette?.target && (palette.justThisPart || scope === "one");

  const stripTop =
    center.y + radius + 8 > appState.height - 60
      ? Math.max(8, center.y - radius - 60)
      : center.y + radius + 8;

  return (
    <div className="icon-color-editor" data-testid="icon-color-editor">
      <svg className="icon-color-editor__lines" aria-hidden="true">
        {badges.map(({ group, anchor, x, y }) => (
          <g key={group.color}>
            <line x1={anchor.x} y1={anchor.y} x2={x} y2={y} />
            <circle cx={anchor.x} cy={anchor.y} r={3} />
          </g>
        ))}
      </svg>
      {badges.map(({ group, number, x, y }) => (
        <button
          key={group.color}
          type="button"
          className={clsx("icon-color-editor__badge", {
            "is-active": activeGroup === group,
          })}
          style={{
            left: x,
            top: y,
            background: group.color,
            color: isColorDark(group.color) ? "#ffffff" : "#1e1e1e",
          }}
          title={`Color ${number}: ${group.color} (${group.keys.length} part${
            group.keys.length === 1 ? "" : "s"
          })`}
          aria-label={`Color ${number}`}
          onPointerEnter={() => setHovered(group.color)}
          onPointerLeave={() => setHovered(null)}
          onClick={() =>
            setPalette({
              x: x + 18,
              y,
              color: group.color,
              target: null,
              justThisPart: false,
            })
          }
        >
          {number}
        </button>
      ))}

      {palette && (
        <div
          className="icon-color-editor__float"
          style={{
            left: Math.max(
              8,
              Math.min(palette.x + 16, appState.width - PALETTE_WIDTH - 8),
            ),
            top: Math.max(8, Math.min(palette.y - 40, appState.height - 260)),
          }}
          data-prevent-outside-click
        >
          <Island
            className="icon-color-editor__palette"
            padding={2}
            role="dialog"
            aria-label={`Color ${paletteNumber}`}
          >
            <div className="icon-color-editor__palette-title">
              <span
                className="icon-color-editor__swatch"
                style={{ background: palette.color }}
              />
              Color {paletteNumber} —{" "}
              {justThisPart
                ? "just this part"
                : `${partCount} part${partCount === 1 ? "" : "s"}`}
            </div>
            {chips.length > 1 && (
              <div
                className="icon-color-editor__chips"
                title="This part is shaded. Pick which of its colors to change."
              >
                {chips.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={clsx({ "is-active": color === palette.color })}
                    onClick={() =>
                      setPalette({ ...palette, color, justThisPart: false })
                    }
                  >
                    <i style={{ background: color }} />
                    {groups.findIndex((g) => g.color === color) + 1}
                  </button>
                ))}
              </div>
            )}
            <ColorPicker
              topPicks={DEFAULT_ELEMENT_STROKE_PICKS}
              palette={DEFAULT_ELEMENT_STROKE_COLOR_PALETTE}
              type="elementStroke"
              label={`Color ${paletteNumber}`}
              color={palette.color}
              onChange={(color) => pickColor(color)}
              elements={app.scene.getNonDeletedElements()}
              appState={appState}
              updateData={() => {}}
              popupOpen={pickerOpen}
              onPopupOpenChange={setPickerOpen}
            />
            <button
              type="button"
              className="icon-color-editor__link"
              onClick={() => {
                pickColor(null);
                setPalette(null);
              }}
            >
              Back to original
            </button>
          </Island>
        </div>
      )}

      <div
        className="icon-color-editor__float icon-color-editor__float--strip"
        style={{ left: center.x, top: stripTop }}
        data-prevent-outside-click
      >
        <Island
          className="icon-color-editor__strip"
          padding={1}
          role="toolbar"
          aria-label="Edit colors"
        >
          <span className="contextual-properties-toolbar__label">
            Edit colors
          </span>
          <div
            className="icon-color-editor__scope"
            role="radiogroup"
            aria-label="Change"
          >
            {(
              [
                ["all", "Every part with this color"],
                ["one", "Just the part I click"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={scope === value}
                className={clsx({ "is-active": scope === value })}
                title={
                  value === "one"
                    ? "Or hold Option (Alt) while you click a part"
                    : undefined
                }
                onClick={() => setScope(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="icon-color-editor__tint">
            <span>Tint</span>
            <IconSizeSlider
              label="Tint"
              className="icon-color-editor__tint-slider"
              value={tint}
              max={360}
              onPreview={(degrees) =>
                apply({
                  colors: tintIconColors(info.colors, degrees),
                  replaceColors: true,
                  preview: true,
                })
              }
              onChange={(degrees) => {
                setTint(degrees);
                apply({
                  colors: tintIconColors(info.colors, degrees),
                  replaceColors: true,
                });
              }}
            />
          </label>
          <span className="contextual-properties-toolbar__label">Outline</span>
          <IconOutlineControls
            elements={app.scene.getNonDeletedElements()}
            appState={appState}
            app={app}
            elementIds={[element.id]}
            onChange={(change) =>
              actionManager.executeAction(
                actionManager.actions.changeIconOutline,
                "ui",
                change,
              )
            }
          />
          <button
            type="button"
            className="icon-color-editor__button"
            onClick={() => {
              setTint(0);
              setPalette(null);
              apply({ reset: true });
            }}
          >
            Reset colors
          </button>
          <button
            type="button"
            className="icon-color-editor__button icon-color-editor__done"
            onClick={onDone}
          >
            Done
          </button>
        </Island>
      </div>
    </div>
  );
};
