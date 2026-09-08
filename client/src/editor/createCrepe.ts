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
 *  - Markdown out goes through `postProcessMarkdown()` which un-escapes
 *    `\[\[wikilink]]` / `!\[\[embed]]` that remark-stringify escapes.
 *  - Outline folding plugin (GRO-2011) registered via `$prose`; fold toggles are
 *    metadata-only transactions and never reach `markdownUpdated` / autosave.
 *  - Outliner keymap (GRO-2012, `outline/listCommands.ts`) patches the gaps in Crepe's
 *    Tab / Enter / Backspace list handling; registered with a higher keymap priority.
 *  - Empty list items round-trip as bare markers, never `* <br />` (GRO-2012,
 *    `listItemRoundTrip.ts`): `<br />` opened an HTML block that swallowed nested children.
 *    Empty task items are `* [ ]` on disk and `* [ ] <br />` inside Milkdown (GRO-2018).
 *  - Obsidian hotkeys (GRO-2027, `outline/hotkeys.ts` + `outline/foldAllHotkeys.ts`): Mod-Enter
 *    task cycle, Mod-Shift-u/i fold/unfold all bullets + headings, Mod-Shift-x strikethrough.
 *  - Underline mark (GRO-2028, `marks/underline.ts`): Mod-u ↔ `<u>text</u>` inline HTML.
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
 *    live-preview style via inline decorations only (brackets hidden, alias/heading display,
 *    caret-adjacency reveal, resolved/unresolved via `opts.wikilinks`) — never a schema or
 *    serializer change, round-trip byte-identical.
 *  - Wikilink click navigation (GRO-2192, `wikilink/wikilinkClick.ts`): MOUSEDOWN on a
 *    collapsed `.wikilink` span navigates (plain → current tab, ⌘ → background tab,
 *    unresolved → create-then-open via `createFromLink`) and preventDefaults so the caret
 *    never lands in the match (no raw-text flash); revealed raw text stays editable.
 *    Registered only when `opts.wikilinkNav` provides the handlers.
 *  - Wikilink picker (GRO-2191, `wikilink/wikilinkPicker.ts`): typing `[[` opens the vault-wide
 *    suggestion popup (candidates via `opts.wikilinkCandidates`); Enter/click inserts plain
 *    `[[name]]` text — and the Create row also makes the page through `opts.wikilinkNav`
 *    (YAZ-1357). Its keymap MUST be `use`d before `outlinerKeymap`: both bind Enter at
 *    priority 100 and equal priorities run in addition order — the picker wins while open and
 *    declines (falls through) while closed.
 *  - Standard Markdown links (YAZ-1309, `markdownLink.ts`): unmodified primary mousedown opens
 *    through the host before caret placement; right-click offers Edit/Copy/Remove. Edit/remove
 *    reuse Crepe's link-tooltip API, including one logical range when formatting splits the DOM
 *    anchor. Registered only when `opts.markdownLinkNav` supplies the host boundary.
 *  - Block handle menu (YAZ-726, `blockHandleMenu.ts`): right-click on the 6-dot handle opens a
 *    `.ctx-menu` popup; rows are data from a provider; capture-suppresses Crepe's right-button
 *    mousedown/mouseup so the selection/focus don't jump. First row: Number children ↔ Bullet
 *    children (YAZ-729, `outline/numberChildrenRow.ts`), disabled when the item has no direct
 *    child list.
 *  - Numbers are manual-only (YAZ-793/YAZ-1329): right-click Number children is the only editor
 *    conversion command. The `1. ` input rule, `Mod-Alt-7` keymap and slash-menu Ordered List row
 *    are removed; real ordered Markdown still parses, and `* 6) text` stays literal bullet text.
 *  - Drawing slash item (YAZ-877, `drawingMenu.ts`): rides Crepe's OWN BlockEdit menu via
 *    `featureConfigs[BlockEdit].buildMenu` — never a parallel slash plugin. Registered only when
 *    `opts.drawing` supplies the creator; the shared config always omits Ordered List.
 *  - Drawing previews (YAZ-878, `drawing/drawingPreview.ts`): `![[x.excalidraw]]` renders as the
 *    scene through inline decorations only (the match's text hidden, a widget in its place,
 *    caret-inside reveals the raw syntax) — never a schema or serializer change. Registered only
 *    when `opts.drawingPreview` gives it the vault root; every other embed is untouched.
 *  - CMD+F find (YAZ-968, `find/findInPage.ts`): matches + highlight decorations + fold-reveal,
 *    driven through the `FindChannel` the host also gives the find bar. Registered only when
 *    `opts.find` supplies that channel; every transaction it makes is metadata-only.
 *  - Heading folding (YAZ-1140, `outline/headingFolding.ts` + `.css`): an H1-H3 chevron collapses
 *    the heading's section — its following sibling blocks up to the next same-or-shallower heading
 *    — through widget + node decorations only; metadata-only transactions, markdown untouched.
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
 */
