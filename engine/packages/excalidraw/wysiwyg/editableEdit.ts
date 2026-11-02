/**
 * YAZ-4071 7M: a change of the text editor's text that the editor makes itself (Tab, Shift-Tab,
 * Enter in a list, a list button, the cleanup of a tab or of the list numbers). The browser's
 * own edit (`execCommand`) is on the text box's undo stack, so ⌘Z takes it back in one step. A
 * script edit (`value`, `setRangeText`) is not, and it puts the stack out of step with the text.
 */

export type EditableEdit = {
  /** The selection after the edit; the input handler puts it back before it reads the text. */
  selectionStart: number;
  selectionEnd: number;
  /** The edit changed the start of each line, and kept their count (YAZ-4071 7C, 7D). */
  eachLine: boolean;
};

const pendingEdits = new WeakMap<HTMLTextAreaElement, EditableEdit>();

/**
 * Puts `nextText` in the editor as one edit: it replaces only the letters between the common
 * start and the common end. Without the focus or `execCommand`, the script edit as before.
 * The input event it makes reads the edit with `takeEditableEdit`.
 */
export const editEditableText = (
  editable: HTMLTextAreaElement,
  nextText: string,
  selectionStart: number,
  selectionEnd: number,
  eachLine = false,
) => {
  const text = editable.value;
  if (text === nextText) {
    editable.setSelectionRange(selectionStart, selectionEnd);
    return;
  }
  let start = 0;
  while (
    start < text.length &&
    start < nextText.length &&
    text[start] === nextText[start]
  ) {
    start++;
  }
  let end = text.length;
  let nextEnd = nextText.length;
  while (
    end > start &&
    nextEnd > start &&
    text[end - 1] === nextText[nextEnd - 1]
  ) {
    end--;
    nextEnd--;
  }
  const inserted = nextText.slice(start, nextEnd);
  pendingEdits.set(editable, { selectionStart, selectionEnd, eachLine });
  editable.setSelectionRange(start, end);
  if (
    document.activeElement !== editable ||
    !document.execCommand?.(inserted ? "insertText" : "delete", false, inserted)
  ) {
    editable.setRangeText(inserted, start, end, "end");
    editable.dispatchEvent(new Event("input"));
  }
  pendingEdits.delete(editable);
  editable.setSelectionRange(selectionStart, selectionEnd);
};

/** The edit that `editEditableText` is making now, for its input event; else undefined. */
export const takeEditableEdit = (editable: HTMLTextAreaElement) => {
  // a plain keystroke: one read
  const edit = pendingEdits.get(editable);
  if (edit) {
    pendingEdits.delete(editable);
  }
  return edit;
};
