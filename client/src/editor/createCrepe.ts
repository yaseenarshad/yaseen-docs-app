/**
 * Locked Crepe construction for this app (GRO-1961).
 *
 * Decisions baked in here (see docs/CONTRACTS.md "Editor rules"):
 *  - Feature set comes from `featureConfig.ts` ONLY (GRO-2014 allowlist + guard test);
 *    ImageBlock is OFF there: its serializer overwrites image alt text with the
 *    ratio ("![1.00](src)"). Plain commonmark image keeps alt/title intact.
 *  - list_item schema widened from `paragraph block*` to `block+` so that
 *    Logseq/Obsidian-style outlines (`* # Heading` / `* - nested`) do not get
 *    an empty `<br />` paragraph injected on round-trip.
 *  - Markdown out goes through `postProcessMarkdown()`: ONE walk over the lines outside fenced
 *    code (`mapOutsideFences`, `listItemRoundTrip.ts`). On each of them it un-escapes
 *    `\[\[wikilink]]` / `!\[\[embed]]` that remark-stringify escapes, and the `\=` the
 *    highlight mark's escape rule (rule 31) would put inside a `[[target]]` — never inside a code
 *    span on that line — and then restores the item line (`restoreItemLine`).
 *    🔒 EVERY text rule, on load (`normalizeEmptyItems`) and on save, goes through that one walk,
 *    so the text of code keeps its bytes. A new text rule must use it too.
 *  - Outline folding plugin (GRO-2011) registered via `$prose`; fold toggles are
 *    metadata-only transactions and never reach `markdownUpdated` / autosave.
 *  - Outliner keymap (GRO-2012, `outline/listCommands.ts`) patches the gaps in Crepe's
 *    Tab / Enter / Backspace list handling; registered with a higher keymap priority.
 *  - Empty list items round-trip as bare markers, never `* <br />` (GRO-2012,
 *    `listItemRoundTrip.ts`): `<br />` opened an HTML block that swallowed nested children.
 *    Empty task items are `* [ ]` on disk and `* [ ] <br />` inside Milkdown (GRO-2018).
 *  - Obsidian hotkeys (GRO-2027, `outline/hotkeys.ts` + `outline/foldAllHotkeys.ts`): Mod-Enter
 *    task cycle, Mod-Shift-u/i fold/unfold all bullets + headings, Mod-Shift-x strikethrough.
 *  - The keys are the defaults of `shared/keys/note.ts` with the user's changes (YAZ-3564 K4,
 *    `noteKeys.ts`): read once in a config, before create, so an open note keeps its keys.
 *  - Underline mark (GRO-2028, `marks/underline.ts`): Mod-u ↔ `<u>text</u>` inline HTML.
 *  - Highlight mark (YAZ-1480, `marks/highlight.ts`): ONE mark with an optional `color`. Yellow
 *    (Mod-Shift-h / typing `==x==` / the first toolbar swatch) is Obsidian's `==text==` on disk —
 *    a vendored micromark tokenizer (gfm-strikethrough's attention run, `=` and exactly two) plus
 *    its stringify escape. The named colours are click-only and store inline HTML
 *    `<mark class="highlight-<name>">`, read back through the shared `marks/htmlPairs.ts` walk; a
 *    custom colour stores `<mark style="background-color: #rrggbb">` (YAZ-4348 demo round 2).
 *    Three toolbar buttons after Strikethrough (yellow, green, blue), each a bold "A" on its colour;
 *    one click applies, re-clicking the lit one removes. Their ▾ opens the board-style colour panel:
 *    most used custom colours, every colour and None, shades, a hex code (`highlightPanel.ts`).
 *  - Inline breaks (YAZ-1452, `inlineBreaks.ts`): inline `<br>` ↔ hardbreak, registered BEFORE
 *    Milkdown's `remarkPreserveEmptyLinePlugin` (which otherwise deletes it); table cells save
 *    a hardbreak back as `<br>`, and Shift-Enter inside a cell always inserts one. A `<br>` at a
 *    line end, or on a line of its own, is ONE break with the line ending beside it.
 *  - Marks on line breaks (YAZ-2280, `breakMarks.ts`): replaces Milkdown's `hardbreakClearMarkPlugin`;
 *    a mark runs through a soft break, never starts or ends on one, and never sits on a hard break.
 *  - Text that ends in whitespace (YAZ-3727 B5, `textStringify.ts`): replaces Milkdown's `text` stringify handler, which
 *    wrote such text raw, so a line that is only `1. ` or `# ` reloaded as a list or a heading. Ours escapes the text and
 *    keeps the trailing whitespace raw (never `&#x20;`), as Milkdown did.
 *  - List markers (YAZ-3727 D2, `outline/listMarkers.ts`): replaces Milkdown's `syncListOrderPlugin`; each item's
 *    marker follows its list, and a change visits only the lists it touched.
 *  - Zoom into a bullet (GRO-2029, `outline/zoom.ts`): view-state-only decorations + breadcrumbs;
 *    glyph click / Mod-. / Mod-Shift-. ; never a document change.
 *  - List guide lines (GRO-2030, `outline/guideLines.ts` + `.css`): CSS vertical lines on nested
 *    lists; clicking a line collapses its direct parent bullets or recursively unfolds their
 *    descendants (meta-only, markdown untouched).
 *  - Multi-block drag (GRO-2019, `multiBlockDrag.ts`): handle-drag inside a multi-block
 *    selection moves the whole selection; single-block drag stays Crepe's.
 *  - Bullet threading (GRO-2094, `outline/bulletThreading.ts` + `.css`): root → caret path
 *    decorations (accent line + glyphs, stops at the active bullet); CSS-gated by the settings cog.
 *  - Wikilinks (GRO-2190, `wikilink/wikilinkPlugin.ts`): `[[target]]` renders Obsidian
 *    live-preview style via decorations only (brackets hidden, alias/heading display,
 *    caret-adjacency reveal, resolved/unresolved via `opts.wikilinks`; an id link's id hidden
 *    too, its note's current title drawn by a widget, YAZ-2293) — never a schema or serializer
 *    change, round-trip byte-identical. Every link is one unit (YAZ-3744 D1, YAZ-3935): it opens
 *    its raw text only from "Edit link".
 *  - Link caret (YAZ-3744 D1, YAZ-3935, `wikilink/idLinkCaret.ts`): a caret that lands inside a
 *    closed link steps over it; Backspace after it and Delete before it remove it whole; a
 *    double-click on a word next to a link selects only that word.
 *  - Pill selection (YAZ-3747 demo, `wikilink/pillSelection.ts`): a link inside a selection lights
 *    up as one box, its icon and padding too.
 *  - Wikilink clicks (GRO-2192, YAZ-3935, YAZ-3936, `wikilink/wikilinkClick.ts`): MOUSEDOWN on a
 *    collapsed `.wikilink` span. In an editable note a plain click puts the caret at the pill's
 *    nearer edge and a double-click selects the link; the gestures of Settings › Hotkeys ›
 *    "Links in a note" open it (⌘ → background tab, ⌘⇧ → new tab in front by default; unresolved →
 *    create-then-open via `createFromLink`); a read-only note opens on a plain click. Both
 *    preventDefault, so the link never flashes its raw text; revealed raw text stays editable.
 *    Registered only when `opts.wikilinkNav` provides the handlers.
 *  - Wikilink hover (YAZ-3403, `wikilink/wikilinkHover.ts`): the pointer on a resolved `.wikilink` span tells the
 *    host which page it opens, for the hover panel. Registered only when `opts.wikilinkHover` is passed: the
 *    note editor's, never a read-only preview's.
 *  - Link menu (YAZ-2293, YAZ-3609 D23, YAZ-3740, `wikilink/wikilinkMenu.ts`): right-click on a rendered
 *    `[[link]]` shows the one link menu (`linkMenu.ts`): its name and id, the Open rows and Show in
 *    sidebar, the copy rows, Focus, Favorites and "Open in ▸", Edit link, Remove link. Registered with
 *    the click plugin, on the same source, nav and follow.
 *  - Wikilink picker (GRO-2191, `wikilink/wikilinkPicker.ts`): typing `[[` opens the vault-wide
 *    suggestion popup (candidates via `opts.wikilinkCandidates`); Enter/click inserts plain
 *    `[[name]]` text — and the Create row also makes the page through `opts.wikilinkNav`
 *    (YAZ-1357). Its keymap MUST be `use`d before `outlinerKeymap`: both bind Enter at
 *    priority 100 and equal priorities run in addition order — the picker wins while open and
 *    declines (falls through) while closed.
 *  - Standard Markdown links (YAZ-1309, `markdownLink.ts`): an open gesture (YAZ-3936; a plain
 *    click in an editable note puts the caret, YAZ-3935) opens before caret placement — a link into
 *    a vault of the window in a tab (where the gesture says, YAZ-3609 D8, D14),
 *    anything else through the host — and such a link draws as a pill (D19); right-click shows the
 *    one link menu (D23, `linkMenu.ts`). Edit/remove
 *    reuse Crepe's link-tooltip API, including one logical range when formatting splits the DOM
 *    anchor. Registered only when `opts.markdownLinkNav` supplies the host boundary.
 *  - Block handle menu (YAZ-726, `blockHandleMenu.ts`): right-click on the 6-dot handle opens a
 *    `.ctx-menu` popup; rows (or picker rows, YAZ-3164) are data from a provider;
 *    capture-suppresses Crepe's right-button mousedown/mouseup so the selection/focus don't jump.
 *    Rows: the line's kind, one strip of the toolbar's buttons (Bullet list, Numbered list, Checklist, T; D18), for the
 *    whole list the line is in, or the highlighted lines (YAZ-3727 D13, D14, `outline/turnIntoRows.ts`, also on a
 *    plain line or a heading); then Number children
 *    ↔ Bullet children (YAZ-729, `outline/numberChildrenRow.ts`), only when the item has a direct child list. On a numbered line, "Bullets with written numbers" turns its list
 *    into bullets with each number written as `n) ` text (YAZ-3727 D12, `writtenNumbersRow`).
 *    On a line that folds, Collapse all and Expand all follow (YAZ-3727 D23, `outline/foldAllRows.ts`).
 *  - Typing a list marker (YAZ-3727 D8, D9, `listMarkerTyping.ts`): replaces Milkdown's `1. ` and `* ` input rules. A
 *    typed space after `n.` or `*` / `-` / `+` at the start of a PLAIN line goes in as text, then the line becomes a list
 *    line as its own undo step; ⌘Z or Backspace right after gives back the plain text. Never on Enter; inside a list
 *    item the marker stays text (`* 6) text` stays literal bullet text, YAZ-1329). Right-click Number children and the
 *    toolbar's Numbered button (YAZ-3806 T2) are the click paths; the `Mod-Alt-7` keymap and the slash-menu Ordered List
 *    row stay removed.
 *  - Drawing slash item (YAZ-877, `drawingMenu.ts`): rides Crepe's OWN BlockEdit menu via
 *    `featureConfigs[BlockEdit].buildMenu` — never a parallel slash plugin. Registered only when
 *    `opts.drawing` supplies the creator; the shared config always omits Ordered List.
 *  - The slash menu in a list item and "Current time" (YAZ-3550, `slashMenu.ts`; YAZ-3511 D21, D22):
 *    the patched Crepe (`client/vendor/milkdown-crepe-7.22.1-yaz3550.*`) opens the menu in a
 *    bullet too and filters by a row's `keywords`; Divider and Bullet List are hidden there.
 *    "Current time" (`h:mmam - `, plain text) ends the Text group on every editor.
 *  - Board embeds (YAZ-4827, was YAZ-878's drawing preview; `drawing/boardEmbed.ts`): `![[x.excalidraw|…]]` and
 *    `![[x.drawio|…]]` render as a window into the board (`embed/types.ts`, lazy) through inline decorations only
 *    (the match's text hidden, a widget in its place, rescanned only in the blocks an edit touched) — never a schema
 *    or serializer change. Its pill rows, its open and its icon are the link plugins' own sources. Registered only
 *    when `opts.boardEmbeds` gives it the vault root; every other embed is untouched.
 *  - CMD+F find (YAZ-968, `find/findInPage.ts`): matches + highlight decorations + fold-reveal,
 *    driven through the `FindChannel` the host also gives the find bar. Registered only when
 *    `opts.find` supplies that channel; every transaction it makes is metadata-only.
 *  - Outside changes (YAZ-3704 D3–D9, `external/outsideChanges.ts`): the words an outside save changed glow,
 *    removed text is a thin red mark, each changed line has a Checked button on hover; the one-line note reads
 *    the count and drives Next through the `OutsideChangesChannel` the host also gives the bar. Registered only
 *    when `opts.outsideChanges` supplies that channel. Memory only; every transaction it makes is metadata-only.
 *  - Table of contents (YAZ-2700, `toc/tocPlugin.ts`): the note's rows — its H1-H5 outside lists,
 *    or its bullets three levels deep when it has fewer than two of those, or what the reader
 *    chose for this note (the channel's source, D14: every heading, or the bullets) — scanned at
 *    view creation, 150 ms after the last document change and at once when the source changes,
 *    published through the `TocChannel` the host also gives `toc/TableOfContents.tsx`; the same
 *    channel carries the jump and the scroll spy. No state field, no decorations. Registered
 *    only when `opts.toc` supplies that channel.
 *  - Heading folding (YAZ-1140, `outline/headingFolding.ts` + `.css`): an H1-H3 chevron collapses
 *    the heading's section — its following sibling blocks up to the next same-or-shallower heading
 *    — through widget + node decorations only; metadata-only transactions, markdown untouched.
 *  - Heading level tag (YAZ-2700 D12, `outline/headingLevelTag.ts` + `.css`): ONE node decoration,
 *    `data-heading-caret`, on the heading that holds the caret (H1-H6, in a bullet too). The "H2"
 *    itself is a CSS `::after` on that heading, on the one under the mouse and — with the page
 *    cog's "Heading levels" on — on every heading: never text, never selected, never saved. A
 *    caret move inside one heading or outside headings keeps the same plugin state.
 *  - Heading text (YAZ-3049, `outline/headingText.ts`): an inline decoration, `heading-text`, on
 *    each text node of every heading (H1-H6, in a bullet and a quote too). app.css paints a
 *    highlighted level's wash on it, so the wash hugs the words while the heading stays full
 *    width (a click right of the words lands at the heading's end). Built once; a change rebuilds
 *    only the textblocks it touched.
 *  - Outline paste (YAZ-937, `outlinePaste.ts`): a pasted Slack/Docs outline of `•`/`◦`/`■` glyphs
 *    is translated to real markdown before it lands, so it arrives as a nested list instead of a
 *    column of paragraphs. Registered as a DIRECT `handlePaste` prop — direct props run before
 *    the clipboard plugin's — and it declines whenever the HTML payload has real list markup.
 *  - Paste modes (YAZ-1394, `clipboardPaste.ts`): native Plain text/Markdown requests target the
 *    focused editor; external standalone paragraph separators keep one blank paragraph each.
 *    Normal external paste keeps a plain `1.`, `2.`, … list (a plain decimal `<ol>`) as real numbers (YAZ-3727 D6);
 *    any other label (`3)`, `09.`, gaps, repeats, `a.`) stays literal text (YAZ-1429), and so does every label in the
 *    folder outline. Explicit Markdown and app-identified rich clipboard slices retain intentional ordered lists.
 *  - Copy-out (`clipboardCopyOut.ts`): normal Copy provides readable text and rich HTML with
 *    explicit empty lines. Copy as chooses plain text or Markdown; saves stay intact (YAZ-1443).
 *  - Images (YAZ-1656, `image/imageView.ts`): the FIRST node view in the codebase, on the commonmark
 *    `image` node the schema already has — a node view is allowed ONLY on an existing node and
 *    never touches the serializer (the line below is the one exception), so `![alt|300](src)`
 *    stays byte-identical. Vault-relative srcs
 *    load through main's `app://vault/` protocol (`image/imageSrc.ts`); eight aspect-locked handles
 *    resize into Obsidian's `alt|width`; double-click opens the host's lightbox (`image/ImageModal`).
 *    Paste/drop of image BYTES writes `assets/images/<note>-<stamp>.<ext>` and inserts the node
 *    (`image/insertImage.ts`, wired in `clipboardPaste.ts` through the `imageOptionsCtx` slice).
 *    Registered only when `opts.image` supplies the root + note path; without it images render as
 *    Crepe's stock `<img>` — the folder outline (its bullets-only lock has no `image`) and the
 *    hover preview card (no root in reach) say so where they mount.
 *  - The line's style (YAZ-3164, `line/lineStyle.ts`): the `hr` node gains `darkness`, `thickness`,
 *    `pattern` and `width` (each null for its default) — the ONE exception to the images rule
 *    above, because Markdown has no carrier for them. A plain line stays `***`; a styled one is
 *    `***` then the next block `<!-- line: darkness 80%, thickness 6px, style dashed, length 40%
 *    -->`, only the parts that are not the default. A `$remark` plugin joins the line and its
 *    comment on load in every container; any other comment stays HTML, bytes untouched. The second
 *    node view (`line/lineView.ts`, on every editor) draws it from custom properties and gives a
 *    selected line a round end handle that drags its length: live while it moves, ONE
 *    `setNodeMarkup` on mouseup. The block handle menu of a line (`line/lineRows.ts`) adds "Line
 *    darkness", "Line thickness" and "Line style", one row each, whose value opens the presets (the
 *    zoom menu's shape) on a click.
 *  - The table's settings (YAZ-3758, `table/tableStyle.ts`): the `table` node gains border,
 *    header, stripes, height, wrap and freeze attributes, and each cell `fill` and `color`
 *    — the SECOND exception to the images rule. A plain table stays the GFM table; one with
 *    settings is the table then the next block `<!-- table: … -->`, joined on load as the line's.
 *  - A code block's width (YAZ-4783, `code/codeWidth.ts`): the `code_block` node gains `width` and
 *    `unknownParts` — the THIRD exception. A plain code block stays the fence; one with a width is
 *    the fence then `<!-- code: width 1300 -->` on the line right under it, joined on load as the
 *    table's. A node decoration sizes the box; its right edge drags the width, written on mouseup.
 *  - Cell notes (YAZ-3818 D4, D12, `table/cellNotes.ts`): a footnote labelled `cell-N` is a `cell_note` block, hidden
 *    in the note view; after a table, a cell note or a mark moves, each cell note goes back under its table. Its mark
 *    is a corner triangle; the "Add cell note" button (`table/cellNoteButton.ts`), a click on the mark, ⌘. on a plain
 *    cell line and the table menu open it as a card beside its cell (`table/cellNoteCard.ts`, the YAZ-3818 demo); a
 *    rest on the cell previews it (`table/cellNotePreview.ts`, D14). A cell's and a cell note's bullets hold lines and lists only: another block put
 *    there becomes lines, and a typed `# ` stays text (`table/cellBlocks.ts`, D1).
 *  - Line numbers (YAZ-2643, `lineNumbers/lineNumbers.ts`): the line of the file ON DISK where each
 *    block starts, as a `data-line` node decoration that app.css draws in a lane left of the page;
 *    a block of two or more lines also carries `data-line-end` and shows its range (D7). View
 *    state only: the host sends the lines in a metadata-only transaction (never `markdownUpdated`,
 *    never history), and between two sends the set only rides the position mapping.
 *    A code block's OWN gutter counts in lines of the file too (D8, `lineNumbers/codeLines.ts`):
 *    one shared CodeMirror compartment in this file's CodeMirror extensions, empty until a build
 *    gives the block `data-line-code`; setting it is an effects-only CodeMirror transaction.
 *  - Section indent (YAZ-2709, `outline/sectionIndent.ts` + `.css`): each top-level block inside a
 *    heading's section stands one step in for each section that holds it, as a `data-sd` node
 *    decoration (and `data-sp` on the caret's path) that the CSS draws as a left border with the
 *    section lines in it. Steps count by nesting, all six levels; folds stay H1-H3. View state
 *    only: the host sends the page's switch in a metadata-only transaction (never
 *    `markdownUpdated`, never history). The set is rebuilt on a document change and handed to
 *    ProseMirror's own `DecorationSet` constructor, never `DecorationSet.create` / `set.map`
 *    (measured: 23.6 ms per key at 2,500 blocks against 0.19 ms), and its `forChild` answers
 *    "nothing inside a block" without ProseMirror's scan of every root decoration (16.5 ms per
 *    key). A click on a line folds the sections beside it (meta-only, through heading folding).
 *  - Column resize (YAZ-3696 D2, `table/tableColumnResize.ts`): `prosemirror-tables`' `columnResizing` as
 *    installed, put just before `tableEditing` so a grip drag selects no cells, with the drag measured
 *    in layout px under document zoom. The vendored table block draws the `<colgroup>` from `colwidth`.
 *  - Shift+arrow in a cell (YAZ-4171, `table/tableShiftArrow.ts`): also just before `tableEditing`; at the edge
 *    of the cell's text the first press selects only that cell, and `tableEditing` grows it on the next.
 *  - Fold rows (YAZ-4165, `table/tableFold.ts`): a run of folded rows is one bar, drawn by row decorations; a
 *    mousedown on the bar opens it, also just before `tableEditing`, so it starts no cell selection.
 *  - The row band (YAZ-4167, `table/tableRowBand.ts`): one decoration on the caret's body row, the mouse's by CSS;
 *    Settings › Tables › All tables › Row band is `data-table-row-band` on `.app`.
 *  - The table zoom (YAZ-4091, `table/tableZoomPill.tsx`): the page zoom pill (`DocumentZoom`) in a widget before each
 *    table sets its `zoom`; `table.css` zooms the block's content, so it multiplies with the page zoom.
 *  - Paste into cells (YAZ-3696 D4 / S2, `table/tablePaste.ts`, called from `clipboardPaste.ts`): cells
 *    and tab-separated text fill from the caret cell and grow the table; one value fills selected
 *    cells; tab-separated text outside a table makes one. One `replaceWith`, one undo step.
 *  - Fill down (YAZ-3696 S4, `table/tableFill.ts` + `fillSeries.ts`): a widget handle in the corner of
 *    the selected cells; a drag down or right fills series up to the table's edge, on mouseup.
 *  - Table menus (YAZ-3766): the table's settings on its six-dot handle (`table/tableRows.ts`), the
 *    cell toolbar over two or more selected cells (`table/cellToolbar.ts`; its custom colour pick,
 *    `table/colours.ts`), and frozen rows and columns (`table/tableFreeze.ts`; the right-click
 *    Table part is `noteMenu.tsx`'s).
 */
