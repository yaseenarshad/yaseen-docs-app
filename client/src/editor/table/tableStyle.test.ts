/**
 * The table's settings in the file (YAZ-3758, YAZ-3696 D1 / D3 / D7 / S3; CONTRACTS rule 41a): real
 * editors (`createCrepe`) load a note, save it, and load the save again. Pinned here: a table with
 * every part, a plain table with the bytes of before (R5), a comment that is not ours kept as text,
 * a table in a bullet, a comment that is not right after a table, widths ↔ `colwidth`, settings set
 * by a transaction, a copy inside the app (`parseDOM` / `toDOM`) and the table block's attributes.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { DOMParser, DOMSerializer, type Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import { getMarkdownForSave } from '../createCrepe'
import { mount, unmountAll } from '../marks/markTestKit'

afterEach(unmountAll)

/** Load, save; then load the save and save again — the second save must give the same bytes. */
async function save(markdown: string): Promise<string> {
  const { crepe } = await mount(markdown)
  const out = getMarkdownForSave(crepe)
  const again = await mount(out)
  expect(getMarkdownForSave(again.crepe)).toBe(out)
  return out
}

const tables = (doc: ProseNode): ProseNode[] => {
  const out: ProseNode[] = []
  doc.descendants((node) => {
    if (node.type.name === 'table') out.push(node)
    return node.type.name !== 'table'
  })
  return out
}
const htmlValues = (doc: ProseNode): string[] => {
  const out: string[] = []
  doc.descendants((node) => {
    if (node.type.name === 'html') out.push(node.attrs.value)
  })
  return out
}
/** One attribute of every cell, row by row. */
const cellAttr = (table: ProseNode, name: string): unknown[][] => {
  const rows: unknown[][] = []
  table.forEach((row) => {
    const cells: unknown[] = []
    row.forEach((cell) => cells.push(cell.attrs[name]))
    rows.push(cells)
  })
  return rows
}
const tablePos = (view: EditorView): number => {
  let pos = -1
  view.state.doc.descendants((node, p) => {
    if (pos < 0 && node.type.name === 'table') pos = p
    return pos < 0
  })
  return pos
}

const TABLE = '| x | y | z |\n| - | - | - |\n| a | b | c |\n| d | e | f |\n| g | h | i |\n| j | k | l |\n'
const SMALL = '| a | b |\n| - | - |\n| 1 | 2 |\n'
const ALL = '<!-- table: widths 140 240 auto, fill A1:C1 blue B3 green, color B2:B5 red, border 2px 40%, header plain, stripes, height compact, nowrap, freeze 2 rows 1 col -->'

describe('the table in the file', () => {
  it('a table with every part loads into the attributes and saves the same comment after a blank line', async () => {
    const note = `${TABLE}${ALL}\n\nAfter\n`
    const { view } = await mount(note)
    const [table] = tables(view.state.doc)
    expect(table.attrs).toMatchObject({
      border: { px: 2, darkness: 40 }, header: 'plain', stripes: true,
      height: 'compact', wrap: false, freezeRows: 2, freezeCols: 1,
    })
    expect(cellAttr(table, 'fill')).toEqual([
      ['blue', 'blue', 'blue'], [null, null, null], [null, 'green', null], [null, null, null], [null, null, null],
    ])
    expect(cellAttr(table, 'color')).toEqual([
      [null, null, null], [null, 'red', null], [null, 'red', null], [null, 'red', null], [null, 'red', null],
    ])
    expect(cellAttr(table, 'colwidth')[3]).toEqual([[140], [240], null])
    expect(htmlValues(view.state.doc)).toEqual([])
    expect(await save(note)).toBe(`${TABLE}\n${ALL}\n\nAfter\n`)
  })

  it('R5: a plain table saves with the same bytes and no comment, at the top level and in a bullet', async () => {
    expect(await save(SMALL)).toBe(SMALL)
    expect(await save(`x\n\n${SMALL}\ny\n`)).toBe(`x\n\n${SMALL}\ny\n`)
    const bullet = '* item\n  | a | b |\n  | - | - |\n  | 1 | 2 |\n* next\n'
    expect(await save(bullet)).toBe(bullet)
  })

  it.each([
    ['<!-- table: sparkle -->'],
    ['<!-- table: -->'],
    ['<!-- tables: stripes -->'],
  ])('a comment that does not parse, %s, keeps its text and the table loads plain', async (comment) => {
    const note = `${SMALL}\n${comment}\n`
    const { view } = await mount(note)
    expect(tables(view.state.doc)[0].attrs.stripes).toBe(false)
    expect(htmlValues(view.state.doc)).toEqual([comment])
    expect(await save(note)).toBe(note)
  })

  it('a table in a tight bullet keeps its comment inside the bullet, indented, and the next bullet stays a sibling', async () => {
    const note = '* item\n  | a | b |\n  | - | - |\n  | 1 | 2 |\n  <!-- table: fill A2 yellow, stripes -->\n* next\n'
    const { view } = await mount(note)
    const list = view.state.doc.child(0)
    expect(list.childCount).toBe(2)
    const item = list.child(0)
    expect(item.childCount).toBe(2)
    expect(item.child(1).attrs.stripes).toBe(true)
    expect(cellAttr(item.child(1), 'fill')).toEqual([[null, null], ['yellow', null]])
    expect(htmlValues(view.state.doc)).toEqual([])
    expect(await save(note)).toBe(note)
  })

  it('a comment that is not right after a table stays a normal comment', async () => {
    const before = `<!-- table: stripes -->\n\n${SMALL}`
    const between = `${SMALL}\ntext\n\n<!-- table: stripes -->\n`
    const alone = 'text\n\n<!-- table: stripes -->\n'
    for (const note of [before, between, alone]) {
      const { view } = await mount(note)
      for (const table of tables(view.state.doc)) expect(table.attrs.stripes).toBe(false)
      expect(htmlValues(view.state.doc)).toEqual(['<!-- table: stripes -->'])
      expect(await save(note)).toBe(note)
    }
  })

  it('widths go to every cell’s colwidth; extra widths are dropped and missing ones are auto', async () => {
    const { view } = await mount(`${SMALL}<!-- table: widths 100 -->\n`)
    expect(cellAttr(tables(view.state.doc)[0], 'colwidth')).toEqual([[[100], null], [[100], null]])
    expect(await save(`${SMALL}<!-- table: widths 100 -->\n`)).toBe(`${SMALL}\n<!-- table: widths 100 auto -->\n`)
    expect(await save(`${SMALL}<!-- table: widths 100 200 300 -->\n`)).toBe(`${SMALL}\n<!-- table: widths 100 200 -->\n`)
    expect(await save(`${SMALL}<!-- table: widths auto auto auto -->\n`)).toBe(SMALL)
  })

  it('cells out of the table are dropped; a comment left with nothing is not written', async () => {
    expect(await save(`${SMALL}<!-- table: fill Z9 blue -->\n`)).toBe(SMALL)
  })
})

