/**
 * The table zoom (YAZ-4091, YAZ-4159 D13): the `zoom` part, the table's `zoom` attribute on the block (`data-table-zoom`,
 * `--table-zoom`), the page zoom pill `DocumentZoom` on the table (`tableZoomPill.tsx`), one undo step per change, and
 * a column drag under a table zoom (`tableColumnResize.ts` reads the zoom at the table, not at the editor).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { undo } from '@milkdown/kit/prose/history'
import { DOMParser, DOMSerializer, type Node as ProseNode } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import { addRowAfter } from '@milkdown/kit/prose/tables'
import type { EditorView } from '@milkdown/kit/prose/view'
import { getMarkdownForSave } from '../createCrepe'
import { mount, pressKey, unmountAll as unmountMarks } from '../marks/markTestKit'
import { formatTableComment, parseTableComment, plainTable, type TableStyle } from './tableComment'
import { cellPos, dragColumnEdge, mountPage, mountTable, unmountAll } from './tableTestKit'
import tableCss from './table.css?inline'

/** The value of each render of a pill (`DocumentZoom`), the real component's own. */
const renders = vi.hoisted(() => [] as number[])
vi.mock('../DocumentZoom', async (importOriginal) => {
  const real = await importOriginal<typeof import('../DocumentZoom')>()
  return {
    ...real,
    DocumentZoom: (props: Parameters<typeof real.DocumentZoom>[0]) => {
      renders.push(props.value)
      return real.DocumentZoom(props)
    },
  }
})

afterEach(async () => {
  await unmountAll()
  await unmountMarks()
})

const style = (parts: Partial<TableStyle>): TableStyle => ({ ...plainTable(), ...parts })
const TABLE = '| h1 | h2 |\n| -- | -- |\n| a  | b  |\n'

const firstTable = (view: EditorView): ProseNode => {
  let out: ProseNode | null = null
  view.state.doc.descendants((node) => {
    if (out === null && node.type.name === 'table') out = node
    return out === null
  })
  return out!
}
const block = (view: EditorView) => view.dom.querySelector<HTMLElement>('.milkdown-table-block')!
const anchor = (view: EditorView) => view.dom.querySelector<HTMLElement>('.table-zoom-anchor')!
const button = (view: EditorView, label: string) => anchor(view).querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!

describe('the `zoom` part', () => {
  it('`zoom 90%` round-trips, after `fold`; 100% is the default and writes nothing', () => {
    expect(parseTableComment('<!-- table: zoom 90% -->')).toEqual(style({ zoom: 90 }))
    expect(formatTableComment(style({ zoom: 90 }))).toBe('<!-- table: zoom 90% -->')
    expect(formatTableComment(parseTableComment('<!-- table: stripes, zoom 125%, fold 3 -->')!)).toBe('<!-- table: fold 3, zoom 125%, stripes -->')
    expect(parseTableComment('<!-- table: zoom 100%, stripes -->')).toEqual(style({ stripes: true }))
    expect(formatTableComment(style({ zoom: 100 }))).toBeNull()
  })

  it.each(['zoom 40%', 'zoom 450%', 'zoom 90', 'zoom 90.5%', 'zoom 090%', 'zoom'])('%s is a value it does not know: the part is kept as its text (YAZ-4176)', (part) => {
    expect(parseTableComment(`<!-- table: ${part}, stripes -->`)).toEqual(style({ stripes: true, unknown: [{ after: null, text: part }] }))
  })
})

describe('in the editor', () => {
  const ZOOMED = `${TABLE}\n<!-- table: zoom 75%, border 2px 40% -->\n`

  it('loads into the table, saves byte for byte, and puts the zoom on the block for `table.css`', async () => {
    const { crepe, view } = await mountPage(ZOOMED)
    expect(getMarkdownForSave(crepe)).toBe(ZOOMED)
    expect(firstTable(view).attrs.zoom).toBe(75)
    expect(block(view).getAttribute('data-table-zoom')).toBe('75')
    expect(block(view).style.getPropertyValue('--table-zoom')).toBe('0.75')
    expect(block(view).style.getPropertyValue('--table-border-width')).toBe('2px')
  })

  it('a copy inside the app keeps it', async () => {
    const { view } = await mountPage(ZOOMED)
    const { schema } = view.state
    const holder = document.createElement('div')
    holder.appendChild(DOMSerializer.fromSchema(schema).serializeNode(firstTable(view)))
    expect(DOMParser.fromSchema(schema).parse(holder).firstChild!.attrs.zoom).toBe(75)
  })

  it('table.css zooms the block\'s content (so it multiplies with the page zoom), and one rule places the pill', () => {
    const css = tableCss.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).toMatch(/\.milkdown-table-block\[data-table-zoom\] \.table-wrapper \{[^}]*zoom: var\(--table-zoom, 1\)/)
    expect(css.match(/\.table-zoom-anchor > \.document-zoom \{[^}]*position: absolute;[^}]*\}/g)).toHaveLength(1)
  })
})

