/**
 * What changed outside the app, shown in the open note (YAZ-3704 D3–D9) — the engine behind
 * `OutsideChangesChannel` and the one-line note (`OutsideChangesBar.tsx`).
 *
 * Input: every outside edit that lands as a diff or a merge (`applyExternalMarkdown`,
 * `mergeExternalMarkdown`) is ONE transaction with `OUTSIDE_RANGES_META`: where each new piece sits in
 * the new document, and the text it replaced. A quiet apply (a copy of this note in another tab saved:
 * the user's own typing) carries none, so it never glows. A rebuild makes a new state, so the list starts
 * empty; the host then says `markWholeNote`.
 *
 * The list (D3) lives in plugin state, memory only, for this editor, nothing saved to disk. When the editor is
 * destroyed, its tab keeps the list for this page (`outsideChangesMemory.ts`), and an editor of the same tab and page
 * gets it back (`keptBack`). Every position is mapped through every transaction, as find and the fold plugin map
 * theirs. One change is one TEXTBLOCK (D4): ranges in one line are one change, and a range across several
 * textblocks (bullets added) is one change for each. More than `MAX_CHANGES` empties the list into
 * whole-note mode, with no glow.
 *
 * Drawing: the changed words glow (inline `outside-change`); removed text is a thin red mark (D7, a widget: not in
 * the doc, never copied or saved). The mouse on either shows at once a box with the line word by word: the words
 * removed since the first outside edit of it struck, the new ones lit; or "New line", or a removed bullet's text
 * (YAZ-3947, YAZ-3989: the Before line is kept with the change, in memory only; the box is built on mouse-over, never
 * on a keystroke). `OUTSIDE_TIP_ATTR` marks what has a box, with its text in short. Each changed textblock carries a node
 * class that shows its **Checked** button on hover (D8). The DecorationSet lives in the state and is built
 * again only when the list changes; a keystroke only maps it.
 *
 * Check off (D8): **Checked**, **Mark all checked**, the Glow time (D5), or the user's OWN edit in a
 * change's textblock — never an outside edit, an undo or redo, a transaction a plugin appends, or one kept out
 * of the history (Milkdown's heading-id sync after an outside heading edit, YAZ-3844). A timed Glow ends
 * whole-note mode at the same time; until checked, it stays until Dismiss.
 *
 * The numbered list (YAZ-3998, `OutsideChangesList.tsx`): each change gets a number when it comes, in the order the changes
 * happened (one save's changes top to bottom), and keeps it until it is checked off; the numbers start at 1 again once the
 * list is empty. Its rows are built only when the list asks, after `version` moved: never on a keystroke.
 *
 * Next change (D9), `findInPage.ts`'s fold books: it goes in number order. the folds that hide the next change open SILENTLY
 * (⌘Z panic-undo untouched) and fold again when Next moves on. Mark all checked, or a list that empties,
 * leaves the folds that hide the active change open: the landing. Outside the zoomed bullet, the page
 * zooms out first and the host tells the tab.
 */
import type { Node as ProseNode, ResolvedPos } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, Selection, type Transaction } from '@milkdown/kit/prose/state'
import { Transform, type Mapping } from '@milkdown/kit/prose/transform'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import type { OutsideChangeGlow } from '@shared/types'
import { collapsedHeadingsHiding, setHeadingFoldSet } from '../outline/headingFolding'
import { collapsedItemsHiding, setOutlineFoldSet } from '../outline/outlineFolding'
import { getZoomedItemPos, zoomToKey } from '../outline/zoom'
import { FLASH_FRAMES, FLASH_MS, reducedMotion } from '../toc/tocMotion'
import { EXTERNAL_EDIT_META, OUTSIDE_RANGES_META, REWRITE_SHARE, replaceTracked, withTrailingParagraphOf, type OutsideRange } from './applyExternalMarkdown'
import { diffDocs, isDerivedAttr } from './diffDocs'
import type { SavedOutsideChanges } from './outsideChangesMemory'
import type { OutsideChangeRow, OutsideChangesChannel, OutsideChangesController, OutsideChangesSnapshot } from './outsideChangesChannel'

export const OUTSIDE_CHANGE_CLASS = 'outside-change'
/** The change Next put the ring on carries this IN ADDITION to its own class. */
export const OUTSIDE_ACTIVE_CLASS = 'outside-change--active'
export const OUTSIDE_REMOVED_CLASS = 'outside-removed'
/** On each changed textblock: its hover shows the Checked button (outsideChanges.css). */
export const OUTSIDE_BLOCK_CLASS = 'outside-change-block'
export const OUTSIDE_CHECKED_CLASS = 'outside-checked'
/** On a glow or a removed mark: the mouse on it shows the box. Its value is the box's text in short ("Before: …"). */
export const OUTSIDE_TIP_ATTR = 'data-outside-tip'
/** The word-by-word box (YAZ-3989): one for each editor, on the body, hidden while the mouse is on no change. */
export const OUTSIDE_TIP_CLASS = 'outside-tip'

