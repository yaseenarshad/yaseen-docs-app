/**
 * The 6-dot menu of a code block or a table (YAZ-4800 demo), through the real createCrepe wiring (the handle stand-in
 * of `turnIntoRows.test.ts`):
 * - on a bullet whose first block is the code block / table: the Bullet · Numbered · Checklist strip (the item's kind
 *   lit; no Text), then "Add line above" (⌘⇧↵) and "Add line below" (⌘↵);
 * - with no bullet: the same strip ("Put on a bullet" …), nothing lit, and the two rows;
 * - a row runs the same command as the keys.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
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

/** Point the handle at the first node named `name` (or, `item`, at its list item). */
function aimAtNode(view: EditorView, name: string, item = false): void {
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found !== -1) return false
    if (node.type.name === name) found = pos
    return true
  })
  if (found === -1) throw new Error(`no ${name}`)
  const inside = item ? view.state.doc.resolve(found).before() : found
  view.posAtCoords = () => ({ pos: inside + 1, inside })
}

const popupOf = (view: EditorView) => view.dom.parentElement!.querySelector<HTMLElement>('.ctx-menu--editor')
const rightClick = (item: HTMLElement) => item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
const stripButtons = (view: EditorView) =>
  [...popupOf(view)!.querySelectorAll<HTMLButtonElement>('.ctx-menu__strip button')].map((b) => `${b.getAttribute('aria-label')}${b.getAttribute('aria-pressed') === 'true' ? '*' : ''}`)
/** Each row as its text, then its key (`data-hint`) after a space when it has one. */
const rowLabels = (view: EditorView) =>
  [...popupOf(view)!.querySelectorAll<HTMLElement>('.ctx-menu__item')].map((b) => `${b.textContent ?? ''}${b.dataset.hint === undefined ? '' : ` ${b.dataset.hint}`}`)
const row = (view: EditorView, label: string): HTMLButtonElement => {
  const found = [...popupOf(view)!.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')].find((b) => b.textContent?.startsWith(label))
  if (found === undefined) throw new Error(`no row ${label}: ${rowLabels(view).join(' | ')}`)
  return found
}

const CODE_ON_BULLET = '* a\n* ```\n  code\n  ```\n'
const TABLE = '| H1 | H2 |\n| --- | --- |\n| x | y |\n'
const TABLE_ON_BULLET = `* ${TABLE.split('\n').join('\n  ')}\n`

describe('YAZ-4800 demo: the 6-dot menu of a code block or table on a bullet', () => {
  it('YAZ-4800 demo: a code block on a bullet: the strip with Bullet list lit (no Text), then Add line above / below with their keys', async () => {
    const { view, item } = await mount(CODE_ON_BULLET)
    aimAtNode(view, 'code_block')
    rightClick(item)
    expect(popupOf(view)).not.toBeNull()
    expect(stripButtons(view)).toEqual(['Bullet list (click to remove)*', 'Numbered list', 'Checklist'])
    const labels = rowLabels(view)
    expect(labels.some((l) => l.startsWith('Add line above') && l.includes('⌘⇧↵'))).toBe(true)
    expect(labels.some((l) => l.startsWith('Add line below') && l.includes('⌘↵'))).toBe(true)
  })

  it('YAZ-4800 demo: the lit Bullet list takes the bullet away and leaves the code block', async () => {
    const { crepe, view, item } = await mount('* ```\n  code\n  ```\n')
    aimAtNode(view, 'code_block')
    rightClick(item)
    popupOf(view)!.querySelector<HTMLButtonElement>('.ctx-menu__strip button[aria-pressed="true"]')!.click()
    expect(view.state.doc.firstChild!.type.name).toBe('code_block')
    expect(getMarkdownForSave(crepe)).toMatch(/^```\ncode\n```\n/)
  })

  it('YAZ-4800 demo: "Add line below" on a code block bullet adds a bullet below', async () => {
    const { view, item } = await mount(CODE_ON_BULLET)
    aimAtNode(view, 'code_block')
    rightClick(item)
    row(view, 'Add line below').click()
    const list = view.state.doc.firstChild!
    expect(list.childCount).toBe(3)
    expect(list.child(2).textContent).toBe('')
    expect(view.state.selection.$from.parent.type.name).toBe('paragraph')
  })

  it('YAZ-4800 demo: a table on a bullet: aimed at its item, the strip and the two rows are there; "Add line above" adds a bullet above', async () => {
    const { view, item } = await mount(TABLE_ON_BULLET)
    aimAtNode(view, 'table', true)
    rightClick(item)
    // The table's own strips (Look, Text, Rows) follow; the list strip comes first.
    expect(stripButtons(view).slice(0, 3)).toEqual(['Bullet list (click to remove)*', 'Numbered list', 'Checklist'])
    row(view, 'Add line above').click()
    const list = view.state.doc.firstChild!
    expect(list.type.name).toBe('bullet_list')
    expect(list.childCount).toBe(2)
    expect(list.child(1).firstChild!.type.name).toBe('table')
  })
})

describe('YAZ-4800 demo: a plain code block or table gets the strip too', () => {
  it('YAZ-4800 demo: a code block with no bullet: Put on a bullet / numbered line / checklist line, nothing lit, and the two rows', async () => {
    const { view, item } = await mount('```\ncode\n```\n')
    aimAtNode(view, 'code_block')
    rightClick(item)
    expect(stripButtons(view)).toEqual(['Put on a bullet', 'Put on a numbered line', 'Put on a checklist line'])
    expect(rowLabels(view).filter((l) => l.startsWith('Add line'))).toHaveLength(2)
  })

  it('YAZ-4800 demo: "Put on a bullet" makes the code block the first block of a new bullet', async () => {
    const { view, item } = await mount('```\ncode\n```\n')
    aimAtNode(view, 'code_block')
    rightClick(item)
    popupOf(view)!.querySelector<HTMLButtonElement>('.ctx-menu__strip button[aria-label="Put on a bullet"]')!.click()
    const list = view.state.doc.firstChild!
    expect(list.type.name).toBe('bullet_list')
    expect(list.firstChild!.firstChild!.type.name).toBe('code_block')
  })

  it('YAZ-4800 demo: a plain table: the strip and the two rows; "Add line below" adds a plain line after it', async () => {
    const { view, item } = await mount(`${TABLE}\nafter\n`)
    aimAtNode(view, 'table')
    rightClick(item)
    expect(stripButtons(view).slice(0, 3)).toEqual(['Put on a bullet', 'Put on a numbered line', 'Put on a checklist line'])
    row(view, 'Add line below').click()
    expect(view.state.doc.child(0).type.name).toBe('table')
    expect(view.state.doc.child(1).type.name).toBe('paragraph')
    expect(view.state.doc.child(1).textContent).toBe('')
    expect(view.state.doc.child(2).textContent).toBe('after')
  })
})