describe('the pill on the table (the page zoom pill, `DocumentZoom`)', () => {
  it('shows the table\'s value; − / + change it, one undo step each; 100% writes no part', async () => {
    const { crepe, view } = await mountPage(`${TABLE}\n<!-- table: zoom 90% -->\n`)
    expect(anchor(view).nextElementSibling).toBe(block(view))
    expect(anchor(view).querySelector('.document-zoom__value')!.textContent).toBe('90%')
    expect(anchor(view).querySelector('.document-zoom')!.getAttribute('aria-label')).toBe('Table zoom')
    expect(anchor(view).hasAttribute('data-zoomed')).toBe(true)
    button(view, 'Zoom in').click()
    expect(firstTable(view).attrs.zoom).toBe(100)
    expect(getMarkdownForSave(crepe)).toBe(TABLE)
    expect(anchor(view).querySelector('.document-zoom__value')!.textContent).toBe('100%')
    expect(anchor(view).hasAttribute('data-zoomed')).toBe(false)
    button(view, 'Zoom out').click()
    button(view, 'Zoom out').click()
    expect(getMarkdownForSave(crepe)).toBe(`${TABLE}\n<!-- table: zoom 75% -->\n`)
    undo(view.state, view.dispatch)
    expect(firstTable(view).attrs.zoom).toBe(90)
    expect(anchor(view).querySelector('.document-zoom__value')!.textContent).toBe('90%')
  })

  it('a zoom change renders only that table\'s pill; an Enter in a cell of another table renders none (YAZ-4176)', async () => {
    const { crepe, view } = await mountPage(`${TABLE}\n<!-- table: zoom 50% -->\n\ntext\n\n${TABLE}`)
    renders.length = 0
    const second = [...view.dom.querySelectorAll('.table-zoom-anchor')][1]!
    second.querySelector<HTMLButtonElement>('button[aria-label="Zoom in"]')!.click()
    expect(renders).toEqual([125])
    renders.length = 0
    // Enter in a cell of the first table, then a new row: the table changes, its zoom does not.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPos(view, 1, 0) + 2)))
    expect(pressKey(crepe, 'Enter')).toBe(true)
    addRowAfter(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toMatch(/^\| h1 +\| h2 \|\n\| -+ \| -- \|\n\| <br>a \| b +\|\n\| +\| +\|\n/)
    expect(renders).toEqual([])
  })

  it('only the note editor has pills: a preview or a bare editor (no `tableZoomPill`) has none (YAZ-4176)', async () => {
    const { view } = await mount(`${TABLE}\n<!-- table: zoom 50% -->\n`)
    expect(view.dom.querySelector('.milkdown-table-block')).not.toBeNull()
    expect(view.dom.querySelector('.table-zoom-anchor')).toBeNull()
  })

  it('each table has its own pill', async () => {
    const { view } = await mountPage(`${TABLE}\n<!-- table: zoom 50% -->\n\ntext\n\n${TABLE}`)
    const pills = [...view.dom.querySelectorAll('.table-zoom-anchor .document-zoom__value')].map((el) => el.textContent)
    expect(pills).toEqual(['50%', '100%'])
  })
})

// R4 / D13: `tableColumnResize.ts` read the editor's zoom, so under a table zoom the edge ran ahead of the cursor.
describe.each([1, 0.5])('column resize under a table zoom of 75%, at document zoom %s', (documentZoom) => {
  it('a drag of 50 layout px (50 × both zooms on screen) widens the column by 50 px', async () => {
    const zoom = documentZoom * 0.75
    const view = await mountTable(`${TABLE}\n<!-- table: zoom 75% -->\n`, zoom)
    // The editor has the document zoom only; the table (inside the block's zoomed content) has both.
    Object.defineProperty(view.dom, 'currentCSSZoom', { value: documentZoom, configurable: true })
    Object.defineProperty(view.dom.querySelector('table.children')!, 'currentCSSZoom', { value: zoom, configurable: true })
    dragColumnEdge(view, 0, 50 * zoom, zoom)
    expect(view.state.doc.nodeAt(cellPos(view, 0, 0))!.attrs.colwidth).toEqual([150])
  })
})