/** D3: above this many changes the list empties and the note is "changed as a whole". */
export const MAX_CHANGES = 200
/** D7: a removed text longer than this is cut in the mark's tip, with "…"; so is a Before line (YAZ-3947). */
const REMOVED_TITLE_CHARS = 200
/** One change keeps at most this many removed marks, the newest (YAZ-3844): an agent that saves one line again and again adds no more. */
export const MAX_REMOVED_PER_CHANGE = 5

interface Span {
  from: number
  to: number
}

interface OutsideChange {
  id: number
  /** Its place in the numbered list (YAZ-3998): the order the changes happened. */
  number: number
  /** The position right before the change's textblock. */
  pos: number
  /** The changed words that glow; empty for a pure deletion. */
  glow: readonly Span[]
  /** The line as it was before the first outside edit of it (with a task's box, a heading's #s); null = a new line. */
  before: string | null
  /** The removed text, at the place it was: one mark for each place, the newest, at most `MAX_REMOVED_PER_CHANGE`. */
  removed: readonly { pos: number; text: string }[]
  /** When a timed glow checks itself off (ms since the epoch); null = until checked. */
  ends: number | null
}

interface OutsideState {
  /** In document order. */
  changes: readonly OutsideChange[]
  /** The change Next put the ring on. */
  activeId: number | null
  /** The last number a change got; the next one gets one more. */
  lastNumber: number
  /** Moves each time the decorations are built again: the list, a change's text, or the ring changed. */
  version: number
  wholeNote: boolean
  /** When whole-note mode ends with a timed Glow (ms since the epoch); null = until Dismiss. */
  wholeNoteEnds: number | null
  glow: OutsideChangeGlow
  /** Items Next opened; Next folds them again when it moves on. */
  revealed: ReadonlySet<number>
  /** The same, for heading sections — kept apart, as find keeps them. */
  revealedHeadings: ReadonlySet<number>
  decorations: DecorationSet
}

type OutsideMeta =
  | { type: 'check'; id: number }
  | { type: 'clear' }
  | { type: 'whole'; now: number }
  | { type: 'glow'; glow: OutsideChangeGlow; now: number }
  | { type: 'expire'; now: number }
  | { type: 'active'; id: number; revealed: ReadonlySet<number>; revealedHeadings: ReadonlySet<number> }
  | { type: 'restore'; changes: readonly OutsideChange[]; lastNumber: number }

/** Shared across instances: a PluginKey only identifies the plugin within one EditorState. */
const outsideKey = new PluginKey<OutsideState>('mdapp-outside-changes')

const NONE: ReadonlySet<number> = new Set()

let nextId = 1

const endsAt = (glow: OutsideChangeGlow, now: number): number | null => (glow === '10s' ? now + 10_000 : glow === '60s' ? now + 60_000 : null)

/** The textblock nearest `pos` (a bullet removed leaves a range between blocks): the one after it, else the one before. */
const textblockNear = (doc: ProseNode, pos: number): number | null => {
  const $pos = doc.resolve(pos)
  if ($pos.parent.isTextblock) return $pos.before()
  const near = Selection.findFrom($pos, 1, true) ?? Selection.findFrom($pos, -1, true)
  return near !== null && near.$from.parent.isTextblock ? near.$from.before() : null
}

/** D4: the textblocks a range landed in, each with its share of the range (null: nothing to glow there). */
const blocksOf = (doc: ProseNode, { from, to }: Span): { pos: number; glow: Span | null }[] => {
  const $from = doc.resolve(from)
  if ($from.parent.isTextblock && to <= $from.end()) return [{ pos: $from.before(), glow: to > from ? { from, to } : null }]
  const blocks: { pos: number; glow: Span | null }[] = []
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true
    const glow = { from: Math.max(from, pos + 1), to: Math.min(to, pos + 1 + node.content.size) }
    // A block the range only touches at its edge is not changed; an empty block inside the range is.
    if (glow.to > glow.from || (pos >= from && pos + node.nodeSize <= to)) blocks.push({ pos, glow: glow.to > glow.from ? glow : null })
    return false
  })
  if (blocks.length > 0) return blocks
  const pos = textblockNear(doc, from)
  return pos === null ? [] : [{ pos, glow: null }]
}

/** The line a textblock was, as the Before hover says it: a task's box and a heading's #s first, as markdown writes them. */
const lineOf = ($pos: ResolvedPos): string => {
  const block = $pos.parent
  const item = $pos.depth > 0 ? $pos.node($pos.depth - 1) : null
  const box = item !== null && $pos.index($pos.depth - 1) === 0 && typeof item.attrs.checked === 'boolean' ? (item.attrs.checked ? '[x] ' : '[ ] ') : ''
  const hashes = block.type.name === 'heading' ? `${'#'.repeat(Number(block.attrs.level))} ` : ''
  return box + hashes + block.textBetween(0, block.content.size, ' ', ' ')
}

/** Attrs or marks as the file says them: the derived ones (a heading's id, set again after a load) left out. */
const ownAttrs = (attrs: Readonly<Record<string, unknown>>): string =>
  JSON.stringify(
    Object.keys(attrs)
      .filter((key) => !isDerivedAttr(key))
      .sort()
      .map((key) => [key, attrs[key]]),
  )

