# Complete-Line Underline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users underline complete selected lines inside one Excalidraw text element while preserving the existing whole-element underline behavior.

**Architecture:** Store an optional boolean array aligned with the explicit newline-delimited lines in `originalText`. Pure helpers own selection mapping, toggle semantics, edit remapping, normalization, and visual-line mapping. Existing actions branch between line-level behavior during WYSIWYG editing and legacy whole-element behavior outside editing; canvas, SVG, and a textarea overlay consume the same visual-line mapping.

**Tech Stack:** TypeScript, React, Excalidraw element model, HTML textarea overlay, Canvas 2D, SVG, Vitest, Testing Library.

---

## File Structure

- Create `packages/element/src/textLineUnderlines.ts`: pure underline-state, selection, edit-remapping, and visual-line helpers.
- Create `packages/element/tests/textLineUnderlines.test.ts`: focused pure-helper regression coverage.
- Modify `packages/element/src/index.ts`: export the new helper module.
- Modify `packages/element/src/types.ts`: add optional line underline state.
- Modify `packages/element/src/newElement.ts`: initialize and preserve normalized line underline state.
- Modify `packages/excalidraw/data/restore.ts`: normalize imported underline state.
- Modify `packages/excalidraw/tests/data/restore.test.ts`: cover valid and malformed imported state.
- Modify `packages/excalidraw/actions/actionProperties.tsx`: route the existing underline action to selected logical lines during editing.
- Modify `packages/excalidraw/actions/actionProperties.test.tsx`: retain its existing coverage of unchanged whole-element behavior.
- Modify `packages/excalidraw/components/App.tsx`: persist remapped line state while text changes.
- Modify `packages/excalidraw/wysiwyg/textWysiwyg.tsx`: remap state on input, preserve selections, and render the editing overlay.
- Modify `packages/excalidraw/wysiwyg/textWysiwyg.test.tsx`: cover keyboard, input remapping, and overlay feedback.
- Modify `packages/element/src/renderElement.ts`: draw underlines only for decorated visual lines on canvas.
- Modify `packages/excalidraw/renderer/staticSvgScene.ts`: decorate only the intended SVG text nodes.
- Modify `packages/excalidraw/tests/scene/export.test.ts`: cover canvas/PNG and SVG line decoration.
- Modify `packages/excalidraw/tests/data/reconcile.test.ts`: prove a newer synchronized element retains line metadata.

### Task 1: Pure selection, normalization, and toggle behavior

**Files:**

- Create: `packages/element/src/textLineUnderlines.ts`
- Create: `packages/element/tests/textLineUnderlines.test.ts`
- Modify: `packages/element/src/index.ts`

- [ ] **Step 1: Write failing tests for logical-line selection and toggling**

Create `packages/element/tests/textLineUnderlines.test.ts`:

```ts
import {
  getSelectedLogicalLineRange,
  normalizeLineUnderlines,
  toggleSelectedLineUnderlines,
} from "../src/textLineUnderlines";

describe("text line underlines", () => {
  it("targets the caret line and excludes a line touched only by the end boundary", () => {
    expect(getSelectedLogicalLineRange("Title\nSubtitle", 2, 2)).toEqual({
      start: 0,
      end: 0,
    });
    expect(getSelectedLogicalLineRange("Title\nSubtitle", 0, 6)).toEqual({
      start: 0,
      end: 0,
    });
    expect(getSelectedLogicalLineRange("Title\nSubtitle", 0, 9)).toEqual({
      start: 0,
      end: 1,
    });
  });

  it("underlines all selected lines and toggles them off together", () => {
    const enabled = toggleSelectedLineUnderlines({
      text: "Title\nSubtitle\nBody",
      lineUnderlines: undefined,
      selectionStart: 0,
      selectionEnd: 14,
      wholeElementUnderlined: false,
    });
    expect(enabled).toEqual([true, true]);

    expect(
      toggleSelectedLineUnderlines({
        text: "Title\nSubtitle\nBody",
        lineUnderlines: enabled,
        selectionStart: 0,
        selectionEnd: 14,
        wholeElementUnderlined: false,
      }),
    ).toBeUndefined();
  });

  it("materializes legacy whole-element underline before removing one line", () => {
    expect(
      toggleSelectedLineUnderlines({
        text: "Title\nSubtitle",
        lineUnderlines: undefined,
        selectionStart: 0,
        selectionEnd: 5,
        wholeElementUnderlined: true,
      }),
    ).toEqual([false, true]);
  });

  it("normalizes malformed, excess, and trailing false entries", () => {
    expect(normalizeLineUnderlines([true, "yes", false, true], 3)).toEqual([
      true,
    ]);
    expect(normalizeLineUnderlines([false, false], 2)).toBeUndefined();
    expect(normalizeLineUnderlines("invalid", 2)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
yarn test:app packages/element/tests/textLineUnderlines.test.ts --watch=false
```

