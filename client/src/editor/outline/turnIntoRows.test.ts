/**
 * The block menu's "turn into" rows (YAZ-3727 D13) through the real createCrepe wiring: Text, Checklist, Bullet list
 * and Numbered list on a line's handle, the toolbar's own commands (`listButtons.ts`) on the line right-clicked, or on
 * the selected lines when the selection covers it. The line's kind has a ✓ and is disabled. A plain line or a heading
 * has the menu too; a code block has none. "Number children" shows only when the line has children.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { undo } from '@milkdown/kit/prose/history'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave } from '../createCrepe'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string): Promise<{ crepe: Crepe; view: EditorView; item: HTMLElement }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.ctx.get(editorViewCtx)
  view.dispatch(view.state.tr)
  const handle = document.createElement('div')
  handle.className = 'milkdown-block-handle'
  const item = document.createElement('div')
  item.className = 'operation-item'
  handle.appendChild(item)
  view.dom.parentElement!.appendChild(handle)
  handle.getBoundingClientRect = () => ({ right: 0 }) as DOMRect
  return { crepe, view, item }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

/** Point the handle at the list item (by its first block), or the top-level block, that reads `label`. */
function aimAt(view: EditorView, label: string): void {
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found !== -1) return false
    if (node.type.name === 'list_item' && node.firstChild?.textContent === label) found = pos
    else if (node.isTextblock && node.textContent === label) found = pos
    return true
  })
  if (found === -1) throw new Error(`block not found: ${label}`)
  view.posAtCoords = () => ({ pos: found + 1, inside: found })
}

const popupOf = (view: EditorView) => view.dom.parentElement!.querySelector<HTMLElement>('.ctx-menu--editor')
const rowsOf = (view: EditorView) => [...popupOf(view)!.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')]
/** Each row as `label`, `label ✓` (the line's kind) and `(off)` when disabled; `|` for a divider. */
const menu = (view: EditorView) =>
  [...popupOf(view)!.children].map((el) => (el.classList.contains('document-zoom__divider') ? '|' : `${el.textContent}${(el as HTMLElement).dataset.hint === '✓' ? ' ✓' : ''}${el.hasAttribute('disabled') ? ' (off)' : ''}`))
const rightClick = (item: HTMLElement) =>
  item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
const pick = (view: EditorView, label: string) => rowsOf(view).find((row) => row.textContent === label)!.click()

/** The position of `text` plus `offset`. */
function posOf(view: EditorView, text: string, offset = 0): number {
  let pos = -1
  view.state.doc.descendants((node, nodePos) => {
    if (pos === -1 && node.isText && node.text!.includes(text)) pos = nodePos + node.text!.indexOf(text) + offset
    return pos === -1
  })
  return pos
}

const KINDS = ['Text', 'Checklist', 'Bullet list', 'Numbered list']

describe('the block menu turns a line into text, a checklist, bullets or numbers (YAZ-3727 D13)', () => {
  it('on a bullet: the four rows, Bullet list ✓ and off; no "Number children" on a line with no children', async () => {
    const { view, item } = await mount('* a\n* b\n* c\n')
    aimAt(view, 'b')
    rightClick(item)
    expect(menu(view)).toEqual(['Text', 'Checklist', 'Bullet list ✓ (off)', 'Numbered list'])
    expect(rowsOf(view).every((row) => row.querySelector('svg') !== null)).toBe(true)
  })

  it('on a numbered line with children: the kinds, a line, then the children rows', async () => {
    const { view, item } = await mount('1. a\n   * kid\n2. b\n')
    aimAt(view, 'a')
    rightClick(item)
    expect(menu(view)).toEqual(['Text', 'Checklist', 'Bullet list', 'Numbered list ✓ (off)', '|', 'Number children', 'Bullets with written numbers'])
  })

  it.each([
    ['Numbered list', '* a\n\n1. b\n\n* c\n'],
    ['Checklist', '* a\n* [ ] b\n* c\n'],
    ['Text', '* a\n\nb\n\n* c\n'],
  ])('a click on %j changes the line right-clicked, as the toolbar does', async (label, saved) => {
    const { crepe, view, item } = await mount('* a\n* b\n* c\n')
    aimAt(view, 'b')
    rightClick(item)
    pick(view, label)
    expect(getMarkdownForSave(crepe)).toBe(saved)
    expect(popupOf(view)).toBeNull()
    expect(view.dom.contains(document.activeElement)).toBe(true)
  })

  it('one ⌘Z gives the line back', async () => {
    const { crepe, view, item } = await mount('* a\n* b\n* c\n')
    aimAt(view, 'b')
    rightClick(item)
    pick(view, 'Numbered list')
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe('* a\n* b\n* c\n')
  })

  it('the caret elsewhere: only the line right-clicked changes', async () => {
    const { crepe, view, item } = await mount('* a\n* b\n* c\n')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, posOf(view, 'a', 1))))
    aimAt(view, 'c')
    rightClick(item)
    pick(view, 'Numbered list')
    expect(getMarkdownForSave(crepe)).toBe('* a\n* b\n\n1. c\n')
  })

  it('a selection over several lines that covers the line: every selected line changes', async () => {
    const { crepe, view, item } = await mount('* a\n* b\n* c\n')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, posOf(view, 'b'), posOf(view, 'c', 1))))
    aimAt(view, 'b')
    rightClick(item)
    pick(view, 'Numbered list')
    expect(getMarkdownForSave(crepe)).toBe('* a\n\n1. b\n2. c\n')
  })

  it('a plain line has the menu: Text ✓, and Bullet list makes it a bullet', async () => {
    const { crepe, view, item } = await mount('para\n')
    aimAt(view, 'para')
    rightClick(item)
    expect(menu(view)).toEqual(['Text ✓ (off)', 'Checklist', 'Bullet list', 'Numbered list'])
    pick(view, 'Bullet list')
    expect(getMarkdownForSave(crepe)).toBe('* para\n')
  })

  it('a heading has the menu with no ✓, and keeps its heading in the list', async () => {
    const { crepe, view, item } = await mount('# H\n')
    aimAt(view, 'H')
    rightClick(item)
    expect(menu(view)).toEqual(KINDS)
    pick(view, 'Numbered list')
    expect(getMarkdownForSave(crepe)).toBe('1. # H\n')
  })

  it('a code block has no menu', async () => {
    const { view, item } = await mount('```\ncode\n```\n')
    aimAt(view, 'code')
    rightClick(item)
    expect(popupOf(view)).toBeNull()
  })
})