/**
 * A doc's shape, to know a kept list still fits it: its nodes' types, own attrs, marks and text, in order, so a task
 * ticked, a heading's level or a word made bold while the tab was away is a change (4I1). Derived attrs are left out, and
 * so is an empty last paragraph (the editor adds one after its first transaction).
 */
const shapeOf = (doc: ProseNode): string => {
  const parts: string[] = []
  const last = doc.lastChild
  const end = last !== null && last.type.name === 'paragraph' && last.content.size === 0 ? doc.content.size - last.nodeSize : doc.content.size
  doc.nodesBetween(0, end, (node) => {
    parts.push(node.isText ? `${node.marks.map((mark) => `{${mark.type.name}${ownAttrs(mark.attrs)}}`).join('')}${node.text ?? ''}` : `<${node.type.name}${ownAttrs(node.attrs)}>`)
  })
  return parts.join('')
}

/** New outside ranges into the list: a range in a block that has a change already joins it (D4) and keeps its Before. */
const addRanges = (
  changes: readonly OutsideChange[],
  ranges: readonly OutsideRange[],
  doc: ProseNode,
  ends: number | null,
  beforeOf: (pos: number) => string | null,
  numberOf: () => number,
): OutsideChange[] => {
  const byPos = new Map(changes.map((change) => [change.pos, change]))
  for (const range of ranges) {
    blocksOf(doc, range).forEach(({ pos, glow }, index) => {
      const old = byPos.get(pos)
      const marks = old?.removed ?? []
      // A newer removal at the same place replaces the older mark; the newest few stay.
      const removed =
        index === 0 && range.removed !== '' ? [...marks.filter((mark) => mark.pos !== range.from), { pos: range.from, text: range.removed }].slice(-MAX_REMOVED_PER_CHANGE) : marks
      byPos.set(pos, {
        id: old?.id ?? nextId++,
        // 0 until the end: one save's new changes are numbered top to bottom.
        number: old?.number ?? 0,
        pos,
        before: old === undefined ? beforeOf(pos) : old.before,
        glow: glow === null ? (old?.glow ?? []) : [...(old?.glow ?? []), glow],
        removed,
        // A new outside edit in the block starts its time again.
        ends,
      })
    })
  }
  return [...byPos.values()].sort((a, b) => a.pos - b.pos).map((change) => (change.number === 0 ? { ...change, number: numberOf() } : change))
}

/**
 * Every change through `mapping`; a change whose textblock is gone (or replaced whole) goes. The CONTENT start is
 * what maps: an attr-only change of the block (`setNodeMarkup`, as the heading-id sync does) re-writes the block's
 * opening token but keeps its content, so the change stays (YAZ-3844). An edit that starts AT the content start (a
 * first word replaced, an undo of typing there) only touches it: the change stays, with its glow and its Before
 * (checker on YAZ-3947); only a range across it goes.
 */
const mapChanges = (changes: readonly OutsideChange[], mapping: Mapping, doc: ProseNode): OutsideChange[] => {
  const mapped: OutsideChange[] = []
  for (const change of changes) {
    const start = mapping.mapResult(change.pos + 1, -1)
    const pos = start.pos - 1
    if (start.deletedAcross || pos < 0 || doc.nodeAt(pos)?.isTextblock !== true) continue
    mapped.push({
      ...change,
      pos,
      glow: change.glow.map((span) => ({ from: mapping.map(span.from, 1), to: mapping.map(span.to, -1) })).filter((span) => span.to > span.from),
      removed: change.removed.map((mark) => ({ ...mark, pos: mapping.map(mark.pos, -1) })),
    })
  }
  return mapped
}

/**
 * D8: the user's own edit. Not an outside edit, not an undo or redo, not what a plugin appends, and not a
 * transaction kept out of the history: the user's typing always goes into it, and Milkdown's heading-id sync
 * (`addToHistory: false`) follows every outside heading edit (YAZ-3844).
 */
const isUserEdit = (transaction: Transaction): boolean =>
  transaction.getMeta(EXTERNAL_EDIT_META) === undefined &&
  transaction.getMeta('history$') === undefined &&
  transaction.getMeta('appendedTransaction') === undefined &&
  transaction.getMeta('addToHistory') !== false

/** Where a transaction changed the document, in the NEW document. */
const editedSpans = (transaction: Transaction): Span[] => {
  const spans: Span[] = []
  transaction.mapping.maps.forEach((map, index) => {
    const later = transaction.mapping.slice(index + 1)
    map.forEach((_oldStart, _oldEnd, from, to) => spans.push({ from: later.map(from, -1), to: later.map(to, 1) }))
  })
  return spans
}

const touches = (change: OutsideChange, spans: readonly Span[], doc: ProseNode): boolean => {
  const start = change.pos + 1
  const end = start + (doc.nodeAt(change.pos)?.content.size ?? 0)
  return spans.some((span) => span.from <= end && span.to >= start)
}

