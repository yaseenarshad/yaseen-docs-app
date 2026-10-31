/**
 * Each list item's marker follows its list (YAZ-3727 D2). Crepe draws a marker from the item's OWN attrs (`listType`,
 * `label`); the file writes the marker of the LIST. So an item that a key, a drag or a paste moves into a list of the
 * other kind showed `2.` on screen and saved `*` (B1, B2).
 *
 * Replaces Milkdown's `syncListOrderPlugin` (removed in `createCrepe()`). That plugin fixed items in numbered lists
 * only, skipped every transaction with metadata (a paste, a drop) or `addToHistory: false`, and walked the WHOLE note
 * on each change: median 19.3 ms, p95 184.8 ms per keystroke at 6,000 lines in jsdom (B4). This one runs after every
 * document change and visits only the lists around or inside the ranges the change wrote: each list that holds an end
 * of a range (the ancestor walk, so an insert at the top of a long list relabels the items after it) and each list
 * inside one. It sets each item's `listType` and `label` from its list: `ordered` and `${index + order}.`, or `bullet`
 * and `•`. Only the items whose attrs differ get a `setNodeMarkup`, in one appended transaction that stays out of the
 * undo history.
 *
 * Milkdown's plugin also turned a `bullet_list` whose FIRST item had `listType: 'ordered'` into an `ordered_list`.
 * That branch is gone: the item follows its list, never the reverse.
 */
import { listItemSchema, orderedListSchema } from '@milkdown/kit/preset/commonmark'
import type { Node } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'
import { LIST_NODE_NAMES } from './listNodes'

export const listMarkersKey = new PluginKey('YAZ_LIST_MARKERS')

export const listMarkers = $prose(
  (ctx) =>
    new Plugin({
      key: listMarkersKey,
      appendTransaction: (transactions, _oldState, state) => {
        if (!transactions.some((tr) => tr.docChanged)) return null
        const itemType = listItemSchema.type(ctx)
        const orderedType = orderedListSchema.type(ctx)
        // The ranges the change wrote, mapped forward to the new document.
        const ranges: Array<[number, number]> = []
        for (const tr of transactions) {
          for (const map of tr.mapping.maps) {
            for (const range of ranges) {
              range[0] = map.map(range[0], -1)
              range[1] = map.map(range[1], 1)
            }
            map.forEach((_oldFrom, _oldTo, from, to) => ranges.push([from, to]))
          }
        }
        // Each list that holds an end of a written range, or sits inside one, once (keyed by its position).
        const { doc } = state
        const lists = new Map<number, Node>()
        for (const [from, to] of ranges) {
          for (const pos of [from, to]) {
            const $pos = doc.resolve(Math.min(pos, doc.content.size))
            for (let depth = $pos.depth; depth > 0; depth--) {
              if (LIST_NODE_NAMES.has($pos.node(depth).type.name)) lists.set($pos.before(depth), $pos.node(depth))
            }
          }
          doc.nodesBetween(from, to, (node, pos) => {
            if (LIST_NODE_NAMES.has(node.type.name)) lists.set(pos, node)
          })
        }
        // setNodeMarkup never changes a node's size, so the positions read from `doc` stay valid in `tr`.
        const tr = state.tr
        for (const [listPos, list] of lists) {
          const ordered = list.type === orderedType
          const order = (list.attrs.order as number | undefined) ?? 1
          list.forEach((item, offset, index) => {
            if (item.type !== itemType) return
            const listType = ordered ? 'ordered' : 'bullet'
            const label = ordered ? `${index + order}.` : '•'
            if (item.attrs.listType !== listType || item.attrs.label !== label) {
              tr.setNodeMarkup(listPos + 1 + offset, undefined, { ...item.attrs, listType, label })
            }
          })
        }
        return tr.docChanged ? tr.setMeta('addToHistory', false) : null
      },
    }),
)
