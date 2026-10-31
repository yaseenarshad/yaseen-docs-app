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
 * The list (D3) lives in plugin state, memory only, for this editor: gone when the editor is destroyed,
 * nothing saved. Every position is mapped through every transaction, as find and the fold plugin map
 * theirs. One change is one TEXTBLOCK (D4): ranges in one line are one change, and a range across several
 * textblocks (bullets added) is one change for each. More than `MAX_CHANGES` empties the list into
 * whole-note mode, with no glow.
 *
 * Drawing: the changed words glow (inline `outside-change`), and their hover shows the line as it was before the
 * first outside edit of it, or "New line" (YAZ-3947; kept with the change, in memory only); removed text is a thin red mark with the text
 * in its title (D7, a widget: not in the doc, never copied or saved); each changed textblock carries a node
 * class that shows its **Checked** button on hover (D8). The DecorationSet lives in the state and is built
 * again only when the list changes; a keystroke only maps it.
 *
 * Check off (D8): **Checked**, **Mark all checked**, the Glow time (D5), or the user's OWN edit in a
 * change's textblock — never an outside edit, an undo or redo, a transaction a plugin appends, or one kept out
 * of the history (Milkdown's heading-id sync after an outside heading edit, YAZ-3844). A timed Glow ends
 * whole-note mode at the same time; until checked, it stays until Dismiss.
 *
 * Next change (D9), `findInPage.ts`'s fold books: the folds that hide the next change open SILENTLY
 * (⌘Z panic-undo untouched) and fold again when Next moves on. Mark all checked, or a list that empties,
 * leaves the folds that hide the active change open: the landing. Outside the zoomed bullet, the page
 * zooms out first and the host tells the tab.
 */
import type { Node as ProseNode, ResolvedPos } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, Selection, type Transaction } from '@milkdown/kit/prose/state'
import type { Mapping } from '@milkdown/kit/prose/transform'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import type { OutsideChangeGlow } from '@shared/types'
import { collapsedHeadingsHiding, setHeadingFoldSet } from '../outline/headingFolding'
import { collapsedItemsHiding, setOutlineFoldSet } from '../outline/outlineFolding'
import { getZoomedItemPos, zoomToKey } from '../outline/zoom'
import { EXTERNAL_EDIT_META, OUTSIDE_RANGES_META, type OutsideRange } from './applyExternalMarkdown'
import type { OutsideChangesChannel, OutsideChangesController, OutsideChangesSnapshot } from './outsideChangesChannel'

export const OUTSIDE_CHANGE_CLASS = 'outside-change'
/** The change Next put the ring on carries this IN ADDITION to its own class. */
export const OUTSIDE_ACTIVE_CLASS = 'outside-change--active'
export const OUTSIDE_REMOVED_CLASS = 'outside-removed'
/** On each changed textblock: its hover shows the Checked button (outsideChanges.css). */
export const OUTSIDE_BLOCK_CLASS = 'outside-change-block'
export const OUTSIDE_CHECKED_CLASS = 'outside-checked'

/** D3: above this many changes the list empties and the note is "changed as a whole". */
export const MAX_CHANGES = 200
/** D7: a removed text longer than this is cut in the mark's title, with "…"; so is a Before line (YAZ-3947). */
const REMOVED_TITLE_CHARS = 200
/** One change keeps at most this many removed marks, the newest (YAZ-3844): an agent that saves one line again and again adds no more. */
export const MAX_REMOVED_PER_CHANGE = 5

interface Span {
  from: number
  to: number
}

interface OutsideChange {
  id: number
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

/** New outside ranges into the list: a range in a block that has a change already joins it (D4) and keeps its Before. */
const addRanges = (
  changes: readonly OutsideChange[],
  ranges: readonly OutsideRange[],
  doc: ProseNode,
  ends: number | null,
  beforeOf: (pos: number) => string | null,
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
        pos,
        before: old === undefined ? beforeOf(pos) : old.before,
        glow: glow === null ? (old?.glow ?? []) : [...(old?.glow ?? []), glow],
        removed,
        // A new outside edit in the block starts its time again.
        ends,
      })
    })
  }
  return [...byPos.values()].sort((a, b) => a.pos - b.pos)
}

/**
 * Every change through `mapping`; a change whose textblock is gone (or replaced whole) goes. The CONTENT start is
 * what maps: an attr-only change of the block (`setNodeMarkup`, as the heading-id sync does) re-writes the block's
 * opening token but keeps its content, so the change stays (YAZ-3844).
 */
const mapChanges = (changes: readonly OutsideChange[], mapping: Mapping, doc: ProseNode): OutsideChange[] => {
  const mapped: OutsideChange[] = []
  for (const change of changes) {
    const start = mapping.mapResult(change.pos + 1, -1)
    const pos = start.pos - 1
    if (start.deletedAfter || pos < 0 || doc.nodeAt(pos)?.isTextblock !== true) continue
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

const cut = (text: string): string => (text.length > REMOVED_TITLE_CHARS ? `${text.slice(0, REMOVED_TITLE_CHARS)}…` : text)
const removedTitle = (text: string): string => `Removed: ${cut(text)}`
const beforeTitle = (before: string | null): string => (before === null ? 'New line' : `Before: ${cut(before)}`)

/** D7: the thin red mark. Between two blocks (a bullet removed) it is a line, not a bar. */
const removedMark = (text: string, between: boolean, active: boolean) => (): HTMLElement => {
  const mark = document.createElement('span')
  mark.className = [OUTSIDE_REMOVED_CLASS, between ? `${OUTSIDE_REMOVED_CLASS}--between` : '', active ? OUTSIDE_ACTIVE_CLASS : ''].filter(Boolean).join(' ')
  mark.contentEditable = 'false'
  mark.title = removedTitle(text)
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
      decorations.push(Decoration.inline(span.from, span.to, { class: active ? `${OUTSIDE_CHANGE_CLASS} ${OUTSIDE_ACTIVE_CLASS}` : OUTSIDE_CHANGE_CLASS, title }))
    for (const mark of change.removed) {
      const between = !doc.resolve(mark.pos).parent.inlineContent
      // The key names the text: a newer removal at the same place must draw its own title, not reuse the old mark.
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
  }
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
  return {
    next: () => {
      const state = current()
      if (state === undefined || state.changes.length === 0) return
      const index = state.changes.findIndex((change) => change.id === state.activeId)
      const target = state.changes[(index + 1) % state.changes.length]
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
          init: () => ({ changes: [], activeId: null, wholeNote: false, wholeNoteEnds: null, glow: channel.getGlow(), revealed: NONE, revealedHeadings: NONE, decorations: DecorationSet.empty }),
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
              // Before (YAZ-3947): the block's content start, back through this transaction; a start inside what it inserted is a new line.
              const back = transaction.mapping.invert()
              const beforeOf = (pos: number): string | null => {
                const result = back.mapResult(pos + 1, -1)
                const $old = oldState.doc.resolve(result.pos)
                return result.deletedAcross || !$old.parent.isTextblock ? null : lineOf($old)
              }
              state = { ...state, changes: addRanges(state.changes, ranges, doc, endsAt(state.glow, Date.now()), beforeOf) }
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
            return { ...state, decorations }
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
            channel.sync(snapshotOf(state))
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
          return {
            update: sync,
            destroy: () => {
              clearTimeout(timer)
              unbind()
            },
          }
        },
      }),
  )
