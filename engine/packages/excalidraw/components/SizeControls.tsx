/**
 * Yaseen Docs (YAZ-4366): the size slider and the exact number field. The text size (YAZ-3943 demo 2), the icon
 * outline's thickness and the Edit colors tint use them, so the three behave the same.
 */
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

import { KEYS } from "@excalidraw/common";

/**
 * A slider whose drag shows each value (`onPreview`, no undo step) and whose release commits the last one
 * (`onChange`), so a drag is one undo step. `previewEveryMs` spaces the previews (a paint is slow, extra 27).
 */
export const DraftSlider = ({
  label,
  value,
  min = 0,
  max,
  step = 1,
  fallback = min,
  previewEveryMs = 0,
  onPreview,
  onChange,
  className = "font-size-slider",
}: {
  label: string;
  /** null: mixed; the slider shows `fallback` */
  value: number | null;
  min?: number;
  max: number;
  step?: number;
  fallback?: number;
  previewEveryMs?: number;
  onPreview: (value: number) => void;
  onChange: (value: number) => void;
  className?: string;
}) => {
  // a value outside the range shows the slider at its end
  const clamp = (next: number | null) =>
    Math.min(max, Math.max(min, Math.round(next ?? fallback)));
  const [draft, setDraft] = useState(clamp(value));
  const moved = useRef<number | null>(null);
  const lastPreview = useRef(0);
  useEffect(() => {
    if (moved.current === null) {
      setDraft(clamp(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const commit = () => {
    if (moved.current !== null) {
      const next = moved.current;
      moved.current = null;
      onChange(next);
    }
  };
  return (
    <input
      type="range"
      className={className}
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={draft}
      onChange={(event) => {
        const next = Number(event.target.value);
        setDraft(next);
        moved.current = next;
        const now = Date.now();
        if (!previewEveryMs || now - lastPreview.current >= previewEveryMs) {
          lastPreview.current = now;
          onPreview(next);
        }
      }}
      onPointerUp={commit}
      onKeyUp={commit}
      onBlur={commit}
      onKeyDown={(event) => event.stopPropagation()}
    />
  );
};

/** A whole number as it is, any other with one decimal (19.33 → "19.3"); "" when mixed. */
export const formatExactNumber = (value: number | null) =>
  value === null
    ? ""
    : Number.isInteger(value)
    ? `${value}`
    : `${Math.round(value * 10) / 10}`;

/**
 * The exact number: Enter or leaving it commits (one decimal, inside `min` to `max`), Esc gives the shown value
 * back. An empty field commits nothing, so a blur on a mixed ("Mixed") field changes no size. `nudge` adds the
 * compact `− 24 +` buttons (YAZ-3943 demo 2).
 */
export const ExactNumberInput = ({
  label,
  value,
  min,
  max,
  onChange,
  unit = "px",
  placeholder,
  compact = false,
  nudge,
}: {
  label: string;
  /** null: mixed */
  value: number | null;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /** null: no unit */
  unit?: string | null;
  placeholder?: string;
  compact?: boolean;
  /** the − and + buttons' labels, and the value they start from when the field is empty */
  nudge?: { decrease: string; increase: string; fallback: number };
}) => {
  const shown = formatExactNumber(value);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const clamp = (next: number) =>
    Math.min(max, Math.max(min, Math.round(next * 10) / 10));

  const commit = () => {
    const parsed = Number(text);
    if (text.trim() === "" || !Number.isFinite(parsed)) {
      setText(shown);
      return;
    }
    const next = clamp(parsed);
    setText(`${next}`);
    if (next !== value) {
      onChange(next);
    }
  };

  const nudgeButton = (amount: number, ariaLabel: string, sign: string) => (
    <button
      type="button"
      aria-label={ariaLabel}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={() => {
        const next = clamp(Number(text || value || nudge!.fallback) + amount);
        setText(`${next}`);
        onChange(next);
      }}
    >
      {sign}
    </button>
  );

  return (
    <div
      className={clsx("font-size-custom", {
        "font-size-custom--compact": compact,
      })}
      data-prevent-outside-click
      onPointerDown={(event) => event.stopPropagation()}
    >
      {compact && nudge && nudgeButton(-1, nudge.decrease, "−")}
      <label>
        <input
          aria-label={label}
          type="number"
          min={min}
          max={max}
          step="0.1"
          value={text}
          placeholder={placeholder}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === KEYS.ENTER) {
              event.preventDefault();
              commit();
            } else if (event.key === KEYS.ESCAPE) {
              setText(shown);
            }
          }}
        />
        {/* YAZ-3943 demo 2: the text toolbar has no unit */}
        {!compact && unit && <span>{unit}</span>}
      </label>
      {compact && nudge && nudgeButton(1, nudge.increase, "+")}
    </div>
  );
};
