/**
 * Collapsible parent bullets (GRO-2011). Ported from yaseen-excalidraw
 * `docs/outlineFolding.ts`; logic unchanged apart from always reporting the
 * resolved key set once on mount (so persisted keys that no longer resolve get pruned).
 *
 * Design: fold state lives ONLY in plugin state (collapsed list_item positions, mapped
 * through every transaction) + decorations. Toggling dispatches a metadata-only
 * transaction (`tr.setMeta(pluginKey, itemPos)`), so `tr.docChanged` is false, the
 * listener plugin never fires `markdownUpdated`, and the markdown on disk is untouched.
 * Persistence is by stable fold key (see outlineFoldKeys.ts), not by position.
 */
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { type EditorState, Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { getOutlineFoldKey } from './outlineFoldKeys'

interface OutlineEntry {
  foldKey: string
  itemPos: number
  label: string
  nestedList: ProseNode
  nestedListPos: number
}

interface OutlineFoldingState {
  collapsedItemPositions: ReadonlySet<number>
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

/** Whether the list_item starting at `itemPos` is currently folded (false when the plugin is absent). */
export const isOutlineItemCollapsed = (state: EditorState, itemPos: number): boolean =>
  pluginKey.getState(state)?.collapsedItemPositions.has(itemPos) ?? false

const LIST_NODE_NAMES = new Set(['bullet_list', 'ordered_list'])

/** Every list_item that owns a nested list, in document order. */
const getOutlineEntries = (doc: ProseNode): OutlineEntry[] => {
  const entries: OutlineEntry[] = []
  const labelOccurrences = new Map<string, number>()

  doc.descendants((node, itemPos) => {
    if (node.type.name !== 'list_item') return true

    let nestedList: ProseNode | null = null
    let nestedListPos = -1
    node.forEach((child, offset) => {
      if (nestedList === null && LIST_NODE_NAMES.has(child.type.name)) {
        nestedList = child
        nestedListPos = itemPos + 1 + offset
      }
    })
    if (nestedList === null) return true

    const label = node.firstChild?.textContent.trim() || 'Untitled item'
    const occurrence = labelOccurrences.get(label) ?? 0
    labelOccurrences.set(label, occurrence + 1)
    entries.push({ foldKey: getOutlineFoldKey(label, occurrence), itemPos, label, nestedList, nestedListPos })
    return true
  })

  return entries
}

const getCollapsedKeys = (doc: ProseNode, collapsedItemPositions: ReadonlySet<number>): string[] =>
  getOutlineEntries(doc)
    .filter(({ itemPos }) => collapsedItemPositions.has(itemPos))
    .map(({ foldKey }) => foldKey)
    .sort()

export const createOutlineFolding = ({ initialCollapsedKeys = new Set(), onCollapsedKeysChange }: OutlineFoldingOptions = {}) =>
  $prose(
    () =>
      new Plugin<OutlineFoldingState>({
        key: pluginKey,
        state: {
          init: (_config, state) => ({
            collapsedItemPositions: new Set(
              getOutlineEntries(state.doc)
                .filter(({ foldKey }) => initialCollapsedKeys.has(foldKey))
                .map(({ itemPos }) => itemPos),
            ),
          }),
          apply: (transaction, previousState, _oldState, newState) => {
            const parentPositions = new Set(getOutlineEntries(newState.doc).map(({ itemPos }) => itemPos))
            const collapsedItemPositions = new Set<number>()
            previousState.collapsedItemPositions.forEach((position) => {
              const mappedPosition = transaction.mapping.map(position, 1)
              if (parentPositions.has(mappedPosition)) collapsedItemPositions.add(mappedPosition)
            })

            const toggledPosition: unknown = transaction.getMeta(pluginKey)
            if (typeof toggledPosition === 'number') {
              if (collapsedItemPositions.has(toggledPosition)) collapsedItemPositions.delete(toggledPosition)
              else if (parentPositions.has(toggledPosition)) collapsedItemPositions.add(toggledPosition)
            }
            return { collapsedItemPositions }
          },
        },
        props: {
          decorations: (state) => {
            const foldingState = pluginKey.getState(state)
            if (!foldingState) return DecorationSet.empty

            const decorations: Decoration[] = []
            getOutlineEntries(state.doc).forEach((entry) => {
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
                    button.textContent = collapsed ? '▸' : '▾'
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
                decorations.push(
                  Decoration.node(entry.nestedListPos, entry.nestedListPos + entry.nestedList.nodeSize, {
                    [OUTLINE_FOLDED_ATTR]: 'true',
                  }),
                )
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
            const keys = getCollapsedKeys(view.state.doc, foldingState.collapsedItemPositions)
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
