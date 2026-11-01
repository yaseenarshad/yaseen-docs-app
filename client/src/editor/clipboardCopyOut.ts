import { editorViewOptionsCtx, prosePluginsCtx, schemaCtx } from '@milkdown/kit/core'
import { createSlice } from '@milkdown/kit/ctx'
import { DOMSerializer, Fragment, type Node as ProseNode, Slice } from '@milkdown/kit/prose/model'
import { type Command, type EditorState, Plugin, PluginKey, type Selection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose, $shortcut } from '@milkdown/kit/utils'
import { APP_CLIPBOARD } from './clipboardNumbers'
import { clipboardPlainText } from './clipboardPlainText'
import { eachVisibleTextblock } from './lineSelection'
import { rowShortcuts } from './noteKeys'
import { getZoomedItemPos } from './outline/zoom'
import { FILL_WASH } from './table/colours'
import { cellColor, type TableColor } from './table/tableComment'
import { EditorView as CodeMirrorView } from '@codemirror/view'

export const CLIPBOARD_EMPTY_PARAGRAPH = 'data-mdapp-empty-paragraph'

/** A document range: what Without folded lines copies. */
interface CopyRange {
  from: number
  to: number
}

/**
 * The bullet Without folded lines copies when the selection is inside one line (YAZ-3653): the
 * innermost bullet holding `pos`, whole (its line and the lines under it). Null when the selection
 * spans lines (it is the copy then), `pos` is in no bullet, or it is in code.
 */
export function bulletToCopy(state: EditorState, pos: number): CopyRange | null {
  const { $from, $to } = state.selection
  if (!$from.sameParent($to) || !$from.parent.isTextblock) return null
  const $pos = state.doc.resolve(pos)
  if ($pos.parent.type.spec.code === true) return null
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name !== 'list_item') continue
    const from = $pos.before(depth)
    return { from, to: from + $pos.node(depth).nodeSize }
  }
  return null
}

/**
 * A right-clicked bullet waiting for main's Copy as request: the next Copy as of the note takes it
 * (any mode), and only a Without folded lines copy uses it, while the note and its selection are
 * still as they were. A request that failed forgets it (`forgetCopyVisible`).
 */
const nextRange = new WeakMap<EditorView, CopyRange & { doc: ProseNode; selection: Selection }>()

/** The next Without folded lines of `view` copies `range` instead of the selection. */
export function copyVisibleNext(view: EditorView, range: CopyRange): void {
  nextRange.set(view, { ...range, doc: view.state.doc, selection: view.state.selection })
}

/** The stored bullet is not wanted: the request for it failed. */
export function forgetCopyVisible(view: EditorView): void {
  nextRange.delete(view)
}

function takeRange(view: EditorView): CopyRange | null {
  const next = nextRange.get(view)
  nextRange.delete(view)
  return next !== undefined && next.doc === view.state.doc && next.selection.eq(view.state.selection) ? next : null
}

/** The lines (textblocks) in `node`, itself included. */
const linesIn = (node: ProseNode): number => {
  let lines = node.isTextblock ? 1 : 0
  node.descendants((child) => {
    if (child.isTextblock) lines++
    return !child.isTextblock
  })
  return lines
}

/**
 * Copy as › Without folded lines (YAZ-3653): the selection (or `range`) minus what folds hide — a
 * folded bullet's children and a folded heading's section, found by the walk formatting uses
 * (`eachVisibleTextblock`, YAZ-3209) — and how many lines that left out. In a zoom, only the zoomed
 * bullet. Slice position p is document position p + from - openStart, so each kept node's start is
 * known on the way down.
 */
const visibleSlice = (state: EditorState, range: CopyRange | null): { slice: Slice; left: number } => {
  const { selection, doc } = state
  if (range === null && selection.ranges.length > 1) return { slice: selection.content(), left: 0 }
  const { from: start, to: end } = range ?? selection
  const zoomed = getZoomedItemPos(state)
  const from = zoomed === null ? start : Math.max(start, zoomed)
  const to = zoomed === null ? end : Math.min(end, zoomed + doc.nodeAt(zoomed)!.nodeSize)
  const hidden = new Set<number>()
  let left = 0
  eachVisibleTextblock(state, from, to, () => {}, (pos) => {
    hidden.add(pos)
    left += linesIn(doc.nodeAt(pos)!)
  })
  const slice = doc.slice(from, to, true)
  if (hidden.size === 0) return { slice, left }
  const keep = (content: Fragment, start: number): Fragment => {
    const kept: ProseNode[] = []
    content.forEach((node, offset) => {
      if (!hidden.has(start + offset)) kept.push(node.isTextblock || node.isLeaf ? node : node.copy(keep(node.content, start + offset + 1)))
    })
    return Fragment.from(kept)
  }
  return { slice: new Slice(keep(slice.content, from - slice.openStart), slice.openStart, slice.openEnd), left }
}

