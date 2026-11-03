import { remapTextRunsForTextEdit } from "@excalidraw/element";

import type { HostTextEditor } from "../../types";

/**
 * YAZ-4277 1D: the text editor of the engine's tests. The app's text box
 * editor is the notes engine, which the engine's tests cannot load; this one
 * is a plain `<textarea>` in the engine's root that reports its text, its
 * caret and its runs (moved with the text, as a text field moves them)
 * through the `textEditor` seam. `test-utils` `render()` gives it to every
 * `<Excalidraw>` that has no `textEditor`.
 */
export const testTextEditor: HostTextEditor = {
  mount: ({ root, text, textRuns, selection, onChange, onSelectionChange }) => {
    const editable = document.createElement("textarea");
    editable.value = text;
    root.appendChild(editable);
    let value = text;
    let runs = textRuns;
    const put = (anchor: number, head: number) =>
      editable.setSelectionRange(
        Math.min(anchor, head),
        Math.max(anchor, head),
        head < anchor ? "backward" : "forward",
      );
    put(selection.anchor, selection.head);
    let last = { anchor: selection.anchor, head: selection.head };
    const reportSelection = () => {
      const next = selectionNow();
      if (next.anchor !== last.anchor || next.head !== last.head) {
        last = next;
        onSelectionChange(next);
      }
    };
    const selectionNow = () => {
      const backward = editable.selectionDirection === "backward";
      return {
        anchor: backward ? editable.selectionEnd : editable.selectionStart,
        head: backward ? editable.selectionStart : editable.selectionEnd,
      };
    };
    const onEdit = () => {
      if (editable.value === value) {
        reportSelection();
        return;
      }
      runs = remapTextRunsForTextEdit(value, editable.value, runs, {
        caret: editable.selectionEnd,
      });
      value = editable.value;
      last = selectionNow();
      onChange(value, runs, last);
    };
    // a test sets the value with `change` alone, or with `change` and `input`
    editable.addEventListener("input", onEdit);
    editable.addEventListener("change", onEdit);
    editable.addEventListener("select", reportSelection);
    editable.addEventListener("keyup", reportSelection);
    const onDocumentSelection = () => {
      if (editable.isConnected) {
        reportSelection();
      }
    };
    document.addEventListener("selectionchange", onDocumentSelection);
    return {
      setSelection: ({ anchor, head }) => {
        put(anchor, head);
        reportSelection();
      },
      replaceText: (start, end, next) => {
        editable.setRangeText(next, start, end, "end");
        editable.dispatchEvent(new Event("input"));
      },
      // the tests' editor has no letter styles of its own: it takes off every run
      // over the selection, as the box editor takes off its marks
      clearLetterStyles: () => {
        const start = Math.min(last.anchor, last.head);
        const end = Math.max(last.anchor, last.head);
        const next = runs?.flatMap((run) =>
          run.end <= start || run.start >= end
            ? [run]
            : [
                ...(run.start < start ? [{ ...run, end: start }] : []),
                ...(run.end > end ? [{ ...run, start: end }] : []),
              ],
        );
        runs = next?.length ? next : undefined;
        onChange(value, runs, last);
      },
      focus: () => editable.focus(),
      destroy: () =>
        document.removeEventListener("selectionchange", onDocumentSelection),
    };
  },
};
