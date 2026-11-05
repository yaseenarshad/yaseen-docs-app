/**
 * Yaseen Docs (YAZ-4354 1D): the "Edit colors" mode of a many-color icon, on the
 * board: the numbers around the picture (one per color it shows now, with a line
 * to that color's part), the palette next to a click, and the strip below the
 * icon (Variations, ⋯ with the scope and the tint, Outline, Reset colors, Done).
 * One card shows at a time: a color's card or one of the strip's (YAZ-4422).
 *
 * A click on the canvas reaches `handlers.pick` first (App): the hidden pick map
 * names the part under it. No SVG of the icon goes into the page: the pick map
 * and the faded preview are pictures (`<img>` data), drawn on canvases.
 *
 * Each pick applies at once and is one undo step (`changeIconColors`); the tint
 * drag paints at most every 100 ms and is one undo step at its release.
 *
 * YAZ-4348 demo ("prebuilt color variations to edit colors including match my
 * board"): Variations shows the icon in Original, Blue, Green, Purple, Pink,
 * Grey and "Match my board". Each preview is a small `<img>` of the painted SVG,
 * made the first time the card opens and kept while the mode is open. A click
 * applies a normal `colors` map (`replaceColors`) and clears the part colors,
 * so the board shows what the preview showed; it is one undo step.
 */
import clsx from "clsx";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

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
  greyIconColors,
  groupColorChange,
  groupIconColors,
  hueIconColors,
  ICON_VARIATION_HUES,
  iconNaturalSize,
  iconPickPointOfScene,
  iconScenePointOfPick,
  loadIconPickMap,
  matchBoardIconColors,
  paintIcon,
  pickIconTarget,
  svgOfDataURL,
  svgToDataURL,
  tintIconColors,
} from "@excalidraw/element";

import type {
  IconPaintTarget,
  IconPickMap,
  IconRecipe,
} from "@excalidraw/element";
import type { InitializedExcalidrawImageElement } from "@excalidraw/element/types";

import {
  actionChangeIconColors,
  currentIconRecipe,
  IconOutlineControls,
  IconSizeSlider,
} from "../actions/actionIconColors";

import { ColorPicker } from "./ColorPicker/ColorPicker";
import { getBoardColors } from "./ColorPicker/colorPickerUtils";
import { Island } from "./Island";
import { ToolbarPopover } from "./ToolbarPopover";
import { Tooltip } from "./Tooltip";
import { DotsHorizontalIcon } from "./icons";

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
  /** YAZ-4348 demo: a digit 1 to 9 opens that number's palette; true when there is such a number */
  digit: ((n: number) => boolean) | null;
};

/** The strip's card that is open (YAZ-4422: one card at a time, a color's card too). */
type StripCard = "variations" | "more" | "outline" | null;

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
/** The number badge's width in px (`IconColorEditor.scss`, 2.5rem). */
const BADGE_SIZE = 40;
const PALETTE_WIDTH = 300;
/** YAZ-4348 demo: what each control does, on hover. */
const SCOPE_TIPS = {
  all: "Click a part of the picture: every part that has the same color changes with it.",
  one: "Click a part of the picture: only that part changes. Tip: hold Option (Alt) while you click to do this once.",
} as const;
const TINT_TIP =
  "Turns every color around the color wheel at once. Black, white and grey stay, and so do the light and dark shades.";
/**
 * YAZ-4375 (1D1): the color a part SHOWS. `currentColor` draws black in a picture, but as a CSS value on a badge it
 * took the badge's own text color (white on white), and the tooltip said "currentColor".
 */
const shownColor = (color: string) =>
  color === "currentColor" ? "#000000" : color;
/** YAZ-4348 demo: the card's height, so it can sit clear of the strip. */
const PALETTE_HEIGHT = 300;
const STRIP_HEIGHT = 64;

/** One prebuilt look of the icon (YAZ-4348 demo). */
type IconVariation = {
  name: string;
  tip: string;
  /** the `colors` map; null: it cannot be made (no colors on the board) */
  colors: Record<string, string> | null;
};