import { fileKind } from '@shared/fileKind'
import { Crepe, CrepeFeature } from './crepe'
import { EditorView as CodeMirrorView } from '@codemirror/view'
import type { EditorView } from '@milkdown/kit/prose/view'
import { codeTheme } from './codeTheme'
import { keymapRef, type ToolbarItem } from '@milkdown/crepe/feature/toolbar'
import { commandsCtx, editorViewCtx, serializerCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import {
  hardbreakClearMarkPlugin,
  headingKeymap,
  listItemKeymap,
  orderedListKeymap,
  remarkPreserveEmptyLinePlugin,
  syncListOrderPlugin,
  turnIntoTextCommand,
  wrapInBulletListInputRule,
  wrapInHeadingCommand,
  wrapInOrderedListInputRule,
} from '@milkdown/kit/preset/commonmark'
import { extendListItemSchemaForTask, keepTableAlignPlugin, wrapInTaskListInputRule as gfmTaskListInputRule } from '@milkdown/kit/preset/gfm'
import { type Command, Plugin, PluginKey, Selection, TextSelection } from '@milkdown/kit/prose/state'
import { $prose, $shortcut, replaceAll } from '@milkdown/kit/utils'
import { blockHandleGate } from './blockHandleGate'
import { readOnlyKeys } from './readOnlyKeys'
import { createBlockHandleMenu } from './blockHandleMenu'
import { breakMarks } from './breakMarks'
import { BOARD_VIEW_META, createBoardEmbed } from './drawing/boardEmbed'
import { flushBoardWindows } from './embed/hostWindow'
import { drawingMenu, type DrawingCreator } from './drawingMenu'
import { createSlashMenu } from './slashMenu'
import { imageOptionsCtx, type ImageOptions } from './image/imageOptions'
import { createImageView, imageBoardKeys, imageParseDefaults } from './image/imageView'
import type { FindChannel } from './find/findChannel'
import { createFindInPage } from './find/findInPage'
import type { OutsideChangesChannel } from './external/outsideChangesChannel'
import { createOutsideChanges } from './external/outsideChanges'
import type { TocChannel } from './toc/tocChannel'
import { createTableOfContents } from './toc/tocPlugin'
import { bulletThreading } from './outline/bulletThreading'
import { sectionIndent } from './outline/sectionIndent'
import { features } from './featureConfig'
import {
  listItemRoundTrip,
  mapOutsideFences,
  normalizeEmptyItems,
  restoreItemLine,
} from './listItemRoundTrip'
import { toggleUnderline, underline, underlineSchema } from './marks/underline'
import { clearFormattingKeymap } from './marks/clearFormatting'
import { highlight, highlightKeymap, highlightSchema, rangeHasHighlight, setHighlightCommand, QUICK_HIGHLIGHTS, type HighlightColor } from './marks/highlight'
import { highlightPanel, MORE_KEY, panelColour, toggleHighlightPanel } from './highlightPanel'
import { showMoreColour } from './toolbarHost'
import { allLinesAre, LIST_KINDS, listButtons, toggleListKind } from './listButtons'
import { noteCrepeIcons, ownIcon, TOOLBAR_GROUP_LABELS, TOOLBAR_LABELS } from './toolbarButtons'
import { arrangeToolbar, toolbarPrefs } from './toolbarPrefs'
import { inlineBreaks } from './inlineBreaks'
import { textStringify } from './textStringify'
import { lineStyle } from './line/lineStyle'
import { tableStyle } from './table/tableStyle'
import { codeBlockWidth, codeCommentStringify } from './code/codeWidth'
import { cellBlocksOnly } from './table/cellBlocks'
import { cellNotes, withoutEmptyCellNotes } from './table/cellNotes'
import { cellNoteButton } from './table/cellNoteButton'
import { cellNoteCard, cellNoteCardKeymap } from './table/cellNoteCard'
import { bulletSelectAllKeymap } from './bulletSelectAll'
import { cellNoteDeleteGuard } from './table/cellNoteGuard'
import { cellNoteClipboard } from './table/cellNoteClipboard'
import { cellNotePreview } from './table/cellNotePreview'
import { tableFill } from './table/tableFill'
import { tableRows } from './table/tableRows'
import { cellToolbar } from './table/cellToolbar'
import { customColourPick } from './table/colours'
import { tableFreeze } from './table/tableFreeze'
import { createTableCalendar } from './table/tableCalendar'
import { lineView } from './line/lineView'
import { lineRows } from './line/lineRows'
import { liftHeadlessItems, lineKeymap, visibleRangeHasMark, visibleTypeOver } from './lineSelection'
import { visibleFormatting } from './visibleFormatting'
import { codeLines } from './lineNumbers/codeLines'
import { lineNumbers } from './lineNumbers/lineNumbers'
import { tableColumnResize } from './table/tableColumnResize'
import { tableShiftArrow } from './table/tableShiftArrow'
import { tableHandleSelect } from './table/tableHandleSelect'
import { tableFold } from './table/tableFold'
import { tableSubhead } from './table/tableSubhead'
import { tableRowBand } from './table/tableRowBand'
import { tableZoomPill } from './table/tableZoomPill'
import { createSuperTables } from './table/super/superTables'
import { multiBlockDrag } from './multiBlockDrag'
import { outlinePaste } from './outlinePaste'
import { clipboardCopyOut, copyLinkTextCtx, copyMarkdownCtx, copyNoticeCtx, copyVisibleHotkey } from './clipboardCopyOut'
import { clipboardPaste } from './clipboardPaste'
import { pathPasteCtx, relativeLinks, type PathPasteOptions } from './pathPaste'
import { guideLines } from './outline/guideLines'
import { numberChildrenRow, writtenNumbersRow } from './outline/numberChildrenRow'
import { turnIntoRows } from './outline/turnIntoRows'
import { createHeadingFolding, type HeadingFoldingOptions } from './outline/headingFolding'
import { createFoldLock, type FoldLockOptions } from './outline/foldLock'
import { headingHotkeys } from './outline/headingHotkeys'
import { headingLevelTag } from './outline/headingLevelTag'
import { headingText } from './outline/headingText'
import { foldAllHotkeys, foldsChanged } from './outline/foldAllHotkeys'
import { obsidianHotkeys } from './outline/hotkeys'
import { addLineCodeKeys, addLineKeymap, addLineViews } from './outline/addLineBeside'
import { caretReveal, foldHistory } from './outline/foldReveal'
import { enterTracker, outlinerKeymap } from './outline/listCommands'
import { listMarkers } from './outline/listMarkers'
import { listMarkerTyping, undoListMarker, wrapInTaskListInputRule } from './listMarkerTyping'
import { typingArrows, undoTypingArrow } from './typingArrows'
import { enterKeepsStyle, enterKeepsStyleInNotes } from './enterKeepsStyle'
import { createFoldingSwitch } from './outline/foldingSwitch'
import { createOutlineFolding, type OutlineFoldingOptions } from './outline/outlineFolding'
import { caretIntoZoom, createOutlineZoom, getZoomKey, getZoomLabel, zoomKeymap, zoomToKey, type ZoomOptions } from './outline/zoom'
import { foldAllRows } from './outline/foldAllRows'
import { openBulletRow } from './outline/openBulletRow'
import { focusSidebar } from '../lib/focusHandoff'
import { createWikilinkClick, wikilinkFollower, type LinkFollow, type WikilinkNav } from './wikilink/wikilinkClick'
import { createWikilinkHover, type WikilinkHover } from './wikilink/wikilinkHover'
import { createWikilinkMenu, linkMenuOf } from './wikilink/wikilinkMenu'
import { createWikilinkPicker, createWikilinkCandidateSource, createWikilinkPickerKeymap, type WikilinkCandidateSource } from './wikilink/wikilinkPicker'
import { createWikilink, createWikilinkResolveSource, linkIsResolved, linkPath, linksAsShown, type LinkLook, type VaultsOfLetters, type WikilinkResolveSource } from './wikilink/wikilinkPlugin'
import { languages as codeLanguages } from '@codemirror/language-data'
import { basename } from '@shared/types'
import { imageSrc, noteDirRel } from './image/imageSrc'
import { NOTE_CARD_ID_META, noteCardCodeKeys, noteCardLanguage, noteCardPlugins, noteCardRow, type NoteCardDeps, type NoteCardHost } from './noteCard/noteCardView'
import type { NoteCardLook } from './noteCard/noteCardRender'
import { createIdLinkCaret } from './wikilink/idLinkCaret'
import { createPillSelection } from './wikilink/pillSelection'
import { createMarkdownLink, noPreviewOnPills, type MarkdownLinkNav } from './markdownLink'
import { createViewOnlyLinkSource, type ViewOnlyLinkSource } from './wikilink/viewOnlyLinkSource'
import { claimPage } from '../lib/readOnlyCaret'
import { toDisplay, type HotkeyOverrides } from '@shared/hotkeyBindings'
import { keyRow, keysOf } from '@shared/keys'
import { applyNoteKeys, noteHotkeysCtx } from './noteKeys'
import { codeBlockFind } from './find/codeBlockFind'
import { blockConfig } from '@milkdown/kit/plugin/block'

export interface CreateCrepeOptions {
  root: HTMLElement
  defaultValue?: string
  /** Called whenever the document changes (Crepe's listener debounces this ~200ms). */
  onMarkdownUpdated?: (markdown: string) => void
  /** Fold state for collapsible parent bullets: restore from / report to the caller (persisted per file). */
  folding?: OutlineFoldingOptions
  /** Fold state for collapsible heading sections (YAZ-1140): same contract as `folding`, its own `h:`-prefixed key space. */
  headingFolding?: HeadingFoldingOptions
  /** Rows locked open (YAZ-4094 4A, `outline/foldLock.ts`). */
  foldLock?: FoldLockOptions
  /** The page's "Folding" switch at mount (YAZ-4094 F1); the host changes it later with `setFoldingOn`. Absent → on. */
  foldingOn?: () => boolean
  /** A fold key on a page with folding off (YAZ-4094 F1): the host's message. */
  onFoldingBlocked?: () => void
  /** Zoom into a bullet (GRO-2029); `title` is the root breadcrumb. Defaults to an unnamed file. */
  zoom?: ZoomOptions
  /** CMD+F channel (YAZ-968): the host's one channel per mount, shared with the find bar. Absent → no find engine at all. */
  find?: FindChannel
  /** Outside changes channel (YAZ-3704 D6): the host's one channel per mount, shared with the one-line note. Absent → no change list at all. */
  outsideChanges?: OutsideChangesChannel
  /** Table of contents channel (YAZ-2700): the host's one channel per mount, shared with the table of contents. Absent → the note is never scanned. */
  toc?: TocChannel
  /** Wikilink resolve source (GRO-2190): App keeps it fed from the vault index. Defaults to a never-updated source (all links render resolved). */
  wikilinks?: WikilinkResolveSource
  /** A resolved `[[link]]`'s pill icon (YAZ-3609 D13). Absent → the pill has no icon. */
  linkLook?: LinkLook
  /** Navigation-only view-file resolver; never carries semantic records. */
  viewOnlyLinks?: ViewOnlyLinkSource
  /** `[[` picker candidates (GRO-2191): App keeps it fed from the vault index. Defaults to a never-updated source (empty picker — only Create rows). */
  wikilinkCandidates?: WikilinkCandidateSource
  /** Wikilink click navigation (GRO-2192): tabs API + create-on-click handlers. Absent → links render but clicks fall through to plain editing (the click plugin is not registered). */
  wikilinkNav?: WikilinkNav
  /** The window's vaults by their ID letters (YAZ-3905 S23): an unresolved `[[INL-4]]` names its vault, and a click makes no page. Absent → none. */
  vaultsOfLetters?: VaultsOfLetters
  /** Wikilink hover (YAZ-3403): the host's hover panel hears which page a resolved link opens. Absent → the hover plugin is not registered. */
  wikilinkHover?: WikilinkHover
  /** Standard Markdown link actions (YAZ-1309, YAZ-3609): a click opens (in a tab for a vault of the window), a pill look, the one link menu. Absent → Crepe's stock behavior. */
  markdownLinkNav?: MarkdownLinkNav
  /** Paste a path, get a link (YAZ-3609). Absent → a pasted path stays text. */
  pathPaste?: PathPasteOptions
  /** Drawing creator (YAZ-877): the host writes the sidecar, the item inserts the embed. Absent → NO Drawing row is added to the slash menu. */
  drawing?: DrawingCreator
  /**
   * Board embeds (YAZ-4827): the vault root the boards load from, and "Edit in a popup" (D7, the drawing modal).
   * Absent → `![[x.excalidraw]]` and `![[x.drawio]]` stay plain text.
   */
  boardEmbeds?: { root: string; onEditInPopup?: (target: string) => void }
  /** First-class images (YAZ-1656): root + note path for src resolution, the lightbox opener, the paste notice. Absent → stock `<img>`, and pasted image bytes are not written. */
  image?: ImageOptions
  /**
   * Feature overrides for a NON-note instance (a drawing's text box). The note editor passes
   * none and gets `featureConfig.ts`'s allowlist
   * verbatim — which is what `featureConfig.test.ts` keeps honest.
   */
  features?: Partial<Record<CrepeFeature, boolean>>
  /**
   * The note editor (a tab, the right panel): while read only it takes the focus and answers its view
   * keys itself (`readOnlyKeys.ts`, YAZ-3125, YAZ-3127). Absent on the read-only previews.
   */
  readOnlyKeys?: boolean
  /**
   * `settings.hotkeys` (YAZ-3564 K4): the note keys the user changed. Read once, here: a change applies to the notes
   * that open next (`noteKeys.ts`). Absent = the defaults.
   */
  hotkeys?: HotkeyOverrides
  /** Copy as › Without folded lines' toast (YAZ-3653): how many folded lines the copy left out. Absent → no toast. */
  onCopyNotice?: (text: string) => void
  /**
   * The note editor (YAZ-4162 D2, D9): a calendar table's current-time marker moves each minute (`table/tableCalendar.ts`).
   * Absent on the hover preview card and the other previews: they show the marker of the time they opened and start no timer.
   */
  calendarClock?: boolean
  /**
   * The note editor (YAZ-4091, YAZ-4176): the table zoom pill on each table (`table/tableZoomPill.tsx`). Absent on the
   * hover preview card, the read-only previews and the outline view: they mount no React root for each table.
   */
  tableZoomPill?: boolean
  /**
   * A NON-note instance's rows that never show (YAZ-4277 D4, a drawing text box): toolbar buttons and slash rows by
   * key. Absent → every row, as a note.
   */
  hidden?: { toolbar?: readonly string[]; slash?: readonly string[] }
  /** A NON-note instance's own toolbar buttons (YAZ-4277 1E: a drawing text box's letter colors), added before the build. */
  extendToolbar?: (builder: ToolbarBuilder) => void
  /** Whether Enter keeps the line's style (YAZ-3746 13AB). Absent → the notes' switch; a drawing text box passes its own. */
  enterKeepsStyle?: () => boolean
  /**
   * Note cards (YAZ-4961): the page's path and the vault's ID door. Absent → no "Note card" slash row; a card still
   * draws (a preview, a read layer). The row also hides while the vault gives no IDs (idea 9, `wikilinks.ids`).
   */
  noteCards?: NoteCardHost
}

/** The slice of Crepe's GroupBuilder `buildToolbar` hands over — structural, since Crepe exports the item type but not the builder class. */
export interface ToolbarGroup {
  addItem: (key: string, item: ToolbarItem & { onRun: (ctx: Ctx) => void }) => unknown
}
export interface ToolbarBuilder {
  addGroup: (key: string, label: string) => ToolbarGroup
  getGroup: (key: string) => ToolbarGroup
  /** The builder's OWN list of groups, in strip order (Crepe's `GroupBuilder.build` hands back the array itself, not a copy). */
  build: () => Array<{ key: string; label: string; items: Array<{ key: string; icon?: string }> }>
}

const viewState = (ctx: Ctx) => ctx.get(editorViewCtx).state
/** Run a ProseMirror command on the editor's view, as Crepe's own buttons do through their commands. */
const runOnView = (ctx: Ctx, command: Command): void => {
  const view = ctx.get(editorViewCtx)
  command(view.state, view.dispatch, view)
}

/**
 * The selection toolbar (YAZ-923 + YAZ-1480 + YAZ-2700 D13 + YAZ-3806).
 *
 * THE STRIP, by default, left to right (YAZ-3806): the Heading group (H1, H2, H3, T), the Lists
 * group (Checklist, Bullet list, Numbered list), Crepe's own Formatting group (Bold, Italic,
 * Underline, Strikethrough, the highlight buttons and their ▾), then Crepe's code and link. The user
 * reorders and hides groups and buttons in Settings (`toolbarPrefs.ts`); the tab order is the strip's order.
 *
 * The highlight swatches (YAZ-1480; since YAZ-4348 demo round 2 yellow, green, blue — pink lives in
 * the ▾ panel with the other colours) join Crepe's OWN Formatting
 * group right after Strikethrough: `getGroup('formatting')` reaches it because `buildToolbar`
 * runs AFTER Crepe has added that group. Bold's toggle semantics (🔒 D5): a dot is lit when ANY of
 * the selection carries its colour, so a partly highlighted line still shows it; clicking a lit dot
 * removes that colour, an unlit one applies it — through the mark's single command, which
 * `Mod-Shift-h` (yellow) and the `==x==` typing rule share. Yellow is the Markdown `==…==` on
 * disk; a colour is `<mark class="highlight-<name>">`. YAZ-4348 demo round 2: each swatch is a bold
 * "A" on its colour, a lit one ringed (app.css), and a ▾ after them opens the colour panel, `highlightPanel.ts`.
 * YAZ-4445: the swatches and the ▾ are the board toolbar's tiles (`toolbarButtons.ts` `swatchTile`, `swatchTile.css`).
 *
 * The Heading group (YAZ-923): H1/H2/H3/T buttons whose ACTIVE state answers "what block is
 * this?" — the invisible `##` made visible — and whose click switches it, through the same
 * commands the typed markdown runs. `T` is the way back to plain text without backspacing hashes
 * you cannot see. It changes only the line's text type, never the list (YAZ-4369, which replaces
 * YAZ-3806 T4's "out of a list too"): a heading in a bullet becomes a plain line in the same
 * bullet, and T lights when every line is a paragraph, in a list or not. The lit list button
 * takes a line out of a list.
 *
 * The Lists group (YAZ-3806 T1, T3): one rule for the three buttons, in `listButtons.ts`. Numbers
 * stay a deliberate act (T2): the Numbered button is a click, like the block handle's command.
 * Underline (T8) runs ⌘U's own command and lights like Bold.
 *
 * `addGroup` can only append, so the groups are added in any order and then put in the user's
 * order (`arrangeToolbar`, the last line below). Crepe builds the strip in a Vue `computed` that
 * calls this function, and `toolbarPrefs` is a Vue ref: a change in Settings rebuilds the strip of
 * every open editor at once (T6).
 *
 * 🔒 The order counts on `builder.build()` handing back the builder's OWN array and not a copy.
 * It does in the Crepe this app installs (`@milkdown/crepe` 7.22.1, from
 * `client/vendor/milkdown-crepe-7.22.1-yaz3550.tgz`, whose patch does not touch the toolbar):
 * `utils/group-builder.ts` is `build = () => this.#groups`, and the toolbar reads its groups
 * through that same call right after this function returns. A Crepe whose `build()` copied
 * would keep Crepe's order and raise nothing; `headingToolbar.test.ts` reads the strip of a real
 * editor and fails on it.
 */
function buildToolbar(builder: ToolbarBuilder, hotkeys: HotkeyOverrides | undefined, hidden: readonly string[] = [], extend?: (builder: ToolbarBuilder) => void): void {
  const formatting = builder.getGroup('formatting')
  for (const color of [null, ...QUICK_HIGHLIGHTS] as HighlightColor[]) {
    const id = color === null ? 'highlight' : (`highlight-${color}` as 'highlight-green' | 'highlight-blue')
    formatting.addItem(id, {
      icon: ownIcon(id),
      label: TOOLBAR_LABELS[id],
      ...(color === null ? { keymap: keymapRef(highlightKeymap.key, 'ToggleHighlight') } : {}),
      active: (ctx) => rangeHasHighlight(ctx.get(editorViewCtx).state, highlightSchema.type(ctx), color),
      onRun: (ctx) => ctx.get(commandsCtx).call(setHighlightCommand.key, color),
    })
  }
  // YAZ-4348 demo round 2: the ▾ of the colour panel; lit when the selection has a colour that is not a button,
  // with a bar of that colour under it, as the board's ▾ (YAZ-4445).
  formatting.addItem(MORE_KEY, {
    icon: ownIcon(MORE_KEY),
    label: TOOLBAR_LABELS[MORE_KEY],
    active: (ctx) => {
      const view = ctx.get(editorViewCtx)
      const colour = panelColour(view.state, highlightSchema.type(ctx))
      showMoreColour(view, MORE_KEY, colour)
      return colour !== null
    },
    onRun: (ctx) => toggleHighlightPanel(ctx.get(editorViewCtx)),
  })
  formatting.addItem('underline', {
    icon: ownIcon('underline'),
    label: TOOLBAR_LABELS.underline,
    // Underline's key is the app's own keymap, not a Milkdown slice `keymapRef` can name: its row, as the note opened.
    shortcut: toDisplay(keysOf(keyRow('note.underline')!, hotkeys)[0] ?? null) || undefined,
    active: (ctx) => visibleRangeHasMark(viewState(ctx), underlineSchema.type(ctx)),
    onRun: (ctx) => runOnView(ctx, toggleUnderline(ctx)),
  })
  const blockAt = (ctx: Ctx) => viewState(ctx).selection.$from.parent
  const group = builder.addGroup('lineType', TOOLBAR_GROUP_LABELS.lineType)
  for (const level of [1, 2, 3] as const) {
    group.addItem(`h${level}`, {
      icon: ownIcon(`h${level}`),
      label: TOOLBAR_LABELS[`h${level}`],
      active: (ctx) => {
        const block = blockAt(ctx)
        return block.type.name === 'heading' && block.attrs.level === level
      },
      onRun: (ctx) => ctx.get(commandsCtx).call(wrapInHeadingCommand.key, level),
    })
  }
  group.addItem('text', {
    icon: ownIcon('text'),
    label: TOOLBAR_LABELS.text,
    active: (ctx) => allLinesAre(viewState(ctx), 'text'),
    onRun: (ctx) => ctx.get(commandsCtx).call(turnIntoTextCommand.key),
  })
  const lists = builder.addGroup('lists', TOOLBAR_GROUP_LABELS.lists)
  for (const kind of LIST_KINDS) {
    lists.addItem(kind, {
      icon: ownIcon(kind),
      label: TOOLBAR_LABELS[kind],
      active: (ctx) => allLinesAre(viewState(ctx), kind),
      onRun: (ctx) => runOnView(ctx, toggleListKind(kind)),
    })
  }
  extend?.(builder)
  // The default order leads with the Heading group (YAZ-2700): the toolbar opens over the start of
  // the selection, so its first buttons are the ones under the hand after a double click.
  const groups = builder.build()
  noteCrepeIcons(groups)
  arrangeToolbar(groups, toolbarPrefs.value)
  if (hidden.length === 0) return
  for (const group of groups) group.items = group.items.filter((item) => !hidden.includes(item.key))
  groups.splice(0, groups.length, ...groups.filter((group) => group.items.length > 0))
}

/**
 * Escape steps OUT of the text and back to the sidebar (YAZ-936), so the keyboard walk resumes
 * exactly where the page was picked: on the Search tab the search bar gets the caret, empty or not
 * (YAZ-2638 D2); on Files, Focus and Favorites the tree's active row gets it. Priority 10 —
 * anything that means something by Esc (the `[[` picker's dismiss at 100, menus) wins first; and
 * it DECLINES when neither is on screen (collapsed sidebar), so Esc stays free everywhere else.
 */
const escapeToSidebar = $shortcut(() => ({
  EscapeToSidebar: {
    key: 'Escape',
    priority: 10,
    onRun: () => () => focusSidebar(),
  },
}))

export function createCrepe(opts: CreateCrepeOptions): Crepe {
  // The "Note card" row (YAZ-4961, idea 9): only in a vault that gives IDs, read at each update of the menu's flags.
  const noteCardSlash = opts.noteCards === undefined ? undefined : { row: noteCardRow(opts.noteCards), on: () => (opts.wikilinks?.ids ?? false) }
  const slashMenu = createSlashMenu(opts.drawing === undefined ? undefined : drawingMenu(opts.drawing), opts.hidden?.slash, noteCardSlash)
  const crepe = new Crepe({
    root: opts.root,
    defaultValue: normalizeEmptyItems(opts.defaultValue ?? ''),
    features: { ...features, ...opts.features },
    featureConfigs: {
      // Crepe feature customisation #1 (YAZ-1329/YAZ-877): Number children is the only editor
      // command that creates ordered children, so the stock Ordered List row is absent. Drawing
      // still composes into this same BlockEdit config when the host supplies a creator, after
      // Current time and before the list rule (YAZ-3550, `slashMenu.ts`). The stock Table row is
      // replaced by the app's own, which keeps a bullet's line above the table (YAZ-3696 D12).
      [CrepeFeature.BlockEdit]: {
        listGroup: { orderedList: null },
        advancedGroup: { table: null },
        buildMenu: slashMenu.buildMenu,
      },
      // #2 (YAZ-923): the selection toolbar SAYS the block's level — a Heading group whose
      // active button is the answer to "what is this?", and whose click is the switch. The
      // markdown stays the source of truth; these call the same commands typing `##` does.
      // YAZ-1480 adds Highlight into Crepe's own Formatting group from the same builder.
      [CrepeFeature.Toolbar]: { buildToolbar: (builder) => buildToolbar(builder, opts.hotkeys, opts.hidden?.toolbar, opts.extendToolbar) },
      // Native text carets track document zoom without a second painted overlay.
      [CrepeFeature.Cursor]: { virtual: false },
      // YAZ-2270: long lines wrap like prose instead of scrolling sideways, and colours come from
      // app.css `--code-*` so they follow Appearance (codeTheme.ts replaces Crepe's One Dark).
      // `codeLines` (YAZ-2643 D8): a code block's own line numbers are lines of the file while the numbers show.
      // `addLineCodeKeys` (YAZ-4800 demo): ⌘↵ / ⌘⇧↵ add a line below / above the code block, before Crepe's exit-code.
      // `noteCardCodeKeys` (YAZ-4961): in a note card's editor ⌘↵ opens the card and Esc is Done, before `addLineCodeKeys`.
      // The `card` language: Markdown with spell check (idea 8).
      [CrepeFeature.CodeMirror]: { theme: codeTheme, languages: [...codeLanguages, noteCardLanguage], extensions: [CodeMirrorView.lineWrapping, codeLines, codeBlockFind, noteCardCodeKeys, addLineCodeKeys] },
    },
  })
  crepe.editor.use(
    // NB: extend the GFM task-item schema, not the commonmark base — extendSchema()
    // always derives from the ORIGINAL schema, so extending listItemSchema directly
    // would silently drop task-list checkbox support.
    extendListItemSchemaForTask.extendSchema((prev) => (ctx) => ({ ...prev(ctx), content: 'block+' })),
  )
  crepe.editor.use(listItemRoundTrip)
  // An image read with no title gets '' as a made one does (YAZ-3704 4I2).
  crepe.editor.use(imageParseDefaults)
  // The slash menu's "in a list" and "in a cell" flags (YAZ-3550, YAZ-3818 D1): which rows a list item and a cell hide.
  crepe.editor.use(slashMenu.inListWatch)
  crepe.editor.use(underline)
  crepe.editor.use(highlight)
  crepe.editor.use(clearFormattingKeymap)
  // The toolbar's highlight ▾ colour panel and its colour box (YAZ-4348 demo round 2, YAZ-4388).
  crepe.editor.use(highlightPanel)
  // The line's darkness, thickness, style and length (YAZ-3164): `***` + the `<!-- line: … -->` comment.
  crepe.editor.use(lineStyle)
  // The table's widths, fills, text colours and settings (YAZ-3758): the table + the `<!-- table: … -->` comment. Milkdown's
  // column-alignment keeper reads the header row by a cell's index, wrong under a merged cell (YAZ-4792); ours is in `tableStyle`.
  void crepe.editor.remove(keepTableAlignPlugin)
  crepe.editor.use(tableStyle)
  // A code block's own width (YAZ-4783): the fence + the `<!-- code: width 1300 -->` line right under it, the right
  // edge's grip and its drag. The join rule keeps the comment on the line under the fence.
  crepe.editor.use(codeBlockWidth)
  crepe.editor.config(codeCommentStringify)
  // Cell notes (YAZ-3818 D4, D12): a `cell-N` footnote is a `cell_note`, hidden, and it stays under its table. Before
  // `inlineBreaks`: its remark step reads a footnote's `<br />` line first.
  crepe.editor.use(cellNotes)
  // A cell's and a cell note's bullets hold lines and lists only (YAZ-3818 D1): another block becomes lines.
  crepe.editor.use(cellBlocksOnly)
  // YAZ-3209: over hidden lines, Bold, Italic, Strikethrough, code and H1-H3 / T change the visible
  // ones only, and the toolbar lights for visible lines only. After the presets, by `EditorViewReady`.
  crepe.editor.use(visibleFormatting)
  // T / ⌘⌥0 = a paragraph in place, the list kept (YAZ-4369); ⌘⌥8 = the Bullet button (YAZ-3806 T3). After visibleFormatting: it replaces T.
  crepe.editor.use(listButtons)
  // Milkdown's empty-line plugin deletes every inline <br> on parse (YAZ-1452). Ours must run
  // first; re-registering Milkdown's AFTER keeps its id resolvable so empty paragraphs still
  // serialise as `<br />`.
  void crepe.editor.remove(remarkPreserveEmptyLinePlugin)
  crepe.editor.use(inlineBreaks).use(remarkPreserveEmptyLinePlugin)
  // Milkdown's break plugin turns soft breaks hard under any new mark (YAZ-2280); ours replaces it.
  void crepe.editor.remove(hardbreakClearMarkPlugin)
  crepe.editor.use(breakMarks)
  // Milkdown's text handler saves a line that is only `1. ` or `# ` raw, so it reloads as a list or a heading (YAZ-3727 B5); ours escapes it.
  crepe.editor.config(textStringify)
  // Milkdown's list-number plugin walks the whole note on each change and fixes numbered lists only (YAZ-3727 D2); ours replaces it.
  void crepe.editor.remove(syncListOrderPlugin)
  crepe.editor.use(listMarkers)
  // Before the fold plugins: their `apply` reads the switch's NEW value off the state being built (YAZ-4094 F1).
  crepe.editor.use(createFoldingSwitch(opts.foldingOn ?? (() => true), opts.onFoldingBlocked))
  crepe.editor.use(createOutlineFolding(opts.folding))
  crepe.editor.use(createHeadingFolding(opts.headingFolding))
  // After both fold plugins: it reads their rows, and opens again each fold a lock blocks.
  crepe.editor.use(createFoldLock(opts.foldLock))
  crepe.editor.use(headingLevelTag)
  crepe.editor.use(headingText)
  // ONE resolve source instance feeds the decorations, the click plugin's routing, and every label that names a link.
  const wikilinks = opts.wikilinks ?? createWikilinkResolveSource()
  // A missing catalog must stay passive: recognized non-Markdown targets can never fall through
  // to Markdown creation, including in isolated createCrepe consumers outside App.
  const viewOnlyLinks = opts.viewOnlyLinks ?? createViewOnlyLinkSource()
  // ⌘F reads a pill as the note draws it (YAZ-3744 S9): the same two sources.
  if (opts.find !== undefined) crepe.editor.use(createFindInPage(opts.find, { wikilinks, viewOnly: viewOnlyLinks }))
  if (opts.outsideChanges !== undefined) crepe.editor.use(createOutsideChanges(opts.outsideChanges))
  // A row of the table of contents, a crumb, the tab's tooltip and its Back list name a line's links as the note shows them (YAZ-3744 D6).
  const linkText = (text: string) => linksAsShown(text, wikilinks, viewOnlyLinks)
  if (opts.toc !== undefined) crepe.editor.use(createTableOfContents(opts.toc, { linkText, subscribe: wikilinks.subscribe }))
  crepe.editor.use(createOutlineZoom({ title: () => 'Untitled', ...opts.zoom, linkText }))
  crepe.editor.use(guideLines)
  crepe.editor.use(bulletThreading)
  crepe.editor.use(sectionIndent)
  crepe.editor.use(lineNumbers)
  // Column resize (YAZ-3696 D2): `columnResizing`, before `tableEditing`, zoom-aware; the table block draws the `<colgroup>`.
  crepe.editor.use(tableColumnResize)
  // Shift+arrow at the edge of a cell's text selects that cell only (YAZ-4171), also before `tableEditing`.
  crepe.editor.use(tableShiftArrow)
  // Delete and Backspace that would take a cell note ask first (YAZ-4206 D16), also before `tableEditing`.
  crepe.editor.use(cellNoteDeleteGuard)
  // Copy, cut and paste carry cell notes (YAZ-4206 D13); Paste as › Cells only leaves them out (D18).
  crepe.editor.use(cellNoteClipboard)
  // Sheets-style selection (the YAZ-4163 demo): a drag along the handles, Shift+Space and Ctrl+Space.
  crepe.editor.use(tableHandleSelect)
  // Folded rows (YAZ-4165): the bar and the hidden rows; a mousedown on a bar opens it, also before `tableEditing`.
  crepe.editor.use(tableFold)
  // Subheader rows (YAZ-4899): the look, the chevron and the collapsed sections, the sticky rows, the keys and the drag.
  crepe.editor.use(tableSubhead)
  // Fill down (YAZ-3696 S4): the corner handle of the selected cells.
  crepe.editor.use(tableFill)
  // The cell toolbar (YAZ-3696 D8): our own strip over two or more selected cells.
  crepe.editor.use(cellToolbar)
  // Cell notes (YAZ-3818 D8, D14): the "Add cell note" button in a cell's corner, the preview on a cell with a note,
  // and the open note's card beside its cell (the demo): Esc and the arrows at its edges at priority 90.
  crepe.editor.use(cellNoteButton)
  crepe.editor.use(cellNotePreview)
  crepe.editor.use(cellNoteCard)
  crepe.editor.use(cellNoteCardKeymap)
  // ⌘A on a bullet (YAZ-4348 demo round 2): its line first, then the whole note; priority 80, under the cell's 90.
  crepe.editor.use(bulletSelectAllKeymap)
  // The table menu's Custom colour… box and its target cells (YAZ-3817, YAZ-4366), kept through edits while it is open.
  crepe.editor.use(customColourPick)
  // Frozen rows and columns (YAZ-3696 S3): the counts kept inside the table, the frozen cells' decorations, the rows' offset.
  crepe.editor.use(tableFreeze)
  // Calendar tables (YAZ-4162): the now row and the past rows; the minute clock in the note editor only.
  crepe.editor.use(createTableCalendar(opts.calendarClock === true))
  // The row band on the caret's row (YAZ-4167): one row decoration, moved only when the caret goes to another row.
  crepe.editor.use(tableRowBand)
  // The table zoom (YAZ-4091): the page zoom pill in a widget before each table, for the table's own `zoom`; the note editor only (YAZ-4176).
  if (opts.tableZoomPill === true) crepe.editor.use(tableZoomPill)
  // Super tables (YAZ-4869): the active tab, the redraw of a changed table's view, the header rename and find; the note
  // editor only, beside the zoom pill whose anchor draws the views. The note's place keys what this Mac remembers.
  if (opts.tableZoomPill === true) crepe.editor.use(createSuperTables(opts.image === undefined ? null : { root: opts.image.root, notePath: opts.image.notePath }))
  // A read-only NOTE's keyboard (YAZ-3125, YAZ-3127): the note editor only, never a preview.
  if (opts.readOnlyKeys === true) crepe.editor.use(readOnlyKeys)
  crepe.editor.use(createWikilink(wikilinks, viewOnlyLinks, opts.linkLook, opts.vaultsOfLetters))
  // Every [[link]] is one unit (YAZ-3744 D1, YAZ-3935): the caret steps over it, Backspace removes it whole.
  crepe.editor.use(createIdLinkCaret())
  // A selected link is one lit box, not its letters alone (YAZ-3747 demo).
  crepe.editor.use(createPillSelection())
  // A click, the link menu's Open rows and a board embed's open follow a link the same way (YAZ-3609 D23, YAZ-4829).
  const follow = opts.wikilinkNav === undefined ? undefined : wikilinkFollower(wikilinks, opts.wikilinkNav, viewOnlyLinks, opts.vaultsOfLetters)
  if (opts.wikilinkNav !== undefined && follow !== undefined) {
    const nav = opts.wikilinkNav
    // A plain click opens a note pill in Explore while the vault says so (YAZ-4936): a note that is there, never a board or a folder.
    const exploreClick = (inner: string): boolean => nav.exploreClick?.() === true && fileKind(linkPath(inner, wikilinks, viewOnlyLinks) ?? '') === 'markdown'
    crepe.editor.use(createWikilinkClick(follow, () => nav.hotkeys?.(), exploreClick)).use(createWikilinkMenu(wikilinks, opts.wikilinkNav, follow, viewOnlyLinks, opts.vaultsOfLetters))
  }
  if (opts.wikilinkHover !== undefined) crepe.editor.use(createWikilinkHover(wikilinks, opts.wikilinkHover, viewOnlyLinks))
  // Note cards (YAZ-4961): a ```card block draws as a card in every editor that has code blocks (idea 10: the hover
  // preview, QuickLook, read-only notes and Explore too); its pills, images and links as the note's.
  if ({ ...features, ...opts.features }[CrepeFeature.CodeMirror] !== false) crepe.editor.use(noteCardPlugins(noteCardDeps(opts, wikilinks, viewOnlyLinks, follow)))
  if (opts.markdownLinkNav !== undefined) crepe.editor.use(createMarkdownLink(opts.markdownLinkNav, wikilinks)).config(noPreviewOnPills)
  crepe.editor.use(createWikilinkPicker(opts.wikilinkCandidates ?? createWikilinkCandidateSource(), wikilinks, opts.wikilinkNav, opts.linkLook))
  if (opts.boardEmbeds !== undefined) {
    // The same sources as the pills (YAZ-4827): a board's path and icon, its open, and its link's menu rows.
    const nav = opts.wikilinkNav
    crepe.editor.use(
      createBoardEmbed({
        ...opts.boardEmbeds,
        source: wikilinks,
        viewOnly: viewOnlyLinks,
        look: opts.linkLook,
        follow,
        linkMenu: nav === undefined || follow === undefined ? undefined : (inner) => linkMenuOf(inner, wikilinks, nav, follow, viewOnlyLinks, opts.vaultsOfLetters, undefined, undefined),
      }),
    )
  }
  // Images (YAZ-1656): the node view takes the options directly; the ctx slice carries the SAME
  // object to `clipboardPaste`, which has no constructor of its own. Injected on every editor (null
  // when the host gave none) so the paste handler can always read it and simply decline.
  crepe.editor.config((ctx) => {
    ctx.inject(imageOptionsCtx, opts.image ?? null)
    ctx.inject(copyNoticeCtx, opts.onCopyNotice ?? null)
    // A plain-text copy names each link as the note shows it, an ID link with its ID (YAZ-3744 S8).
    ctx.inject(copyLinkTextCtx, (text) => linksAsShown(text, wikilinks, viewOnlyLinks, true))
    // Copy as Markdown writes each `[[link]]` as a save does, never `\[\[link]]` (YAZ-3747).
    ctx.inject(copyMarkdownCtx, postProcessMarkdown)
  })
  // The note keys (YAZ-3564 K4): the user's changes for the app's keymaps, and Milkdown's keymap slices set from them,
  // before any keymap is read.
  crepe.editor.config((ctx) => {
    ctx.inject(noteHotkeysCtx, opts.hotkeys ?? {})
    applyNoteKeys(ctx)
    // YAZ-3695 D3: Delete at a line's start deletes the next character. Milkdown's `LiftFirstListItem` (a `joinBackward`)
    // keeps Backspace only, and `DowngradeHeading` (a heading one level BIGGER) loses both: the outliner's join (D6) owns
    // Backspace at a heading's start. `applyNoteKeys` leaves both entries alone: they are on no key row.
    ctx.update(listItemKeymap.key, (prev) => ({ ...prev, LiftFirstListItem: { ...prev.LiftFirstListItem, shortcuts: 'Backspace' } }))
    ctx.update(headingKeymap.key, (prev) => ({ ...prev, DowngradeHeading: { ...prev.DowngradeHeading, shortcuts: [] } }))
  })
  if (opts.image !== undefined) crepe.editor.use(createImageView(opts.image)).use(imageBoardKeys)
  // The line (YAZ-3164): its look and its length handle, on every editor — the line's style is in the schema.
  crepe.editor.use(lineView)
  crepe.editor.use(outlinePaste)
  // Read by `clipboardPaste`, like `imageOptionsCtx` (YAZ-3609); null when the host gave none.
  crepe.editor.config((ctx) => {
    ctx.inject(pathPasteCtx, opts.pathPaste ?? null)
  })
  crepe.editor.use(clipboardPaste)
  crepe.editor.use(relativeLinks)
  crepe.editor.use(clipboardCopyOut)
  crepe.editor.use(copyVisibleHotkey)
  crepe.editor.use(blockHandleGate)
  // YAZ-4800: a table that is a bullet's first block is no handle target of its own (the table's handle stood on the
  // bullet's dot and took its right-click). The handle goes to the bullet, left of the dot, as a code block's does; its
  // menu holds the bullet strip and the table's settings (`tableRows`). Crepe's own rule stays: nothing inside a table,
  // a quote or inline math.
  // Only where the handle is on: an editor built without it (a preview) has no `blockConfig` to set.
  // A statement, not `&&`: a config callback returns void (YAZ-4800, tsc).
  crepe.editor.config((ctx) => {
    if (!ctx.isInjected(blockConfig.key)) return
    ctx.set(blockConfig.key, {
      filterNodes: (pos, node) => {
        if (node.type.name === 'table' && pos.parent.type.name === 'list_item' && pos.index() === 0) return false
        for (let depth = pos.depth; depth > 0; depth--) if (['table', 'blockquote', 'math_inline'].includes(pos.node(depth).type.name)) return false
        return true
      },
    })
  })
  // YAZ-3727 D8, D9: Milkdown's list typing rules fire inside bullets and on Enter, and undo badly; ours
  // replace them (plain lines, a typed space, a clean undo). The toolbar's Numbered button (YAZ-3806 T2) is the click
  // path; Mod-Alt-7 and the slash-menu row stay absent. GFM's `[ ] ` rule reached past a table cell (YAZ-3818).
  void crepe.editor.remove([wrapInOrderedListInputRule, wrapInBulletListInputRule, gfmTaskListInputRule, ...orderedListKeymap])
  crepe.editor.use(listMarkerTyping).use(undoListMarker).use(wrapInTaskListInputRule)
  // Arrows while typing (YAZ-4273): `->` → `→` and the rest, off from Settings › Editor › Typing.
  crepe.editor.use(typingArrows).use(undoTypingArrow)
  // Enter keeps the text style (YAZ-3746 13AB): off in notes, on in drawing text boxes, from Settings › Editor › Typing.
  crepe.editor.use(enterKeepsStyle(opts.enterKeepsStyle ?? enterKeepsStyleInNotes))
  // The bullet's menu, top to bottom (YAZ-3646 D9): where it opens (Open in new tab), its kind (the toolbar's list
  // buttons and T in one strip, YAZ-3727 D13, D14), its children (Number children, when it has any), its
  // own numbered list as bullets with written numbers (YAZ-3727 D12),
  // then a line's pickers (YAZ-3164 D3), or a table's settings (YAZ-3767 D7). A new row joins its group.
  crepe.editor.use(createBlockHandleMenu((view, target, ctx) => [...openBulletRow(view, target, opts.zoom?.onOpen), ...turnIntoRows(view, target, ctx), ...numberChildrenRow(view, target, ctx), ...writtenNumbersRow(view, target, ctx), ...foldAllRows(view, target, ctx), ...lineRows(view, target, ctx), ...tableRows(view, target, ctx)]))
  crepe.editor.use(multiBlockDrag)
  // Before outlinerKeymap on purpose: both bind Enter at priority 100 and KeymapManager runs
  // equal priorities in addition order — an OPEN [[ picker takes Enter, closed falls through.
  crepe.editor.use(createWikilinkPickerKeymap(wikilinks, opts.wikilinkNav))
  // YAZ-1734, also before `outlinerKeymap`: ⇧↑/⇧↓ whole lines; ⌫/Delete/Enter over a fold-spanning
  // range first delete the visible pieces (Enter re-presses itself, D7). The outliner's
  // Backspace/Enter require an empty selection, so nothing else moves.
  crepe.editor.use(lineKeymap)
  crepe.editor.use(outlinerKeymap)
  // YAZ-3695 D7: the outliner's Backspace puts no space in a join right after an Enter; this DOM keydown handler tells it.
  crepe.editor.use(enterTracker)
  // YAZ-3695 (11): after an edit, a caret in a folded line opens the folds that hide it. Before it: ⌘Z / ⌘⇧Z close and
  // open again the folds an edit opened (YAZ-3781), so the guard sees the folds as ⌘Z left them.
  crepe.editor.use(foldHistory).use(caretReveal)
  // The document-wide coordinator runs first: it owns Mod-Shift-U/I and consumes Mod-z only when
  // BOTH fold plugins are pending from that one atomic gesture. Individual heading/bullet folds
  // fall through to their existing undo handlers; foreign view actions still clear stale pending
  // state through viewActions.ts. Mod-ArrowUp/Down remains order-independent: the bullet handler
  // consumes only inside list items, and the heading handler declines there.
  crepe.editor.use(foldAllHotkeys)
  crepe.editor.use(foldsChanged)
  crepe.editor.use(headingHotkeys)
  crepe.editor.use(obsidianHotkeys)
  // YAZ-4800 demo: ⌘↵ / ⌘⇧↵ in a table add a line below / above it (priority 200, above the ⌘↵ above); the code block's
  // keys find their editor through `addLineViews`.
  crepe.editor.use(addLineKeymap).use(addLineViews)
  crepe.editor.use(escapeToSidebar)
  crepe.editor.use(zoomKeymap)
  // YAZ-1734 D3: a list_item left without its own paragraph (its line deleted) yields its children one level up, whatever path produced it.
  crepe.editor.use(liftHeadlessItems)
  // YAZ-1734 D6: typing over a selection that spans folded lines replaces only the visible pieces.
  crepe.editor.use(visibleTypeOver)
  if (opts.onMarkdownUpdated) {
    const cb = opts.onMarkdownUpdated
    crepe.on((listener) => {
      listener.markdownUpdated((ctx, markdown, prev) => {
        // Compared as it would be SAVED. Crepe's trailing empty paragraph (added on start-up to any
        // document ending in a list) differs raw but vanishes in `postProcessMarkdown`, and an
        // update the file would not notice is not an update (YAZ-968's save-path contract). An empty
        // cell note is left out, as `getMarkdownForSave` leaves it out (YAZ-3818 D15).
        const next = postProcessMarkdown(savedMarkdown(ctx) ?? markdown)
        if (next !== postProcessMarkdown(prev)) cb(next)
      })
    })
    // A board window's view write (YAZ-4820 D4) is outside undo (`addToHistory: false`), and Milkdown's listener skips
    // every such transaction, so it would never be saved. This plugin saves exactly those, debounced as the listener is.
    crepe.editor.use(
      $prose((ctx) => {
        const key = new PluginKey<number>('mdapp-board-view-save')
        return new Plugin({
          key,
          // A new note card's ID (YAZ-4961) is such a write too: out of undo, so ⌘Z removes the card in one step.
          state: { init: () => 0, apply: (tr, n) => (tr.docChanged && (tr.getMeta(BOARD_VIEW_META) === true || tr.getMeta(NOTE_CARD_ID_META) === true) ? n + 1 : n) },
          view: () => {
            let timer: ReturnType<typeof setTimeout> | undefined
            return {
              update: (view, prev) => {
                if (key.getState(view.state) === key.getState(prev)) return
                clearTimeout(timer)
                timer = setTimeout(() => cb(postProcessMarkdown(savedMarkdown(ctx) ?? ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc))), 200)
              },
              destroy: () => clearTimeout(timer),
            }
          },
        })
      }),
    )
  }
  return crepe
}

