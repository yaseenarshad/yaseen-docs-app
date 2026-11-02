/**
 * Lock one row open (YAZ-4094 demo, 4A): a bullet or a heading that must never fold, so the reader knows they see all of
 * it. The row's menu has "Lock open" / "Unlock" (`foldAllRows.ts`); the row's chevron shows a lock (`foldLock.css`).
 *
 * A lock blocks every fold that would hide part of the row: the row itself, a row inside it, and a row that holds it
 * (folding a parent would hide the locked row too). The fold plugins know nothing of it: after any transaction that
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
import { addHeadingFoldSetMeta, hasHeadingFoldMeta, headingCollapsedPositions, headingFoldRows, headingLevel } from './headingFolding'
import { addOutlineFoldSetMeta, hasOutlineFoldMeta, outlineCollapsedPositions, outlineFoldRows } from './outlineFolding'

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

/** Whether a lock stops the row at `pos` from folding: it is locked, sits inside a locked row, or holds one. */
export const foldLockBlocks = (state: EditorState, pos: number): boolean => {
  const locked = pluginKey.getState(state)
  if (locked === undefined || locked.size === 0) return false
  const row = rowRange(state.doc, pos)
  if (row === null) return false
  for (const lockedPos of locked) {
    const lock = rowRange(state.doc, lockedPos)
    if (lock !== null && ((lock.from <= row.from && row.to <= lock.to) || (row.from <= lock.from && lock.to <= row.to))) return true
  }
  return false
}

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
              next = new Set()
              for (const pos of locked) {
                const mapped = transaction.mapping.mapResult(pos, 1)
                if (!mapped.deletedAfter) (next as Set<number>).add(mapped.pos)
              }
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
        appendTransaction: (transactions, _oldState, state) => {
          const locked = pluginKey.getState(state)
          if (locked === undefined || locked.size === 0) return null
          const folds = transactions.some((tr) => tr.docChanged || hasOutlineFoldMeta(tr) || hasHeadingFoldMeta(tr) || tr.getMeta(pluginKey) !== undefined)
          if (!folds) return null
          const bullets = [...outlineCollapsedPositions(state)].filter((pos) => foldLockBlocks(state, pos))
          const headings = [...headingCollapsedPositions(state)].filter((pos) => foldLockBlocks(state, pos))
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
          handleDOMEvents: {
            mousedown: (view, event) => {
              const toggle = (event.target as Element | null)?.closest?.('.outline-toggle, .heading-toggle')
              if (!toggle || !view.dom.contains(toggle)) return false
              // The chevron widget sits at the row's position + 1.
              if (foldLockBlocks(view.state, view.posAtDOM(toggle, 0) - 1)) onBlocked?.()
              return false
            },
          },
        },
        view: (view) => {
          let previous: string | null = null
          const notify = () => {
            const locked = pluginKey.getState(view.state)
            if (locked === undefined || onLockedKeysChange === undefined) return
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
          return { update: notify }
        },
      }),
  )