/** Without folded lines' toast (YAZ-3653): the host's notice, or none (a preview, a test). */
export const copyNoticeCtx = createSlice<((text: string) => void) | null, 'copyNotice'>(null, 'copyNotice')

/**
 * How a plain-text copy names a text's `[[links]]` (YAZ-3744 S8): as the note shows them, an ID link with its ID.
 * createCrepe gives the editor's link sources; none (a bare mount) copies links as written.
 */
export const copyLinkTextCtx = createSlice<((text: string) => string) | null, 'copyLinkText'>(null, 'copyLinkText')

/**
 * Copy as Markdown writes what a save writes (YAZ-3747): createCrepe gives its save step, `postProcessMarkdown`, which
 * takes remark's escapes off each `[[link]]`. None (a bare mount) copies the serializer's text as it is.
 */
export const copyMarkdownCtx = createSlice<((markdown: string) => string) | null, 'copyMarkdown'>(null, 'copyMarkdown')

/** What the toast says: the lines a copy left out, so a copy that dropped them reads as meant. */
const copiedText = (left: number): string =>
  left === 0 ? 'Copied. Nothing in it was folded' : `Copied, ${left} folded line${left === 1 ? '' : 's'} left out`

/**
 * The key for Without folded lines (YAZ-3653): the note row `note.copyVisible`, no key until the
 * user picks one in Settings › Hotkeys. Main runs it as the Edit menu's row, so it copies what that
 * row copies: with nothing selected the bullet at the caret, else the selection.
 */
const copyVisible: Command = (state, dispatch) => {
  if (state.selection.empty && bulletToCopy(state, state.selection.head) === null) return false
  if (dispatch !== undefined) window.yaseenDocs?.menu?.edit?.('copy-visible').catch((error: unknown) => console.error('Copy failed', error))
  return true
}

export const copyVisibleHotkey = $shortcut((ctx) => rowShortcuts(ctx, 'note.copyVisible', 'CopyWithoutFoldedLines', { onRun: () => copyVisible }))

/**
 * A copied cell's colours in the light theme (YAZ-3802, YAZ-3817): the text colours of table.css `:root`,
 * and each fill's see-through wash (`--table-fill-*`) as it shows over white, because Docs needs a solid
 * colour. A custom colour copies as picked; a custom fill as its wash over white, as the page draws it.
 */
const COPY_FILL: Record<TableColor, string> = {
  red: '#ffc5c2', orange: '#ffdab7', yellow: '#ffee99', green: '#c2ecd0', teal: '#b4e8e5',
  blue: '#c2deff', purple: '#deccff', pink: '#ffd0e5', grey: '#dadada', brown: '#e1d0be',
}
const COPY_TEXT: Record<TableColor, string> = {
  red: '#c0392b', orange: '#b45309', yellow: '#a16207', green: '#2e7d32', teal: '#0f766e',
  blue: '#1d5fbf', purple: '#7b3fbf', pink: '#c2185b', grey: '#6b6b6b', brown: '#8b5a2b',
}
/** `#rrggbb` at its wash (`FILL_WASH`, table.css `--table-fill-wash`) over white. */
const washOverWhite = (hex: string): string =>
  `#${[1, 3, 5].map((i) => Math.round(255 - (255 - parseInt(hex.slice(i, i + 2), 16)) * FILL_WASH).toString(16).padStart(2, '0')).join('')}`
const copyFill = (fill: string | null) => (fill === null ? undefined : fill.startsWith('#') ? washOverWhite(fill) : COPY_FILL[fill as TableColor])
const copyText = (color: string | null) => (color === null ? undefined : color.startsWith('#') ? color : COPY_TEXT[color as TableColor])

/**
 * Inline styles on copied tables (YAZ-3802, demo round 1 decision 13): Google Docs and Sheets read
 * only these, so the lines, fills, text colours and the bold header show there. A paste into this
 * app reads the cells' `data-fill` / `data-color` and ignores the styles.
 */
function styleTables(dom: DocumentFragment): void {
  for (const table of dom.querySelectorAll('table')) table.style.borderCollapse = 'collapse'
  for (const cell of dom.querySelectorAll<HTMLElement>('th, td')) {
    cell.style.border = '1px solid #999'
    cell.style.padding = '4px 8px'
    if (cell.tagName === 'TH') cell.style.fontWeight = 'bold'
    const fill = copyFill(cellColor(cell.dataset.fill))
    if (fill !== undefined) cell.style.backgroundColor = fill
    const color = copyText(cellColor(cell.dataset.color))
    if (color !== undefined) cell.style.color = color
  }
}