/** The most previews the mode keeps (seven per outline). */
const MAX_VARIATION_PREVIEWS = 42;

const shadesTip = (name: string) =>
  `${name}: every color turns ${name.toLowerCase()}. Light and dark shades stay, and so do black, white and grey.`;

/** The variations of an icon whose original colors are `originals`. */
export const iconVariations = (
  originals: readonly string[],
  boardColors: readonly string[],
): IconVariation[] => [
  { name: "Original", tip: "Original: the icon's own colors.", colors: {} },
  ...(
    [
      ["Blue", ICON_VARIATION_HUES.blue],
      ["Green", ICON_VARIATION_HUES.green],
      ["Purple", ICON_VARIATION_HUES.purple],
      ["Pink", ICON_VARIATION_HUES.pink],
    ] as const
  ).map(([name, hue]) => ({
    name,
    tip: shadesTip(name),
    colors: hueIconColors(originals, hue),
  })),
  {
    name: "Grey",
    tip: "Grey: every color turns grey. Light and dark shades stay.",
    colors: greyIconColors(originals),
  },
  ((colors) => ({
    name: "Match my board",
    tip: colors
      ? "Match my board: uses the colors already on this board."
      : "Match my board: this board has no colors yet. Color a shape or an icon first.",
    colors,
  }))(matchBoardIconColors(originals, boardColors)),
];

/** The same color map, whatever its key order. */
const sameColors = (a: Record<string, string>, b: Record<string, string>) =>
  Object.keys(a).length === Object.keys(b).length &&
  Object.entries(a).every(([key, color]) => b[key] === color);

/**
 * The Variations card. It mounts when the card opens; the previews come from
 * `cache` (the mode's, so each one is painted once while the mode is open).
 */
