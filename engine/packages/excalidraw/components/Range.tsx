import React, { useEffect } from "react";

import "./Range.scss";

export type RangeProps = {
  label: React.ReactNode;
  value: number;
  onChange: (value: number) => void;
  onChangeEnd?: (value: number) => void;
  ariaLabel?: string;
  className?: string;
  min?: number;
  max?: number;
  step?: number;
  minLabel?: React.ReactNode;
  maxLabel?: React.ReactNode;
  hasCommonValue?: boolean;
  preventCanvasInteraction?: boolean;
  showValueBubble?: boolean;
  showMinValueInBubble?: boolean;
  testId?: string;
};

export const Range = ({
  label,
  value,
  onChange,
  onChangeEnd,
  ariaLabel,
  className,
  min = 0,
  max = 100,
  step = 10,
  minLabel = min,
  maxLabel,
  hasCommonValue = true,
  preventCanvasInteraction = false,
  showValueBubble = true,
  showMinValueInBubble = false,
  testId,
}: RangeProps) => {
  const rangeRef = React.useRef<HTMLInputElement>(null);
  const valueRef = React.useRef<HTMLDivElement>(null);
  const latestValueRef = React.useRef(value);

  useEffect(() => {
    latestValueRef.current = value;
    if (rangeRef.current) {
      const rangeElement = rangeRef.current;
      const valueElement = valueRef.current;
      const inputWidth = rangeElement.offsetWidth;
      const thumbWidth =
        parseFloat(
          getComputedStyle(rangeElement).getPropertyValue(
            "--slider-thumb-size",
          ),
        ) || 16;
      const progress = ((value - min) / (max - min || 1)) * 100;
      const position =
        rangeElement.offsetLeft +
        (progress / 100) * (inputWidth - thumbWidth) +
        thumbWidth / 2;
      if (valueElement) {
        valueElement.style.left = `${position}px`;
      }
      rangeElement.style.background = `linear-gradient(to right, var(--color-slider-track) 0%, var(--color-slider-track) ${progress}%, var(--button-bg) ${progress}%, var(--button-bg) 100%)`;
    }
  }, [max, min, value]);

  return (
    <label
      className={`control-label${className ? ` ${className}` : ""}`}
      onPointerDown={
        preventCanvasInteraction
          ? (event) => {
              event.stopPropagation();
            }
          : undefined
      }
    >
      {label}
      <div className="range-wrapper">
        <input
          aria-label={ariaLabel}
          style={{
            ["--color-slider-track" as string]: hasCommonValue
              ? undefined
              : "var(--button-bg)",
          }}
          ref={rangeRef}
          type="range"
          min={min}
          max={max}
          step={step}
          onChange={(event) => {
            latestValueRef.current = +event.target.value;
            onChange(latestValueRef.current);
          }}
          onPointerUp={() => {
            onChangeEnd?.(latestValueRef.current);
          }}
          onPointerCancel={() => {
            onChangeEnd?.(latestValueRef.current);
          }}
          onKeyDown={
            preventCanvasInteraction
              ? (event) => {
                  event.stopPropagation();
                }
              : undefined
          }
          onKeyUp={(event) => {
            if (preventCanvasInteraction) {
              event.stopPropagation();
            }
            onChangeEnd?.(latestValueRef.current);
          }}
          value={value}
          className="range-input"
          data-testid={testId}
        />
        {showValueBubble && (
          <div className="value-bubble" ref={valueRef}>
            {value !== min || showMinValueInBubble ? value : null}
          </div>
        )}
        <div className="zero-label">{minLabel}</div>
        {maxLabel !== undefined && <div className="max-label">{maxLabel}</div>}
      </div>
    </label>
  );
};