/** What the note cards of one editor read (YAZ-4961): the editor's own link sources, follower, images and doors. */
function noteCardDeps(opts: CreateCrepeOptions, wikilinks: WikilinkResolveSource, viewOnly: ViewOnlyLinkSource, follow: LinkFollow | undefined): NoteCardDeps {
  const image = opts.image
  const nav = opts.markdownLinkNav
  const look: NoteCardLook = {
    link: (inner) => {
      const path = linkPath(inner, wikilinks, viewOnly)
      return {
        label: linksAsShown(`[[${inner}]]`, wikilinks, viewOnly),
        resolved: linkIsResolved(inner, wikilinks, viewOnly),
        attrs: path === null || opts.linkLook === undefined ? undefined : opts.linkLook.icon(path, fileKind(basename(path)) === null),
      }
    },
    image: image === undefined ? undefined : (src) => imageSrc(image.root, noteDirRel(image.root, image.notePath), src),
  }
  return {
    host: opts.noteCards,
    path: image?.notePath ?? null,
    look: () => look,
    subscribe: (listener) => wikilinks.subscribe(listener),
    follow,
    hotkeys: () => opts.wikilinkNav?.hotkeys?.(),
    openHref:
      nav === undefined
        ? undefined
        : (href) => {
            const path = nav.inApp?.(href) ?? null
            if (path !== null && nav.openPath !== undefined) nav.openPath(path, 'explore')
            else void nav.open(href)
          },
    onNotice: opts.wikilinkNav?.onNotice ?? nav?.onNotice,
  }
}

