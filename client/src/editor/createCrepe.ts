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
 *    its stringify escape. Green/blue/pink are click-only and store inline HTML
 *    `<mark class="highlight-<name>">`, read back through the shared `marks/htmlPairs.ts` walk.
 *    Four toolbar swatches after Strikethrough; one click applies, re-clicking the lit one removes.
 *  - Inline breaks (YAZ-1452, `inlineBreaks.ts`): inline `<br>` ↔ hardbreak, registered BEFORE
 *    Milkdown's `remarkPreserveEmptyLinePlugin` (which otherwise deletes it); table cells save
 *    a hardbreak back as `<br>`, and Shift-Enter inside a cell always inserts one. A `<br>` at a
 *    line end, or on a line of its own, is ONE break with the line ending beside it.
 *  - Marks on line breaks (YAZ-2280, `breakMarks.ts`): replaces Milkdown's `hardbreakClearMarkPlugin`;
 *    a mark runs through a soft break, never starts or ends on one, and never sits on a hard break.
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
 *    change, round-trip byte-identical.
 *  - Wikilink click navigation (GRO-2192, `wikilink/wikilinkClick.ts`): MOUSEDOWN on a
 *    collapsed `.wikilink` span navigates (plain → current tab, ⌘ → background tab,
 *    unresolved → create-then-open via `createFromLink`) and preventDefaults so the caret
 *    never lands in the match (no raw-text flash); revealed raw text stays editable.
 *    Registered only when `opts.wikilinkNav` provides the handlers.
 *  - Wikilink hover (YAZ-3403, `wikilink/wikilinkHover.ts`): the pointer on a resolved `.wikilink` span tells the
 *    host which page it opens, for the hover panel. Registered only when `opts.wikilinkHover` is passed: the
 *    note editor's, never a read-only preview's.
 *  - Link menu (YAZ-2293, YAZ-3609 D23, `wikilink/wikilinkMenu.ts`): right-click on a rendered
 *    `[[link]]` shows the one link menu (`linkMenu.ts`): its name and id, Open, Open in new tab,
 *    Copy link, Copy ID, Edit link, Remove link. Registered with the click plugin, on the same
 *    source, nav and follow.
 *  - Wikilink picker (GRO-2191, `wikilink/wikilinkPicker.ts`): typing `[[` opens the vault-wide
 *    suggestion popup (candidates via `opts.wikilinkCandidates`); Enter/click inserts plain
 *    `[[name]]` text — and the Create row also makes the page through `opts.wikilinkNav`
 *    (YAZ-1357). Its keymap MUST be `use`d before `outlinerKeymap`: both bind Enter at
 *    priority 100 and equal priorities run in addition order — the picker wins while open and
 *    declines (falls through) while closed.
 *  - Standard Markdown links (YAZ-1309, `markdownLink.ts`): a primary mousedown opens before caret
 *    placement — a link into a vault of the window in a tab (⌘: a background tab, YAZ-3609 D8, D14),
 *    anything else through the host — and such a link draws as a pill (D19); right-click shows the
 *    one link menu (D23, `linkMenu.ts`). Edit/remove
 *    reuse Crepe's link-tooltip API, including one logical range when formatting splits the DOM
 *    anchor. Registered only when `opts.markdownLinkNav` supplies the host boundary.
 *  - Block handle menu (YAZ-726, `blockHandleMenu.ts`): right-click on the 6-dot handle opens a
 *    `.ctx-menu` popup; rows (or picker rows, YAZ-3164) are data from a provider;
 *    capture-suppresses Crepe's right-button mousedown/mouseup so the selection/focus don't jump.
 *    First row: Number children ↔ Bullet children (YAZ-729, `outline/numberChildrenRow.ts`),
 *    disabled when the item has no direct child list.
 *  - Numbers are manual-only (YAZ-793/YAZ-1329): right-click Number children and the toolbar's
 *    Numbered button (YAZ-3806 T2) are the only editor conversion commands. The `1. ` input
 *    rule, `Mod-Alt-7` keymap and slash-menu Ordered List row are removed; real ordered Markdown
 *    still parses, and `* 6) text` stays literal bullet text.
 *  - Drawing slash item (YAZ-877, `drawingMenu.ts`): rides Crepe's OWN BlockEdit menu via
 *    `featureConfigs[BlockEdit].buildMenu` — never a parallel slash plugin. Registered only when
 *    `opts.drawing` supplies the creator; the shared config always omits Ordered List.
 *  - The slash menu in a list item and "Current time" (YAZ-3550, `slashMenu.ts`; YAZ-3511 D21, D22):
 *    the patched Crepe (`client/vendor/milkdown-crepe-7.22.1-yaz3550.*`) opens the menu in a
 *    bullet too and filters by a row's `keywords`; Divider and Bullet List are hidden there.
 *    "Current time" (`h:mmam - `, plain text) ends the Text group on every editor.
 *  - Drawing previews (YAZ-878, `drawing/drawingPreview.ts`): `![[x.excalidraw]]` renders as the
 *    scene through inline decorations only (the match's text hidden, a widget in its place,
 *    caret-inside reveals the raw syntax) — never a schema or serializer change. Registered only
 *    when `opts.drawingPreview` gives it the vault root; every other embed is untouched.
 *  - CMD+F find (YAZ-968, `find/findInPage.ts`): matches + highlight decorations + fold-reveal,
 *    driven through the `FindChannel` the host also gives the find bar. Registered only when
 *    `opts.find` supplies that channel; every transaction it makes is metadata-only.
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
 *    Normal external paste keeps number labels literal (YAZ-1429); explicit Markdown and
 *    app-identified rich clipboard slices retain intentional ordered lists.
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
 */