const mapSet = (set: ReadonlySet<number>, mapping: Mapping): ReadonlySet<number> => (set.size === 0 ? set : new Set([...set].map((pos) => mapping.map(pos, 1))))

/** YAZ-3989: around the changed words, the box shows at most this much of a line's same start and same end. */
const TIP_CONTEXT_CHARS = 60
/** Above this many word pairs to compare, the changed middle shows as all removed, then all new. */
const MAX_DIFF_CELLS = 10_000

const cut = (text: string): string => (text.length > REMOVED_TITLE_CHARS ? `${text.slice(0, REMOVED_TITLE_CHARS)}…` : text)
const removedTitle = (text: string): string => `Removed: ${cut(text)}`
const beforeTitle = (before: string | null): string => (before === null ? 'New line' : `Before: ${cut(before)}`)

/** A task's box first ("[ ]" → "[x]" is one piece), then words, spaces, and each mark of punctuation alone. */
const WORDS = /^\[[ x]\]|\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu

type DiffPart = OutsideChangeRow['parts'][number]

/** Word by word, `before` into `now`: the same start and end, then the longest common words of the middle. */
const wordDiff = (before: string, now: string): DiffPart[] => {
  // "Sam" → "Sam, urgent" adds ", urgent" and strikes nothing.
  const a = before.match(WORDS) ?? []
  const b = now.match(WORDS) ?? []
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let end = 0
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++
  const midA = a.slice(start, a.length - end)
  const midB = b.slice(start, b.length - end)
  const middle: DiffPart[] = []
  if (midA.length * midB.length > MAX_DIFF_CELLS) {
    middle.push(...midA.map((text) => ({ kind: 'del' as const, text })), ...midB.map((text) => ({ kind: 'ins' as const, text })))
  } else {
    // lcs[i][j]: the most words midA[i..] and midB[j..] have in common, in order.
    const lcs = Array.from({ length: midA.length + 1 }, () => new Array<number>(midB.length + 1).fill(0))
    for (let i = midA.length - 1; i >= 0; i--)
      for (let j = midB.length - 1; j >= 0; j--) lcs[i][j] = midA[i] === midB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    let i = 0
    let j = 0
    while (i < midA.length || j < midB.length) {
      if (i < midA.length && j < midB.length && midA[i] === midB[j]) middle.push({ kind: 'same', text: midA[i++] }), j++
      else if (j < midB.length && (i === midA.length || lcs[i][j + 1] >= lcs[i + 1][j])) middle.push({ kind: 'ins', text: midB[j++] })
      else middle.push({ kind: 'del', text: midA[i++] })
    }
  }
  // Removed words before the new ones, and one part for each run of a kind.
  const parts: DiffPart[] = []
  const push = (kind: DiffPart['kind'], text: string): void => {
    if (text === '') return
    const last = parts[parts.length - 1]
    if (last?.kind === kind) last.text += text
    else parts.push({ kind, text })
  }
  push('same', a.slice(0, start).join(''))
  let dels = ''
  let inss = ''
  for (const part of middle) {
    if (part.kind === 'del') dels += part.text
    else if (part.kind === 'ins') inss += part.text
    else {
      // A space alone between two changes joins them: "~~3500 euros~~ 4000 dollars", not word by word.
      if (/^\s+$/.test(part.text) && (dels !== '' || inss !== '')) {
        dels += dels === '' ? '' : part.text
        inss += inss === '' ? '' : part.text
        continue
      }
      push('del', dels.trimEnd())
      push('ins', inss.trimEnd())
      push('same', (dels.endsWith(' ') || inss.endsWith(' ') ? ' ' : '') + part.text)
      dels = ''
      inss = ''
    }
  }
  push('del', dels)
  push('ins', inss)
  push('same', a.slice(a.length - end).join(''))
  return parts
}

/** A long same start or end is cut to "…": the box and the row show the change, not the whole paragraph. */
const cutContext = (parts: DiffPart[]): DiffPart[] =>
  parts.map((part, index) =>
    part.kind !== 'same' || part.text.length <= TIP_CONTEXT_CHARS
      ? part
      : index === 0
        ? { ...part, text: `…${part.text.slice(-TIP_CONTEXT_CHARS)}` }
        : index === parts.length - 1
          ? { ...part, text: `${part.text.slice(0, TIP_CONTEXT_CHARS)}…` }
          : part,
  )

const removedParts = (text: string): DiffPart[] => [
  { kind: 'same', text: 'Removed: ' },
  { kind: 'del', text: cut(text) },
]

/** The line word by word, or null when its words did not change (a removed bullet beside it, a link or bold made). */
const lineParts = (doc: ProseNode, change: OutsideChange): DiffPart[] | null => {
  if (change.before === null) return null
  const parts = wordDiff(change.before, lineOf(doc.resolve(change.pos + 1)))
  return parts.some((part) => part.kind !== 'same') ? cutContext(parts) : null
}