const IconColorVariations = ({
  app,
  element,
  svgText,
  originals,
  recipe,
  outlineUnits,
  cache,
  onPick,
}: {
  app: AppClassProperties;
  element: InitializedExcalidrawImageElement;
  svgText: string;
  originals: readonly string[];
  recipe: IconRecipe;
  outlineUnits: number;
  cache: Map<string, string>;
  onPick: (colors: Record<string, string>) => void;
}) => {
  const variations = useMemo(
    () =>
      iconVariations(
        originals,
        getBoardColors(app.scene.getNonDeletedElements(), element.id),
      ),
    // the board's colors are read once each time the card opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const previewOf = (colors: Record<string, string>) => {
    const key = `${JSON.stringify(recipe.outline)}|${JSON.stringify(colors)}`;
    let url = cache.get(key);
    if (url === undefined) {
      if (cache.size >= MAX_VARIATION_PREVIEWS) {
        cache.clear();
      }
      try {
        url = svgToDataURL(
          paintIcon(svgText, { colors, outline: recipe.outline }, outlineUnits),
        );
      } catch {
        url = "";
      }
      cache.set(key, url);
    }
    return url;
  };
  const noParts = !recipe.parts || !Object.keys(recipe.parts).length;
  return (
    <div
      className="icon-color-editor__variations"
      role="group"
      aria-label="Variations"
    >
      {variations.map(({ name, tip, colors }) => {
        const active = !!colors && noParts && sameColors(colors, recipe.colors);
        const url = colors ? previewOf(colors) : "";
        return (
          <Tooltip key={name} label={tip} long>
            <button
              type="button"
              className={clsx("icon-color-editor__variation", {
                "is-active": active,
              })}
              aria-label={name}
              aria-pressed={active}
              aria-disabled={!colors}
              onClick={() => colors && onPick(colors)}
            >
              <span className="icon-color-editor__variation-preview">
                {url ? <img src={url} alt="" draggable={false} /> : null}
              </span>
              <span className="icon-color-editor__variation-name">{name}</span>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
};

/**
 * The numbers' angles around the picture, each kept near its part, but never closer than `minGap` (the badge's
 * width at this radius) — also across the wrap from the last to the first. YAZ-4348 demo: an 11-color fire put
 * numbers on top of each other, because the old pass pushed only forward and never compared the last with the
 * first. When the circle cannot hold them all at `minGap`, they spread evenly.
 */
const spreadAngles = (angles: number[], minGap: number) => {
  const n = angles.length;
  if (n < 2) {
    return [...angles];
  }
  const TAU = 2 * Math.PI;
  const order = angles
    .map((angle, i) => ({ angle: ((angle % TAU) + TAU) % TAU, i }))
    .sort((a, b) => a.angle - b.angle);
  const gap = Math.min(minGap, TAU / n);
  // pull apart every close pair (the last and the first too), half each way, until nothing overlaps
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (let k = 0; k < n; k++) {
      const a = order[k];
      const b = order[(k + 1) % n];
      const diff = k === n - 1 ? b.angle + TAU - a.angle : b.angle - a.angle;
      if (diff < gap - 1e-6) {
        const push = (gap - diff) / 2;
        a.angle -= push;
        b.angle += push;
        moved = true;
      }
    }
    if (!moved) {
      break;
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
  // YAZ-4366: each target's index by its key, so a number finds its parts in one look each
  const targetIndex = useMemo(
    () => new Map(targets.map((target, i) => [target.key, i])),
    [targets],
  );
  const outlineUnits = info.geometry?.outline ?? 0;
  const [pickMap, setPickMap] = useState<IconPickMap | null>(null);
  const [scope, setScope] = useState<"all" | "one">("all");
  const [palette, setPalette] = useState<Palette | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [tint, setTint] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  // YAZ-4348 demo, YAZ-4422: one card at a time; a strip card closes the color's card, and back
  const [stripCard, setStripCard] = useState<StripCard>(null);
  const previews = useRef(new Map<string, HTMLImageElement>());
  // the Variations previews: painted once each while the mode is open
  const variationPreviews = useRef(new Map<string, string>());
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

  /**
   * Opens a color's card, or closes it (null). YAZ-4422: a color's card closes the strip's card. YAZ-4366: each
   * card opens with the full picker closed; a pick inside the card keeps it (`setPalette`).
   */
  const showPalette = (next: Palette | null) => {
    setPalette(next);
    setPickerOpen(false);
    if (next) {
      setStripCard(null);
    }
  };

  /** A strip card's open state; opening it closes the other cards (YAZ-4422). */
  const stripCardProps = (card: Exclude<StripCard, null>) => ({
    open: stripCard === card,
    onOpenChange: (open: boolean) => {
      // a close can come after the next card opened (its outside click): it closes only itself
      setStripCard((current) =>
        open ? card : current === card ? null : current,
      );
      if (open) {
        showPalette(null);
      }
    },
  });

  // a canvas click: true when it was inside the picture (the mode keeps it)
  const pick: NonNullable<IconColorEditorHandlers["pick"]> = (
    scene,
    client,
    justThisPart,
  ) => {
    const point = natural && iconPickPointOfScene(element, natural, scene);
    if (!point) {
      return false;
    }
    const index = pickMap ? pickIconTarget(pickMap, point.x, point.y) : -1;
    const target = index >= 0 ? targets[index] : null;
    if (!target) {
      showPalette(null);
      return true;
    }
    showPalette({
      x: client.x - appState.offsetLeft,
      y: client.y - appState.offsetTop,
      color: currentTargetColors(target, recipe)[0],
      target,
      justThisPart,
    });
    return true;
  };
  const escape = () => {
    if (palette) {
      showPalette(null);
      return true;
    }
    return false;
  };

  /**
   * The App's clicks and keys reach the mode through `handlers`. YAZ-4366: the render does not write them; they are
   * set once, and they call the last render's functions (`live`, set after each commit).
   */
  const live = useRef<Required<{
    [K in keyof IconColorEditorHandlers]: NonNullable<
      IconColorEditorHandlers[K]
    >;
  }> | null>(null);
  useLayoutEffect(() => {
    handlers.pick = (...args) => live.current?.pick(...args) ?? false;
    handlers.escape = () => live.current?.escape() ?? false;
    handlers.digit = (n) => live.current?.digit(n) ?? false;
    return () => {
      handlers.pick = null;
      handlers.escape = null;
      handlers.digit = null;
      onPreview(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // the numbers: around the picture, each pointing at its color's biggest part
  const center = toContainer({
    x: element.x + element.width / 2,
    y: element.y + element.height / 2,
  });
  // a ring wide enough to hold every number side by side (an 11-color fire needs a wider ring than a star)
  const radius = Math.max(
    (Math.max(element.width, element.height) / 2) * appState.zoom.value +
      BADGE_GAP,
    (groups.length * (BADGE_SIZE + 10)) / (2 * Math.PI),
  );
  const anchors = groups.map((group) => {
    let best = -1;
    for (const key of group.keys) {
      const i = targetIndex.get(key) ?? -1;
      if (
        i >= 0 &&
        (best < 0 || (pickMap?.areas[i] ?? 0) > (pickMap?.areas[best] ?? 0))
      ) {
        best = i;
      }
    }
    const anchor = best >= 0 ? pickMap?.anchors[best] : null;
    const scene =
      anchor && natural ? iconScenePointOfPick(element, natural, anchor) : null;
    return scene ? toContainer(scene) : center;
  });
  const angles = spreadAngles(
    anchors.map((anchor, i) =>
      Math.hypot(anchor.x - center.x, anchor.y - center.y) < 4
        ? -Math.PI / 2 + i * 0.7
        : Math.atan2(anchor.y - center.y, anchor.x - center.x),
    ),
    (BADGE_SIZE + 10) / radius,
  );
  const badges = groups.map((group, i) => ({
    group,
    number: i + 1,
    anchor: anchors[i],
    x: center.x + Math.cos(angles[i]) * radius,
    y: center.y + Math.sin(angles[i]) * radius,
  }));

  // one palette at a time, the same from a click on a number or its digit key
  const openBadge = (badge: typeof badges[number]) => {
    showPalette({
      x: badge.x + 18,
      y: badge.y,
      color: badge.group.color,
      target: null,
      justThisPart: false,
    });
  };
  // YAZ-4348 demo ("1- yes im down for that"): the keys 1 to 9 open the numbers' palettes
  const digit = (n: number) => {
    const badge = natural ? badges[n - 1] : undefined;
    if (!badge) {
      return false;
    }
    openBadge(badge);
    return true;
  };
  useLayoutEffect(() => {
    live.current = { pick, escape, digit };
  });

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
  // the color's card never covers the strip: beside the click, else above or below the strip
  const paletteTop = (y: number) => {
    const fit = (top: number) =>
      Math.max(8, Math.min(top, appState.height - PALETTE_HEIGHT - 8));
    const top = fit(y - 40);
    const overlaps =
      top < stripTop + STRIP_HEIGHT + 8 && top + PALETTE_HEIGHT > stripTop - 8;
    if (!overlaps) {
      return top;
    }
    return stripTop > center.y
      ? fit(stripTop - PALETTE_HEIGHT - 12)
      : fit(stripTop + STRIP_HEIGHT + 12);
  };

  if (!natural) {
    return null;
  }

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
            background: shownColor(group.color),
            color: isColorDark(shownColor(group.color)) ? "#ffffff" : "#1e1e1e",
          }}
          title={`Color ${number} · ${group.keys.length} part${
            group.keys.length === 1 ? "" : "s"
          }. Click${
            number <= 9 ? ` or press ${number}` : ""
          } to change it; point to see its parts.`}
          aria-label={`Color ${number}`}
          onPointerEnter={() => setHovered(group.color)}
          onPointerLeave={() => setHovered(null)}
          onClick={() => openBadge(badges[number - 1])}
        >
          {number}
        </button>
      ))}

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
          {/* YAZ-4348 demo: the prebuilt looks, with live previews, behind one chip */}
          <ToolbarPopover
            label="Variations"
            title="Variations: the icon in other colors, or in the colors already on this board"
            className="text-toolbar-value icon-color-editor__variations-trigger"
            {...stripCardProps("variations")}
            icon={
              <span className="icon-color-editor__variations-chip">
                <i />
                Variations
              </span>
            }
          >
            <IconColorVariations
              app={app}
              element={element}
              svgText={svgText}
              originals={info.colors}
              recipe={recipe}
              outlineUnits={outlineUnits}
              cache={variationPreviews.current}
              onPick={(colors) => {
                setTint(0);
                showPalette(null);
                apply({
                  colors,
                  replaceColors: true,
                  parts: Object.fromEntries(
                    Object.keys(recipe.parts ?? {}).map((key) => [key, null]),
                  ),
                });
              }}
            />
          </ToolbarPopover>
          {/* YAZ-4348 demo: the change scope and the tint sit behind ⋯, so the strip stays short */}
          <ToolbarPopover
            label="More options"
            title="More: what a click changes, and Tint"
            icon={DotsHorizontalIcon}
            className="icon-color-editor__more-trigger"
            {...stripCardProps("more")}
          >
            <div className="icon-color-editor__more">
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
                  <Tooltip key={value} label={SCOPE_TIPS[value]} long>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={scope === value}
                      className={clsx({ "is-active": scope === value })}
                      onClick={() => setScope(value)}
                    >
                      {label}
                    </button>
                  </Tooltip>
                ))}
              </div>
              <Tooltip label={TINT_TIP} long>
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
              </Tooltip>
            </div>
          </ToolbarPopover>
          {/* YAZ-4348 demo: one outline chip; its colors and thickness open in their own card */}
          <ToolbarPopover
            label="Outline"
            title="Outline: a line around the icon's shape. Pick its color and thickness."
            className="text-toolbar-value icon-color-editor__outline-trigger"
            {...stripCardProps("outline")}
            icon={
              <span className="icon-color-editor__outline-chip">
                <i
                  style={{ background: recipe.outline?.color ?? "transparent" }}
                />
                Outline
              </span>
            }
          >
            <div className="icon-color-editor__outline-card">
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
            </div>
          </ToolbarPopover>
          <Tooltip
            label="Back to the icon's original colors. The outline stays."
            long
          >
            <button
              type="button"
              className="icon-color-editor__button"
              onClick={() => {
                setTint(0);
                showPalette(null);
                apply({ reset: true });
              }}
            >
              Reset colors
            </button>
          </Tooltip>
          <button
            type="button"
            className="icon-color-editor__button icon-color-editor__done"
            onClick={onDone}
          >
            Done
          </button>
        </Island>
      </div>
      {palette && (
        <div
          className="icon-color-editor__float"
          style={{
            left: Math.max(
              8,
              Math.min(palette.x + 16, appState.width - PALETTE_WIDTH - 8),
            ),
            top: paletteTop(palette.y),
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
                style={{ background: shownColor(palette.color) }}
              />
              Color {paletteNumber}:{" "}
              {justThisPart
                ? "just this part"
                : `${partCount} part${partCount === 1 ? "" : "s"}`}
            </div>
            {chips.length > 1 && (
              <div
                className="icon-color-editor__chips"
                title="This part is shaded. Pick which of its colors to change."
              >
                {chips.map((color) => {
                  // YAZ-4366: a color with no number yet (a pick still paints) shows no "0"
                  const number = groups.findIndex((g) => g.color === color) + 1;
                  return (
                    <button
                      key={color}
                      type="button"
                      className={clsx({
                        "is-active": color === palette.color,
                      })}
                      onClick={() =>
                        setPalette({ ...palette, color, justThisPart: false })
                      }
                    >
                      <i style={{ background: shownColor(color) }} />
                      {number > 0 ? number : null}
                    </button>
                  );
                })}
              </div>
            )}
            <ColorPicker
              topPicks={DEFAULT_ELEMENT_STROKE_PICKS}
              palette={DEFAULT_ELEMENT_STROKE_COLOR_PALETTE}
              type="elementStroke"
              label={`Color ${paletteNumber}`}
              color={shownColor(palette.color)}
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
                showPalette(null);
              }}
            >
              Back to original
            </button>
          </Island>
        </div>
      )}
    </div>
  );
};
