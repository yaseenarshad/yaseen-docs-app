import {
  focusOpenTextEditor,
  pauseOpenTextEditorBlur,
} from "../wysiwyg/hostTextWysiwyg";

/**
 * YAZ-4277 1D: the text box editor keeps its own selection while a picker has
 * the focus. This gives it the focus back, after the current event.
 */
export const restoreCaretPosition = (): void => {
  setTimeout(focusOpenTextEditor, 0);
};

/** Runs `callback`, and in compact mode gives the focus back to the text editor. */
export const withCaretPositionPreservation = (
  callback: () => void,
  isCompactMode: boolean,
  isEditingText: boolean,
  onPreventClose?: () => void,
): void => {
  // Prevent popover from closing in compact mode
  if (isCompactMode && onPreventClose) {
    onPreventClose();
  }

  callback();

  if (isCompactMode && isEditingText) {
    restoreCaretPosition();
  }
};

/** A blur of the text editor in the next `duration` ms does not end the edit. */
export const temporarilyDisableTextEditorBlur = (duration: number = 100) =>
  pauseOpenTextEditorBlur(duration);
