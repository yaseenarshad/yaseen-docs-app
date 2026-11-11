/**
 * YAZ-4869 S2–S5 on the real editor (jsdom): a Super table's view draws from the folder-page engine over the table's
 * rows, hides the table, groups and sorts without a change to the file; an edit in a view is one undo step; a header
 * rename renames the column in the views; a drag to another group writes the row's group cell; ⌘F's match shows its
 * row; a copy keeps the view's order; and a key in another block runs no engine (item 20).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { undo } from '@milkdown/kit/prose/history'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { getMarkdownForSave } from '../../createCrepe'
import { mountNote, unmountAll } from '../tableTestKit'
import { loadSuperTable, SUPER_TYPING_MS } from '../tableZoomPill'
import { superRuns } from './superData'
import { activeViewAt, setActiveTab, SUPER_HIDDEN_CLASS } from './superTables'

afterEach(unmountAll)

const TABLE = [
  '| Piece | Layer | Size |',
  '| - | - | - |',
  '| Roof | Top | 3 |',
  '| Wall | Middle | 12 |',
  '| Door | Middle | 2 |',
  '| Base | Ground | 1,200 |',
  '| Hat | Top |  |',
].join('\n')
const NOTE = `Intro line\n\n${TABLE}\n\n<!-- table: super, view "By layer" group Layer sort Piece, view Sizes sort Size desc summary Size sum -->\n`

const tablePos = (view: EditorView): number => {
  let pos = -1
  view.state.doc.descendants((node, p) => {
    if (pos === -1 && node.type.name === 'table') pos = p
    return pos === -1
  })
  return pos
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A note with its table's view `name` showing; `saved` is the note as the app saves it, before any change. */
async function showView(markdown: string, name: string) {
  const m = await mountNote(markdown)
  const saved = getMarkdownForSave(m.crepe)
  await loadSuperTable()
  setActiveTab(m.view, tablePos(m.view), name)
  await wait(0)
  return { ...m, saved }
}

const viewRoot = (view: EditorView) => view.dom.querySelector<HTMLElement>('.table-super-view')!
/** Each line of the view: `# <group> <count>` or the row's cells joined by `|`. */
const linesOf = (view: EditorView) =>
  [...viewRoot(view).querySelectorAll<HTMLElement>('tbody tr')].map((tr) =>
    tr.classList.contains('super-view__group') ? `# ${tr.querySelector('.view-group__value')?.textContent} ${tr.querySelector('.view-group__count')?.textContent}` : [...tr.querySelectorAll('td:not(.super-view__gutter)')].map((td) => td.textContent).join('|'),
  )

describe('YAZ-4873 S2: a view of the table', () => {
  it('hides the table and draws the view: groups in first-appearance order, rows sorted, the file unchanged', async () => {
    const { view, crepe, saved } = await showView(NOTE, 'By layer')
    expect(view.dom.querySelector('.milkdown-table-block')!.classList.contains(SUPER_HIDDEN_CLASS)).toBe(true)
    expect([...view.dom.querySelectorAll('.table-super-bar__tab')].map((t) => `${t.textContent}${t.getAttribute('aria-selected') === 'true' ? '*' : ''}`)).toEqual(['Table', 'By layer*', 'Sizes', '+'])
    expect(linesOf(view)).toEqual(['# Top 2', 'Hat|Top|', 'Roof|Top|3', '# Middle 2', 'Door|Middle|2', 'Wall|Middle|12', '# Ground 1', 'Base|Ground|1,200'])
    expect(saved).toContain('<!-- table: super, view "By layer" group Layer sort Piece, view Sizes sort Size desc summary Size sum -->')
    expect(getMarkdownForSave(crepe)).toBe(saved)
    setActiveTab(view, tablePos(view), null)
    await wait(0)
    expect(view.dom.querySelector('.milkdown-table-block')!.classList.contains(SUPER_HIDDEN_CLASS)).toBe(false)
    expect(view.dom.querySelector('.table-super-view')).toBeNull()
    expect(getMarkdownForSave(crepe)).toBe(saved)
  })

  it('item 14: numbers sort as numbers (1,200 above 12) and sum; an empty cell sorts last', async () => {
    const { view } = await showView(NOTE, 'Sizes')
    expect(linesOf(view).map((l) => l.split('|')[0])).toEqual(['Base', 'Wall', 'Roof', 'Door', 'Hat'])
    expect(viewRoot(view).querySelector('.super-view__summary-value')!.textContent).toBe('1217')
  })

  it('item 21: a copy of rows in a view keeps the view’s order, as a Markdown table and an HTML table', async () => {
    const { view } = await showView(NOTE, 'Sizes')
    const selection = window.getSelection()!
    selection.selectAllChildren(viewRoot(view).querySelector('tbody')!)
    const data = new Map<string, string>()
    const event = new Event('copy', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(event, 'clipboardData', { value: { setData: (type: string, text: string) => data.set(type, text) } })
    viewRoot(view).querySelector('td')!.dispatchEvent(event)
    expect(data.get('text/plain')).toBe(['| Piece | Layer | Size |', '| --- | --- | --- |', '| Base | Ground | 1,200 |', '| Wall | Middle | 12 |', '| Roof | Top | 3 |', '| Door | Middle | 2 |', '| Hat | Top |  |'].join('\n'))
    expect(data.get('text/html')).toContain('<tr><td>Base</td><td>Ground</td><td>1,200</td></tr><tr><td>Wall</td>')
    expect(event.defaultPrevented).toBe(true)
  })

  it('item 20: a key in another block runs no engine; keys in the table run it once per debounce', async () => {
    const big = ['| Name | Group | ' + Array.from({ length: 8 }, (_, c) => `C${c}`).join(' | ') + ' |', `|${' - |'.repeat(10)}`, ...Array.from({ length: 500 }, (_, r) => `| n${r} | g${r % 7} | ${Array.from({ length: 8 }, (_, c) => `${r * c}`).join(' | ')} |`)].join('\n')
    const { view } = await showView(`Intro line\n\n${big}\n\n<!-- table: super, view All group Group sort C1 desc -->\n`, 'All')
    expect(viewRoot(view).querySelectorAll('tbody tr.super-view__row').length).toBeLessThan(120)
    const runs = superRuns.count
    const type = (pos: number) => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)).insertText('x'))
    for (let i = 0; i < 20; i++) type(2)
    await wait(SUPER_TYPING_MS + 50)
    expect(superRuns.count).toBe(runs)
    const inTable = tablePos(view) + 4
    for (let i = 0; i < 20; i++) type(inTable)
    expect(superRuns.count).toBe(runs)
    await wait(SUPER_TYPING_MS + 50)
    expect(superRuns.count).toBe(runs + 1)
  })
})