Expected: FAIL because `../src/textLineUnderlines` does not exist.

- [ ] **Step 3: Implement the minimal pure helpers**

Create `packages/element/src/textLineUnderlines.ts`:

```ts
const getLineCount = (text: string) => text.split("\n").length;

export const getLogicalLineIndexAtOffset = (text: string, offset: number) => {
  const clamped = Math.max(0, Math.min(offset, text.length));
  return text.slice(0, clamped).split("\n").length - 1;
};

export const getSelectedLogicalLineRange = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
) => {
  const start = Math.max(0, Math.min(selectionStart, text.length));
  const end = Math.max(start, Math.min(selectionEnd, text.length));
  const adjustedEnd = end > start && text[end - 1] === "\n" ? end - 1 : end;

  return {
    start: getLogicalLineIndexAtOffset(text, start),
    end: getLogicalLineIndexAtOffset(text, adjustedEnd),
  };
};

export const normalizeLineUnderlines = (
  value: unknown,
  lineCount: number,
): readonly boolean[] | undefined => {
  if (!Array.isArray(value) || lineCount <= 0) {
    return undefined;
  }
  const normalized = value.slice(0, lineCount).map((entry) => entry === true);
  while (normalized.length && !normalized[normalized.length - 1]) {
    normalized.pop();
  }
  return normalized.length ? normalized : undefined;
};

export const areSelectedLinesUnderlined = (args: {
  text: string;
  lineUnderlines: readonly boolean[] | undefined;
  selectionStart: number;
  selectionEnd: number;
  wholeElementUnderlined: boolean;
}) => {
  const range = getSelectedLogicalLineRange(
    args.text,
    args.selectionStart,
    args.selectionEnd,
  );
  return Array.from(
    { length: range.end - range.start + 1 },
    (_, offset) =>
      args.wholeElementUnderlined ||
      args.lineUnderlines?.[range.start + offset] === true,
  ).every(Boolean);
};

export const toggleSelectedLineUnderlines = (args: {
  text: string;
  lineUnderlines: readonly boolean[] | undefined;
  selectionStart: number;
  selectionEnd: number;
  wholeElementUnderlined: boolean;
  enabled?: boolean;
}) => {
  const lineCount = getLineCount(args.text);
  const next = args.wholeElementUnderlined
    ? Array<boolean>(lineCount).fill(true)
    : Array.from(
        { length: lineCount },
        (_, index) => args.lineUnderlines?.[index] === true,
      );
  const range = getSelectedLogicalLineRange(
    args.text,
    args.selectionStart,
    args.selectionEnd,
  );
  const enabled =
    args.enabled ??
    !areSelectedLinesUnderlined({
      ...args,
      lineUnderlines: next,
      wholeElementUnderlined: false,
    });

  for (let index = range.start; index <= range.end; index++) {
    next[index] = enabled;
  }
  return normalizeLineUnderlines(next, lineCount);
};
```

Export it from `packages/element/src/index.ts`:

```ts
export * from "./textLineUnderlines";
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
yarn test:app packages/element/tests/textLineUnderlines.test.ts --watch=false
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit the pure toggle behavior**

```bash
git add packages/element/src/textLineUnderlines.ts packages/element/src/index.ts packages/element/tests/textLineUnderlines.test.ts
git commit -m "Add logical line underline helpers"
```

### Task 2: Preserve line underline state through text edits

**Files:**

- Modify: `packages/element/src/textLineUnderlines.ts`
- Modify: `packages/element/tests/textLineUnderlines.test.ts`

- [ ] **Step 1: Add failing edit-remapping tests**

Extend the Task 1 import to include `remapLineUnderlinesForTextEdit`, then append:

```ts
describe("remapLineUnderlinesForTextEdit", () => {
  it("preserves decoration for character edits", () => {
    expect(
      remapLineUnderlinesForTextEdit("Title\nSubtitle", "New Title\nSubtitle", [
        true,
      ]),
    ).toEqual([true]);
  });

  it("inherits decoration when an underlined line is split", () => {
    expect(remapLineUnderlinesForTextEdit("Title", "Ti\ntle", [true])).toEqual([
      true,
      true,
    ]);
  });

  it("keeps a merged line underlined when either source line was underlined", () => {
    expect(
      remapLineUnderlinesForTextEdit("Title\nSubtitle", "TitleSubtitle", [
        false,
        true,
      ]),
    ).toEqual([true]);
  });

  it("shifts unaffected lines after multiline insertion", () => {
    expect(
      remapLineUnderlinesForTextEdit("Title\nBody", "Intro\nTitle\nBody", [
        true,
        false,
      ]),
    ).toEqual([true, true]);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
yarn test:app packages/element/tests/textLineUnderlines.test.ts --watch=false
```

Expected: FAIL because `remapLineUnderlinesForTextEdit` is not exported.

- [ ] **Step 3: Implement deterministic edit remapping**

Append to `packages/element/src/textLineUnderlines.ts`:

```ts
const getEditWindow = (previousText: string, nextText: string) => {
  let start = 0;
  while (
    start < previousText.length &&
    start < nextText.length &&
    previousText[start] === nextText[start]
  ) {
    start++;
  }

  let previousEnd = previousText.length;
  let nextEnd = nextText.length;
  while (
    previousEnd > start &&
    nextEnd > start &&
    previousText[previousEnd - 1] === nextText[nextEnd - 1]
  ) {
    previousEnd--;
    nextEnd--;
  }
  return { start, previousEnd, nextEnd };
};

export const remapLineUnderlinesForTextEdit = (
  previousText: string,
  nextText: string,
  lineUnderlines: readonly boolean[] | undefined,
) => {
  if (!lineUnderlines?.some(Boolean) || previousText === nextText) {
    return normalizeLineUnderlines(lineUnderlines, nextText.split("\n").length);
  }

  const edit = getEditWindow(previousText, nextText);
  const previousStartLine = getLogicalLineIndexAtOffset(
    previousText,
    edit.start,
  );
  const previousEndLine = getLogicalLineIndexAtOffset(
    previousText,
    edit.previousEnd,
  );
  const nextStartLine = getLogicalLineIndexAtOffset(nextText, edit.start);
  const nextEndLine = getLogicalLineIndexAtOffset(nextText, edit.nextEnd);
  const previousAffected = Array.from(
    { length: previousEndLine - previousStartLine + 1 },
    (_, offset) => lineUnderlines[previousStartLine + offset] === true,
  );
  const nextAffectedCount = nextEndLine - nextStartLine + 1;
  const inherited =
    nextAffectedCount < previousAffected.length
      ? previousAffected.some(Boolean)
      : previousAffected[0] === true;
  const next = [
    ...lineUnderlines.slice(0, previousStartLine),
    ...Array<boolean>(nextAffectedCount).fill(inherited),
    ...lineUnderlines.slice(previousEndLine + 1),
  ];

  return normalizeLineUnderlines(next, nextText.split("\n").length);
};
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
yarn test:app packages/element/tests/textLineUnderlines.test.ts --watch=false
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit edit remapping**

```bash
git add packages/element/src/textLineUnderlines.ts packages/element/tests/textLineUnderlines.test.ts
git commit -m "Preserve line underlines through text edits"
```

### Task 3: Add the optional field to creation and restore paths

**Files:**

- Modify: `packages/element/src/types.ts`
- Modify: `packages/element/src/newElement.ts`
- Modify: `packages/excalidraw/data/restore.ts`
- Modify: `packages/excalidraw/tests/data/restore.test.ts`
- Modify: `packages/excalidraw/tests/data/reconcile.test.ts`

- [ ] **Step 1: Add failing restore normalization coverage**

In `packages/excalidraw/tests/data/restore.test.ts`, add a test using the existing `restoreElements()` test helpers:

```ts
it("normalizes imported text line underlines", () => {
  const [restored] = restoreElements(
    [
      {
        ...API.createElement({
          type: "text",
          text: "Title\nSubtitle",
        }),
        lineUnderlines: [true, "invalid", true],
      } as any,
    ],
    null,
  );

  expect(restored).toMatchObject({
    type: "text",
    lineUnderlines: [true],
  });
});

it("round-trips text line underlines through scene JSON", () => {
  const element = {
    ...API.createElement({
      type: "text",
      text: "Title\nSubtitle",
    }),
    lineUnderlines: [true],
  };
  const serialized = serializeAsJSON(
    [element],
    getDefaultAppState(),
    {},
    "local",
  );
  const parsed = JSON.parse(serialized);
  const [restored] = restore.restoreElements(parsed.elements, null);

  expect(restored).toMatchObject({ lineUnderlines: [true] });
});
```

Import `serializeAsJSON` from `../../data/json`. Reuse the existing `getDefaultAppState` import and call `restore.restoreElements` if the test file keeps the current namespace import.

- [ ] **Step 2: Run the restore test and verify RED**

Run:

```bash
yarn test:app packages/excalidraw/tests/data/restore.test.ts --watch=false
```

Expected: FAIL because malformed entries are currently retained.

- [ ] **Step 3: Add the field and normalization**

Add to `ExcalidrawTextElement` in `packages/element/src/types.ts`:

```ts
lineUnderlines?: readonly boolean[];
```

Add to the `newTextElement()` options in `packages/element/src/newElement.ts`:

```ts
lineUnderlines?: ExcalidrawTextElement["lineUnderlines"];
```

Add to `textElementProps`:

```ts
lineUnderlines: normalizeLineUnderlines(
  opts.lineUnderlines,
  (opts.originalText ?? text).split("\n").length,
),
```

Import `normalizeLineUnderlines` from `./textLineUnderlines`.

In the text case of `restoreElement()` in `packages/excalidraw/data/restore.ts`, derive `originalText` once and include:

```ts
const originalText = element.originalText || text;

element = restoreElementWithProperties(element, {
  fontSize,
  fontFamily,
  text,
  textAlign: element.textAlign || DEFAULT_TEXT_ALIGN,
  verticalAlign: element.verticalAlign || DEFAULT_VERTICAL_ALIGN,
  containerId: element.containerId ?? null,
  originalText,
  autoResize: element.autoResize ?? true,
  lineHeight,
  lineUnderlines: normalizeLineUnderlines(
    (element as { lineUnderlines?: unknown }).lineUnderlines,
    originalText.split("\n").length,
  ),
});
```

Import `normalizeLineUnderlines` from `@excalidraw/element`.

- [ ] **Step 4: Run restore and pure tests**

Run:

```bash
yarn test:app packages/excalidraw/tests/data/restore.test.ts packages/element/tests/textLineUnderlines.test.ts --watch=false
```

Expected: both files pass.

- [ ] **Step 5: Add and run a cloud reconciliation regression test**

In `packages/excalidraw/tests/data/reconcile.test.ts`, import `API` from `../helpers/api` and add:

```ts
it("keeps line underline metadata from the newer remote text element", () => {
  const [local] = syncInvalidIndices([
    {
      ...API.createElement({
        type: "text",
        id: "styledText",
        text: "Title\nSubtitle",
      }),
      version: 1,
      versionNonce: randomInteger(),
    },
  ]);
  const [remote] = syncInvalidIndices([
    {
      ...local,
      version: 2,
      versionNonce: randomInteger(),
      lineUnderlines: [true],
    },
  ]);

  const [reconciled] = reconcileElements(
    [local],
    [remote as RemoteExcalidrawElement],
    {} as AppState,
  );

  expect(reconciled).toMatchObject({
    id: "styledText",
    version: 2,
    lineUnderlines: [true],
  });
});
```

Run:

```bash
yarn test:app packages/excalidraw/tests/data/reconcile.test.ts --watch=false
```

Expected: PASS once the field is part of the element type and the newer remote element wins reconciliation.

- [ ] **Step 6: Run TypeScript before committing**

Run:

```bash
yarn test:typecheck
```

Expected: exit 0.

- [ ] **Step 7: Commit the persisted data model**

```bash
git add packages/element/src/types.ts packages/element/src/newElement.ts packages/excalidraw/data/restore.ts packages/excalidraw/tests/data/restore.test.ts packages/excalidraw/tests/data/reconcile.test.ts
git commit -m "Persist line underline metadata"
```

### Task 4: Make the existing underline action selection-aware

**Files:**

- Modify: `packages/excalidraw/actions/actionProperties.tsx`
- Modify: `packages/excalidraw/wysiwyg/textWysiwyg.test.tsx`

- [ ] **Step 1: Add failing toolbar behavior tests**

Add beside the existing editing-mode bold/underline shortcut test in `textWysiwyg.test.tsx`:

```ts
it("toggles underline for only the logical lines selected in the editor", () => {
  fireEvent.input(textarea, {
    target: { value: "Title\nSubtitle" },
  });
  textarea.setSelectionRange(0, 5);

  act(() => {
    h.app.actionManager.executeAction(actionChangeTextStyle, "ui", {
      property: "textDecoration",
      enabled: true,
    });
  });

  expect(h.elements[0]).toMatchObject({
    textDecoration: "none",
    lineUnderlines: [true],
  });
  expect(textarea.selectionStart).toBe(0);
  expect(textarea.selectionEnd).toBe(5);
});
```

- [ ] **Step 2: Run the action test and verify RED**

Run:

```bash
yarn test:app packages/excalidraw/wysiwyg/textWysiwyg.test.tsx --watch=false
```

Expected: the editing test fails because underline still changes the entire element.

- [ ] **Step 3: Branch underline state and mutation by editing mode**

In `getTextStyle()`, when `property === "textDecoration"` and the matching text element is currently being edited, query `.excalidraw-wysiwyg` and return:

```ts
return editable
  ? areSelectedLinesUnderlined({
      text: editable.value,
      lineUnderlines: textElement.lineUnderlines,
      selectionStart: editable.selectionStart,
      selectionEnd: editable.selectionEnd,
      wholeElementUnderlined: textElement.textDecoration === "underline",
    })
  : textElement.textDecoration === "underline";
```

In `changeTextStyle()`, resolve the textarea for underline as well as bullets. For the editing text element and `textDecoration`, return:

```ts
const lineUnderlines = toggleSelectedLineUnderlines({
  text: editable.value,
  lineUnderlines: element.lineUnderlines,
  selectionStart: editable.selectionStart,
  selectionEnd: editable.selectionEnd,
  wholeElementUnderlined: element.textDecoration === "underline",
  enabled: value.enabled,
});

return newElementWith(element, {
  textDecoration: "none",
  lineUnderlines,
});
```

For non-editing whole-element toggles, preserve the existing assignment and also set:

```ts
lineUnderlines: undefined,
```

Import `areSelectedLinesUnderlined` and `toggleSelectedLineUnderlines` from `@excalidraw/element`.

Keep `withCaretPositionPreservation()` around toolbar updates so clicking the control does not collapse the selection.

- [ ] **Step 4: Run action and existing WYSIWYG shortcut tests**

Run:

```bash
yarn test:app packages/excalidraw/actions/actionProperties.test.tsx packages/excalidraw/wysiwyg/textWysiwyg.test.tsx --watch=false
```

Expected: both files pass. Update the existing editing-mode shortcut assertion to expect `lineUnderlines: [true]` and `textDecoration: "none"`; keep the existing outside-editing whole-element assertion unchanged.

- [ ] **Step 5: Commit selection-aware actions**

```bash
git add packages/excalidraw/actions/actionProperties.tsx packages/excalidraw/wysiwyg/textWysiwyg.test.tsx
git commit -m "Toggle underline on selected text lines"
```

### Task 5: Remap state during WYSIWYG input and show immediate feedback

**Files:**

- Modify: `packages/excalidraw/components/App.tsx`
- Modify: `packages/excalidraw/wysiwyg/textWysiwyg.tsx`
- Modify: `packages/excalidraw/wysiwyg/textWysiwyg.test.tsx`

- [ ] **Step 1: Add failing keyboard, input-remap, and overlay tests**

Add to `packages/excalidraw/wysiwyg/textWysiwyg.test.tsx`:

```ts
it("toggles only the selected line with the underline shortcut", async () => {
  fireEvent.input(textarea, {
    target: { value: "Title\nSubtitle" },
  });
  textarea.setSelectionRange(0, 5);

  fireEvent.keyDown(textarea, {
    [KEYS.CTRL_OR_CMD]: true,
    key: "u",
    code: CODES.U,
  });

  expect((h.elements[0] as ExcalidrawTextElement).lineUnderlines).toEqual([
    true,
  ]);
  expect(
    document.querySelectorAll(".excalidraw-wysiwyg-line-underline"),
  ).toHaveLength(1);
});

it("shifts line underline state when a newline is inserted above it", async () => {
  fireEvent.input(textarea, {
    target: { value: "Title\nBody" },
  });
  textarea.setSelectionRange(0, 5);
  fireEvent.keyDown(textarea, {
    [KEYS.CTRL_OR_CMD]: true,
    key: "u",
    code: CODES.U,
  });

  fireEvent.input(textarea, {
    target: { value: "Intro\nTitle\nBody" },
  });

  expect((h.elements[0] as ExcalidrawTextElement).lineUnderlines).toEqual([
    true,
    true,
  ]);
});
```

- [ ] **Step 2: Run the WYSIWYG test and verify RED**

Run:

```bash
yarn test:app packages/excalidraw/wysiwyg/textWysiwyg.test.tsx --watch=false
```

Expected: FAIL because input does not remap metadata and no overlay exists.

- [ ] **Step 3: Pass line metadata through the WYSIWYG change callback**

Change the `textWysiwyg()` option type:

```ts
onChange?: (
  nextOriginalText: string,
  nextLineUnderlines: readonly boolean[] | undefined,
) => void;
onSubmit: (data: {
  viaKeyboard: boolean;
  nextOriginalText: string;
  nextLineUnderlines: readonly boolean[] | undefined;
}) => void;
```

After assigning `editable.value`, initialize:

```ts
let previousEditableValue = editable.value;
```

In `editable.oninput`, before calling `onChange`, read the current element and calculate:

```ts
const currentElement = app.scene.getElement(
  element.id,
) as ExcalidrawTextElement | null;
const nextLineUnderlines = remapLineUnderlinesForTextEdit(
  previousEditableValue,
  editable.value,
  currentElement?.lineUnderlines,
);
previousEditableValue = editable.value;
onChange(editable.value, nextLineUnderlines);
```

Import `remapLineUnderlinesForTextEdit` from `@excalidraw/element`.

In `App.handleTextWysiwyg()`, change `updateElement()` to accept `nextLineUnderlines` and include it in `newElementWith()`:

```ts
const updateElement = (
  nextOriginalText: string,
  isDeleted: boolean,
  nextLineUnderlines?: readonly boolean[],
) => {
  this.scene.replaceAllElements([
    ...this.scene.getElementsIncludingDeleted().map((_element) => {
      if (_element.id === element.id && isTextElement(_element)) {
        return newElementWith(_element, {
          originalText: nextOriginalText,
          lineUnderlines: nextLineUnderlines,
          isDeleted: isDeleted ?? _element.isDeleted,
          ...refreshTextDimensions(
            _element,
            getContainerElement(_element, elementsMap),
            elementsMap,
            nextOriginalText,
          ),
        });
      }
      return _element;
    }),
  ]);
};
```

The `onChange` callback passes both values. Initial and submit calls pass the current element's `lineUnderlines` so submitting text does not erase metadata. In `handleSubmit()`, read the latest element and include its `lineUnderlines` in the `onSubmit()` payload; destructure and forward that field in `App.handleTextWysiwyg()`.

- [ ] **Step 4: Add and update the textarea underline overlay**

In `textWysiwyg.tsx`, create:

```ts
const underlineOverlay = document.createElement("div");
underlineOverlay.className = "excalidraw-wysiwyg-underlines";
Object.assign(underlineOverlay.style, {
  position: "absolute",
  pointerEvents: "none",
  background: "transparent",
  overflow: "hidden",
  zIndex: "var(--zIndex-wysiwyg)",
});
```

Extend `currentTextLayout` with `verticalOffset` and `maxWidth`. In `updateWysiwygStyle()`, mirror the textarea's `left`, `top`, `width`, `height`, and `transform` onto the overlay, clear its children, and obtain visual lines:

```ts
const visualLines = getWrappedTextLines(
  editable.value,
  font,
  whiteSpace === "pre-wrap" ? width : Infinity,
);
const currentElement = app.scene.getElement(
  element.id,
) as ExcalidrawTextElement | null;
if (!currentElement) {
  return;
}

for (const [index, line] of visualLines.entries()) {
  const logicalLine = getLogicalLineIndexAtOffset(editable.value, line.start);
  const underlined =
    currentElement?.textDecoration === "underline" ||
    currentElement?.lineUnderlines?.[logicalLine] === true;
  if (!underlined || !line.text) {
    continue;
  }
  const widthPx = getLineWidth(line.text, font);
  const left =
    textAlign === "center"
      ? (width - widthPx) / 2
      : textAlign === "right"
      ? width - widthPx
      : 0;
  const rule = document.createElement("span");
  rule.className = "excalidraw-wysiwyg-line-underline";
  Object.assign(rule.style, {
    position: "absolute",
    left: `${left}px`,
    top: `${
      index * lineHeightPx +
      verticalOffset +
      Math.max(1, currentElement.fontSize * 0.08)
    }px`,
    width: `${widthPx}px`,
    height: `${Math.max(1, currentElement.fontSize / 16)}px`,
    background: editable.style.color,
  });
  underlineOverlay.appendChild(rule);
}
```

Append the overlay before the textarea:

```ts
const editorContainer = excalidrawContainer?.querySelector(
  ".excalidraw-textEditorContainer",
);
editorContainer?.appendChild(underlineOverlay);
editorContainer?.appendChild(editable);
```

Remove it in `cleanup()`:

```ts
underlineOverlay.remove();
```

Because scene updates already call `updateWysiwygStyle()`, keyboard and toolbar actions refresh the overlay immediately.

- [ ] **Step 5: Run WYSIWYG and action tests**

Run:

```bash
yarn test:app packages/excalidraw/wysiwyg/textWysiwyg.test.tsx packages/excalidraw/actions/actionProperties.test.tsx --watch=false
```

Expected: both files pass.

- [ ] **Step 6: Commit editor persistence and feedback**

```bash
git add packages/excalidraw/components/App.tsx packages/excalidraw/wysiwyg/textWysiwyg.tsx packages/excalidraw/wysiwyg/textWysiwyg.test.tsx
git commit -m "Show line underlines while editing text"
```

### Task 6: Render and export decorated logical lines

**Files:**

- Modify: `packages/element/src/textLineUnderlines.ts`
- Modify: `packages/element/tests/textLineUnderlines.test.ts`
- Modify: `packages/element/src/renderElement.ts`
- Modify: `packages/excalidraw/renderer/staticSvgScene.ts`
- Modify: `packages/excalidraw/tests/scene/export.test.ts`

- [ ] **Step 1: Add failing wrapped-line mapping tests**

Add:

```ts
import { getUnderlinedVisualLines } from "../src/textLineUnderlines";

it("marks every wrapped fragment of an underlined logical line", () => {
  const lines = getUnderlinedVisualLines({
    originalText: "A long title that wraps\nSubtitle",
    font: "20px Assistant",
    maxWidth: 90,
    lineUnderlines: [true],
    wholeElementUnderlined: false,
  });

  expect(lines.length).toBeGreaterThan(2);
  const titleLines = lines.filter((line) => line.logicalLine === 0);
  expect(titleLines.length).toBeGreaterThan(1);
  expect(titleLines.every((line) => line.underlined)).toBe(true);
  expect(
    lines
      .filter((line) => line.logicalLine === 1)
      .every((line) => !line.underlined),
  ).toBe(true);
});
```

- [ ] **Step 2: Run the pure test and verify RED**

Run:

```bash
yarn test:app packages/element/tests/textLineUnderlines.test.ts --watch=false
```

Expected: FAIL because `getUnderlinedVisualLines` does not exist.

- [ ] **Step 3: Add the shared visual-line helper**

In `textLineUnderlines.ts`, import `getWrappedTextLines` from `./textWrapping` and `FontString` from `./types`, then add:

```ts
export const getUnderlinedVisualLines = (args: {
  originalText: string;
  font: FontString;
  maxWidth: number;
  lineUnderlines: readonly boolean[] | undefined;
  wholeElementUnderlined: boolean;
}) =>
  getWrappedTextLines(args.originalText, args.font, args.maxWidth).map(
    (line) => {
      const logicalLine = getLogicalLineIndexAtOffset(
        args.originalText,
        line.start,
      );
      return {
        ...line,
        logicalLine,
        underlined:
          args.wholeElementUnderlined ||
          args.lineUnderlines?.[logicalLine] === true,
      };
    },
  );
```

- [ ] **Step 4: Use the shared mapping in canvas rendering**

In the text branch of `packages/element/src/renderElement.ts`, compute the wrapping width with the same rule used by text refresh:

```ts
const container = getContainerElement(element, elementsMap);
const maxWidth = container
  ? getBoundTextMaxWidth(container, element)
  : element.autoResize
  ? Infinity
  : element.width;
const lines = getUnderlinedVisualLines({
  originalText: element.originalText,
  font: getFontString(element),
  maxWidth,
  lineUnderlines: element.lineUnderlines,
  wholeElementUnderlined: element.textDecoration === "underline",
});
```

Render `lines[index].text` instead of the previous string split. Replace the whole-element decoration condition with `lines[index].underlined`.

- [ ] **Step 5: Use the mapping in SVG rendering and add failing export tests**

In `packages/excalidraw/tests/scene/export.test.ts`, create:

```ts
const lineStyledText = {
  ...API.createElement({
    type: "text",
    text: "Title\nSubtitle",
    width: 100,
    height: 50,
  }),
  lineUnderlines: [true],
};
```

Add an SVG test and assert:

```ts
const textNodes = Array.from(svg.querySelectorAll("text"));
expect(textNodes).toHaveLength(2);
expect(textNodes[0].getAttribute("text-decoration")).toBe("underline");
expect(textNodes[1].hasAttribute("text-decoration")).toBe(false);
```

Add a canvas/PNG-path test:

```ts
const canvas = await exportToCanvas({
  elements: [lineStyledText],
  files: null,
  appState: { exportBackground: false },
});
const events = (canvas.getContext("2d") as any).__getEvents();
const underlineRules = events.filter(
  (event: any) =>
    event.type === "fillRect" &&
    event.props.width > 0 &&
    event.props.height > 0,
);
expect(underlineRules).toHaveLength(1);
```

Run:

```bash
yarn test:app packages/excalidraw/tests/scene/export.test.ts --watch=false
```

Expected: FAIL because canvas and SVG still ignore line metadata.

Update `staticSvgScene.ts` to build the same `lines` collection, set `text.textContent = lines[i].text`, and set the attribute only when:

```ts
if (lines[i].underlined) {
  text.setAttribute("text-decoration", "underline");
}
```

- [ ] **Step 6: Run pure and export tests**

Run:

```bash
yarn test:app packages/element/tests/textLineUnderlines.test.ts packages/excalidraw/tests/scene/export.test.ts --watch=false
```

Expected: both files pass.

- [ ] **Step 7: Commit rendering and export**

```bash
git add packages/element/src/textLineUnderlines.ts packages/element/tests/textLineUnderlines.test.ts packages/element/src/renderElement.ts packages/excalidraw/renderer/staticSvgScene.ts packages/excalidraw/tests/scene/export.test.ts
git commit -m "Render underlines on decorated text lines"
```

### Task 7: Full verification, production deployment, and cleanup

**Files:**

- Verify all modified files from Tasks 1–6.

- [ ] **Step 1: Run focused regression tests**

```bash
yarn test:app packages/element/tests/textLineUnderlines.test.ts packages/excalidraw/tests/data/restore.test.ts packages/excalidraw/tests/data/reconcile.test.ts packages/excalidraw/actions/actionProperties.test.tsx packages/excalidraw/wysiwyg/textWysiwyg.test.tsx packages/excalidraw/tests/scene/export.test.ts --watch=false
```

Expected: all selected test files pass with zero failures.

- [ ] **Step 2: Run static validation**

```bash
yarn test:typecheck
yarn eslint --max-warnings=0 \
  packages/element/src/textLineUnderlines.ts \
  packages/element/src/types.ts \
  packages/element/src/newElement.ts \
  packages/element/src/renderElement.ts \
  packages/excalidraw/data/restore.ts \
  packages/excalidraw/actions/actionProperties.tsx \
  packages/excalidraw/components/App.tsx \
  packages/excalidraw/wysiwyg/textWysiwyg.tsx \
  packages/excalidraw/renderer/staticSvgScene.ts
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 3: Build the production app**

```bash
yarn build
```

Expected: Vite completes with exit 0. Existing bundle-size and third-party module-directive warnings are acceptable; new errors are not.

- [ ] **Step 4: Run a local browser acceptance check**

At a non-100% zoom:

1. Create one text box containing `TITLE`, `Subtitle`, and `Body`.
2. Select only part of `TITLE` and press `Cmd+U`.
3. Confirm the complete title line, and no other line, is underlined.
4. Select across `Subtitle` and `Body`; click the toolbar Underline control.
5. Confirm both complete lines are underlined and the text selection remains.
6. Insert a newline above `TITLE`; confirm existing line decorations remap.
7. Save/reload and export SVG; confirm decorations persist.
8. Confirm the canvas does not jump after cloud autosave.

- [ ] **Step 5: Push and deploy**

```bash
git push origin main
npx --yes wrangler deploy
```

Expected: `origin/main` advances to the verified commit and Wrangler reports a new production version for `draw.yasinarshad.com`.

- [ ] **Step 6: Verify the deployed bundle**

Open a temporary production diagram, repeat the `TITLE`/`Subtitle` selection test, wait for the save state to return to `Saved`, reload, and confirm the underline remains. Delete the temporary diagram afterward.
