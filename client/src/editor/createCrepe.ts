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
 *  - Obsidian hotkeys (GRO-2027, `outline/hotkeys.ts`): Mod-Enter task cycle, Mod-Shift-u/i
 *    fold/unfold all, Mod-Shift-x strikethrough.
 *  - Underline mark (GRO-2028, `marks/underline.ts`): Mod-u ↔ `<u>text</u>` inline HTML.
 *  - Zoom into a bullet (GRO-2029, `outline/zoom.ts`): view-state-only decorations + breadcrumbs;
 *    glyph click / Mod-. / Mod-Shift-. ; never a document change.
 *  - List guide lines (GRO-2030, `outline/guideLines.ts` + `.css`): CSS vertical lines on nested
 *    lists; clicking a line toggles the parent's fold (meta-only, same as the chevron).
 *  - Multi-block drag (GRO-2019, `multiBlockDrag.ts`): handle-drag inside a multi-block
 *    selection moves the whole selection; single-block drag stays Crepe's.
 *  - Bullet threading (GRO-2094, `outline/bulletThreading.ts` + `.css`): root → caret path
 *    decorations (accent line + glyphs, stops at the active bullet); CSS-gated by the settings cog.
 *  - Base embeds (GRO-2145, `baseEmbed/baseEmbedPlugin.ts`): a paragraph with exactly one `![[X.base]]`
 *    gets a widget decoration slot (never a schema change — the text round-trips byte-identically);
 *    CrepeHost portals `<BaseEmbed>` into the slots via the registry in `opts.baseEmbeds`.
 *  - `base` code blocks (GRO-2146, `baseCodeBlock/baseCodeBlockView.ts`): a `$view` replacement
 *    for `code_block` — `language === 'base'` gets a registry slot (CrepeHost portals
 *    `<BaseCodeBlock>`), every other language delegates to Crepe's stock CodeMirror block.
 *    No schema/serializer change: the block's exact text round-trips byte-identically.
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
 *    `[[name]]` text. Its keymap MUST be `use`d before `outlinerKeymap`: both bind Enter at
 *    priority 100 and equal priorities run in addition order — the picker wins while open and
 *    declines (falls through) while closed.
 */
import { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { extendListItemSchemaForTask } from '@milkdown/kit/preset/gfm'
import { Selection } from '@milkdown/kit/prose/state'
import { replaceAll } from '@milkdown/kit/utils'
import { createBaseCodeBlock, createBaseCodeBlockRegistry, type BaseCodeBlockRegistry } from './baseCodeBlock/baseCodeBlockView'
import { createBaseEmbed, createBaseEmbedRegistry, type BaseEmbedRegistry } from './baseEmbed/baseEmbedPlugin'
import { blockHandleGate } from './blockHandleGate'
import { bulletThreading } from './outline/bulletThreading'
import { features } from './featureConfig'
import { listItemRoundTrip, normalizeEmptyItems, stripEmptyTaskBreaks } from './listItemRoundTrip'
import { underline } from './marks/underline'
import { multiBlockDrag } from './multiBlockDrag'
import { guideLines } from './outline/guideLines'
import { obsidianHotkeys } from './outline/hotkeys'
import { outlinerKeymap } from './outline/listCommands'
import { createOutlineFolding, type OutlineFoldingOptions } from './outline/outlineFolding'
import { createOutlineZoom, zoomKeymap, type ZoomOptions } from './outline/zoom'
import { createWikilinkClick, type WikilinkNav } from './wikilink/wikilinkClick'
import { createWikilinkPicker, createWikilinkCandidateSource, wikilinkPickerKeymap, type WikilinkCandidateSource } from './wikilink/wikilinkPicker'
import { createWikilink, createWikilinkResolveSource, type WikilinkResolveSource } from './wikilink/wikilinkPlugin'

export interface CreateCrepeOptions {
  root: HTMLElement
  defaultValue?: string
  /** Called whenever the document changes (Crepe's listener debounces this ~200ms). */
  onMarkdownUpdated?: (markdown: string) => void
  /** Fold state for collapsible parent bullets: restore from / report to the caller (persisted per file). */
  folding?: OutlineFoldingOptions
  /** Zoom into a bullet (GRO-2029); `fileName` is the root breadcrumb. Defaults to an unnamed file. */
  zoom?: ZoomOptions
  /** Base embed slots (GRO-2145): the host portals `<BaseEmbed>` into them. Defaults to a private registry. */
  baseEmbeds?: BaseEmbedRegistry
  /** `base` code block slots (GRO-2146): the host portals `<BaseCodeBlock>` into them. Defaults to a private registry. */
  baseCodeBlocks?: BaseCodeBlockRegistry
  /** Wikilink resolve source (GRO-2190): App keeps it fed from the vault index. Defaults to a never-updated source (all links render resolved). */
  wikilinks?: WikilinkResolveSource
  /** `[[` picker candidates (GRO-2191): App keeps it fed from the vault index. Defaults to a never-updated source (empty picker — only Create rows). */
  wikilinkCandidates?: WikilinkCandidateSource
  /** Wikilink click navigation (GRO-2192): tabs API + create-on-click handlers. Absent → links render but clicks fall through to plain editing (the click plugin is not registered). */
  wikilinkNav?: WikilinkNav
}

export function createCrepe(opts: CreateCrepeOptions): Crepe {
  const crepe = new Crepe({
    root: opts.root,
    defaultValue: normalizeEmptyItems(opts.defaultValue ?? ''),
    features,
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
  crepe.editor.use(createOutlineZoom(opts.zoom ?? { fileName: 'Untitled' }))
  crepe.editor.use(guideLines)
  crepe.editor.use(bulletThreading)
  crepe.editor.use(createBaseEmbed(opts.baseEmbeds ?? createBaseEmbedRegistry()))
  crepe.editor.use(createBaseCodeBlock(opts.baseCodeBlocks ?? createBaseCodeBlockRegistry()))
  // ONE resolve source instance feeds both the decorations and the click plugin's routing.
  const wikilinks = opts.wikilinks ?? createWikilinkResolveSource()
  crepe.editor.use(createWikilink(wikilinks))
  if (opts.wikilinkNav !== undefined) crepe.editor.use(createWikilinkClick(wikilinks, opts.wikilinkNav))
  crepe.editor.use(createWikilinkPicker(opts.wikilinkCandidates ?? createWikilinkCandidateSource()))
  crepe.editor.use(blockHandleGate)
  crepe.editor.use(multiBlockDrag)
  // Before outlinerKeymap on purpose: both bind Enter at priority 100 and KeymapManager runs
  // equal priorities in addition order — an OPEN [[ picker takes Enter, closed falls through.
  crepe.editor.use(wikilinkPickerKeymap)
  crepe.editor.use(outlinerKeymap)
  crepe.editor.use(obsidianHotkeys)
  crepe.editor.use(zoomKeymap)
  if (opts.onMarkdownUpdated) {
    const cb = opts.onMarkdownUpdated
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown, prev) => {
        if (markdown !== prev) cb(postProcessMarkdown(markdown))
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
 * Replace the whole document in an existing instance (e.g. external file change).
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
  return stripEmptyTaskBreaks(
    md
      .replace(/(!?)\\\[\\\[/g, '$1[[')
      // Crepe's trailing plugin keeps an empty paragraph after a final heading/list/code
      // block; remark would serialise it as an extra blank line. Contract: single final \n.
      .replace(/\n{2,}$/, '\n'),
  )
}