describe('settings set by a transaction', () => {
  it('table attributes and cell attributes write the comment; colwidth writes the widths', async () => {
    const { crepe, view } = await mount(`x\n\n${SMALL}`)
    const pos = tablePos(view)
    const table = view.state.doc.nodeAt(pos)!
    const tr = view.state.tr.setNodeMarkup(pos, undefined, { ...table.attrs, stripes: true, height: 'tall', freezeRows: 1 })
    // The first cell of each row: header row at pos + 1, its first cell at pos + 2.
    const first = pos + 2
    tr.setNodeMarkup(first, undefined, { ...view.state.doc.nodeAt(first)!.attrs, fill: 'pink', colwidth: [180] })
    const second = first + table.child(0).nodeSize
    tr.setNodeMarkup(second, undefined, { ...view.state.doc.nodeAt(second)!.attrs, color: 'orange', colwidth: [180] })
    view.dispatch(tr)
    expect(getMarkdownForSave(crepe)).toBe(`x\n\n${SMALL}\n<!-- table: widths 180 auto, fill A1 pink, color A2 orange, stripes, height tall, freeze 1 row -->\n`)
  })

  it('values the comment does not know are not written', async () => {
    const { crepe, view } = await mount(SMALL)
    const pos = tablePos(view)
    const tr = view.state.tr.setNodeMarkup(pos, undefined, { ...view.state.doc.nodeAt(pos)!.attrs, height: 'huge' })
    tr.setNodeMarkup(pos + 2, undefined, { ...view.state.doc.nodeAt(pos + 2)!.attrs, fill: 'magenta' })
    tr.setNodeMarkup(pos + 2 + view.state.doc.nodeAt(pos + 2)!.nodeSize, undefined, { ...view.state.doc.nodeAt(pos + 2)!.attrs, color: '#ff88' })
    view.dispatch(tr)
    expect(getMarkdownForSave(crepe)).toBe(SMALL)
  })
})

describe('parseDOM / toDOM: a copy inside the app keeps the settings', () => {
  it('the table and its cells carry data attributes and read them back', async () => {
    const { view } = await mount(`${SMALL}<!-- table: fill A2 green, color B2 blue, border 3px 60%, header plain, stripes, height tall, nowrap, freeze 1 row 1 col -->\n`)
    const { schema } = view.state
    const dom = DOMSerializer.fromSchema(schema).serializeNode(tables(view.state.doc)[0]) as HTMLElement
    const tableEl = dom.tagName === 'TABLE' ? dom : dom.querySelector('table')!
    expect(tableEl.getAttribute('data-table-header')).toBe('plain')
    expect(tableEl.querySelector('td')!.getAttribute('data-fill')).toBe('green')
    expect(tableEl.querySelectorAll('td')[1].getAttribute('data-color')).toBe('blue')
    const holder = document.createElement('div')
    holder.appendChild(dom)
    const [copy] = tables(DOMParser.fromSchema(schema).parse(holder))
    expect(copy.attrs).toMatchObject({ border: { px: 3, darkness: 60 }, header: 'plain', stripes: true, height: 'tall', wrap: false, freezeRows: 1, freezeCols: 1 })
    expect(cellAttr(copy, 'fill')).toEqual([[null, null], ['green', null]])
    expect(cellAttr(copy, 'color')).toEqual([[null, null], [null, 'blue']])
  })

  it('a plain table and its cells have no data attributes of ours', async () => {
    const { view } = await mount(SMALL)
    const dom = DOMSerializer.fromSchema(view.state.schema).serializeNode(tables(view.state.doc)[0]) as HTMLElement
    expect(dom.outerHTML).not.toMatch(/data-(table|fill|color)/)
  })
})

