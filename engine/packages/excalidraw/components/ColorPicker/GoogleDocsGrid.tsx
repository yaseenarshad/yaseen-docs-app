/**
 * Unified Google Docs-style 10×8 colour grid for Excalidraw (`YAZ-6730`).
 *
 * Matches `shared/palette.ts` + `client/src/editor/colourGrid.ts` pixel-for-pixel so the
 * Drawing board toolbar (Text color, Highlight, Text box fill, Icon colors, Shape stroke/fill)
 * shares one exact design language with Page, Table, and Drawing Text Box colour pickers.
 */
import clsx from "clsx";
import React, { useEffect, useRef, useState } from "react";

import { COLOR_PALETTE } from "@excalidraw/common";
import type { ColorPaletteCustom } from "@excalidraw/common";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { useAtom } from "../../editor-jotai";
import { t } from "../../i18n";
import { useEditorInterface } from "../App";
import { activeEyeDropperAtom } from "../EyeDropper";
import { eyeDropperIcon } from "../icons";

import { ColorInput } from "./ColorInput";
import {
  getMostUsedCustomColors,
  type ColorPickerType,
} from "./colorPickerUtils";

export interface GDocsSwatch {
  readonly hex: string;
  readonly label: string;
}

export const GDOCS_GRAYSCALE: readonly GDocsSwatch[] = [
  { hex: "#000000", label: "Black" },
  { hex: "#434343", label: "Dark grey 4" },
  { hex: "#666666", label: "Dark grey 3" },
  { hex: "#999999", label: "Dark grey 2" },
  { hex: "#b7b7b7", label: "Dark grey 1" },
  { hex: "#cccccc", label: "Grey" },
  { hex: "#d9d9d9", label: "Light grey 1" },
  { hex: "#efefef", label: "Light grey 2" },
  { hex: "#f3f3f3", label: "Light grey 3" },
  { hex: "#ffffff", label: "White" },
];

export const GDOCS_BASE_HUES: readonly GDocsSwatch[] = [
  { hex: "#980000", label: "Red berry" },
  { hex: "#ff0000", label: "Red" },
  { hex: "#ff9900", label: "Orange" },
  { hex: "#ffff00", label: "Yellow" },
  { hex: "#00ff00", label: "Green" },
  { hex: "#00ffff", label: "Cyan" },
  { hex: "#4a86e8", label: "Cornflower blue" },
  { hex: "#0000ff", label: "Blue" },
  { hex: "#9900ff", label: "Purple" },
  { hex: "#ff00ff", label: "Magenta" },
];

const SHADE_NAMES = [
  "Light 3",
  "Light 2",
  "Light 1",
  "Dark 1",
  "Dark 2",
  "Dark 3",
] as const;

const SHADE_HEXES: readonly (readonly string[])[] = [
  [
    "#e6b8af",
    "#f4cccc",
    "#fce5cd",
    "#fff2cc",
    "#d9ead3",
    "#d0e0e3",
    "#c9daf8",
    "#cfe2f3",
    "#d9d2e9",
    "#ead1dc",
  ],
  [
    "#dd7e6b",
    "#ea9999",
    "#f9cb9c",
    "#ffe599",
    "#b6d7a8",
    "#a2c4c9",
    "#a4c2f4",
    "#9fc5e8",
    "#b4a7d6",
    "#d5a6bd",
  ],
  [
    "#cc4125",
    "#e06666",
    "#f6b26b",
    "#ffd966",
    "#93c47d",
    "#76a5af",
    "#6d9eeb",
    "#6fa8dc",
    "#8e7cc3",
    "#c27ba0",
  ],
  [
    "#a61c00",
    "#cc0000",
    "#e69138",
    "#f1c232",
    "#6aa84f",
    "#45818e",
    "#3c78d8",
    "#3d85c6",
    "#674ea7",
    "#a64d79",
  ],
  [
    "#85200c",
    "#990000",
    "#b45f06",
    "#bf9000",
    "#38761d",
    "#134f5c",
    "#1155cc",
    "#0b5394",
    "#351c75",
    "#741b47",
  ],
  [
    "#5b0f00",
    "#660000",
    "#783f04",
    "#7f6000",
    "#274e13",
    "#0c343d",
    "#1c4587",
    "#073763",
    "#20124d",
    "#4c1130",
  ],
];

