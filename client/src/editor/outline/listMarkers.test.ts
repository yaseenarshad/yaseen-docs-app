/**
 * Each item's marker follows its list (YAZ-3727 D2, `listMarkers.ts`): the real editor (`createCrepe`), keys through
 * the DOM keydown handlers and then `handleKeyDown` (the Enter tracker of YAZ-3695 D7 takes part), and in each case the
 * item's own attrs (`listType`, `label`: what Crepe draws) AND the saved Markdown (the marker of the list: what the
 * file holds) are asserted together. Before D2 they disagreed after a Shift-Tab or an Enter that moved a numbered line
 * into a bullet level (B1): the screen showed `2.`, the file `*`.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { undo } from '@milkdown/kit/prose/history'
import type { Node } from '@milkdown/kit/prose/model'
import { mount, md, posOf, endOf, select, unmountAll } from '../marks/markTestKit'
import { listMarkersKey } from './listMarkers'

afterEach(unmountAll)

const KEY_CODES: Record<string, number> = { Tab: 9, Enter: 13, Backspace: 8 }

/** One key press as the browser delivers it: the DOM keydown handlers first, then `handleKeyDown`. */
function press(crepe: Crepe, key: 'Tab' | 'Enter' | 'Backspace', shift = false): boolean {
  return crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const event = new KeyboardEvent('keydown', { key, code: key, keyCode: KEY_CODES[key], shiftKey: shift, bubbles: true, cancelable: true })
    if (view.someProp('handleDOMEvents', (handlers) => handlers.keydown?.(view, event))) return true
    return view.someProp('handleKeyDown', (handler) => handler(view, event)) ?? false
  })
}

const docOf = (crepe: Crepe): Node => crepe.editor.ctx.get(editorViewCtx).state.doc

/** `text: listType label` for every list item in document order, an empty item as `(empty)`. */
function markers(crepe: Crepe): string[] {
  const out: string[] = []
  docOf(crepe).descendants((node) => {
    if (node.type.name === 'list_item') out.push(`${node.firstChild?.textContent || '(empty)'}: ${node.attrs.listType} ${node.attrs.label}`)
    return true
  })
  return out
}

/** The position before the list item whose first block reads `text`. */
function itemPos(crepe: Crepe, text: string): number {
  let pos = -1
  docOf(crepe).descendants((node, nodePos) => {
    if (pos < 0 && node.type.name === 'list_item' && node.firstChild?.textContent === text) pos = nodePos
    return pos < 0
  })
  if (pos < 0) throw new Error(`no item: ${text}`)
  return pos
}