/** A numbered list's row: the line word by word, a new line with its text, a removed bullet, or the line itself. */
const rowParts = (doc: ProseNode, change: OutsideChange): DiffPart[] => {
  const line = lineOf(doc.resolve(change.pos + 1))
  if (change.before === null) return [{ kind: 'same', text: 'New line: ' }, { kind: 'ins', text: cut(line) }]
  const parts = lineParts(doc, change)
  if (parts !== null) return parts
  const bullet = change.removed.find((mark) => !doc.resolve(mark.pos).parent.inlineContent)
  return bullet !== undefined ? removedParts(bullet.text) : [{ kind: 'same', text: `Changed: ${cut(line)}` }]
}

const tipText = (tag: 'span' | 'del' | 'ins', text: string): HTMLElement => {
  const el = document.createElement(tag)
  el.textContent = text
  return el
}

/** The box's content for a glow or a removed mark: the line word by word, "New line", or a removed bullet. */
const tipContent = (view: EditorView, target: HTMLElement): HTMLElement[] => {
  const fallback = [tipText('span', target.getAttribute(OUTSIDE_TIP_ATTR) ?? '')]
  const state = outsideKey.getState(view.state)
  if (state === undefined) return fallback
  const doc = view.state.doc
  const pos = view.posAtDOM(target, 0)
  const isMark = target.classList.contains(OUTSIDE_REMOVED_CLASS)
  // A removed mark is found by its place (a bullet's sits between blocks, before its change's block); a glow by its block.
  const change = state.changes.find((each) =>
    isMark ? each.removed.some((removed) => removed.pos === pos) : pos > each.pos && pos < each.pos + (doc.nodeAt(each.pos)?.nodeSize ?? 0),
  )
  if (change === undefined) return fallback
  const mark = change.removed.find((removed) => removed.pos === pos)
  const parts =
    mark !== undefined && target.classList.contains(`${OUTSIDE_REMOVED_CLASS}--between`)
      ? removedParts(mark.text)
      : change.before === null
        ? [{ kind: 'same' as const, text: 'New line' }]
        : lineParts(doc, change)
  return parts === null ? fallback : parts.map((part) => tipText(part.kind === 'same' ? 'span' : part.kind, part.text))
}

