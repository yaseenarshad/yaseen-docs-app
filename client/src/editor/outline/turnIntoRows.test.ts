/**
 * The block menu's strip (YAZ-3727 D13, D14, D18) through the real createCrepe wiring: Bullet list, Numbered list,
 * Checklist and Text as one row of toolbar buttons, the toolbar's own commands (`listButtons.ts`). With nothing highlighted
 * they change the whole list the line is in (one level); with text highlighted, the highlighted lines. The lit button
 * takes the lines out of their list, as on the toolbar. A plain line or a heading has the strip too (that line only);
 * a code block has none. "Number children" shows only when the line has children.
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
/** Each row as its label, the strip as `[Checklist, Bullet list*, …]` (`*` lit), `|` for a divider; `(off)` when disabled. */
const menu = (view: EditorView) =>
  [...popupOf(view)!.children].map((el) =>
    el.classList.contains('document-zoom__divider')
      ? '|'
      : el.classList.contains('ctx-menu__strip')
        ? `[${[...el.querySelectorAll('button')].map((b) => `${b.getAttribute('aria-label')}${b.getAttribute('aria-pressed') === 'true' ? '*' : ''}`).join(', ')}]`
        : `${el.textContent}${el.hasAttribute('disabled') ? ' (off)' : ''}`,
  )
const rightClick = (item: HTMLElement) =>
  item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
const pick = (view: EditorView, label: string) => popupOf(view)!.querySelector<HTMLButtonElement>(`.ctx-menu__strip button[aria-label="${label}"]`)!.click()

/** The position of `text` plus `offset`. */
function posOf(view: EditorView, text: string, offset = 0): number {
  let pos = -1
  view.state.doc.descendants((node, nodePos) => {
    if (pos === -1 && node.isText && node.text!.includes(text)) pos = nodePos + node.text!.indexOf(text) + offset
    return pos === -1
  })
  return pos
}

const STRIP = (lit: string | null) => `[${['Bullet list', 'Numbered list', 'Checklist', 'Text'].map((label) => (label === lit ? `${label}*` : label)).join(', ')}]`

/** ⌘. through the editor's keymaps: zoom into the bullet that holds the caret. */
function zoomInto(view: EditorView, text: string): void {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, posOf(view, text, 1))))
  const event = new KeyboardEvent('keydown', { key: '.', code: 'Period', keyCode: 190, metaKey: true, bubbles: true, cancelable: true })
  view.someProp('handleKeyDown', (handler) => handler(view, event))
}

