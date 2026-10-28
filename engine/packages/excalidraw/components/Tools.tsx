import clsx from "clsx";
import { useEffect, useState } from "react";

import { KEYS, capitalizeString } from "@excalidraw/common";

import type { PointerType } from "@excalidraw/element/types";

import { trackEvent } from "../analytics";
import { t } from "../i18n";
import { boundShortcut, toolMovedAway } from "../keyRemap";
import { getShortcutKey } from "../shortcut";

import { IconButton } from "./IconButton";
import { ToolPopover } from "./ToolPopover";
import {
  SelectionIcon,
  RectangleIcon,
  DiamondIcon,
  EllipseIcon,
  ArrowIcon,
  LineIcon,
  FreedrawIcon,
  drawShapeToolIcon,
  TextIcon,
  ImageIcon,
  EraserIcon,
  laserPointerToolIcon,
  LassoIcon,
  handIcon,
  frameToolIcon,
  EmbedIcon,
} from "./icons";

import type {
  AppClassProperties,
  AppState,
  ToolType,
  UIAppState,
} from "../types";

export type ToolConfig = {
  icon: React.ReactNode;
  /** letter shortcut(s) — the first one is shown in tooltips */
  letterKey?: string | readonly string[];
  /** whether `letterKey` requires Shift to be held (e.g. Shift+X) */
  shiftKey?: boolean;
  /** whether the tool's shapes can be filled — fills the icon when active */
  fillable?: boolean;
  /**
   * re-activating the tool switches back to the previously active tool
   * (via the keyboard shortcut or ESC — see `setActiveTool`'s `toggle`
   * option)
   */
  toggle?: boolean;
};

/** preserves the exact keys while typing every entry as ToolConfig */
const defineTools = <T extends Record<string, ToolConfig>>(tools: T) =>
  tools as { [K in keyof T]: ToolConfig };

/**
 * Tool data — the single source of truth for tool buttons, keyboard
 * shortcuts (`findShapeByKey`), and the command palette. Toolbar placement
 * is not defined here: toolbars compose the `*ToolButton` components below
 * manually, so entries without a toolbar slot (e.g. laser) are data-only.
 */
export const TOOLS = defineTools({
  hand: {
    icon: handIcon,
    letterKey: KEYS.H,
    toggle: true,
  },
  selection: {
    icon: SelectionIcon,
    letterKey: KEYS.V,
    fillable: true,
  },
  rectangle: {
    icon: RectangleIcon,
    letterKey: KEYS.R,
    fillable: true,
  },
  diamond: {
    icon: DiamondIcon,
    fillable: true,
  },
  ellipse: {
    icon: EllipseIcon,
    letterKey: KEYS.O,
    fillable: true,
  },
  arrow: {
    icon: ArrowIcon,
    letterKey: KEYS.A,
    fillable: true,
  },
  line: {
    icon: LineIcon,
    letterKey: [KEYS.D, KEYS.L],
    fillable: true,
  },
  freedraw: {
    icon: FreedrawIcon,
    letterKey: [KEYS.W, KEYS.P, KEYS.X],
  },
  text: {
    icon: TextIcon,
    letterKey: KEYS.T,
  },
  image: {
    icon: ImageIcon,
  },
  eraser: {
    icon: EraserIcon,
    toggle: true,
  },
  frame: {
    icon: frameToolIcon,
    letterKey: KEYS.F,
  },
  autoshape: {
    icon: drawShapeToolIcon,
    letterKey: KEYS.X,
    shiftKey: true,
    fillable: false,
  },
  embeddable: {
    icon: EmbedIcon,
  },
  laser: {
    icon: laserPointerToolIcon,
    letterKey: [KEYS.E, KEYS.K],
  },
  lasso: {
    icon: LassoIcon,
    fillable: false,
  },
});

export type ToolbarToolType = keyof typeof TOOLS;

/**
 * tools that, when activated while already active, switch back to the
 * previously active tool (see `setActiveTool`'s `toggle` option)
 */
export const TOGGLE_TOOLS: readonly (ToolType | "custom")[] = (
  Object.keys(TOOLS) as ToolbarToolType[]
).filter((type) => TOOLS[type].toggle);

export const getToolLetter = (type: ToolbarToolType) => {
  // Yaseen Docs (YAZ-3564 K12): the user's key, when they changed it
  const bound = boundShortcut(`tool:${type}`);
  if (bound !== undefined) {
    return bound;
  }
  const { letterKey, shiftKey } = TOOLS[type];
  if (!letterKey) {
    return letterKey;
  }
  const letter = capitalizeString(
    typeof letterKey === "string" ? letterKey : letterKey[0],
  );
  return shiftKey ? getShortcutKey(`Shift+${letter}`) : letter;
};

/** human-readable shortcut hint, e.g. "D or L", used in tooltips */
export const getToolShortcut = (type: ToolbarToolType) => {
  // Yaseen Docs (YAZ-3564 K12)
  const bound = boundShortcut(`tool:${type}`);
  if (bound !== undefined) {
    return bound;
  }
  const { letterKey, shiftKey } = TOOLS[type];
  const letters = letterKey
    ? (typeof letterKey === "string" ? [letterKey] : letterKey).map((key) => {
        const letter = capitalizeString(key);
        return shiftKey ? getShortcutKey(`Shift+${letter}`) : letter;
      })
    : [];
  return letters.join(` ${t("helpDialog.or")} `);
};