/**
 * Copied CELLS are rows: ProseMirror wraps them in a `<table>` of its own after the serializer (its
 * `wrapMap`), made by the detached document it hands the serializer for this one copy. So that
 * document's tables are made collapsed too. Never the page's own document.
 */
const collapsing = new WeakSet<Document>()
function collapseTablesOf(doc: Document | undefined): void {
  if (doc === undefined || doc === document || collapsing.has(doc)) return
  collapsing.add(doc)
  const create = doc.createElement.bind(doc)
  doc.createElement = ((tag: string, options?: ElementCreationOptions) => {
    const el = create(tag, options)
    if (tag === 'table') el.style.borderCollapse = 'collapse'
    return el
  }) as Document['createElement']
}

/** Copy-only formats: readable text, rich HTML and explicitly requested Markdown; saves stay unchanged. */
export const clipboardCopyOut = $prose((ctx) => {
  // Read at each copy: the app's own HTML flavour keeps the raw links, so a paste into a note keeps them (S8).
  const plainText = (slice: Slice) => clipboardPlainText(slice, (ctx.isInjected(copyLinkTextCtx) ? ctx.get(copyLinkTextCtx) : null) ?? undefined)
  let copyMarkdown: ((slice: Slice, view: EditorView) => string) | undefined
  ctx.update(editorViewOptionsCtx, (prev) => {
    const stock = ctx.get(prosePluginsCtx).find((plugin) => plugin.props.clipboardTextSerializer)
    const serialize = prev.clipboardTextSerializer ?? stock?.props.clipboardTextSerializer?.bind(stock)
    if (!serialize) return prev
    copyMarkdown = (slice, view) => {
      const markdown = serialize(slice, view)
      return (ctx.isInjected(copyMarkdownCtx) ? ctx.get(copyMarkdownCtx) : null)?.(markdown) ?? markdown
    }
    const html = prev.clipboardSerializer ?? DOMSerializer.fromSchema(ctx.get(schemaCtx))
    const clipboardSerializer = new DOMSerializer({
      ...html.nodes,
      paragraph: (node) => {
        const paragraph = html.serializeNode(node) as HTMLElement
        paragraph.style.marginTop = '0'
        paragraph.style.marginBottom = '0'
        if (node.content.size === 0) {
          const separator = document.createElement('br')
          for (const { name, value } of paragraph.attributes) separator.setAttribute(name, value)
          separator.setAttribute(CLIPBOARD_EMPTY_PARAGRAPH, 'true')
          return separator
        }
        return paragraph
      },
    }, html.marks)
    const serializeFragment = clipboardSerializer.serializeFragment.bind(clipboardSerializer)
    clipboardSerializer.serializeFragment = (fragment, options, target) => {
      const dom = serializeFragment(fragment, options, target)
      dom.firstElementChild?.setAttribute(APP_CLIPBOARD, 'true')
      if (dom instanceof DocumentFragment) styleTables(dom)
      collapseTablesOf(options?.document)
      return dom
    }
    return {
      ...prev,
      clipboardSerializer,
      clipboardTextSerializer: plainText,
    }
  })
  return new Plugin({
    key: new PluginKey('mdapp-clipboard-copy-out'),
    view: view => {
      const unsubscribe = window.yaseenDocs?.menu?.onCopyAs?.(mode => {
        const stored = takeRange(view)
        const active = document.activeElement
        if (active instanceof HTMLElement && view.dom.contains(active)) {
          const code = CodeMirrorView.findFromDOM(active)
          if (code?.hasFocus) return code.state.selection.ranges.filter(range => !range.empty)
            .map(range => code.state.sliceDoc(range.from, range.to)).join(code.state.lineBreak)
        }
        if (!view.hasFocus()) return undefined
        if (mode === 'visible') {
          // The right-clicked bullet; with nothing selected the bullet at the caret (the Edit menu's row, the key); else the selection.
          const range = stored ?? (view.state.selection.empty ? bulletToCopy(view.state, view.state.selection.head) : null)
          if (range === null && view.state.selection.empty) return ''
          const { slice, left } = visibleSlice(view.state, range)
          const { dom, text } = view.serializeForClipboard(slice)
          if (text !== '' && ctx.isInjected(copyNoticeCtx)) ctx.get(copyNoticeCtx)?.(copiedText(left))
          return { text, html: dom.innerHTML }
        }
        if (view.state.selection.empty) return ''
        const slice = view.state.selection.content()
        return mode === 'plain' ? plainText(slice) : copyMarkdown?.(slice, view) ?? ''
      })
      return { destroy: () => unsubscribe?.() }
    },
  })
})