export const GDOCS_SHADES: readonly (readonly GDocsSwatch[])[] =
  SHADE_HEXES.map((row, r) =>
    row.map((hex, c) => ({
      hex,
      label: `${GDOCS_BASE_HUES[c]!.label} ${SHADE_NAMES[r]}`,
    })),
  );

const GDOCS_HEX_SET = new Set<string>(
  [GDOCS_GRAYSCALE, GDOCS_BASE_HUES, ...GDOCS_SHADES]
    .flat()
    .map((s) => s.hex),
);

const hexLuminance = (hex: string): number => {
  if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) {
    return 0.5;
  }
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const isLightSwatch = (hex: string): boolean => hexLuminance(hex) >= 0.42;

const GLOBAL_CUSTOM_KEY = "yaseen:custom-colors";
const GLOBAL_CUSTOM_EVENT = "yaseen:custom-colors-change";
const ENGINE_ADD_EVENT = "yaseen:engine-custom-color-add";
const ENGINE_REMOVE_EVENT = "yaseen:engine-custom-color-remove";
const MAX_RECENT_CUSTOM = 8;

const readStoredCustom = (): string[] => {
  try {
    const raw = window.localStorage.getItem(GLOBAL_CUSTOM_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (x): x is string =>
        typeof x === "string" && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(x),
    );
  } catch {
    return [];
  }
};