/**
 * The doc's Markdown without each empty cell note and its mark (YAZ-3818 D15, `withoutEmptyCellNotes`), or null when
 * the doc has none: then the editor's own serialization is the save.
 */
const savedMarkdown = (ctx: Ctx): string | null => {
  const { state } = ctx.get(editorViewCtx)
  const doc = withoutEmptyCellNotes(state)
  return doc === state.doc ? null : ctx.get(serializerCtx)(doc)
}

/**
 * Markdown as it should be written to disk (frontmatter is added by the caller). An empty cell note stays out of it,
 * so it never reaches the file, by whatever route its page closes (YAZ-3818 D15, 5A-5). A board window's view that
 * still waits for its 800 ms write is written first (YAZ-4834 A8): every save flush (close, quit, rename) reads here.
 */
export function getMarkdownForSave(crepe: Crepe): string {
  const saved = crepe.editor.action((ctx) => {
    flushBoardWindows(ctx.get(editorViewCtx))
    return savedMarkdown(ctx)
  })
  return postProcessMarkdown(saved ?? crepe.getMarkdown())
}

/**
 * Replace the whole document in an existing instance: the mount-time rename buffer, and
 * `applyExternalMarkdown`'s fallback for a whole-document rewrite (YAZ-1347 — a live external
 * edit applies as a diff transaction instead, so folds and caret survive by position mapping).
 * Uses `flush` (fresh EditorState, so no `markdownUpdated` fires and history is
 * reset) but keeps focus and the caret position so the user is not kicked out.
 */
