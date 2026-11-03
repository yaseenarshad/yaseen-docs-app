import { useCallback } from "react";

import {
  focusOpenTextEditor,
  pauseOpenTextEditorBlur,
} from "../wysiwyg/hostTextWysiwyg";

/**
 * YAZ-4277 1D: the text box editor keeps its own selection while a picker has
 * the focus, so these give it the focus back and keep no caret of their own.
 */
export type CaretPosition = {
  start: number;
  end: number;
};

/** The editor keeps its selection: nothing to save. */
export const saveCaretPosition = (): CaretPosition | null => null;

/** Gives the open text editor the focus back, after the current event. */
export const restoreCaretPosition = (
  _position?: CaretPosition | null,
): void => {
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

export const useTextEditorFocus = () => {
  const saveCaretPositionToState = useCallback(() => {}, []);
  const restoreCaretPositionFromState = useCallback(
    () => restoreCaretPosition(),
    [],
  );
  return {
    saveCaretPosition: saveCaretPositionToState,
    restoreCaretPosition: restoreCaretPositionFromState,
  };
};

/** A blur of the text editor in the next `duration` ms does not end the edit. */
export const temporarilyDisableTextEditorBlur = (duration: number = 100) =>
  pauseOpenTextEditorBlur(duration);