import { Crepe, CrepeFeature } from './crepe'
import { EditorView as CodeMirrorView } from '@codemirror/view'
import type { EditorView } from '@milkdown/kit/prose/view'
import { codeTheme } from './codeTheme'
import { keymapRef, type ToolbarItem } from '@milkdown/crepe/feature/toolbar'
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import {
  hardbreakClearMarkPlugin,
  orderedListKeymap,
  remarkPreserveEmptyLinePlugin,
  turnIntoTextCommand,
  wrapInHeadingCommand,
  wrapInOrderedListInputRule,
} from '@milkdown/kit/preset/commonmark'
import { extendListItemSchemaForTask } from '@milkdown/kit/preset/gfm'
import { type Command, Selection } from '@milkdown/kit/prose/state'
import { $shortcut, replaceAll } from '@milkdown/kit/utils'
import { blockHandleGate } from './blockHandleGate'
import { readOnlyKeys } from './readOnlyKeys'
import { createBlockHandleMenu } from './blockHandleMenu'
import { breakMarks } from './breakMarks'
import { createDrawingPreview, type DrawingPreviewOptions } from './drawing/drawingPreview'
import { drawingMenu, type DrawingCreator } from './drawingMenu'
import { createSlashMenu } from './slashMenu'
import { imageOptionsCtx, type ImageOptions } from './image/imageOptions'
import { createImageView } from './image/imageView'
import type { FindChannel } from './find/findChannel'
import { createFindInPage } from './find/findInPage'
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
import { highlight, highlightKeymap, highlightSchema, rangeHasHighlight, setHighlightCommand, HIGHLIGHT_COLORS, type HighlightColor } from './marks/highlight'
import { allLinesAre, LIST_KINDS, listButtons, toggleListKind } from './listButtons'
import { noteCrepeIcons, ownIcon, TOOLBAR_GROUP_LABELS, TOOLBAR_LABELS } from './toolbarButtons'
import { arrangeToolbar, toolbarPrefs } from './toolbarPrefs'
import { inlineBreaks } from './inlineBreaks'
import { lineStyle } from './line/lineStyle'
import { lineView } from './line/lineView'
import { lineRows } from './line/lineRows'
import { liftHeadlessItems, lineKeymap, visibleRangeHasMark, visibleTypeOver } from './lineSelection'
import { visibleFormatting } from './visibleFormatting'
import { codeLines } from './lineNumbers/codeLines'
import { lineNumbers } from './lineNumbers/lineNumbers'
import { multiBlockDrag } from './multiBlockDrag'
import { outlinePaste } from './outlinePaste'
import { clipboardCopyOut, copyNoticeCtx, copyVisibleHotkey } from './clipboardCopyOut'
import { clipboardPaste } from './clipboardPaste'
import { pathPasteCtx, relativeLinks, type PathPasteOptions } from './pathPaste'
import { guideLines } from './outline/guideLines'
import { numberChildrenRow } from './outline/numberChildrenRow'
import { createHeadingFolding, type HeadingFoldingOptions } from './outline/headingFolding'
import { headingHotkeys } from './outline/headingHotkeys'
import { headingLevelTag } from './outline/headingLevelTag'
import { headingText } from './outline/headingText'
import { foldAllHotkeys } from './outline/foldAllHotkeys'
import { obsidianHotkeys } from './outline/hotkeys'
import { outlinerKeymap } from './outline/listCommands'
import { createOutlineFolding, type OutlineFoldingOptions } from './outline/outlineFolding'
import { caretIntoZoom, createOutlineZoom, getZoomKey, getZoomLabel, zoomKeymap, zoomToKey, type ZoomOptions } from './outline/zoom'
import { openBulletRow } from './outline/openBulletRow'
import { focusSidebar } from '../lib/focusHandoff'
import { createWikilinkClick, wikilinkFollower, type WikilinkNav } from './wikilink/wikilinkClick'
import { createWikilinkHover, type WikilinkHover } from './wikilink/wikilinkHover'
import { createWikilinkMenu } from './wikilink/wikilinkMenu'
import { createWikilinkPicker, createWikilinkCandidateSource, createWikilinkPickerKeymap, type WikilinkCandidateSource } from './wikilink/wikilinkPicker'
import { createWikilink, createWikilinkResolveSource, type LinkLook, type WikilinkResolveSource } from './wikilink/wikilinkPlugin'
import { createMarkdownLink, type MarkdownLinkNav } from './markdownLink'
import { createViewOnlyLinkSource, type ViewOnlyLinkSource } from './wikilink/viewOnlyLinkSource'
import { claimPage } from '../lib/readOnlyCaret'
import { toDisplay, type HotkeyOverrides } from '@shared/hotkeyBindings'
import { keyRow, keysOf } from '@shared/keys'
import { applyNoteKeys, noteHotkeysCtx } from './noteKeys'