describe('custom colours (YAZ-3817)', () => {
  const CUSTOM = `${SMALL}\n<!-- table: fill A2 #ff8800 B2 teal, color B2 #1a2b3c -->\n`

  it('load into the cells, save the same bytes, and draw by a custom property on the cell', async () => {
    expect(await save(CUSTOM)).toBe(CUSTOM)
    const { root, view } = await mount(CUSTOM)
    const [table] = tables(view.state.doc)
    expect(cellAttr(table, 'fill')).toEqual([[null, null], ['#ff8800', 'teal']])
    expect(cellAttr(table, 'color')).toEqual([[null, null], [null, '#1a2b3c']])
    const [a2, b2] = root.querySelectorAll<HTMLElement>('td')
    expect(a2.getAttribute('data-fill')).toBe('#ff8800')
    expect(a2.style.getPropertyValue('--table-fill-custom')).toBe('#ff8800')
    expect(b2.getAttribute('data-fill')).toBe('teal')
    expect(b2.style.getPropertyValue('--table-fill-custom')).toBe('')
    expect(b2.getAttribute('data-color')).toBe('#1a2b3c')
    expect(b2.style.getPropertyValue('--table-text-custom')).toBe('#1a2b3c')
    // The GFM alignment's style stays.
    expect(a2.style.textAlign).toBe('left')
  })

  it('a copy inside the app keeps them', async () => {
    const { view } = await mount(CUSTOM)
    const { schema } = view.state
    const holder = document.createElement('div')
    holder.appendChild(DOMSerializer.fromSchema(schema).serializeNode(tables(view.state.doc)[0]))
    const [copy] = tables(DOMParser.fromSchema(schema).parse(holder))
    expect(cellAttr(copy, 'fill')).toEqual([[null, null], ['#ff8800', 'teal']])
    expect(cellAttr(copy, 'color')).toEqual([[null, null], [null, '#1a2b3c']])
  })
})

describe('a cell\'s own alignment (YAZ-3819)', () => {
  const ALIGNED = '|  a | b |\n| -: | - |\n|  1 | 2 |\n\n<!-- table: align A2 center -->\n'

  it('loads into the cell, saves the same bytes, and wins over the column alignment on the page', async () => {
    expect(await save(ALIGNED)).toBe(ALIGNED)
    const { root, view } = await mount(ALIGNED)
    const [table] = tables(view.state.doc)
    expect(cellAttr(table, 'align')).toEqual([[null, null], ['center', null]])
    expect(cellAttr(table, 'alignment')).toEqual([['right', null], ['right', null]])
    const [h1] = root.querySelectorAll<HTMLElement>('th')
    const [a2, b2] = root.querySelectorAll<HTMLElement>('td')
    expect([h1.style.textAlign, a2.style.textAlign, b2.style.textAlign]).toEqual(['right', 'center', 'left'])
    expect(a2.getAttribute('data-align')).toBe('center')
  })

  it('a copy inside the app keeps it', async () => {
    const { view } = await mount(ALIGNED)
    const { schema } = view.state
    const holder = document.createElement('div')
    holder.appendChild(DOMSerializer.fromSchema(schema).serializeNode(tables(view.state.doc)[0]))
    const [copy] = tables(DOMParser.fromSchema(schema).parse(holder))
    expect(cellAttr(copy, 'align')).toEqual([[null, null], ['center', null]])
  })
})

describe('the table block shows the table settings to CSS', () => {
  it('data attributes and custom properties on .milkdown-table-block, kept up to date', async () => {
    const { root, view } = await mount(`${SMALL}<!-- table: border 2px 40%, header plain, stripes, height compact, nowrap -->\n`)
    const block = root.querySelector<HTMLElement>('.milkdown-table-block')!
    expect(block.getAttribute('data-table-header')).toBe('plain')
    expect(block.hasAttribute('data-table-stripes')).toBe(true)
    expect(block.getAttribute('data-table-height')).toBe('compact')
    expect(block.hasAttribute('data-table-nowrap')).toBe(true)
    expect(block.style.getPropertyValue('--table-border-width')).toBe('2px')
    expect(block.style.getPropertyValue('--table-border-darkness')).toBe('40%')
    const pos = tablePos(view)
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...view.state.doc.nodeAt(pos)!.attrs, stripes: false, height: 'tall' }))
    const now = root.querySelector<HTMLElement>('.milkdown-table-block')!
    expect(now.hasAttribute('data-table-stripes')).toBe(false)
    expect(now.getAttribute('data-table-height')).toBe('tall')
  })
})