describe('listMarkers: the marker follows its list (YAZ-3727 D2)', () => {
  it('B1: Shift-Tab of a numbered child into the bullet level makes it a bullet, on screen and on disk', async () => {
    const { crepe } = await mount('* Keys\n  1. id\n  2. version\n  3. status\n')
    select(crepe, posOf(crepe, 'version') + 1)
    expect(press(crepe, 'Tab', true)).toBe(true)
    expect(md(crepe)).toBe('* Keys\n  1. id\n* version\n  1. status\n')
    expect(markers(crepe)).toEqual(['Keys: bullet •', 'id: ordered 1.', 'version: bullet •', 'status: ordered 1.'])
  })

  it('⌘Z after that Shift-Tab puts the number back, on screen and on disk', async () => {
    const { crepe, view } = await mount('* Keys\n  1. id\n  2. version\n  3. status\n')
    select(crepe, posOf(crepe, 'version') + 1)
    expect(press(crepe, 'Tab', true)).toBe(true)
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(md(crepe)).toBe('* Keys\n  1. id\n  2. version\n  3. status\n')
    expect(markers(crepe)).toEqual(['Keys: bullet •', 'id: ordered 1.', 'version: ordered 2.', 'status: ordered 3.'])
  })

  it('B2: a drop of a numbered item into a bullet list makes it a bullet (a transaction with metadata)', async () => {
    const { crepe, view } = await mount('* a\n* b\n\n1. one\n2. two\n')
    const from = itemPos(crepe, 'two')
    const item = view.state.doc.nodeAt(from)!
    const tr = view.state.tr.delete(from, from + item.nodeSize)
    tr.insert(itemPos(crepe, 'b'), item).setMeta('uiEvent', 'drop')
    view.dispatch(tr)
    expect(md(crepe)).toBe('* a\n* two\n* b\n\n1. one\n')
    expect(markers(crepe)).toEqual(['a: bullet •', 'two: bullet •', 'b: bullet •', 'one: ordered 1.'])
  })

  it('Enter twice at the end of the last numbered child: the empty line outdents as a bullet', async () => {
    const { crepe } = await mount('* a\n  1. one\n  2. two\n')
    select(crepe, endOf(crepe, 'two'))
    expect(press(crepe, 'Enter')).toBe(true)
    expect(press(crepe, 'Enter')).toBe(true)
    expect(md(crepe)).toBe('* a\n  1. one\n  2. two\n*\n')
    expect(markers(crepe)).toEqual(['a: bullet •', 'one: ordered 1.', 'two: ordered 2.', '(empty): bullet •'])
  })

  it('a Backspace join moves bullet children into the numbered list above: they number on', async () => {
    const { crepe } = await mount('* a\n  1. one\n* b\n  * kid\n')
    select(crepe, posOf(crepe, 'b'))
    expect(press(crepe, 'Backspace')).toBe(true)
    expect(md(crepe)).toBe('* a\n  1. one b\n  2. kid\n')
    expect(markers(crepe)).toEqual(['a: bullet •', 'one b: ordered 1.', 'kid: ordered 2.'])
  })

  it('deleting the first numbered item renumbers the rest', async () => {
    const { crepe, view } = await mount('* Keys\n  1. id\n  2. version\n  3. status\n')
    const pos = itemPos(crepe, 'id')
    view.dispatch(view.state.tr.delete(pos, pos + view.state.doc.nodeAt(pos)!.nodeSize))
    expect(md(crepe)).toBe('* Keys\n  1. version\n  2. status\n')
    expect(markers(crepe)).toEqual(['Keys: bullet •', 'version: ordered 1.', 'status: ordered 2.'])
  })

  it('a numbered list that starts at 8 keeps 8, 9, 10 after an edit', async () => {
    const { crepe } = await mount('8. eight\n9. nine\n10. ten\n')
    select(crepe, endOf(crepe, 'nine'))
    expect(press(crepe, 'Enter')).toBe(true)
    expect(md(crepe)).toBe('8. eight\n9. nine\n10.\n11. ten\n')
    expect(markers(crepe)).toEqual(['eight: ordered 8.', 'nine: ordered 9.', '(empty): ordered 10.', 'ten: ordered 11.'])
  })

  it('an insert at the top of a long list relabels every later item, from the ancestor walk', async () => {
    const { crepe, view } = await mount(`${Array.from({ length: 500 }, (_, i) => `${i + 1}. item ${i}`).join('\n')}\n`)
    const first = itemPos(crepe, 'item 0')
    view.dispatch(view.state.tr.insert(first, view.state.doc.nodeAt(first)!.type.create(null, view.state.schema.nodes.paragraph.create(null, view.state.schema.text('new')))))
    const labels = markers(crepe)
    expect(labels[0]).toBe('new: ordered 1.')
    expect(labels[500]).toBe('item 499: ordered 501.')
    expect(labels.every((line, i) => line.endsWith(` ordered ${i + 1}.`))).toBe(true)
  })

  it('typing skips the walk (YAZ-3855), but a structural change in a long flat list still relabels: Enter, a join, a delete', async () => {
    const { crepe, view } = await mount(`${Array.from({ length: 500 }, (_, i) => `${i + 1}. item ${i}`).join('\n')}\n`)
    const numbered = () => markers(crepe).every((line, i) => line.endsWith(` ordered ${i + 1}.`))
    select(crepe, endOf(crepe, 'item 0'))
    expect(press(crepe, 'Enter')).toBe(true)
    expect(markers(crepe)).toHaveLength(501)
    expect(numbered()).toBe(true)
    // A join writes into one textblock in the new document, but its deleted range in the old one spans two items.
    view.dispatch(view.state.tr.delete(endOf(crepe, 'item 1'), posOf(crepe, 'item 2')))
    expect(markers(crepe)[2]).toBe('item 1item 2: ordered 3.')
    expect(markers(crepe)).toHaveLength(500)
    expect(numbered()).toBe(true)
    const pos = itemPos(crepe, 'item 3')
    view.dispatch(view.state.tr.delete(pos, pos + view.state.doc.nodeAt(pos)!.nodeSize))
    expect(markers(crepe)).toHaveLength(499)
    expect(numbered()).toBe(true)
  })

  it('a text edit inside a list with right labels appends nothing', async () => {
    const { crepe, view } = await mount('* a\n  1. one\n  2. two\n')
    const before = view.state
    const tr = before.tr.insertText('x', endOf(crepe, 'two'))
    expect(listMarkersKey.get(before)!.spec.appendTransaction!([tr], before, before.apply(tr))).toBeNull()
  })

  it('a deleted list leaves nothing to fix', async () => {
    const { crepe, view } = await mount('para\n\n1. one\n2. two\n\nend\n')
    const pos = posOf(crepe, 'one') - 3
    view.dispatch(view.state.tr.delete(pos, pos + view.state.doc.nodeAt(pos)!.nodeSize))
    expect(md(crepe)).toBe('para\n\nend\n')
  })

  it("Milkdown's syncListOrderPlugin is not registered; ours is", async () => {
    const { view } = await mount('1. one\n')
    expect(view.state.plugins.some((plugin) => String((plugin as unknown as { key: string }).key).startsWith('MILKDOWN_KEEP_LIST_ORDER'))).toBe(false)
    expect(listMarkersKey.get(view.state)).toBeDefined()
  })
})
