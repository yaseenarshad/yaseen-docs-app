/**
 * Number children menu row (YAZ-729) through the real createCrepe wiring: label flips with the
 * child list state, the click round-trips the markdown, the row is disabled on a leaf item, and
 * absent off a list item (YAZ-3696 B3).
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { undo } from '@milkdown/kit/prose/history'
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

/** Point the handle at the list_item (by its first paragraph) or heading that reads `label`. */
function aimAt(view: EditorView, label: string): void {
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found !== -1) return
    if (node.type.name === 'list_item' && node.firstChild?.textContent === label) found = pos
    if (node.type.name === 'heading' && node.textContent === label) found = pos
  })
  if (found === -1) throw new Error(`block not found: ${label}`)
  view.posAtCoords = () => ({ pos: found + 1, inside: found })
}

const popupOf = (view: EditorView) => view.dom.parentElement!.querySelector<HTMLElement>('.ctx-menu--editor')
/** The children row, after the four "turn into" rows (YAZ-3727 D13); null when it is not shown. */
const childrenRowOf = (view: EditorView) =>
  [...popupOf(view)!.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')].find((row) => /^(Number|Bullet) children$/.test(row.textContent ?? '')) ?? null
const rowOf = (view: EditorView) => {
  const row = childrenRowOf(view)
  expect(row).not.toBeNull()
  return row!
}
const rightClick = (item: HTMLElement) =>
  item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))

const TREE = '* Fundamentals\n  * Setup\n    * deep\n  * VS Code\n'

describe('numberChildrenRow', () => {
  it('numbers then re-bullets the direct children, closes, and returns focus', async () => {
    const { crepe, view, item } = await mount(TREE)
    aimAt(view, 'Fundamentals')
    rightClick(item)
    let row = rowOf(view)
    expect(row.textContent).toBe('Number children')
    expect(row.disabled).toBe(false)
    row.click()
    expect(getMarkdownForSave(crepe)).toBe('* Fundamentals\n  1. Setup\n     * deep\n  2. VS Code\n')
    expect(popupOf(view)).toBeNull()
    expect(view.dom.contains(document.activeElement)).toBe(true)

    rightClick(item)
    row = rowOf(view)
    expect(row.textContent).toBe('Bullet children')
    row.click()
    expect(getMarkdownForSave(crepe)).toBe(TREE)
  })

  it('is absent on a leaf item: it would do nothing (it was a disabled row before YAZ-3727 D13)', async () => {
    const { view, item } = await mount(TREE)
    aimAt(view, 'deep')
    rightClick(item)
    expect(childrenRowOf(view)).toBeNull()
  })

  it('is absent on a heading: not in a list item (YAZ-3696 B3); the heading\'s menu has the "turn into" rows only (D13)', async () => {
    const { view, item } = await mount('# H\n\ntext\n')
    aimAt(view, 'H')
    rightClick(item)
    expect(childrenRowOf(view)).toBeNull()
  })
})

describe('writtenNumbersRow: a numbered list becomes bullets with its numbers written as text (YAZ-3727 D12)', () => {
  const ROW = 'Bullets with written numbers'
  const labels = (view: EditorView) => [...popupOf(view)!.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')].map((row) => row.textContent)
  const click = (view: EditorView, label: string) =>
    [...popupOf(view)!.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')].find((row) => row.textContent === label)!.click()

  it.each([
    ['1. apples\n2. pears\n', 'pears', '* 1) apples\n* 2) pears\n'],
    ['3. apples\n4. pears\n', 'apples', '* 3) apples\n* 4) pears\n'],
    ['* Keys\n  1. id\n  2. version\n', 'id', '* Keys\n  * 1) id\n  * 2) version\n'],
    ['1. a\n   * kid\n2. b\n   1. deep\n', 'b', '* 1) a\n  * kid\n* 2) b\n  1. deep\n'],
  ])('%j, aimed at %j, saves %j', async (markdown, at, saved) => {
    const { crepe, view, item } = await mount(markdown)
    aimAt(view, at)
    rightClick(item)
    click(view, ROW)
    expect(getMarkdownForSave(crepe)).toBe(saved)
    expect(popupOf(view)).toBeNull()
    expect(view.dom.contains(document.activeElement)).toBe(true)
  })

  it('the lines show bullets, and the saved file opens to the same text', async () => {
    const { crepe, view, item } = await mount('3. apples\n4. pears\n')
    aimAt(view, 'apples')
    rightClick(item)
    click(view, ROW)
    const items: string[] = []
    view.state.doc.descendants((node) => { if (node.type.name === 'list_item') items.push(`${node.attrs.listType} ${node.firstChild?.textContent}`) })
    expect(items).toEqual(['bullet 3) apples', 'bullet 4) pears'])
    const reopened = await mount(getMarkdownForSave(crepe))
    expect(getMarkdownForSave(reopened.crepe)).toBe('* 3) apples\n* 4) pears\n')
  })

  it('one ⌘Z gives the numbers back', async () => {
    const { crepe, view, item } = await mount('1. apples\n2. pears\n')
    aimAt(view, 'apples')
    rightClick(item)
    click(view, ROW)
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe('1. apples\n2. pears\n')
  })

  it('shows on a numbered line only, after Number children', async () => {
    let { view, item } = await mount('1. a\n   * kid\n2. b\n')
    aimAt(view, 'a')
    rightClick(item)
    expect(labels(view).slice(-4)).toEqual(['Number children', ROW, 'Collapse all', 'Expand all'])
    ;({ view, item } = await mount('* a\n* b\n'))
    aimAt(view, 'a')
    rightClick(item)
    expect(labels(view)).not.toContain(ROW)
  })
})