export function setMarkdown(crepe: Crepe, markdown: string): void {
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const hadFocus = view.hasFocus()
    const { from } = view.state.selection
    replaceAll(normalizeEmptyItems(markdown), true)(ctx)
    const doc = view.state.doc
    const sel = Selection.near(doc.resolve(Math.min(from, doc.content.size)))
    view.dispatch(view.state.tr.setSelection(sel))
    if (hadFocus) view.focus()
  })
}

/** The note's ProseMirror view, for what lives beside the editor and acts on it: the note's right-click menu (YAZ-3653). */
export const editorViewOf = (crepe: Crepe): EditorView => crepe.editor.action((ctx) => ctx.get(editorViewCtx))

/** Move keyboard focus into the document (e.g. right after opening a file from the sidebar). */
export function focusEditor(crepe: Crepe): void {
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    // Sent into the page with no click (a tab open, a wikilink, Esc from the table of contents): it has the keys (YAZ-3145).
    claimPage(view.dom)
    view.focus()
  })
}

/**
 * A page that starts drilled in (YAZ-2951 D1) has its caret in a hidden block: move it into the
 * bullet. Run once the editor is made; true when the caret moved.
 */
export function moveCaretIntoZoom(crepe: Crepe): boolean {
  return crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    return caretIntoZoom(view.state, view.dispatch)
  })
}

