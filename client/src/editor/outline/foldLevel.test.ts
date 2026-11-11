/**
 * Collapse this level / Expand this level (YAZ-4786 demo: "expand / collapse a certain level in notes"), on a real
 * createCrepe: `setOutlineFoldLevel` folds every foldable bullet at the right-clicked bullet's depth, in the whole note,
 * and opens every one above it; Expand opens that level and above, deeper folds stay; one ⌘Z undoes it; the rows show
 * in a bullet's handle menu only where that level folds. Folding never touches the markdown.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import { foldAllOutline, outlineCollapsedPositions, setOutlineFoldLevel, undoLastFold } from './outlineFolding'

/** Two sections, each with numbered items that have children: the demo's AWS doc in small. */
const DOC = `* Section A
  1. Item A1
     * a1 detail
  2. Item A2
     * a2 detail
* Section B
  1. Item B1
     * b1 detail
`

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []
async function mount(markdown = DOC): Promise<{ crepe: Crepe; view: EditorView; item: HTMLElement }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.ctx.get(editorViewCtx)
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

/** The list_item whose first line reads `label`. */
function itemPos(view: EditorView, label: string): number {
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found !== -1) return false
    if (node.type.name === 'list_item' && node.firstChild?.textContent === label) found = pos
    return true
  })
  if (found === -1) throw new Error(`no ${label}`)
  return found
}
/** The labels of the folded bullets, sorted. */
const collapsed = (view: EditorView) =>
  [...outlineCollapsedPositions(view.state)].map((pos) => view.state.doc.nodeAt(pos)!.firstChild!.textContent).sort()

describe('YAZ-4786 demo: setOutlineFoldLevel', () => {
  it('YAZ-4786 demo: Collapse this level on Item A1 folds every numbered item in both sections; the sections stay open', async () => {
    const { crepe, view } = await mount()
    const before = getMarkdownForSave(crepe)
    expect(setOutlineFoldLevel(itemPos(view, 'Item A1'), true)(view.state, view.dispatch)).toBe(true)
    expect(collapsed(view)).toEqual(['Item A1', 'Item A2', 'Item B1'])
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  it('YAZ-4786 demo: after Collapse all, Collapse this level opens the bullets above so the level shows', async () => {
    const { view } = await mount()
    foldAllOutline(view.state, view.dispatch)
    expect(collapsed(view)).toEqual(['Item A1', 'Item A2', 'Item B1', 'Section A', 'Section B'])
    setOutlineFoldLevel(itemPos(view, 'Item B1'), true)(view.state, view.dispatch)
    expect(collapsed(view)).toEqual(['Item A1', 'Item A2', 'Item B1'])
  })

  it('YAZ-4786 demo: Expand this level opens that level and above; deeper folds stay', async () => {
    const { view } = await mount()
    foldAllOutline(view.state, view.dispatch)
    setOutlineFoldLevel(itemPos(view, 'Section A'), false)(view.state, view.dispatch)
    expect(collapsed(view)).toEqual(['Item A1', 'Item A2', 'Item B1'])
    setOutlineFoldLevel(itemPos(view, 'Item A2'), false)(view.state, view.dispatch)
    expect(collapsed(view)).toEqual([])
  })

  it('YAZ-4786 demo: one ⌘Z undoes Collapse this level, the opened bullets above folded again', async () => {
    const { view } = await mount()
    foldAllOutline(view.state, view.dispatch)
    setOutlineFoldLevel(itemPos(view, 'Item A1'), true)(view.state, view.dispatch)
    undoLastFold(view.state, view.dispatch)
    expect(collapsed(view)).toEqual(['Item A1', 'Item A2', 'Item B1', 'Section A', 'Section B'])
  })

  it('YAZ-4786 demo: a level with no foldable bullet answers false (the rows hide); a non-item answers false', async () => {
    const { view } = await mount()
    expect(setOutlineFoldLevel(itemPos(view, 'a1 detail'), true)(view.state)).toBe(false)
    // Position 0 is the bullet list itself, no list item.
    expect(setOutlineFoldLevel(0, true)(view.state)).toBe(false)
    expect(setOutlineFoldLevel(itemPos(view, 'Item A1'), true)(view.state)).toBe(true)
  })
})

describe('YAZ-4786 demo: the rows in a bullet menu', () => {
  const popupOf = (view: EditorView) => view.dom.parentElement!.querySelector<HTMLElement>('.ctx-menu--editor')
  const rows = (view: EditorView) => [...(popupOf(view)?.querySelectorAll<HTMLElement>('.ctx-menu__item') ?? [])].map((b) => b.textContent)
  const open = (view: EditorView, item: HTMLElement, label: string) => {
    const pos = itemPos(view, label)
    view.posAtCoords = () => ({ pos: pos + 1, inside: pos })
    item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
  }

  it('YAZ-4786 demo: under Expand all, "Collapse this level" and "Expand this level"; the row runs the level fold', async () => {
    const { view, item } = await mount()
    open(view, item, 'Item A1')
    const labels = rows(view)
    const at = labels.indexOf('Expand all')
    expect(at).toBeGreaterThanOrEqual(0)
    expect(labels.slice(at + 1, at + 3)).toEqual(['Collapse this level', 'Expand this level'])
    ;[...popupOf(view)!.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')].find((b) => b.textContent === 'Collapse this level')!.click()
    expect(collapsed(view)).toEqual(['Item A1', 'Item A2', 'Item B1'])
  })
})
