/**
 * Collapsible parent bullets (GRO-2011). Ported from yaseen-excalidraw
 * `docs/outlineFolding.ts`; logic unchanged apart from always reporting the
 * resolved key set once on mount (so persisted keys that no longer resolve get pruned).
 *
 * Design: fold state lives ONLY in plugin state (the document's outline entries + the collapsed
 * list_item positions, mapped through every transaction) + decorations. Toggling dispatches a
 * metadata-only transaction (`tr.setMeta(pluginKey, itemPos)`), so `tr.docChanged` is false, the
 * listener plugin never fires `markdownUpdated`, and the markdown on disk is untouched.
 * Persistence is by stable fold key (see outlineFoldKeys.ts), not by position.
 * ⌘Z panic-undo (GRO-2075): the state also remembers the most recent fold action while it is
 * the latest USER action; `undoLastFold` (bound to Mod-z in hotkeys.ts) reverts exactly that.
 */
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { type Command, type EditorState, Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { findNestedLists } from './listNodes'
import { getOutlineFoldKey } from './outlineFoldKeys'

interface OutlineEntry {
  foldKey: string
  itemPos: number
  label: string
  /** Document ranges of every nested list (mixed markers parse as sibling lists; folding hides them all). */
  nestedListRanges: readonly { from: number; to: number }[]
}

/** The most recent fold action while it is still the latest action (GRO-2075 panic-undo). */
type LastToggle =
  | { kind: 'toggle'; itemPos: number }
  /** fold-all / unfold-all: the collapsed set as it was right before the action. */
  | { kind: 'set'; previousCollapsed: ReadonlySet<number> }

interface OutlineFoldingState {
  /** Every list_item that owns a nested list, in document order (recomputed per transaction). */
  entries: readonly OutlineEntry[]
  collapsedItemPositions: ReadonlySet<number>
  /** Cleared by any document change: ⌘Z only reverts a fold that is the latest action. */
  lastToggle: LastToggle | null
}

export interface OutlineFoldingOptions {
  initialCollapsedKeys?: ReadonlySet<string>
  /** Called with the sorted live collapsed keys whenever the set changes (and once on mount). */
  onCollapsedKeysChange?: (keys: readonly string[]) => void
}

export const OUTLINE_TOGGLE_CLASS = 'outline-toggle'
export const OUTLINE_FOLDED_ATTR = 'data-outline-folded'

/** Shared across instances: a PluginKey only identifies the plugin within one EditorState. */
const pluginKey = new PluginKey<OutlineFoldingState>('mdapp-outline-folding')

/** Transaction meta understood by the plugin: toggle one item (by position), fold/unfold every parent, or revert the latest fold. */
type FoldMeta = number | 'fold-all' | 'unfold-all' | 'undo-fold'

/** Whether the list_item starting at `itemPos` is currently folded (false when the plugin is absent). */
export const isOutlineItemCollapsed = (state: EditorState, itemPos: number): boolean =>
  pluginKey.getState(state)?.collapsedItemPositions.has(itemPos) ?? false

const foldAllCommand = (meta: 'fold-all' | 'unfold-all'): Command => (state, dispatch) => {
  const foldingState = pluginKey.getState(state)
  if (!foldingState || foldingState.entries.length === 0) return false
  const allCollapsed = foldingState.entries.every(({ itemPos }) => foldingState.collapsedItemPositions.has(itemPos))
  if (meta === 'fold-all' ? allCollapsed : foldingState.collapsedItemPositions.size === 0) return false
  dispatch?.(state.tr.setMeta(pluginKey, meta))
  return true
}

/** Toggle the fold of the parent list_item at `itemPos` (GRO-2030 guide-line click); metadata-only. */
export const toggleOutlineFold = (itemPos: number): Command => (state, dispatch) => {
  const foldingState = pluginKey.getState(state)
  if (!foldingState) return false
  const isParent = foldingState.entries.some((entry) => entry.itemPos === itemPos)
  if (!isParent && !foldingState.collapsedItemPositions.has(itemPos)) return false
  dispatch?.(state.tr.setMeta(pluginKey, itemPos))
  return true
}

/** Collapse every parent item (GRO-2027 `Mod-Shift-u`); metadata-only transaction, the doc is untouched. */
export const foldAllOutline: Command = foldAllCommand('fold-all')
/** Expand every parent item (GRO-2027 `Mod-Shift-i`). */
export const unfoldAllOutline: Command = foldAllCommand('unfold-all')

/**
 * ⌘Z panic-undo (GRO-2075): revert the most recent fold action iff no document change
 * happened after it; returns false otherwise so ProseMirror's own undo runs.
 */
export const undoLastFold: Command = (state, dispatch) => {
  if (!pluginKey.getState(state)?.lastToggle) return false
  dispatch?.(state.tr.setMeta(pluginKey, 'undo-fold'))
  return true
}

/**
 * Chevron glyph (GRO-2093): one stroked SVG (chevron-down), sized by `--fold-chevron-size` and
 * rotated -90° by CSS when collapsed, so the 18px widget box — and with it the guide-line strip
 * and block-handle-gate geometry — never changes.
 */
const chevronSvg = (): SVGSVGElement => {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(ns, 'path')
  path.setAttribute('d', 'M6 9l6 6 6-6')
  svg.appendChild(path)
  return svg
}

const getOutlineEntries = (doc: ProseNode): OutlineEntry[] => {
  const entries: OutlineEntry[] = []
  const labelOccurrences = new Map<string, number>()

  doc.descendants((node, itemPos) => {
    if (node.type.name !== 'list_item') return true
    const nestedLists = findNestedLists(node)
    if (nestedLists.length === 0) return true

    const label = node.firstChild?.textContent.trim() || 'Untitled item'
    const occurrence = labelOccurrences.get(label) ?? 0
    labelOccurrences.set(label, occurrence + 1)
    entries.push({
      foldKey: getOutlineFoldKey(label, occurrence),
      itemPos,
      label,
      nestedListRanges: nestedLists.map(({ list, offset }) => {
        const from = itemPos + 1 + offset
        return { from, to: from + list.nodeSize }
      }),
    })
    return true
  })

  return entries
}

const getCollapsedKeys = ({ entries, collapsedItemPositions }: OutlineFoldingState): string[] =>
  entries
    .filter(({ itemPos }) => collapsedItemPositions.has(itemPos))
    .map(({ foldKey }) => foldKey)
    .sort()

export const createOutlineFolding = ({ initialCollapsedKeys = new Set(), onCollapsedKeysChange }: OutlineFoldingOptions = {}) =>
  $prose(
    () =>
      new Plugin<OutlineFoldingState>({
        key: pluginKey,
        state: {
          init: (_config, state) => {
            const entries = getOutlineEntries(state.doc)
            return {
              entries,
              collapsedItemPositions: new Set(
                entries.filter(({ foldKey }) => initialCollapsedKeys.has(foldKey)).map(({ itemPos }) => itemPos),
              ),
              lastToggle: null,
            }
          },
          apply: (transaction, previousState, _oldState, newState) => {
            const entries = transaction.docChanged ? getOutlineEntries(newState.doc) : previousState.entries
            const parentPositions = new Set(entries.map(({ itemPos }) => itemPos))
            const collapsedItemPositions = new Set<number>()
            previousState.collapsedItemPositions.forEach((position) => {
              const mappedPosition = transaction.mapping.map(position, 1)
              if (parentPositions.has(mappedPosition)) collapsedItemPositions.add(mappedPosition)
            })

            // A fold is only ⌘Z-revertible while it is the latest USER action. Plugin-appended
            // transactions (e.g. Crepe's trailing paragraph) are not user actions: they keep the
            // pending fold alive, with positions mapped through their doc change.
            const appended = transaction.getMeta('appendedTransaction') !== undefined
            let lastToggle = previousState.lastToggle
            if (transaction.docChanged && !appended) lastToggle = null
            else if (transaction.docChanged && lastToggle !== null) {
              lastToggle =
                lastToggle.kind === 'toggle'
                  ? { kind: 'toggle', itemPos: transaction.mapping.map(lastToggle.itemPos, 1) }
                  : {
                      kind: 'set',
                      previousCollapsed: new Set(
                        [...lastToggle.previousCollapsed].map((p) => transaction.mapping.map(p, 1)),
                      ),
                    }
            }

            const meta: FoldMeta | undefined = transaction.getMeta(pluginKey)
            if (meta === 'fold-all')
              return {
                entries,
                collapsedItemPositions: parentPositions,
                lastToggle: { kind: 'set', previousCollapsed: collapsedItemPositions },
              }
            if (meta === 'unfold-all')
              return {
                entries,
                collapsedItemPositions: new Set(),
                lastToggle: { kind: 'set', previousCollapsed: collapsedItemPositions },
              }
            if (meta === 'undo-fold' && lastToggle !== null) {
              if (lastToggle.kind === 'set') {
                const restored = new Set([...lastToggle.previousCollapsed].filter((p) => parentPositions.has(p)))
                return { entries, collapsedItemPositions: restored, lastToggle: null }
              }
              if (collapsedItemPositions.has(lastToggle.itemPos)) collapsedItemPositions.delete(lastToggle.itemPos)
              else if (parentPositions.has(lastToggle.itemPos)) collapsedItemPositions.add(lastToggle.itemPos)
              return { entries, collapsedItemPositions, lastToggle: null }
            }
            if (typeof meta === 'number') {
              if (collapsedItemPositions.has(meta)) collapsedItemPositions.delete(meta)
              else if (parentPositions.has(meta)) collapsedItemPositions.add(meta)
              lastToggle = { kind: 'toggle', itemPos: meta }
            }
            return { entries, collapsedItemPositions, lastToggle }
          },
        },
        props: {
          decorations: (state) => {
            const foldingState = pluginKey.getState(state)
            if (!foldingState) return DecorationSet.empty

            const decorations: Decoration[] = []
            foldingState.entries.forEach((entry) => {
              const collapsed = foldingState.collapsedItemPositions.has(entry.itemPos)
              decorations.push(
                Decoration.widget(
                  entry.itemPos + 1,
                  (view) => {
                    const button = document.createElement('button')
                    button.type = 'button'
                    button.className = OUTLINE_TOGGLE_CLASS
                    button.dataset.outlineFoldKey = entry.foldKey
                    button.setAttribute('aria-expanded', String(!collapsed))
                    button.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${entry.label}`)
                    button.replaceChildren(chevronSvg())
                    const toggle = () => view.dispatch(view.state.tr.setMeta(pluginKey, entry.itemPos))
                    // Keep the caret where it is: the toggle must not steal focus or move the selection.
                    button.addEventListener('mousedown', (event) => event.preventDefault())
                    button.addEventListener('click', (event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      toggle()
                    })
                    // The widget sits inside the contenteditable, so ProseMirror's keymap would swallow
                    // Enter/Space before the button's native activation; handle them here and keep focus
                    // on the (re-rendered) toggle so keyboard users can fold/unfold repeatedly.
                    button.addEventListener('keydown', (event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      event.stopPropagation()
                      toggle()
                      view.dom
                        .querySelector<HTMLButtonElement>(`.${OUTLINE_TOGGLE_CLASS}[data-outline-fold-key="${entry.foldKey}"]`)
                        ?.focus()
                    })
                    return button
                  },
                  { key: `outline-toggle:${entry.foldKey}:${collapsed ? 'collapsed' : 'expanded'}` },
                ),
              )
              if (collapsed) {
                entry.nestedListRanges.forEach(({ from, to }) => {
                  decorations.push(Decoration.node(from, to, { [OUTLINE_FOLDED_ATTR]: 'true' }))
                })
              }
            })
            return DecorationSet.create(state.doc, decorations)
          },
        },
        view: (view) => {
          let previousKeys: string | null = null
          const notify = () => {
            const foldingState = pluginKey.getState(view.state)
            if (!foldingState || !onCollapsedKeysChange) return
            const keys = getCollapsedKeys(foldingState)
            const serializedKeys = keys.join(' ')
            if (serializedKeys !== previousKeys) {
              previousKeys = serializedKeys
              onCollapsedKeysChange(keys)
            }
          }
          notify()
          return { update: notify }
        },
      }),
  )