export interface CreateCrepeOptions {
  root: HTMLElement
  defaultValue?: string
  /** Called whenever the document changes (Crepe's listener debounces this ~200ms). */
  onMarkdownUpdated?: (markdown: string) => void
  /** Fold state for collapsible parent bullets: restore from / report to the caller (persisted per file). */
  folding?: OutlineFoldingOptions
  /** Fold state for collapsible heading sections (YAZ-1140): same contract as `folding`, its own `h:`-prefixed key space. */
  headingFolding?: HeadingFoldingOptions
  /** Zoom into a bullet (GRO-2029); `title` is the root breadcrumb. Defaults to an unnamed file. */
  zoom?: ZoomOptions
  /** CMD+F channel (YAZ-968): the host's one channel per mount, shared with the find bar. Absent → no find engine at all. */
  find?: FindChannel
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
  /** Wikilink hover (YAZ-3403): the host's hover panel hears which page a resolved link opens. Absent → the hover plugin is not registered. */
  wikilinkHover?: WikilinkHover
  /** Standard Markdown link actions (YAZ-1309, YAZ-3609): a click opens (in a tab for a vault of the window), a pill look, the one link menu. Absent → Crepe's stock behavior. */
  markdownLinkNav?: MarkdownLinkNav
  /** Paste a path, get a link (YAZ-3609). Absent → a pasted path stays text. */
  pathPaste?: PathPasteOptions
  /** Drawing creator (YAZ-877): the host writes the sidecar, the item inserts the embed. Absent → NO Drawing row is added to the slash menu. */
  drawing?: DrawingCreator
  /** Drawing previews (YAZ-878): the vault root to read scenes against, plus the optional refresh feed and click handler. Absent → `.excalidraw` embeds stay plain text. */
  drawingPreview?: DrawingPreviewOptions
  /** First-class images (YAZ-1656): root + note path for src resolution, the lightbox opener, the paste notice. Absent → stock `<img>`, and pasted image bytes are not written. */
  image?: ImageOptions
  /**
   * Feature overrides for a NON-note instance (YAZ-901's bullets-only outline editor passes
   * `outlineFeatures`). The note editor passes none and gets `featureConfig.ts`'s allowlist
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
}

/** The slice of Crepe's GroupBuilder `buildToolbar` hands over — structural, since Crepe exports the item type but not the builder class. */
interface ToolbarGroup {
  addItem: (key: string, item: ToolbarItem & { onRun: (ctx: Ctx) => void }) => unknown
}
interface ToolbarBuilder {
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
 * Underline, Strikethrough, the four swatches), then Crepe's code and link. The user reorders and
 * hides groups and buttons in Settings (`toolbarPrefs.ts`); the tab order is the strip's order.
 *
 * The four highlight swatches (YAZ-1480 — yellow, green, blue, pink) join Crepe's OWN Formatting
 * group right after Strikethrough: `getGroup('formatting')` reaches it because `buildToolbar`
 * runs AFTER Crepe has added that group. Bold's toggle semantics (🔒 D5): a dot is lit when ANY of
 * the selection carries its colour, so a partly highlighted line still shows it; clicking a lit dot
 * removes that colour, an unlit one applies it — through the mark's single command, which
 * `Mod-Shift-h` (yellow) and the `==x==` typing rule share. Yellow is the Markdown `==…==` on
 * disk; a colour is `<mark class="highlight-<name>">`.
 *
 * The Heading group (YAZ-923): H1/H2/H3/T buttons whose ACTIVE state answers "what block is
 * this?" — the invisible `##` made visible — and whose click switches it, through the same
 * commands the typed markdown runs. `T` is the way back to plain text without backspacing hashes
 * you cannot see, and out of a list too (YAZ-3806 T4): it lights only for plain text outside a list.
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
function buildToolbar(builder: ToolbarBuilder, hotkeys: HotkeyOverrides | undefined): void {
  const formatting = builder.getGroup('formatting')
  for (const color of [null, ...HIGHLIGHT_COLORS] as HighlightColor[]) {
    const id = color === null ? 'highlight' : (`highlight-${color}` as const)
    formatting.addItem(id, {
      icon: ownIcon(id),
      label: TOOLBAR_LABELS[id],
      ...(color === null ? { keymap: keymapRef(highlightKeymap.key, 'ToggleHighlight') } : {}),
      active: (ctx) => rangeHasHighlight(ctx.get(editorViewCtx).state, highlightSchema.type(ctx), color),
      onRun: (ctx) => ctx.get(commandsCtx).call(setHighlightCommand.key, color),
    })
  }
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
  // The default order leads with the Heading group (YAZ-2700): the toolbar opens over the start of
  // the selection, so its first buttons are the ones under the hand after a double click.
  const groups = builder.build()
  noteCrepeIcons(groups)
  arrangeToolbar(groups, toolbarPrefs.value)
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
  const slashMenu = createSlashMenu(opts.drawing === undefined ? undefined : drawingMenu(opts.drawing))
  const crepe = new Crepe({
    root: opts.root,
    defaultValue: normalizeEmptyItems(opts.defaultValue ?? ''),
    features: { ...features, ...opts.features },
    featureConfigs: {
      // Crepe feature customisation #1 (YAZ-1329/YAZ-877): Number children is the only editor
      // command that creates ordered children, so the stock Ordered List row is absent. Drawing
      // still composes into this same BlockEdit config when the host supplies a creator, after
      // Current time and before the list rule (YAZ-3550, `slashMenu.ts`).
      [CrepeFeature.BlockEdit]: {
        listGroup: { orderedList: null },
        buildMenu: slashMenu.buildMenu,
      },
      // #2 (YAZ-923): the selection toolbar SAYS the block's level — a Heading group whose
      // active button is the answer to "what is this?", and whose click is the switch. The
      // markdown stays the source of truth; these call the same commands typing `##` does.
      // YAZ-1480 adds Highlight into Crepe's own Formatting group from the same builder.
      [CrepeFeature.Toolbar]: { buildToolbar: (builder) => buildToolbar(builder, opts.hotkeys) },
      // Native text carets track document zoom without a second painted overlay.
      [CrepeFeature.Cursor]: { virtual: false },
      // YAZ-2270: long lines wrap like prose instead of scrolling sideways, and colours come from
      // app.css `--code-*` so they follow Appearance (codeTheme.ts replaces Crepe's One Dark).
      // `codeLines` (YAZ-2643 D8): a code block's own line numbers are lines of the file while the numbers show.
      [CrepeFeature.CodeMirror]: { theme: codeTheme, extensions: [CodeMirrorView.lineWrapping, codeLines] },
    },
  })
  crepe.editor.use(
    // NB: extend the GFM task-item schema, not the commonmark base — extendSchema()
    // always derives from the ORIGINAL schema, so extending listItemSchema directly
    // would silently drop task-list checkbox support.
    extendListItemSchemaForTask.extendSchema((prev) => (ctx) => ({ ...prev(ctx), content: 'block+' })),
  )
  crepe.editor.use(listItemRoundTrip)
  // The slash menu's "in a list" flag (YAZ-3550): which stock rows a list item hides.
  crepe.editor.use(slashMenu.inListWatch)
  crepe.editor.use(underline)
  crepe.editor.use(highlight)
  // The line's darkness, thickness, style and length (YAZ-3164): `***` + the `<!-- line: … -->` comment.
  crepe.editor.use(lineStyle)
  // YAZ-3209: over hidden lines, Bold, Italic, Strikethrough, code and H1-H3 / T change the visible
  // ones only, and the toolbar lights for visible lines only. After the presets, by `EditorViewReady`.
  crepe.editor.use(visibleFormatting)
  // T / ⌘⌥0 out of every list level, ⌘⌥8 = the Bullet button (YAZ-3806 T3, T4). After visibleFormatting: it replaces T.
  crepe.editor.use(listButtons)
  // Milkdown's empty-line plugin deletes every inline <br> on parse (YAZ-1452). Ours must run
  // first; re-registering Milkdown's AFTER keeps its id resolvable so empty paragraphs still
  // serialise as `<br />`.
  void crepe.editor.remove(remarkPreserveEmptyLinePlugin)
  crepe.editor.use(inlineBreaks).use(remarkPreserveEmptyLinePlugin)
  // Milkdown's break plugin turns soft breaks hard under any new mark (YAZ-2280); ours replaces it.
  void crepe.editor.remove(hardbreakClearMarkPlugin)
  crepe.editor.use(breakMarks)
  crepe.editor.use(createOutlineFolding(opts.folding))
  crepe.editor.use(createHeadingFolding(opts.headingFolding))
  crepe.editor.use(headingLevelTag)
  crepe.editor.use(headingText)
  if (opts.find !== undefined) crepe.editor.use(createFindInPage(opts.find))
  if (opts.toc !== undefined) crepe.editor.use(createTableOfContents(opts.toc))
  crepe.editor.use(createOutlineZoom(opts.zoom ?? { title: () => 'Untitled' }))
  crepe.editor.use(guideLines)
  crepe.editor.use(bulletThreading)
  crepe.editor.use(sectionIndent)
  crepe.editor.use(lineNumbers)
  // A read-only NOTE's keyboard (YAZ-3125, YAZ-3127): the note editor only, never a preview.
  if (opts.readOnlyKeys === true) crepe.editor.use(readOnlyKeys)
  // ONE resolve source instance feeds both the decorations and the click plugin's routing.
  const wikilinks = opts.wikilinks ?? createWikilinkResolveSource()
  // A missing catalog must stay passive: recognized non-Markdown targets can never fall through
  // to Markdown creation, including in isolated createCrepe consumers outside App.
  const viewOnlyLinks = opts.viewOnlyLinks ?? createViewOnlyLinkSource()
  crepe.editor.use(createWikilink(wikilinks, viewOnlyLinks, opts.linkLook))
  if (opts.wikilinkNav !== undefined) {
    // A click and the link menu's Open rows follow a link the same way (YAZ-3609 D23).
    const follow = wikilinkFollower(wikilinks, opts.wikilinkNav, viewOnlyLinks)
    crepe.editor.use(createWikilinkClick(follow)).use(createWikilinkMenu(wikilinks, opts.wikilinkNav, follow))
  }
  if (opts.wikilinkHover !== undefined) crepe.editor.use(createWikilinkHover(wikilinks, opts.wikilinkHover, viewOnlyLinks))
  if (opts.markdownLinkNav !== undefined) crepe.editor.use(createMarkdownLink(opts.markdownLinkNav))
  crepe.editor.use(createWikilinkPicker(opts.wikilinkCandidates ?? createWikilinkCandidateSource(), wikilinks, opts.wikilinkNav))
  if (opts.drawingPreview !== undefined) crepe.editor.use(createDrawingPreview(opts.drawingPreview))
  // Images (YAZ-1656): the node view takes the options directly; the ctx slice carries the SAME
  // object to `clipboardPaste`, which has no constructor of its own. Injected on every editor (null
  // when the host gave none) so the paste handler can always read it and simply decline.
  crepe.editor.config((ctx) => {
    ctx.inject(imageOptionsCtx, opts.image ?? null)
    ctx.inject(copyNoticeCtx, opts.onCopyNotice ?? null)
  })
  // The note keys (YAZ-3564 K4): the user's changes for the app's keymaps, and Milkdown's keymap slices set from them,
  // before any keymap is read.
  crepe.editor.config((ctx) => {
    ctx.inject(noteHotkeysCtx, opts.hotkeys ?? {})
    applyNoteKeys(ctx)
  })
  if (opts.image !== undefined) crepe.editor.use(createImageView(opts.image))
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
  // Numbers are manual-only (YAZ-793/YAZ-1329): only a deliberate act makes them, the block-handle
  // command or the toolbar's Numbered button (YAZ-3806 T2). Typing, slash-menu and keyboard
  // conversion paths are all absent.
  void crepe.editor.remove([wrapInOrderedListInputRule, ...orderedListKeymap])
  // The bullet's menu, top to bottom (YAZ-3646 D9): where it opens (Open in new tab), its children (Number children),
  // then a line's pickers (YAZ-3164 D3). A new row joins its group.
  crepe.editor.use(createBlockHandleMenu((view, target, ctx) => [...openBulletRow(view, target, opts.zoom?.onOpen), ...numberChildrenRow(view, target, ctx), ...lineRows(view, target, ctx)]))
  crepe.editor.use(multiBlockDrag)
  // Before outlinerKeymap on purpose: both bind Enter at priority 100 and KeymapManager runs
  // equal priorities in addition order — an OPEN [[ picker takes Enter, closed falls through.
  crepe.editor.use(createWikilinkPickerKeymap(wikilinks, opts.wikilinkNav))
  // YAZ-1734, also before `outlinerKeymap`: ⇧↑/⇧↓ whole lines; ⌫/Delete/Enter over a fold-spanning
  // range first delete the visible pieces (Enter re-presses itself, D7). The outliner's
  // Backspace/Enter require an empty selection, so nothing else moves.
  crepe.editor.use(lineKeymap)
  crepe.editor.use(outlinerKeymap)
  // The document-wide coordinator runs first: it owns Mod-Shift-U/I and consumes Mod-z only when
  // BOTH fold plugins are pending from that one atomic gesture. Individual heading/bullet folds
  // fall through to their existing undo handlers; foreign view actions still clear stale pending
  // state through viewActions.ts. Mod-ArrowUp/Down remains order-independent: the bullet handler
  // consumes only inside list items, and the heading handler declines there.
  crepe.editor.use(foldAllHotkeys)
  crepe.editor.use(headingHotkeys)
  crepe.editor.use(obsidianHotkeys)
  crepe.editor.use(escapeToSidebar)
  crepe.editor.use(zoomKeymap)
  // YAZ-1734 D3: a list_item left without its own paragraph (its line deleted) yields its children one level up, whatever path produced it.
  crepe.editor.use(liftHeadlessItems)
  // YAZ-1734 D6: typing over a selection that spans folded lines replaces only the visible pieces.
  crepe.editor.use(visibleTypeOver)
  if (opts.onMarkdownUpdated) {
    const cb = opts.onMarkdownUpdated
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown, prev) => {
        // Compared as it would be SAVED. Crepe's trailing empty paragraph (added on start-up to any
        // document ending in a list) differs raw but vanishes in `postProcessMarkdown`, and an
        // update the file would not notice is not an update (YAZ-968's save-path contract).
        const next = postProcessMarkdown(markdown)
        if (next !== postProcessMarkdown(prev)) cb(next)
      })
    })
  }
  return crepe
}

/** Markdown as it should be written to disk (frontmatter is added by the caller). */
export function getMarkdownForSave(crepe: Crepe): string {
  return postProcessMarkdown(crepe.getMarkdown())
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