/**
 * The caret a page view kept (YAZ-3737 D3): a woken tab, a copy. Cut to the document, which may have changed on disk
 * meanwhile (S24), and moved to the nearest places text can go. Run once the editor is made, before the caret grab.
 * Crepe's list-item views put back, one frame after they mount, the caret the new editor had then: its start (the
 * pinned `@milkdown/components` restore, YAZ-2131 4B). So the caret goes there again on the next frame (YAZ-3926).
 */
export function placeCaret(crepe: Crepe, at: { anchor: number; head: number }): void {
  const view = editorViewOf(crepe)
  const place = () => {
    const { doc } = view.state
    const pos = (n: number) => doc.resolve(Math.max(0, Math.min(n, doc.content.size)))
    view.dispatch(view.state.tr.setSelection(TextSelection.between(pos(at.anchor), pos(at.head))))
  }
  place()
  requestAnimationFrame(() => {
    if (!view.isDestroyed) place()
  })
}

/** The note's caret, for its page view (YAZ-3737 D3). */
export function getCaretOf(crepe: Crepe): { anchor: number; head: number } {
  const { anchor, head } = editorViewOf(crepe).state.selection
  return { anchor, head }
}

/** The drilled-in bullet's zoom key, or null (YAZ-2951 D4): the page view reader asks once, on a copy action. */
export function getZoomKeyOf(crepe: Crepe): string | null {
  return crepe.editor.action((ctx) => getZoomKey(ctx.get(editorViewCtx).state))
}

