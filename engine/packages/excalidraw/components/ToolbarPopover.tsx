import clsx from "clsx";
import { Popover } from "radix-ui";

import { CLASSES } from "@excalidraw/common";

import { useExcalidrawContainer } from "./App";
import { Island } from "./Island";
import { Tooltip } from "./Tooltip";

import type { CSSProperties, PointerEvent, ReactNode } from "react";

/**
 * The text toolbar's one popover (YAZ-3943 demo 2): a toolbar button, and a small card that opens BELOW it,
 * aligned to its start — the size, the text color ▾, the highlight ▾, align and line spacing all use it, so
 * they look the same (`contextual-properties-toolbar__popover`). `open` and `onOpenChange` are for a host that
 * closes it itself (the color ▾'s "Custom…").
 */
export const ToolbarPopover = ({
  label,
  icon,
  children,
  className,
  title,
  style,
  open,
  onOpenChange,
  onTriggerPointerDown,
  tooltip = true,
}: {
  label: string;
  icon: ReactNode;
  children: ReactNode;
  className?: string;
  /** The tooltip; the label when absent. */
  title?: string;
  style?: CSSProperties;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onTriggerPointerDown?: (event: PointerEvent<HTMLButtonElement>) => void;
  /** False: no tooltip, as the ▾ buttons (it would cover the popover); the aria-label stays. */
  tooltip?: boolean;
}) => {
  const { container } = useExcalidrawContainer();
  const trigger = (
    <Popover.Trigger asChild>
      <button
        type="button"
        className={clsx(
          "contextual-properties-toolbar__popover-trigger",
          className,
        )}
        aria-label={label}
        style={style}
        onPointerDown={(event) => {
          onTriggerPointerDown?.(event);
          event.stopPropagation();
        }}
      >
        {icon}
      </button>
    </Popover.Trigger>
  );

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      {tooltip ? <Tooltip label={title ?? label}>{trigger}</Tooltip> : trigger}
      <Popover.Portal container={container}>
        <Popover.Content
          className={clsx(
            CLASSES.SHAPE_ACTIONS_THEME_SCOPE,
            "properties-content",
            "focus-visible-none",
          )}
          data-prevent-outside-click
          side="bottom"
          align="start"
          sideOffset={8}
          collisionBoundary={container ?? undefined}
          onPointerDown={(event) => event.stopPropagation()}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          style={{ zIndex: "var(--zIndex-ui-styles-popup)" }}
        >
          <Island
            className="contextual-properties-toolbar__popover"
            padding={3}
          >
            {children}
          </Island>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};