import { Crepe, CrepeFeature } from '@milkdown/crepe'
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import {
  orderedListKeymap,
  turnIntoTextCommand,
  wrapInHeadingCommand,
  wrapInOrderedListInputRule,
} from '@milkdown/kit/preset/commonmark'
import { extendListItemSchemaForTask } from '@milkdown/kit/preset/gfm'
import { Selection } from '@milkdown/kit/prose/state'
import { $shortcut, replaceAll } from '@milkdown/kit/utils'
import { blockHandleGate } from './blockHandleGate'
import { createBlockHandleMenu } from './blockHandleMenu'
import { createDrawingPreview, type DrawingPreviewOptions } from './drawing/drawingPreview'
import { drawingMenu, type DrawingCreator } from './drawingMenu'
import type { FindChannel } from './find/findChannel'
import { createFindInPage } from './find/findInPage'
import { bulletThreading } from './outline/bulletThreading'
import { features } from './featureConfig'
import {
  listItemRoundTrip,
  normalizeEmptyItems,
  restoreSameLineOrderedMarkers,
  stripEmptyTaskBreaks,
} from './listItemRoundTrip'
import { underline } from './marks/underline'
import { multiBlockDrag } from './multiBlockDrag'
import { outlinePaste } from './outlinePaste'
import { clipboardCopyOut } from './clipboardCopyOut'
import { clipboardPaste } from './clipboardPaste'
import { guideLines } from './outline/guideLines'
import { numberChildrenRow } from './outline/numberChildrenRow'
import { createHeadingFolding, type HeadingFoldingOptions } from './outline/headingFolding'
import { headingHotkeys } from './outline/headingHotkeys'
import { foldAllHotkeys } from './outline/foldAllHotkeys'
import { obsidianHotkeys } from './outline/hotkeys'
import { outlinerKeymap } from './outline/listCommands'
import { createOutlineFolding, type OutlineFoldingOptions } from './outline/outlineFolding'
import { createOutlineZoom, zoomKeymap, type ZoomOptions } from './outline/zoom'
import { focusSidebar } from '../lib/focusHandoff'
import { createWikilinkClick, type WikilinkNav } from './wikilink/wikilinkClick'
import { createWikilinkPicker, createWikilinkCandidateSource, createWikilinkPickerKeymap, type WikilinkCandidateSource } from './wikilink/wikilinkPicker'
import { createWikilink, createWikilinkResolveSource, type WikilinkResolveSource } from './wikilink/wikilinkPlugin'
import { createMarkdownLink, type MarkdownLinkNav } from './markdownLink'
import { createViewOnlyLinkSource, type ViewOnlyLinkSource } from './wikilink/viewOnlyLinkSource'