/** The box under the mouse: shown on mouse-over at once, hidden off a change, on any change of the list, and with the view. */
const createTip = (view: EditorView): { hide: () => void; destroy: () => void } => {
  let box: HTMLElement | null = null
  const hide = (): void => {
    if (box !== null) box.hidden = true
  }
  const onOver = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>(`[${OUTSIDE_TIP_ATTR}]`) : null
    if (target === null || !view.dom.contains(target)) return hide()
    if (box === null) {
      box = document.createElement('div')
      box.className = OUTSIDE_TIP_CLASS
      document.body.appendChild(box)
    }
    box.replaceChildren(...tipContent(view, target))
    box.hidden = false
    const rect = target.getBoundingClientRect()
    box.style.top = `${rect.bottom + 4}px`
    box.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - box.offsetWidth - 8))}px`
  }
  view.dom.addEventListener('mouseover', onOver)
  view.dom.addEventListener('mouseleave', hide)
  return {
    hide,
    destroy: () => {
      view.dom.removeEventListener('mouseover', onOver)
      view.dom.removeEventListener('mouseleave', hide)
      box?.remove()
    },
  }
}

/** D7: the thin red mark. Between two blocks (a bullet removed) it is a line, not a bar. */
const removedMark = (text: string, between: boolean, active: boolean) => (): HTMLElement => {
  const mark = document.createElement('span')
  mark.className = [OUTSIDE_REMOVED_CLASS, between ? `${OUTSIDE_REMOVED_CLASS}--between` : '', active ? OUTSIDE_ACTIVE_CLASS : ''].filter(Boolean).join(' ')
  mark.contentEditable = 'false'
  mark.setAttribute(OUTSIDE_TIP_ATTR, removedTitle(text))
  return mark
}

/** D8: Checked. The mousedown never moves the caret or takes the focus; the click checks off this change only. */
const checkedButton = (id: number) => (view: EditorView): HTMLElement => {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = OUTSIDE_CHECKED_CLASS
  button.contentEditable = 'false'
  button.textContent = 'Checked'
  button.addEventListener('mousedown', (event) => event.preventDefault())
  button.addEventListener('click', (event) => {
    event.preventDefault()
    view.dispatch(view.state.tr.setMeta(outsideKey, { type: 'check', id } satisfies OutsideMeta))
  })
  return button
}

const buildDecorations = (doc: ProseNode, changes: readonly OutsideChange[], activeId: number | null): DecorationSet => {
  if (changes.length === 0) return DecorationSet.empty
  const decorations: Decoration[] = []
  for (const change of changes) {
    const block = doc.nodeAt(change.pos)
    if (block === null) continue
    const active = change.id === activeId
    // A change with nothing to glow and no mark (an empty bullet added) wears the ring on its block.
    const ringOnBlock = active && change.glow.length === 0 && change.removed.length === 0
    decorations.push(Decoration.node(change.pos, change.pos + block.nodeSize, { class: ringOnBlock ? `${OUTSIDE_BLOCK_CLASS} ${OUTSIDE_ACTIVE_CLASS}` : OUTSIDE_BLOCK_CLASS }))
    const title = beforeTitle(change.before)
    for (const span of change.glow)
      decorations.push(Decoration.inline(span.from, span.to, { class: active ? `${OUTSIDE_CHANGE_CLASS} ${OUTSIDE_ACTIVE_CLASS}` : OUTSIDE_CHANGE_CLASS, [OUTSIDE_TIP_ATTR]: title }))
    for (const mark of change.removed) {
      const between = !doc.resolve(mark.pos).parent.inlineContent
      // The key names the text: a newer removal at the same place must draw its own tip, not reuse the old mark.
      const key = `outside-removed-${change.id}-${active ? 1 : 0}${between ? 1 : 0}-${mark.text.length}-${mark.text.slice(0, REMOVED_TITLE_CHARS)}`
      decorations.push(Decoration.widget(mark.pos, removedMark(mark.text, between, active), { side: -1, ignoreSelection: true, key }))
    }
    decorations.push(
      Decoration.widget(change.pos + 1 + block.content.size, checkedButton(change.id), { side: 1, ignoreSelection: true, stopEvent: () => true, key: `outside-checked-${change.id}` }),
    )
  }
  return DecorationSet.create(doc, decorations)
}

const snapshotOf = ({ changes, wholeNote }: OutsideState): OutsideChangesSnapshot => ({ count: changes.length, wholeNote })

const applyMeta = (meta: OutsideMeta, state: Omit<OutsideState, 'decorations'>): { next: Omit<OutsideState, 'decorations'>; redraw: boolean } => {
  switch (meta.type) {
    case 'check':
      return { next: { ...state, changes: state.changes.filter((change) => change.id !== meta.id) }, redraw: true }
    case 'clear':
      return { next: { ...state, changes: [], wholeNote: false, wholeNoteEnds: null, activeId: null }, redraw: true }
    case 'whole':
      return state.glow === 'off'
        ? { next: state, redraw: false }
        : { next: { ...state, changes: [], wholeNote: true, wholeNoteEnds: endsAt(state.glow, meta.now), activeId: null }, redraw: true }
    case 'glow': {
      // Off clears what shows; a timed glow starts every change's time now, and whole-note mode's.
      if (meta.glow === 'off') return { next: { ...state, glow: meta.glow, changes: [], wholeNote: false, wholeNoteEnds: null, activeId: null }, redraw: true }
      const ends = endsAt(meta.glow, meta.now)
      return { next: { ...state, glow: meta.glow, changes: state.changes.map((change) => ({ ...change, ends })), wholeNoteEnds: state.wholeNote ? ends : null }, redraw: false }
    }
    case 'expire': {
      const changes = state.changes.filter((change) => change.ends === null || change.ends > meta.now)
      const wholeNoteEnded = state.wholeNoteEnds !== null && state.wholeNoteEnds <= meta.now
      if (changes.length === state.changes.length && !wholeNoteEnded) return { next: state, redraw: false }
      return { next: { ...state, changes, ...(wholeNoteEnded ? { wholeNote: false, wholeNoteEnds: null } : {}) }, redraw: true }
    }
    case 'active':
      return { next: { ...state, activeId: meta.id, revealed: meta.revealed, revealedHeadings: meta.revealedHeadings }, redraw: true }
    case 'restore':
      return state.glow === 'off' ? { next: state, redraw: false } : { next: { ...state, changes: meta.changes, lastNumber: meta.lastNumber }, redraw: true }
  }
}

/** Where a position of `doc` was before the transform: the Before of a change (YAZ-3947); a start inside what it inserted is a new line. */
const beforeThrough = (mapping: Mapping, doc: ProseNode) => (pos: number): string | null => {
  const result = mapping.invert().mapResult(pos + 1, -1)
  const $old = doc.resolve(result.pos)
  return result.deletedAcross || !$old.parent.isTextblock ? null : lineOf($old)
}

/**
 * A kept list back on the note its tab shows again (YAZ-3704 demo feedback): as it was, when the note is the same; when
 * the note changed while the tab was away, the kept list goes through the diff from the doc it was drawn on to the note
 * now, and what changed glows as one outside save would, numbered after it. Never the doc itself: folds, caret and
 * history stay. Null: nothing fits (a rewrite, or a diff that does not give the note now).
 */
const keptBack = (kept: SavedOutsideChanges, doc: ProseNode, glow: OutsideChangeGlow): OutsideMeta | null => {
  if (shapeOf(doc) === kept.shape) return { type: 'restore', changes: kept.changes as OutsideChange[], lastNumber: kept.lastNumber }
  let old: ProseNode
  try {
    old = doc.type.schema.nodeFromJSON(kept.doc)
  } catch {
    return null
  }
  const target = withTrailingParagraphOf(old, doc)
  const ranges = diffDocs(old, target)
  if (ranges.some(({ from, to }) => to - from >= old.content.size * REWRITE_SHARE)) return { type: 'whole', now: Date.now() }
  const away = new Transform(old)
  const landed = replaceTracked(away, ranges, old)
  if (!away.doc.eq(target)) return null
  let last = kept.lastNumber
  const mapped = mapChanges(kept.changes as OutsideChange[], away.mapping, away.doc)
  const changes = addRanges(mapped, landed, away.doc, endsAt(glow, Date.now()), beforeThrough(away.mapping, old), () => ++last)
  return { type: 'restore', changes, lastNumber: last }
}

/** The engine behind the channel's commands. Every transaction it sends is metadata-only. */
const createController = (view: EditorView, channel: OutsideChangesChannel): OutsideChangesController => {
  const current = (): OutsideState | undefined => outsideKey.getState(view.state)
  const dispatchMeta = (meta: OutsideMeta): void => view.dispatch(view.state.tr.setMeta(outsideKey, meta))
  const fold = (positions: Iterable<number>, collapsed: boolean): void => {
    setOutlineFoldSet([...positions], collapsed, { silent: true })(view.state, view.dispatch)
  }
  const foldHeadings = (positions: Iterable<number>, collapsed: boolean): void => {
    setHeadingFoldSet([...positions], collapsed, { silent: true })(view.state, view.dispatch)
  }
  /** Next and a row's click (D9, YAZ-3998): the ring on `target`, its folds opened, scrolled into view. */
  const goTo = (target: OutsideChange): void => {
    const state = current()
    if (state === undefined) return
    // Moving on: what Next opened for the last change folds again first.
    fold(state.revealed, true)
    foldHeadings(state.revealedHeadings, true)
    const zoomed = getZoomedItemPos(view.state)
    const item = zoomed === null ? null : view.state.doc.nodeAt(zoomed)
    if (zoomed !== null && item !== null && (target.pos < zoomed || target.pos >= zoomed + item.nodeSize) && zoomToKey(null)(view.state, view.dispatch))
      channel.zoomedOut()
    const inside = target.pos + 1
    const revealed = new Set(collapsedItemsHiding(view.state, inside))
    const revealedHeadings = new Set(collapsedHeadingsHiding(view.state, inside))
    fold(revealed, false)
    foldHeadings(revealedHeadings, false)
    dispatchMeta({ type: 'active', id: target.id, revealed, revealedHeadings })
    // The ring, not the caret: the selection stays where the reader left it. jsdom has no scrollIntoView.
    const { node } = view.domAtPos(inside)
    const element = view.dom.querySelector(`.${OUTSIDE_ACTIVE_CLASS}`) ?? (node instanceof Element ? node : node.parentElement)
    element?.scrollIntoView?.({ block: 'center' })
    // The table of contents' landing flash on the change's line (YAZ-3704 demo, 4H), so a row lands as a TOC click does. jsdom has no `animate`.
    const line = view.nodeDOM(target.pos)
    if (line instanceof HTMLElement && typeof line.animate === 'function' && !reducedMotion())
      line.animate(FLASH_FRAMES, { duration: FLASH_MS, easing: 'ease-out' })
  }
  const byNumber = (): OutsideChange[] => [...(current()?.changes ?? [])].sort((a, b) => a.number - b.number)
  return {
    next: () => {
      const ordered = byNumber()
      if (ordered.length === 0) return
      const index = ordered.findIndex((change) => change.id === current()?.activeId)
      goTo(ordered[(index + 1) % ordered.length])
    },
    go: (id) => {
      const target = current()?.changes.find((change) => change.id === id)
      if (target !== undefined) goTo(target)
    },
    rows: () => {
      const activeId = current()?.activeId ?? null
      return byNumber().map((change) => ({ id: change.id, number: change.number, active: change.id === activeId, parts: rowParts(view.state.doc, change) }))
    },
    clear: () => {
      const state = current()
      if (state === undefined) return
      // `findInPage.ts` close(): fold back all that Next opened, then open again what hides the active change.
      // The landing stays open (YAZ-3844: a keep-set read before the fold back is empty, as Next opened it already).
      const active = state.changes.find((change) => change.id === state.activeId)
      fold(state.revealed, true)
      foldHeadings(state.revealedHeadings, true)
      if (active !== undefined) {
        fold(collapsedItemsHiding(view.state, active.pos + 1), false)
        foldHeadings(collapsedHeadingsHiding(view.state, active.pos + 1), false)
      }
      dispatchMeta({ type: 'clear' })
    },
    markWholeNote: () => dispatchMeta({ type: 'whole', now: Date.now() }),
    setGlow: (glow) => dispatchMeta({ type: 'glow', glow, now: Date.now() }),
  }
}

/** The change list, registered by `createCrepe` when the host hands it the channel. */
export const createOutsideChanges = (channel: OutsideChangesChannel) =>
  $prose(
    () =>
      new Plugin<OutsideState>({
        key: outsideKey,
        state: {
          init: () => ({ changes: [], activeId: null, lastNumber: 0, version: 0, wholeNote: false, wholeNoteEnds: null, glow: channel.getGlow(), revealed: NONE, revealedHeadings: NONE, decorations: DecorationSet.empty }),
          apply: (transaction, previous, oldState, newState) => {
            const meta: OutsideMeta | undefined = transaction.getMeta(outsideKey)
            const ranges: OutsideRange[] | undefined = transaction.getMeta(OUTSIDE_RANGES_META)
            // The usual keystroke: nothing in the list, nothing to map.
            if (meta === undefined && ranges === undefined && (!transaction.docChanged || (previous.changes.length === 0 && previous.revealed.size === 0 && previous.revealedHeadings.size === 0)))
              return previous
            const doc = newState.doc
            const { decorations: drawn, ...rest } = previous
            let state = rest
            let redraw = false
            if (transaction.docChanged) {
              let changes = mapChanges(state.changes, transaction.mapping, doc)
              if (isUserEdit(transaction) && changes.length > 0) {
                const spans = editedSpans(transaction)
                changes = changes.filter((change) => !touches(change, spans, doc))
              }
              redraw = changes.length !== state.changes.length
              state = { ...state, changes, revealed: mapSet(state.revealed, transaction.mapping), revealedHeadings: mapSet(state.revealedHeadings, transaction.mapping) }
            }
            if (ranges !== undefined && ranges.length > 0 && state.glow !== 'off' && !state.wholeNote) {
              // Before (YAZ-3947): the block's content start, back through this transaction.
              const beforeOf = beforeThrough(transaction.mapping, oldState.doc)
              // YAZ-3998: numbers in the order the changes came; an empty list starts at 1 again.
              let last = state.changes.length === 0 ? 0 : state.lastNumber
              state = { ...state, changes: addRanges(state.changes, ranges, doc, endsAt(state.glow, Date.now()), beforeOf, () => ++last) }
              state = { ...state, lastNumber: last }
              redraw = true
            }
            if (meta !== undefined) {
              const applied = applyMeta(meta, state)
              state = applied.next
              redraw ||= applied.redraw
            }
            if (state.changes.length > MAX_CHANGES) {
              state = { ...state, changes: [], wholeNote: true, wholeNoteEnds: endsAt(state.glow, Date.now()) }
              redraw = true
            }
            if (state.activeId !== null && !state.changes.some((change) => change.id === state.activeId)) state = { ...state, activeId: null }
            // A list that empties leaves the landing open: what Next opened hides the active change.
            if (state.changes.length === 0) state = { ...state, revealed: NONE, revealedHeadings: NONE }
            const decorations = redraw ? buildDecorations(doc, state.changes, state.activeId) : transaction.docChanged ? drawn.map(transaction.mapping, doc) : drawn
            return { ...state, version: redraw ? state.version + 1 : state.version, decorations }
          },
        },
        props: {
          decorations: (state) => outsideKey.getState(state)?.decorations ?? DecorationSet.empty,
        },
        view: (editorView) => {
          const unbind = channel.bind(createController(editorView, channel))
          // D5: one timer for the view, set to the soonest end of a timed glow (a change's, or whole-note mode's).
          let timer: ReturnType<typeof setTimeout> | undefined
          let timerAt = Infinity
          const sync = () => {
            const state = outsideKey.getState(editorView.state)
            if (state === undefined) return
            channel.sync(snapshotOf(state), state.version)
            const soonest = state.changes.reduce((min, change) => Math.min(min, change.ends ?? Infinity), state.wholeNoteEnds ?? Infinity)
            if (soonest === timerAt && (timer !== undefined || soonest === Infinity)) return
            clearTimeout(timer)
            timer = undefined
            timerAt = soonest
            if (soonest === Infinity) return
            timer = setTimeout(() => {
              timer = undefined
              editorView.dispatch(editorView.state.tr.setMeta(outsideKey, { type: 'expire', now: Date.now() } satisfies OutsideMeta))
            }, Math.max(0, soonest - Date.now()))
          }
          sync()
          const tip = createTip(editorView)
          // The list this tab kept for the page while it showed another (a link, then Back), with what changed meanwhile.
          const kept = channel.readSaved()
          let destroyed = false
          if (kept !== null)
            queueMicrotask(() => {
              const state = outsideKey.getState(editorView.state)
              const meta = destroyed || state === undefined ? null : keptBack(kept, editorView.state.doc, state.glow)
              if (meta !== null) editorView.dispatch(editorView.state.tr.setMeta(outsideKey, meta))
            })
          return {
            update: (_view, previous) => {
              // A change checked off, mapped or redrawn: what the box showed may be gone.
              if (outsideKey.getState(editorView.state) !== outsideKey.getState(previous)) tip.hide()
              sync()
            },
            destroy: () => {
              destroyed = true
              clearTimeout(timer)
              tip.destroy()
              unbind()
              const state = outsideKey.getState(editorView.state)
              channel.save(
                state === undefined || state.changes.length === 0
                  ? null
                  : { shape: shapeOf(editorView.state.doc), doc: editorView.state.doc.toJSON(), changes: state.changes, lastNumber: state.lastNumber },
              )
            },
          }
        },
      }),
  )
