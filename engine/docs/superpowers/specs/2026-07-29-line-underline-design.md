# Complete-Line Underline Design

## Goal

Allow a user editing one text element to underline only the complete logical line or lines touched by the current text selection. A title and subtitle can therefore remain in one text box while only the title is underlined.

This feature must preserve the existing whole-element underline behavior and must not introduce a full rich-text editor.

## User Experience

- While editing text, `Cmd+U` on macOS or `Ctrl+U` elsewhere toggles underline for every complete logical line touched by the selection.
- The contextual Underline button performs the same action.
- A collapsed selection toggles the line containing the caret.
- If every targeted line is already underlined, the action removes underline from all targeted lines. Otherwise, it underlines all targeted lines.
- A selection ending exactly at the start of the next line does not include that next line.
- When a text element is selected but is not being edited, the existing whole-element underline behavior remains unchanged.
- Partial line underline appears while editing and after editing is submitted.
- Underline survives save, reload, cloud synchronization, `.excalidraw` import/export, PNG export, and SVG export.

Logical lines are separated by explicit newline characters in `originalText`. If a logical line wraps visually inside a fixed-width text box or bound container, every visual fragment of that logical line is underlined.

## Data Model

Add an optional `lineUnderlines` field to `ExcalidrawTextElement`:

```ts
lineUnderlines?: readonly boolean[];
```

Each array entry corresponds to the same zero-based logical line in `originalText`. Missing entries and `false` entries mean no line underline. Trailing `false` entries are removed before storing the element.

The existing `textDecoration` property continues to represent whole-element underline for backward compatibility.

Rendering considers a line underlined when either:

- `textDecoration === "underline"`, or
- the corresponding `lineUnderlines` entry is `true`.

When a partial underline action is invoked on an element with legacy whole-element underline, the action first materializes underline for all logical lines in `lineUnderlines`, sets `textDecoration` to `"none"`, and then applies the requested line toggle. This allows one line to be removed from an otherwise fully underlined element without changing older diagrams.

Whole-element underline actions outside text-editing mode clear `lineUnderlines` and continue to use `textDecoration`.

Invalid, excess, or non-boolean restored entries are ignored. An empty decoration array is omitted.

## Selection and Editing Rules

A pure selection helper converts `selectionStart` and `selectionEnd` into the inclusive range of logical lines to toggle. It clamps invalid offsets and uses the same newline-boundary rule as the existing bullet-list selection helper.

Text edits update the parallel line-decoration array without adding formatting characters to the text:

- Character edits within a line preserve that line's underline state.
- Inserting a newline inside an underlined line makes both resulting lines underlined.
- Inserting a newline inside a plain line makes both resulting lines plain.
- Deleting a newline merges the two lines. The merged line remains underlined if either source line was underlined.
- Replacing or pasting multiline text inherits the underline state of the logical line containing the start of the replacement. Unaffected lines retain their existing state and shift with the edit.

The edit remapping is implemented as a pure helper using the previous text, next text, previous selection, and previous decoration array. The WYSIWYG editor calls it during text input so model updates and visual feedback remain in sync.

## Rendering

### Canvas and PNG

Extract shared text-line layout logic that maps each logical line in `originalText` to one or more visual lines after wrapping. The canvas renderer draws an underline below every visual fragment belonging to an underlined logical line. It uses the existing text alignment, baseline, font metrics, stroke color, opacity, zoom, and dark-mode behavior.

### SVG

The SVG renderer uses the same logical-to-visual mapping and applies `text-decoration="underline"` only to the generated `<text>` nodes belonging to underlined logical lines. Whole-element underline continues to decorate all nodes.

### WYSIWYG Editor

The existing textarea remains the source of text input, selection, clipboard, IME, and keyboard behavior. A pointer-events-disabled overlay renders underline rules at the same baselines and widths as the textarea's visual lines. This provides immediate partial-underline feedback without replacing the mature textarea editor with `contenteditable`.

The overlay is recreated or repositioned when text, selection formatting, font, line height, alignment, wrapping width, zoom, rotation, or viewport position changes.

## Actions and State

The existing underline action branches by editing state:

- Editing text: read the textarea selection and update `lineUnderlines`.
- Not editing text: retain the existing whole-element `textDecoration` toggle.

The toolbar's active state while editing is based on the targeted logical lines:

- active when every targeted line is underlined;
- inactive when none or only some targeted lines are underlined.

Applying the action updates the element through the normal mutation path so the element version increments and cloud reconciliation sees the change.

No Convex schema or cloud persistence change is required because the complete Excalidraw scene JSON is already stored and synchronized.

## Compatibility

- Existing scenes without `lineUnderlines` render exactly as before.
- Existing scenes using `textDecoration: "underline"` remain fully underlined.
- Existing whole-element keyboard and toolbar behavior outside text-editing mode remains valid. Editing-mode tests change to expect line metadata.
- Older app builds ignore the optional field. They can still read the scene, but they will not display partial line underline until they load a build containing this feature.
- Bullet prefixes are part of their logical line and are underlined with the rest of that line.

## Testing

Add focused tests for:

- selection-to-logical-line range conversion, including exact newline boundaries and collapsed selections;
- toggling one line, multiple lines, mixed states, and toggling off;
- converting legacy whole-element underline into per-line underline;
- character edits, newline insertion, newline deletion, and multiline paste;
- wrapped logical lines inheriting underline on every visual fragment;
- keyboard and contextual-toolbar behavior while editing;
- unchanged whole-element behavior outside editing;
- textarea overlay layout and updates;
- canvas rendering and PNG path;
- SVG output decorating only the intended line nodes;
- restore normalization and `.excalidraw` serialization round trips;
- cloud scene reconciliation retaining the new element field.

## Non-Goals

- Underlining arbitrary words or character ranges.
- Per-range bold, italic, font family, font size, color, or effects.
- Replacing the textarea with a full rich-text `contenteditable` editor.
- Adding visible controls beyond the existing Underline button.
- Changing autosave, snapshot retention, Convex tables, or R2 assets.