export interface CreateCrepeOptions {
  root: HTMLElement
  defaultValue?: string
  /** Called whenever the document changes (Crepe's listener debounces this ~200ms). */
  onMarkdownUpdated?: (markdown: string) => void
  /** Fold state for collapsible parent bullets: restore from / report to the caller (persisted per file). */
  folding?: OutlineFoldingOptions
  /** Fold state for collapsible heading sections (YAZ-1140): same contract as `folding`, its own `h:`-prefixed key space. */
  headingFolding?: HeadingFoldingOptions
  /** Zoom into a bullet (GRO-2029); `fileName` is the root breadcrumb. Defaults to an unnamed file. */
  zoom?: ZoomOptions
  /** CMD+F channel (YAZ-968): the host's one channel per mount, shared with the find bar. Absent → no find engine at all. */
  find?: FindChannel
  /** Wikilink resolve source (GRO-2190): App keeps it fed from the vault index. Defaults to a never-updated source (all links render resolved). */
  wikilinks?: WikilinkResolveSource
  /** Navigation-only view-file resolver; never carries semantic records. */
  viewOnlyLinks?: ViewOnlyLinkSource
  /** `[[` picker candidates (GRO-2191): App keeps it fed from the vault index. Defaults to a never-updated source (empty picker — only Create rows). */
  wikilinkCandidates?: WikilinkCandidateSource
  /** Wikilink click navigation (GRO-2192): tabs API + create-on-click handlers. Absent → links render but clicks fall through to plain editing (the click plugin is not registered). */
  wikilinkNav?: WikilinkNav
  /** Standard Markdown link actions (YAZ-1309): primary click opens; right-click edits/copies/removes. Absent → Crepe's stock behavior. */
  markdownLinkNav?: MarkdownLinkNav
  /** Drawing creator (YAZ-877): the host writes the sidecar, the item inserts the embed. Absent → NO Drawing row is added to the slash menu. */
  drawing?: DrawingCreator
  /** Drawing previews (YAZ-878): the vault root to read scenes against, plus the optional refresh feed and click handler. Absent → `.excalidraw` embeds stay plain text. */
  drawingPreview?: DrawingPreviewOptions
  /**
   * Feature overrides for a NON-note instance (YAZ-901's bullets-only outline editor passes
   * `outlineFeatures`). The note editor passes none and gets `featureConfig.ts`'s allowlist
   * verbatim — which is what `featureConfig.test.ts` keeps honest.
   */
  features?: Partial<Record<CrepeFeature, boolean>>
}

/** An `Hn` / `T` glyph for the toolbar, drawn as text — the label IS the icon. */
const headingIcon = (label: string): string =>
  `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><text x="12" y="16.5" text-anchor="middle" font-size="12" font-weight="700" font-family="inherit" fill="currentColor">${label}</text></svg>`

/** The slice of Crepe's GroupBuilder `buildToolbar` hands over — structural, since Crepe does not export the class from its root. */
interface HeadingToolbarBuilder {
  addGroup: (key: string, label: string) => {
    addItem: (key: string, item: { icon: string; label: string; active: (ctx: Ctx) => boolean; onRun: (ctx: Ctx) => void }) => unknown
  }
}

/**
 * The toolbar's Heading group (YAZ-923): H1/H2/H3/T buttons whose ACTIVE state answers "what
 * block is this?" — the invisible `##` made visible — and whose click switches it, through the
 * same commands the typed markdown runs. `T` is the way back to plain text without backspacing
 * hashes you cannot see.
 */
function buildHeadingToolbar(builder: HeadingToolbarBuilder): void {
  const blockAt = (ctx: Ctx) => ctx.get(editorViewCtx).state.selection.$from.parent
  const group = builder.addGroup('heading', 'Heading')
  for (const level of [1, 2, 3] as const) {
    group.addItem(`h${level}`, {
      icon: headingIcon(`H${level}`),
      label: `Heading ${level}`,
      active: (ctx) => {
        const block = blockAt(ctx)
        return block.type.name === 'heading' && block.attrs.level === level
      },
      onRun: (ctx) => ctx.get(commandsCtx).call(wrapInHeadingCommand.key, level),
    })
  }
  group.addItem('text', {
    icon: headingIcon('T'),
    label: 'Text',
    active: (ctx) => blockAt(ctx).type.name === 'paragraph',
    onRun: (ctx) => ctx.get(commandsCtx).call(turnIntoTextCommand.key),
  })
}

/**
 * Escape steps OUT of the text and back to the sidebar's active row (YAZ-936), so the keyboard
 * walk resumes exactly where the page was picked. Priority 10 — anything that means something by
 * Esc (the `[[` picker's dismiss at 100, menus) wins first; and it DECLINES when no tree row is
 * on screen (collapsed sidebar), so Esc stays free everywhere else.
 */
const escapeToSidebar = $shortcut(() => ({
  EscapeToSidebar: {
    key: 'Escape',
    priority: 10,
    onRun: () => () => focusSidebar(),
  },
}))

