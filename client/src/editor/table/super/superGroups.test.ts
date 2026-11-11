/**
 * YAZ-4869 S3 (YAZ-4874) on the real editor: a view's groups collapse and this Mac keeps it (never the note), the Group
 * panel sets each level's order and the group lines, and table folds act in "Table" only.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { EditorView } from '@milkdown/kit/prose/view'
import { getMarkdownForSave } from '../../createCrepe'
import { mountNote, unmountAll } from '../tableTestKit'
import { loadSuperTable } from '../tableZoomPill'
import { setActiveTab } from './superTables'

afterEach(unmountAll)

const TABLE = ['| Piece | Layer |', '| - | - |', '| Roof | Top |', '| Wall | Middle |', '| Door | Middle |', '| Base | Ground |'].join('\n')

const tablePos = (view: EditorView): number => {
  let pos = -1
  view.state.doc.descendants((node, p) => {
    if (pos === -1 && node.type.name === 'table') pos = p
    return pos === -1
  })
  return pos
}
const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

async function showView(markdown: string, name: string) {
  const m = await mountNote(markdown)
  const saved = getMarkdownForSave(m.crepe)
  await loadSuperTable()
  setActiveTab(m.view, tablePos(m.view), name)
  await wait()
  return { ...m, saved }
}

const lines = (view: EditorView) =>
  [...view.dom.querySelectorAll<HTMLElement>('.table-super-view tbody tr')].map((tr) => (tr.classList.contains('super-view__group') ? `# ${tr.querySelector('.view-group__value')?.textContent}` : tr.querySelector('td:not(.super-view__gutter)')?.textContent))
const tool = (view: EditorView, name: string) => [...view.dom.querySelectorAll<HTMLButtonElement>('.table-super-bar__tool')].find((b) => b.textContent?.startsWith(name))!

describe('YAZ-4874 S3: groups', () => {
  it('item 8: a collapsed group stays collapsed when the note opens again; the note never changes', async () => {
    const note = `${TABLE}\n\n<!-- table: super, view Layers group Layer -->\n`
    const first = await showView(note, 'Layers')
    expect(lines(first.view)).toEqual(['# Top', 'Roof', '# Middle', 'Wall', 'Door', '# Ground', 'Base'])
    const middle = [...first.view.dom.querySelectorAll<HTMLButtonElement>('.view-group__toggle')].find((b) => b.getAttribute('aria-label') === 'Toggle group Middle')!
    middle.click()
    await wait()
    expect(lines(first.view)).toEqual(['# Top', 'Roof', '# Middle', '# Ground', 'Base'])
    expect(getMarkdownForSave(first.crepe)).toBe(first.saved)
    await unmountAll()
    const again = await showView(note, 'Layers')
    expect(lines(again.view)).toEqual(['# Top', 'Roof', '# Middle', '# Ground', 'Base'])
  })

  it('items 7, 10: the Group panel sets a level’s order (A to Z) and the group lines; each pick is one write of the view', async () => {
    const { view, crepe } = await showView(`${TABLE}\n\n<!-- table: super, view Tiers group Layer -->\n`, 'Tiers')
    tool(view, 'Group').click()
    await wait()
    const order = view.dom.querySelector<HTMLButtonElement>('[aria-label="Group level 1 order"]')!
    order.click()
    await wait()
    ;[...view.dom.querySelectorAll<HTMLButtonElement>('.column-picker__option')].find((b) => b.textContent?.startsWith('A → Z'))!.click()
    await wait()
    expect(getMarkdownForSave(crepe)).toContain('<!-- table: super, view Tiers group Layer asc -->')
    expect(lines(view)).toEqual(['# Ground', 'Base', '# Middle', 'Wall', 'Door', '# Top', 'Roof'])
    ;[...view.dom.querySelectorAll<HTMLButtonElement>('.super-menu__segments .view-chip')].find((b) => b.textContent === 'Always')!.click()
    await wait()
    expect(getMarkdownForSave(crepe)).toContain('<!-- table: super, view Tiers group Layer asc lines always -->')
    expect(view.dom.querySelector('.super-view')!.getAttribute('data-group-lines')).toBe('always')
    // One line a level in the gutter of each row in a group.
    expect(view.dom.querySelectorAll('.super-view__row .super-view__gutter > i')).toHaveLength(4)
  })

  it('item 19: folded rows fold in "Table" only; a view shows them', async () => {
    const { view } = await showView(`${TABLE}\n\n<!-- table: fold 3-4, super, view All -->\n`, 'All')
    expect(lines(view)).toEqual(['Roof', 'Wall', 'Door', 'Base'])
  })
})