describe('YAZ-4876 S5: edit in a view, header rename, find', () => {
  it('item 5: a double-click edits a cell; Enter writes it in the table, one undo step', async () => {
    const { view, crepe, saved } = await showView(NOTE, 'By layer')
    const roof = [...viewRoot(view).querySelectorAll('td')].find((td) => td.textContent === 'Roof')!
    roof.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await wait(0)
    const box = viewRoot(view).querySelector<HTMLInputElement>('.super-view__edit')!
    box.value = 'Roof tiles'
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await wait(0)
    expect(getMarkdownForSave(crepe)).toMatch(/\| Roof tiles \| Top +\| 3 +\|/)
    expect(linesOf(view)).toContain('Roof tiles|Top|3')
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(saved)
  })

  it('item 15: a key in a header cell renames the column in the views, in the same undo step', async () => {
    const { view, crepe } = await mountNote(NOTE)
    const saved = getMarkdownForSave(crepe)
    // The end of "Layer" in the header row.
    let at = -1
    view.state.doc.descendants((node, pos) => {
      if (at === -1 && node.isText && node.text === 'Layer') at = pos + 5
      return at === -1
    })
    view.dispatch(view.state.tr.insertText('s', at))
    expect(getMarkdownForSave(crepe)).toContain('<!-- table: super, view "By layer" group Layers sort Piece, view Sizes sort Size desc summary Size sum -->')
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(saved)
  })

  it('item 9: a row dropped on another group gets that group’s value, one undo step', async () => {
    const { view, crepe, saved } = await showView(NOTE, 'By layer')
    const rows = () => [...viewRoot(view).querySelectorAll<HTMLElement>('tbody tr')]
    const door = rows().find((tr) => tr.textContent?.startsWith('Door'))!
    const ground = rows().find((tr) => tr.querySelector('.view-group__value')?.textContent === 'Ground')!
    door.dispatchEvent(new Event('dragstart', { bubbles: true }))
    ground.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }))
    await wait(0)
    expect(getMarkdownForSave(crepe)).toMatch(/\| Door +\| Ground +\| 2 +\|/)
    expect(linesOf(view)).toContain('# Ground 2')
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(saved)
  })

  it('item 25: ⌘F’s match in a table that shows a view marks its row there', async () => {
    const { view } = await showView(NOTE, 'Sizes')
    expect(activeViewAt(view.state, tablePos(view))).toBe('Sizes')
    const anchor = view.dom.querySelector<HTMLElement & { findRow?: (row: number) => void }>('.table-zoom-anchor')!
    anchor.findRow!(4)
    await wait(0)
    expect(viewRoot(view).querySelector('tr[data-found]')?.textContent).toContain('Base')
  })
})
