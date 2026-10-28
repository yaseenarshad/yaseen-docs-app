import React from "react";
import clsx from "clsx";

import "./Island.scss";

import type { ViewportUIDock, ViewportUIName } from "../types";

type IslandProps = {
  children: React.ReactNode;
  padding?: number;
  className?: string | boolean;
  style?: object;
  /** marks the island as a canvas-occluding UI surface measured by
   * `getViewportOffsets` (see {@link ViewportUIDock}) */
  "data-viewport-ui"?: ViewportUIDock;
  /** identifies the surface so `getViewportOffsets` can reserve space for
   * it while hidden (see {@link ViewportUIName}) */
  "data-viewport-ui-name"?: ViewportUIName;
  role?: React.AriaRole;
  "aria-label"?: string;
};

export const Island = React.forwardRef<HTMLDivElement, IslandProps>(
  (
    {
      children,
      padding,
      className,
      style,
      "data-viewport-ui": viewportUI,
      "data-viewport-ui-name": viewportUIName,
      role,
      "aria-label": ariaLabel,
    },
    ref,
  ) => (
    <div
      className={clsx("Island", className)}
      style={{ "--padding": padding, ...style }}
      data-viewport-ui={viewportUI}
      data-viewport-ui-name={viewportUIName}
      role={role}
      aria-label={ariaLabel}
      ref={ref}
    >
      {children}
    </div>
  ),
);