/** valid ARIA key tokens for each alternate shortcut, e.g. "D L" */
export const getToolAriaKeyShortcuts = (type: ToolbarToolType) => {
  // Yaseen Docs (YAZ-3564 K12)
  const bound = boundShortcut(`tool:${type}`, (text) => text);
  if (bound !== undefined) {
    return bound;
  }
  const { letterKey, shiftKey } = TOOLS[type];
  const letters = letterKey
    ? (typeof letterKey === "string" ? [letterKey] : letterKey).map((key) => {
        const letter = capitalizeString(key);
        return shiftKey ? `Shift+${letter}` : letter;
      })
    : [];
  return letters.join(" ");
};

export const findShapeByKey = (
  key: string,
  app: AppClassProperties,
  shiftKey: boolean = false,
  // Yaseen Docs (YAZ-3564 K5): the tool the user's key picks (`boundTool`)
  bound: string | null = null,
) => {
  if (bound !== null) {
    return bound === "selection"
      ? app.state.preferredSelectionTool.type
      : (bound as ToolbarToolType);
  }
  // CapsLock-insensitive: the caller excludes every modifier but shift, and
  // shift is matched explicitly below, so a capital letter on its own means
  // CapsLock
  const lowerKey = key.toLowerCase();

  for (const type of Object.keys(TOOLS) as ToolbarToolType[]) {
    const { letterKey, shiftKey: requiresShift } = TOOLS[type];
    // shift-bound tools require shift; plain-bound ones require its absence
    // Yaseen Docs (YAZ-3564 K5): a tool the user moved keeps no letter
    if (shiftKey !== Boolean(requiresShift) || toolMovedAway(type)) {
      continue;
    }
    if (
      letterKey &&
      (typeof letterKey === "string"
        ? letterKey === lowerKey
        : letterKey.includes(lowerKey))
    ) {
      // the selection shortcut activates whichever selection tool the user
      // prefers (selection or lasso)
      return type === "selection"
        ? app.state.preferredSelectionTool.type
        : type;
    }
  }
  return null;
};

/**
 * Whether a toolbar entry activating the given tool renders disabled — true
 * when the active tool is host-controlled (`props.activeTool`) and the entry
 * doesn't activate the forced tool (`setActiveTool` refuses it).
 */
export const isToolButtonDisabled = (app: AppClassProperties, type: string) =>
  app.props.activeTool != null && app.props.activeTool.type !== type;

export type ToolButtonComponentProps = {
  app: AppClassProperties;
  activeTool: UIAppState["activeTool"];
  /** hide the keybinding badge rendered in the button's corner */
  hideKeyBinding?: boolean;
  /**
   * hide all shortcut affordances (tooltip hint, aria-keyshortcuts, and the
   * keybinding badge) — used on mobile where there's no keyboard
   */
  hideShortcut?: boolean;
};

type ToolButtonBehavior = {
  /**
   * display the shortcut of another tool (tooltip, aria, keybinding badge) —
   * e.g. the lasso button shows the selection shortcut, which activates it
   * when lasso is the preferred selection tool
   */
  shortcutType?: ToolbarToolType;
  /**
   * custom activation — replaces the default track + `setActiveTool` (pen
   * detection still runs before it)
   */
  onSelect?: (
    app: AppClassProperties,
    data: { pointerType: PointerType | null },
  ) => void;
};

/**
 * Creates a toolbar button component for the given tool. Activation is
 * uniform: track + `setActiveTool` (recording the previous tool for toggle
 * tools), with pen detection on the first pen interaction.
 */
const createToolButton = (
  type: ToolbarToolType,
  behavior?: ToolButtonBehavior,
) => {
  const config = TOOLS[type];
  const shortcutType = behavior?.shortcutType ?? type;

  const ToolButtonComponent = ({
    app,
    activeTool,
    hideKeyBinding,
    hideShortcut,
  }: ToolButtonComponentProps) => {
    const label = capitalizeString(t(`toolBar.${type}`));
    const shortcut = hideShortcut ? null : getToolShortcut(shortcutType);

    return (
      <IconButton
        className={clsx({ fillable: config.fillable })}
        type="toggle"
        icon={config.icon}
        checked={activeTool.type === type}
        disabled={isToolButtonDisabled(app, type)}
        title={shortcut ? `${label} — ${shortcut}` : label}
        keyBindingLabel={
          hideKeyBinding || hideShortcut
            ? undefined
            : getToolLetter(shortcutType)
        }
        aria-label={label}
        aria-keyshortcuts={
          hideShortcut ? undefined : getToolAriaKeyShortcuts(shortcutType)
        }
        data-testid={`toolbar-${type}`}
        onSelect={({ pointerType }) => {
          if (!app.state.penDetected && pointerType === "pen") {
            app.togglePenMode(true);
          }

          if (behavior?.onSelect) {
            behavior.onSelect(app, { pointerType });
            return;
          }

          if (app.state.activeTool.type !== type) {
            trackEvent("toolbar", type, "ui");
            app.setActiveTool({ type });
          }
        }}
      />
    );
  };

  ToolButtonComponent.displayName = `${capitalizeString(type)}IconButton`;

  return ToolButtonComponent;
};

