/**
 * Lock one row open (YAZ-4094 demo, 4A): a bullet or a heading that must never fold, so the reader knows they see all of
 * it. The row's menu has "Lock open" / "Unlock" (`foldAllRows.ts`); the row's chevron shows a lock (`foldLock.css`).
 *
 * A lock blocks the row's own fold and the folds of the rows inside it. A row that holds it still folds (user, 4A): what
 * you lock is what stays open, so to keep a parent open you lock the parent. The fold plugins know nothing of it: after any transaction that
 * folds, this plugin appends a silent unfold of each blocked fold (`appendTransaction`), so every fold path — the
 * chevron, ⌘↑, Collapse all, the guide line — obeys it. A press on a blocked chevron shows the host's message.
 *
 * Locks are view state like folds: positions mapped through edits, saved by key (`lock:` + the row's fold key) in the
 * same `folders[root].folds` bucket. Renaming a row loses its lock, as it loses its fold.
 * Registered after both fold plugins: its `init` reads their rows.
 */
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { type Command, type EditorState, Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { isFoldingOn, turnsFoldingOn } from './foldingSwitch'
import { addHeadingFoldSetMeta, hasHeadingFoldMeta, headingCollapsedAfter, headingCollapsedPositions, headingFoldRows, headingLevel } from './headingFolding'
import { addOutlineFoldSetMeta, hasOutlineFoldMeta, outlineCollapsedAfter, outlineCollapsedPositions, outlineFoldRows } from './outlineFolding'

const pluginKey = new PluginKey<ReadonlySet<number>>('mdapp-fold-lock')

export const FOLD_LOCK_ATTR = 'data-fold-locked'
export const FOLD_LOCKED_NOTICE = 'A lock keeps this row open. Unlock it in the row’s menu.'
const LOCK_PREFIX = 'lock:'

export interface FoldLockOptions {
  /** The saved `lock:` keys, read on every state init. */
  seedLockedKeys?: () => ReadonlySet<string>
  /** Called with the sorted `lock:` keys whenever the set changes. */
  onLockedKeysChange?: (keys: readonly string[]) => void
  /** A press on a chevron that a lock blocks. */
  onBlocked?: () => void
}

/** The rows a fold key can name: the foldable bullets and headings. */
const foldRows = (state: EditorState) => [...outlineFoldRows(state), ...headingFoldRows(state)]

/** What a row's fold hides, with the row: a bullet's node, or a heading and its section. */
const rowRange = (doc: ProseNode, pos: number): { from: number; to: number } | null => {
  const node = doc.nodeAt(pos)
  if (node === null) return null
  const level = headingLevel(node)
  if (level === null) return { from: pos, to: pos + node.nodeSize }
  const $pos = doc.resolve(pos)
  let to = pos + node.nodeSize
  for (let i = $pos.index() + 1; i < $pos.parent.childCount; i++) {
    const sibling = $pos.parent.child(i)
    const siblingLevel = headingLevel(sibling)
    if (siblingLevel !== null && siblingLevel <= level) break
    to += sibling.nodeSize
  }
  return { from: pos, to }
}

export const isFoldLocked = (state: EditorState, pos: number): boolean => pluginKey.getState(state)?.has(pos) ?? false

/** What each lock holds open: the locked row with what its fold hides. Measured once per check, never per row. */
const lockRanges = (state: EditorState): { from: number; to: number }[] => {
  const locked = pluginKey.getState(state)
  if (locked === undefined || locked.size === 0) return []
  return [...locked].map((pos) => rowRange(state.doc, pos)).filter((range): range is { from: number; to: number } => range !== null)
}

/**
 * Whether a row that starts at `pos` is held: it is a locked row, or starts inside one. A row that starts inside a
 * lock also ends inside it — a bullet inside a bullet, or a heading inside a section, which is deeper and so ends
 * with it — so its start alone decides. A row that holds a locked row starts before it and still folds (user, 4A).
 */
const held = (ranges: readonly { from: number; to: number }[], pos: number): boolean => ranges.some(({ from, to }) => from <= pos && pos < to)

/** Whether a lock stops the row at `pos` from folding: it is locked, or sits inside a locked row. */
export const foldLockBlocks = (state: EditorState, pos: number): boolean => held(lockRanges(state), pos)

/** Lock the row at `pos` open, or unlock it. Not an edit: ⌘Z never undoes it. Locking opens the folds it blocks. */
export const toggleFoldLock =
  (pos: number): Command =>
  (state, dispatch) => {
    dispatch?.(state.tr.setMeta(pluginKey, pos).setMeta('addToHistory', false))
    return true
  }

export const createFoldLock = ({ seedLockedKeys = () => new Set(), onLockedKeysChange, onBlocked }: FoldLockOptions = {}) =>
  $prose(
    () =>
      new Plugin<ReadonlySet<number>>({
        key: pluginKey,
        state: {
          init: (_config, state) => {
            const seed = seedLockedKeys()
            if (seed.size === 0) return new Set()
            return new Set(foldRows(state).filter(({ foldKey }) => seed.has(LOCK_PREFIX + foldKey)).map(({ pos }) => pos))
          },
          apply: (transaction, locked) => {
            let next = locked
            if (transaction.docChanged && locked.size > 0) {
              const mapped = new Set<number>()
              for (const pos of locked) {
                // The lock stays while a node of the same type starts where the row maps to and the row's start was
                // not deleted: typing in it, a rewrite of the node in place (Milkdown's heading id sets a heading's
                // attributes after each edit and on load, YAZ-4131) and Enter at its end (YAZ-4136) keep it; a deleted
                // row loses it.
                const before = transaction.before.nodeAt(pos)
                if (before === null || transaction.mapping.mapResult(pos + 1).deletedAcross) continue
                const from = transaction.mapping.map(pos, 1)
                if (transaction.doc.nodeAt(from)?.type === before.type) mapped.add(from)
              }
              // The same set when no lock moved: typing below every lock reports nothing (the view's `notify`).
              if (mapped.size !== locked.size || [...locked].some((pos) => !mapped.has(pos))) next = mapped
            }
            const meta: unknown = transaction.getMeta(pluginKey)
            if (typeof meta === 'number') {
              const toggled = new Set(next)
              if (toggled.has(meta)) toggled.delete(meta)
              else toggled.add(meta)
              next = toggled
            }
            return next
          },
        },
        // A fold that the locks block entirely never happens (YAZ-4132, YAZ-4133): it would change nothing on screen,
        // yet the fold-all button would count it and ⌘Z would spend itself on it. Only a transaction that changes no
        // document, sets no selection, opens no fold, and folds only held rows. The lock's own unfold opens folds, so it passes.
        filterTransaction: (transaction, state) => {
          if (transaction.docChanged || transaction.selectionSet || !(hasOutlineFoldMeta(transaction) || hasHeadingFoldMeta(transaction))) return true
          const ranges = lockRanges(state)
          if (ranges.length === 0) return true
          const foldsOnlyHeld = (before: ReadonlySet<number>, after: ReadonlySet<number>): boolean =>
            [...before].every((pos) => after.has(pos)) && [...after].every((pos) => before.has(pos) || held(ranges, pos))
          return !(
            foldsOnlyHeld(outlineCollapsedPositions(state), outlineCollapsedAfter(state, transaction)) &&
            foldsOnlyHeld(headingCollapsedPositions(state), headingCollapsedAfter(state, transaction))
          )
        },
        appendTransaction: (transactions, _oldState, state) => {
          const locked = pluginKey.getState(state)
          // Folding off (YAZ-4094 F1): the fold plugins ignore each request, and the saved folds wait. So does the lock,
          // until folding is on again: then it opens the saved folds that it holds.
          if (locked === undefined || locked.size === 0 || !isFoldingOn(state)) return null
          const folds = transactions.some((tr) => tr.docChanged || hasOutlineFoldMeta(tr) || hasHeadingFoldMeta(tr) || tr.getMeta(pluginKey) !== undefined || turnsFoldingOn(tr))
          if (!folds) return null
          const ranges = lockRanges(state)
          const bullets = [...outlineCollapsedPositions(state)].filter((pos) => held(ranges, pos))
          const headings = [...headingCollapsedPositions(state)].filter((pos) => held(ranges, pos))
          if (bullets.length === 0 && headings.length === 0) return null
          const tr = state.tr.setMeta('addToHistory', false)
          addOutlineFoldSetMeta(tr, bullets, false)
          addHeadingFoldSetMeta(tr, headings, false)
          return tr
        },
        props: {
          decorations: (state) => {
            const locked = pluginKey.getState(state)
            if (locked === undefined || locked.size === 0) return DecorationSet.empty
            const decorations: Decoration[] = []
            for (const pos of locked) {
              const node = state.doc.nodeAt(pos)
              if (node !== null && (node.type.name === 'list_item' || node.type.name === 'heading')) decorations.push(Decoration.node(pos, pos + node.nodeSize, { [FOLD_LOCK_ATTR]: 'true' }))
            }
            return DecorationSet.create(state.doc, decorations)
          },
        },
        view: (view) => {
          // A press on a blocked chevron. A capture listener, not `handleDOMEvents`: each chevron cancels its own
          // `mousedown`, and ProseMirror then stops at the first plugin that handles one (YAZ-4126).
          const onMouseDown = (event: MouseEvent): void => {
            const toggle = (event.target as Element | null)?.closest?.('.outline-toggle, .heading-toggle')
            if (!toggle || !view.dom.contains(toggle)) return
            // The chevron widget sits at the row's position + 1.
            if (foldLockBlocks(view.state, view.posAtDOM(toggle, 0) - 1)) onBlocked?.()
          }
          view.dom.addEventListener('mousedown', onMouseDown, true)
          let previous: string | null = null
          /** The lock set of the last report: a transaction that keeps it (no lock, no edit) costs nothing. */
          let reported: ReadonlySet<number> | undefined
          const notify = () => {
            const locked = pluginKey.getState(view.state)
            if (locked === undefined || onLockedKeysChange === undefined || locked === reported) return
            reported = locked
            const keys = foldRows(view.state)
              .filter(({ pos }) => locked.has(pos))
              .map(({ foldKey }) => LOCK_PREFIX + foldKey)
              .sort()
            const serialized = keys.join(' ')
            if (previous === null) {
              previous = serialized
              return
            }
            if (serialized !== previous) {
              previous = serialized
              onLockedKeysChange(keys)
            }
          }
          notify()
          return { update: notify, destroy: () => view.dom.removeEventListener('mousedown', onMouseDown, true) }
        },
      }),
  )
