import type { TextRunFlag, TextRunStyle } from "@excalidraw/element";

/**
 * YAZ-3718 D10: B, I, U, S or a text color with only a caret in the editor
 * styles the next typed letters, like a note's stored marks. `false` and
 * `null` turn a style off for them. The style belongs to one caret position:
 * moving the caret drops it.
 */
export type PendingTextStyle = Partial<Record<TextRunFlag, boolean>> & {
  color?: string | null;
};

const pendingStyles = new WeakMap<
  HTMLTextAreaElement,
  { offset: number; style: PendingTextStyle }
>();

/** The pending style at the editor's caret; a style left at another place is dropped. */
export const getPendingTextStyle = (editable: HTMLTextAreaElement) => {
  const pending = pendingStyles.get(editable);
  if (
    pending &&
    (editable.selectionStart !== pending.offset ||
      editable.selectionEnd !== pending.offset)
  ) {
    pendingStyles.delete(editable);
    return undefined;
  }
  return pending?.style;
};

export const setPendingTextStyle = (
  editable: HTMLTextAreaElement,
  style: PendingTextStyle,
) => {
  pendingStyles.set(editable, {
    offset: editable.selectionStart,
    style: { ...getPendingTextStyle(editable), ...style },
  });
};

/** Takes the pending style for the letters just typed at its caret. */
export const takePendingTextStyle = (
  editable: HTMLTextAreaElement,
  insertStart: number,
): TextRunStyle | undefined => {
  const pending = pendingStyles.get(editable);
  pendingStyles.delete(editable);
  if (!pending || pending.offset !== insertStart) {
    return undefined;
  }
  const style: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(pending.style)) {
    // a key with `undefined` turns the inherited style off
    style[field] =
      value === true || typeof value === "string" ? value : undefined;
  }
  return style as TextRunStyle;
};