/** The drilled-in bullet's crumb text, or null (YAZ-3647 E3): what the tab's Back list menu and tooltip show for it. */
export function getZoomLabelOf(crepe: Crepe): string | null {
  return crepe.editor.action((ctx) => getZoomLabel(ctx.get(editorViewCtx).state))
}

/** Back and Forward (YAZ-3647 D2): the page goes to its tab's level, quietly; false when it is there already. */
export function zoomPageTo(crepe: Crepe, key: string | null): boolean {
  return crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    return zoomToKey(key)(view.state, view.dispatch)
  })
}

/**
 * The document's plain text, one block per line: what the page settings menu counts (YAZ-2643).
 * No break at the end: the empty paragraph Crepe keeps under a last bullet, heading, code block or
 * table is no text, and the count must not move when it appears.
 */
export function getPlainText(crepe: Crepe): string {
  return crepe.editor.action((ctx) => {
    const { doc } = ctx.get(editorViewCtx).state
    return doc.textBetween(0, doc.content.size, '\n').replace(/\n+$/, '')
  })
}

/**
 * A code span on one line: a run of backticks up to the next run of the same length. A backtick
 * that the user typed as text is not one: remark writes it with a backslash, so the opening run
 * has an even count of backslashes before it.
 */
const CODE_SPAN = /(?<=(?:^|[^\\])(?:\\\\)*)(`+)(?!`).*?(?<!`)\1(?!`)/g