const writeStoredCustom = (next: string[]): string[] => {
  const trimmed = next.slice(0, MAX_RECENT_CUSTOM);
  try {
    window.localStorage.setItem(GLOBAL_CUSTOM_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore private-mode / sandbox storage errors.
  }
  return trimmed;
};

const recordStoredCustom = (hex: string): string[] => {
  const norm = hex.toLowerCase();
  const next = writeStoredCustom([
    norm,
    ...readStoredCustom().filter((c) => c !== norm),
  ]);
  window.dispatchEvent(
    new CustomEvent(ENGINE_ADD_EVENT, { detail: { color: norm } }),
  );
  return next;
};

const removeStoredCustom = (hex: string): string[] => {
  const norm = hex.toLowerCase();
  const next = writeStoredCustom(
    readStoredCustom().filter((c) => c.toLowerCase() !== norm),
  );
  window.dispatchEvent(
    new CustomEvent(ENGINE_REMOVE_EVENT, { detail: { color: norm } }),
  );
  return next;
};

interface GoogleDocsGridProps {
  color: string | null;
  onChange: (color: string) => void;
  type: ColorPickerType;
  label: string;
  elements: readonly ExcalidrawElement[];
  palette?: ColorPaletteCustom | null;
  noneLabel?: string | null;
  onNone?: () => void;
  onRequestClose?: () => void;
}

export const GoogleDocsGrid = ({
  color,
  onChange,
  type,
  label,
  elements,
  palette = COLOR_PALETTE,
  noneLabel,
  onNone,
  onRequestClose,
}: GoogleDocsGridProps) => {
  const editorInterface = useEditorInterface();
  const [eyeDropperState, setEyeDropperState] = useAtom(activeEyeDropperAtom);
  const [customOpen, setCustomOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const [storedCustom, setStoredCustom] = useState<string[]>(() =>
    readStoredCustom(),
  );
  const [dismissedBoard, setDismissedBoard] = useState<string[]>([]);
  const [ctxMenu, setCtxMenu] = useState<{
    label: string;
    hex: string;
    isCustom: boolean;
    left: number;
    top: number;
  } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ctxMenu) {
      return;
    }
    const onDown = (e: MouseEvent) => {
      if (
        ctxMenuRef.current &&
        e.target instanceof Node &&
        !ctxMenuRef.current.contains(e.target)
      ) {
        setCtxMenu(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setCtxMenu(null);
      }
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [ctxMenu]);

  const openCtxMenu = (
    e: React.MouseEvent<HTMLButtonElement>,
    label: string,
    hex: string,
    isCustom: boolean,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const host = gridRef.current?.getBoundingClientRect();
    const btn = e.currentTarget.getBoundingClientRect();
    if (!host) {
      setCtxMenu({ label, hex, isCustom, left: 0, top: 0 });
      return;
    }
    const menuW = 172;
    const menuH = 98;
    const left = Math.max(0, Math.min(btn.left - host.left, host.width - menuW));
    const below = btn.bottom - host.top + 4;
    const top =
      below + menuH <= host.height
        ? below
        : Math.max(4, btn.top - host.top - menuH - 4);
    setCtxMenu({ label, hex, isCustom, left, top });
  };

  const normalizedColor = color ? color.toLowerCase() : null;
  const isTransparent =
    !normalizedColor || normalizedColor === COLOR_PALETTE.transparent;

  useEffect(() => {
    const onSync = () => setStoredCustom(readStoredCustom());
    window.addEventListener(GLOBAL_CUSTOM_EVENT, onSync);
    return () => window.removeEventListener(GLOBAL_CUSTOM_EVENT, onSync);
  }, []);

  const boardCustom =
    storedCustom.length > 0 || type === "canvasBackground" || !palette
      ? []
      : getMostUsedCustomColors(elements, type, palette).filter(
          (c) =>
            !GDOCS_HEX_SET.has(c.toLowerCase()) &&
            !dismissedBoard.includes(c.toLowerCase()),
        );
  const customColors = Array.from(
    new Set(
      [...storedCustom, ...boardCustom.map((c) => c.toLowerCase())].filter(
        (c) => /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(c),
      ),
    ),
  ).slice(0, MAX_RECENT_CUSTOM);

  useEffect(() => {
    return () => {
      setEyeDropperState(null);
    };
  }, [setEyeDropperState]);

  const handleCustomChange = (nextHex: string) => {
    setCtxMenu(null);
    const norm = nextHex.toLowerCase();
    if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(norm)) {
      setStoredCustom(recordStoredCustom(norm));
    }
    onChange(nextHex);
  };

  const handleRemoveCustom = (hex: string) => {
    setCtxMenu(null);
    const norm = hex.toLowerCase();
    setDismissedBoard((prev) => (prev.includes(norm) ? prev : [...prev, norm]));
    setStoredCustom(removeStoredCustom(hex));
  };

  const handlePinCustom = (hex: string) => {
    setCtxMenu(null);
    setStoredCustom(recordStoredCustom(hex));
  };

  const handleCopyHex = (hex: string) => {
    setCtxMenu(null);
    void navigator.clipboard?.writeText(hex).catch(() => {});
  };

  const renderRow = (swatches: readonly GDocsSwatch[], rowKey: string) => (
    <div className="gdocs-grid__row" key={rowKey} role="row">
      {swatches.map((swatch) => {
        const active = normalizedColor === swatch.hex;
        const light = isLightSwatch(swatch.hex);
        return (
          <button
            key={swatch.hex}
            type="button"
            className={clsx("gdocs-grid__dot", {
              active,
              "is-light": light,
            })}
            style={{ "--swatch": swatch.hex } as React.CSSProperties}
            title={`${swatch.label} (${swatch.hex})`}
            aria-label={swatch.label}
            aria-pressed={active}
            onClick={() => {
              setCtxMenu(null);
              onChange(swatch.hex);
            }}
            onContextMenu={(e) =>
              openCtxMenu(e, swatch.label, swatch.hex, false)
            }
          />
        );
      })}
    </div>
  );

  const showNone = !!onNone || type === "elementBackground";
  const resolvedNoneLabel = noneLabel ?? "None";
  const handleNone = () => {
    if (onNone) {
      onNone();
    } else {
      onChange(COLOR_PALETTE.transparent);
    }
    onRequestClose?.();
  };

  return (
    <div
      ref={gridRef}
      className="gdocs-grid"
      role="grid"
      aria-label={label || t("labels.colorPicker")}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        if (
          ctxMenu &&
          !(e.target instanceof Element && e.target.closest(".gdocs-grid__ctx"))
        ) {
          setCtxMenu(null);
        }
      }}
    >
      {showNone && (
        <button
          type="button"
          className={clsx("gdocs-grid__reset", { active: isTransparent })}
          aria-pressed={isTransparent}
          onClick={handleNone}
        >
          <span className="gdocs-grid__reset-icon" aria-hidden="true">
            <svg
              viewBox="0 0 16 16"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
            >
              <circle cx="8" cy="8" r="6" />
              <line x1="3.8" y1="12.2" x2="12.2" y2="3.8" />
            </svg>
          </span>
          <span>{resolvedNoneLabel}</span>
        </button>
      )}

      <div className="gdocs-grid__palette">
        {renderRow(GDOCS_GRAYSCALE, "gray")}
        {renderRow(GDOCS_BASE_HUES, "base")}
        <div className="gdocs-grid__shades">
          {GDOCS_SHADES.map((row, idx) => renderRow(row, `shade-${idx}`))}
        </div>
      </div>

      <div className="gdocs-grid__custom">
        <div className="gdocs-grid__label">Custom</div>
        <div className="gdocs-grid__custom-row">
          {customColors.map((hex) => {
            const active = normalizedColor === hex;
            return (
              <button
                key={hex}
                type="button"
                className={clsx("gdocs-grid__dot", {
                  active,
                  "is-light": isLightSwatch(hex),
                })}
                style={{ "--swatch": hex } as React.CSSProperties}
                title={`${hex} · Right-click for options`}
                aria-label={`Custom colour ${hex}`}
                aria-pressed={active}
                onClick={() => handleCustomChange(hex)}
                onContextMenu={(e) => openCtxMenu(e, "Custom", hex, true)}
                onKeyDown={(e) => {
                  if (e.key === "Backspace" || e.key === "Delete") {
                    e.preventDefault();
                    e.stopPropagation();
                    handleRemoveCustom(hex);
                  }
                }}
              />
            );
          })}
          <button
            type="button"
            className={clsx("gdocs-grid__action", { active: customOpen })}
            title="Custom colour…"
            aria-label="Custom colour…"
            aria-expanded={customOpen}
            onClick={() => setCustomOpen((v) => !v)}
          >
            +
          </button>
          {editorInterface.formFactor !== "phone" && (
            <button
              type="button"
              className={clsx("gdocs-grid__action", {
                active: !!eyeDropperState,
              })}
              title={t("labels.eyeDropper")}
              aria-label={t("labels.eyeDropper")}
              aria-pressed={!!eyeDropperState}
              onClick={() =>
                setEyeDropperState((state) =>
                  state
                    ? null
                    : {
                        keepOpenOnAlt: false,
                        onSelect: (picked) => handleCustomChange(picked),
                        colorPickerType: type,
                      },
                )
              }
            >
              {eyeDropperIcon}
            </button>
          )}
        </div>
      </div>

      {customOpen && (
        <div className="gdocs-grid__drawer">
          <ColorInput
            color={isTransparent ? "" : color || ""}
            label={label}
            onChange={handleCustomChange}
            colorPickerType={type}
            placeholder={t("colorPicker.color")}
          />
        </div>
      )}

      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="gdocs-grid__ctx"
          role="menu"
          style={{ left: ctxMenu.left, top: ctxMenu.top }}
        >
          <div className="gdocs-grid__ctx-head">
            <span
              className="gdocs-grid__ctx-swatch"
              style={{ background: ctxMenu.hex }}
            />
            <span className="gdocs-grid__ctx-name">{ctxMenu.label}</span>
            <code className="gdocs-grid__ctx-hex">{ctxMenu.hex}</code>
          </div>
          <button
            type="button"
            className="gdocs-grid__ctx-item"
            role="menuitem"
            onClick={() => handleCopyHex(ctxMenu.hex)}
          >
            Copy hex ({ctxMenu.hex})
          </button>
          {ctxMenu.isCustom ? (
            <button
              type="button"
              className="gdocs-grid__remove"
              role="menuitem"
              onClick={() => handleRemoveCustom(ctxMenu.hex)}
            >
              ✕ Remove {ctxMenu.hex}
            </button>
          ) : (
            <button
              type="button"
              className="gdocs-grid__ctx-item"
              role="menuitem"
              onClick={() => handlePinCustom(ctxMenu.hex)}
            >
              ★ Pin to Custom
            </button>
          )}
        </div>
      )}
    </div>
  );
};