export function createCrepe(opts: CreateCrepeOptions): Crepe {
  const crepe = new Crepe({
    root: opts.root,
    defaultValue: normalizeEmptyItems(opts.defaultValue ?? ''),
    features: { ...features, ...opts.features },
    featureConfigs: {
      // Crepe feature customisation #1 (YAZ-1329/YAZ-877): Number children is the only editor
      // command that creates ordered children, so the stock Ordered List row is absent. Drawing
      // still composes into this same BlockEdit config when the host supplies a creator.
      [CrepeFeature.BlockEdit]: {
        listGroup: { orderedList: null },
        ...(opts.drawing === undefined ? {} : { buildMenu: drawingMenu(opts.drawing) }),
      },
      // #2 (YAZ-923): the selection toolbar SAYS the block's level — a Heading group whose
      // active button is the answer to "what is this?", and whose click is the switch. The
      // markdown stays the source of truth; these call the same commands typing `##` does.
      [CrepeFeature.Toolbar]: { buildToolbar: buildHeadingToolbar },
      // Native text carets track document zoom without a second painted overlay.
      [CrepeFeature.Cursor]: { virtual: false },
    },
  })
  crepe.editor.use(
    // NB: extend the GFM task-item schema, not the commonmark base — extendSchema()
    // always derives from the ORIGINAL schema, so extending listItemSchema directly
    // would silently drop task-list checkbox support.
    extendListItemSchemaForTask.extendSchema((prev) => (ctx) => ({ ...prev(ctx), content: 'block+' })),
  )
  crepe.editor.use(listItemRoundTrip)
  crepe.editor.use(underline)
  crepe.editor.use(createOutlineFolding(opts.folding))
  crepe.editor.use(createHeadingFolding(opts.headingFolding))
  if (opts.find !== undefined) crepe.editor.use(createFindInPage(opts.find))
  crepe.editor.use(createOutlineZoom(opts.zoom ?? { fileName: 'Untitled' }))
  crepe.editor.use(guideLines)
  crepe.editor.use(bulletThreading)
  // ONE resolve source instance feeds both the decorations and the click plugin's routing.
  const wikilinks = opts.wikilinks ?? createWikilinkResolveSource()
  // A missing catalog must stay passive: recognized non-Markdown targets can never fall through
  // to Markdown creation, including in isolated createCrepe consumers outside App.
  const viewOnlyLinks = opts.viewOnlyLinks ?? createViewOnlyLinkSource()
  crepe.editor.use(createWikilink(wikilinks, viewOnlyLinks))
  if (opts.wikilinkNav !== undefined) crepe.editor.use(createWikilinkClick(wikilinks, opts.wikilinkNav, viewOnlyLinks))
  if (opts.markdownLinkNav !== undefined) crepe.editor.use(createMarkdownLink(opts.markdownLinkNav))
  crepe.editor.use(createWikilinkPicker(opts.wikilinkCandidates ?? createWikilinkCandidateSource(), opts.wikilinkNav))
  if (opts.drawingPreview !== undefined) crepe.editor.use(createDrawingPreview(opts.drawingPreview))
  crepe.editor.use(outlinePaste)
  crepe.editor.use(clipboardPaste)
  crepe.editor.use(clipboardCopyOut)
  crepe.editor.use(blockHandleGate)
  // Numbers are manual-only (YAZ-793/YAZ-1329): only the explicit block-handle command creates
  // ordered children. Typing, slash-menu and keyboard conversion paths are all absent.
  void crepe.editor.remove([wrapInOrderedListInputRule, ...orderedListKeymap])
  crepe.editor.use(createBlockHandleMenu(numberChildrenRow))
  crepe.editor.use(multiBlockDrag)
  // Before outlinerKeymap on purpose: both bind Enter at priority 100 and KeymapManager runs
  // equal priorities in addition order — an OPEN [[ picker takes Enter, closed falls through.
  crepe.editor.use(createWikilinkPickerKeymap(opts.wikilinkNav))
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

/** Move keyboard focus into the document (e.g. right after opening a file from the sidebar). */
export function focusEditor(crepe: Crepe): void {
  crepe.editor.action((ctx) => ctx.get(editorViewCtx).focus())
}

export function postProcessMarkdown(md: string): string {
  return restoreSameLineOrderedMarkers(
    stripEmptyTaskBreaks(
      md
        .replace(/(!?)\\\[\\\[/g, '$1[[')
        // Crepe's trailing plugin keeps an empty paragraph after a final heading/list/code
        // block; remark would serialise it as an extra blank line. Contract: single final \n.
        .replace(/\n{2,}$/, '\n'),
    ),
  )
}