/**
 * remark's escapes come off a wikilink, so the link keeps its bytes: `\[\[` is `[[` again, and the
 * `\=` that rule 31's escape puts inside a target is `=` again (a target is plain text to remark,
 * so `[[A == B]]` would be `[[A \=\= B]]` and break the link).
 */
const restoreWikilinkText = (text: string): string =>
  text.replace(/(!?)\\\[\\\[/g, '$1[[').replace(/\[\[[^\]]*\]\]/g, (link) => link.replace(/\\=/g, '='))

/**
 * One line outside a fence, on its way to the file. The wikilink rule never works inside a code
 * span: remark escapes nothing there, so a backslash in code is the user's own. Most lines have no
 * work: every save rule needs a backslash, or the `<br />` that ends an empty task.
 */
const restoreLine = (line: string): string => {
  const escaped = line.includes('\\')
  if (!escaped && !line.endsWith('<br />')) return line
  if (!escaped || !line.includes('`')) return restoreItemLine(restoreWikilinkText(line))
  let out = ''
  let from = 0
  for (const span of line.matchAll(CODE_SPAN)) {
    out += restoreWikilinkText(line.slice(from, span.index)) + span[0]
    from = span.index + span[0].length
  }
  return restoreItemLine(out + restoreWikilinkText(line.slice(from)))
}

export function postProcessMarkdown(md: string): string {
  return (
    mapOutsideFences(md, restoreLine)
      // Crepe's trailing plugin keeps an empty paragraph after a final heading/list/code
      // block; remark would serialise it as an extra blank line. Contract: single final \n.
      .replace(/\n{2,}$/, '\n')
  )
}