export const HandToolButton = createToolButton("hand");
export const RectangleToolButton = createToolButton("rectangle");
export const DiamondToolButton = createToolButton("diamond");
export const EllipseToolButton = createToolButton("ellipse");
export const ArrowToolButton = createToolButton("arrow");
export const LineToolButton = createToolButton("line");
export const FreedrawToolButton = createToolButton("freedraw");
export const TextToolButton = createToolButton("text");
export const ImageToolButton = createToolButton("image");
export const EraserToolButton = createToolButton("eraser");
export const FrameToolButton = createToolButton("frame");
export const LaserToolButton = createToolButton("laser");

/**
 * The selection tool button — pointer-clicking it while the selection tool
 * is active switches to lasso.
 */
export const SelectionToolButton = createToolButton("selection", {
  onSelect: (app, { pointerType }) => {
    if (app.state.activeTool.type === "selection" && pointerType !== null) {
      // pointer-clicking the active selection tool switches to lasso;
      // keyboard/AT activation stays on selection
      app.setActiveTool({ type: "lasso" });
      return;
    }

    if (app.state.activeTool.type !== "selection") {
      trackEvent("toolbar", "selection", "ui");
      app.setActiveTool({ type: "selection" });
    }
  },
});

/**
 * Rendered in place of the selection button when lasso is the preferred
 * selection tool; the selection shortcut activates it then.
 */
export const LassoToolButton = createToolButton("lasso", {
  shortcutType: "selection",
});

/**
 * The selection ⇄ lasso popover used in compact (tablet) and mobile
 * toolbars; picking an option also makes it the preferred selection tool.
 */
export const SelectionToolPopover = ({
  app,
  activeTool,
  setAppState,
}: {
  app: AppClassProperties;
  activeTool: UIAppState["activeTool"];
  setAppState: React.Component<any, AppState>["setState"];
}) => {
  const SELECTION_TOOLS = [
    {
      type: "selection",
      icon: TOOLS.selection.icon,
      fillable: TOOLS.selection.fillable,
      title: capitalizeString(t("toolBar.selection")),
    },
    {
      type: "lasso",
      icon: TOOLS.lasso.icon,
      fillable: TOOLS.lasso.fillable,
      title: capitalizeString(t("toolBar.lasso")),
    },
  ] as const;

  const displayedOption =
    SELECTION_TOOLS.find(
      (tool) => tool.type === app.state.preferredSelectionTool.type,
    ) || SELECTION_TOOLS[0];

  return (
    <ToolPopover
      app={app}
      options={SELECTION_TOOLS}
      activeTool={activeTool}
      defaultOption={app.state.preferredSelectionTool.type}
      data-testid="toolbar-selection"
      onToolChange={(type: string) => {
        if (type === "selection" || type === "lasso") {
          app.setActiveTool({ type });
          setAppState({
            preferredSelectionTool: { type, initialized: true },
          });
        }
      }}
      displayedOption={displayedOption}
    />
  );
};

/**
 * The freedraw ⇄ draw-shape popover used in compact (tablet) and mobile
 * toolbars. The trigger remembers and displays the most recently used option.
 */
export const FreedrawToolPopover = ({
  app,
  activeTool,
}: {
  app: AppClassProperties;
  activeTool: UIAppState["activeTool"];
}) => {
  const DRAWING_TOOLS = [
    {
      type: "freedraw",
      icon: TOOLS.freedraw.icon,
      fillable: TOOLS.freedraw.fillable,
      title: capitalizeString(t("toolBar.freedraw")),
    },
    {
      type: "autoshape",
      icon: TOOLS.autoshape.icon,
      fillable: TOOLS.autoshape.fillable,
      title: capitalizeString(t("toolBar.autoshape")),
    },
  ] as const;

  const [lastDrawingTool, setLastDrawingTool] = useState<
    typeof DRAWING_TOOLS[number]["type"]
  >(activeTool.type === "autoshape" ? "autoshape" : "freedraw");

  useEffect(() => {
    if (activeTool.type === "freedraw" || activeTool.type === "autoshape") {
      setLastDrawingTool(activeTool.type);
    }
  }, [activeTool.type]);

  const displayedOption =
    DRAWING_TOOLS.find((tool) => tool.type === lastDrawingTool) ||
    DRAWING_TOOLS[0];

  return (
    <ToolPopover
      app={app}
      options={DRAWING_TOOLS}
      activeTool={activeTool}
      defaultOption={lastDrawingTool}
      data-testid="toolbar-freedraw"
      onToolChange={(type: string) => {
        if (type === "freedraw" || type === "autoshape") {
          setLastDrawingTool(type);
          app.setActiveTool({ type });
        }
      }}
      displayedOption={displayedOption}
    />
  );
};