describe('the block menu\'s strip turns a list into a checklist, bullets, numbers or text (YAZ-3727 D13, D14)', () => {
  it('on a bullet: one strip, bullets, numbers, checklist, then T (D18), icons only, Bullet list lit; no "Number children" on a line with no children', async () => {
    const { view, item } = await mount('* a\n* b\n* c\n')
    aimAt(view, 'b')
    rightClick(item)
    expect(menu(view)).toEqual([STRIP('Bullet list')])
    const buttons = [...popupOf(view)!.querySelectorAll<HTMLButtonElement>('.ctx-menu__strip button')]
    expect(buttons.every((b) => b.querySelector('svg') !== null && b.textContent === '' && b.title === b.getAttribute('aria-label'))).toBe(true)
  })

  it('on a numbered line with children: the strip, a line, then the children rows', async () => {
    const { view, item } = await mount('1. a\n   * kid\n2. b\n')
    aimAt(view, 'a')
    rightClick(item)
    expect(menu(view)).toEqual([STRIP('Numbered list'), '|', 'Number children', 'Bullets with written numbers'])
  })

  it.each([
    ['Numbered list', '1. a\n2. b\n3. c\n'],
    ['Checklist', '* [ ] a\n* [ ] b\n* [ ] c\n'],
    ['Text', 'a\n\nb\n\nc\n'],
  ])('nothing highlighted: %j changes the whole list', async (label, saved) => {
    const { crepe, view, item } = await mount('* a\n* b\n* c\n')
    aimAt(view, 'b')
    rightClick(item)
    pick(view, label)
    expect(getMarkdownForSave(crepe)).toBe(saved)
    expect(popupOf(view)).toBeNull()
    expect(view.dom.contains(document.activeElement)).toBe(true)
  })

  it('the whole list is one level: the children keep their kind', async () => {
    const { crepe, view, item } = await mount('1. a\n   1. kid\n2. b\n')
    aimAt(view, 'b')
    rightClick(item)
    pick(view, 'Bullet list')
    expect(getMarkdownForSave(crepe)).toBe('* a\n  1. kid\n* b\n')
  })

  it('the caret in another line of the list is no highlight: still the whole list', async () => {
    const { crepe, view, item } = await mount('* a\n* b\n* c\n')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, posOf(view, 'a', 1))))
    aimAt(view, 'c')
    rightClick(item)
    pick(view, 'Numbered list')
    expect(getMarkdownForSave(crepe)).toBe('1. a\n2. b\n3. c\n')
  })

  it('the lit button takes the list out, as on the toolbar', async () => {
    const { crepe, view, item } = await mount('* a\n* b\n')
    aimAt(view, 'a')
    rightClick(item)
    pick(view, 'Bullet list')
    expect(getMarkdownForSave(crepe)).toBe('a\n\nb\n')
  })

  it('text highlighted on one bullet: only that line changes', async () => {
    const { crepe, view, item } = await mount('* a\n* bee\n* c\n')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, posOf(view, 'bee', 1), posOf(view, 'bee', 2))))
    aimAt(view, 'bee')
    rightClick(item)
    expect(menu(view)).toEqual([STRIP('Bullet list')])
    pick(view, 'Numbered list')
    expect(getMarkdownForSave(crepe)).toBe('* a\n\n1. bee\n\n* c\n')
  })

  it('text highlighted over several lines that cover the line: those lines change', async () => {
    const { crepe, view, item } = await mount('* a\n* b\n* c\n')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, posOf(view, 'b'), posOf(view, 'c', 1))))
    aimAt(view, 'b')
    rightClick(item)
    pick(view, 'Numbered list')
    expect(getMarkdownForSave(crepe)).toBe('* a\n\n1. b\n2. c\n')
  })

  it('one ⌘Z gives the list back', async () => {
    const { crepe, view, item } = await mount('* a\n* b\n* c\n')
    aimAt(view, 'b')
    rightClick(item)
    pick(view, 'Numbered list')
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe('* a\n* b\n* c\n')
  })

  it('a plain line has the menu, Text lit; Bullet list changes that line only', async () => {
    const { crepe, view, item } = await mount('p1\n\np2\n')
    aimAt(view, 'p2')
    rightClick(item)
    expect(menu(view)).toEqual([STRIP('Text')])
    pick(view, 'Bullet list')
    expect(getMarkdownForSave(crepe)).toBe('p1\n\n* p2\n')
  })

  it('a heading has the menu with nothing lit, and keeps its heading in the list', async () => {
    const { crepe, view, item } = await mount('# H\n')
    aimAt(view, 'H')
    rightClick(item)
    expect(menu(view)).toEqual([STRIP(null)])
    pick(view, 'Numbered list')
    expect(getMarkdownForSave(crepe)).toBe('1. # H\n')
  })

  it('zoomed into a bullet, its own line: only that line, its hidden siblings stay', async () => {
    const { crepe, view, item } = await mount('* a\n* b\n  * kid\n* c\n')
    zoomInto(view, 'b')
    aimAt(view, 'b')
    rightClick(item)
    pick(view, 'Numbered list')
    expect(getMarkdownForSave(crepe)).toBe('* a\n\n1. b\n   * kid\n\n* c\n')
  })

  it('a code block has no menu', async () => {
    const { view, item } = await mount('```\ncode\n```\n')
    aimAt(view, 'code')
    rightClick(item)
    expect(popupOf(view)).toBeNull()
  })
})
