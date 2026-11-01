/**
 * The table comment on its own (YAZ-3758, YAZ-3696 D1 / D3 / D7 / S3): parse and format of
 * `<!-- table: … -->`. No editor here — `tableStyle.test.ts` holds it to a real one.
 */
import { describe, expect, it } from 'vitest'
import { cellAddress, formatTableComment, parseTableComment, plainTable, type TableStyle } from './tableComment'

const style = (parts: Partial<TableStyle>): TableStyle => ({ ...plainTable(), ...parts })

describe('A1 addresses', () => {
  it('columns are letters, rows are numbers from 1; column 27 is AA', () => {
    expect(cellAddress(0, 0)).toBe('A1')
    expect(cellAddress(4, 25)).toBe('Z5')
    expect(cellAddress(0, 26)).toBe('AA1')
    expect(cellAddress(9, 27)).toBe('AB10')
    expect(cellAddress(0, 52)).toBe('BA1')
  })

  it('reads AA as column 27', () => {
    expect(parseTableComment('<!-- table: fill AA2 blue -->')?.fill).toEqual(new Map([['AA2', 'blue']]))
  })
})

describe('each part', () => {
  it.each<[string, Partial<TableStyle>]>([
    ['widths 140 240 auto', { widths: [140, 240, null] }],
    ['fill B3 green', { fill: new Map([['B3', 'green']]) }],
    ['color B2 red', { color: new Map([['B2', 'red']]) }],
    ['border 2px 40%', { border: { px: 2, darkness: 40 } }],
    ['header plain', { header: 'plain' }],
    ['stripes', { stripes: true }],
    ['height compact', { height: 'compact' }],
    ['height tall', { height: 'tall' }],
    ['nowrap', { nowrap: true }],
    ['freeze 2 rows 1 col', { freeze: { rows: 2, cols: 1 } }],
    ['freeze 1 row', { freeze: { rows: 1, cols: 0 } }],
    ['freeze 3 cols', { freeze: { rows: 0, cols: 3 } }],
  ])('%s', (part, parts) => {
    const comment = `<!-- table: ${part} -->`
    expect(parseTableComment(comment)).toEqual(style(parts))
    expect(formatTableComment(style(parts))).toBe(comment)
  })

  it('a plain table has no comment', () => {
    expect(formatTableComment(plainTable())).toBeNull()
    expect(formatTableComment(style({ widths: [null, null] }))).toBeNull()
    expect(formatTableComment(style({ freeze: { rows: 0, cols: 0 } }))).toBeNull()
  })

  it('a default value written by hand is read as the default', () => {
    expect(parseTableComment('<!-- table: header shaded, height normal, stripes -->')).toEqual(style({ stripes: true }))
  })
})

describe('ranges', () => {
  it('a range sets every cell in its rectangle, either corner first', () => {
    const fill = new Map([['A1', 'blue'], ['B1', 'blue'], ['A2', 'blue'], ['B2', 'blue']])
    expect(parseTableComment('<!-- table: fill A1:B2 blue -->')?.fill).toEqual(fill)
    expect(parseTableComment('<!-- table: fill B2:A1 blue -->')?.fill).toEqual(fill)
  })

  it('several addresses before one colour all take it', () => {
    expect(parseTableComment('<!-- table: color A1 C3:C4 red B2 grey -->')?.color).toEqual(
      new Map([['A1', 'red'], ['C3', 'red'], ['C4', 'red'], ['B2', 'grey']]),
    )
  })

  it('writes cells of one colour as rows and columns of rectangles, each colour once, in reading order', () => {
    const fill = new Map<string, 'blue' | 'green' | 'yellow'>([
      ['A1', 'blue'], ['B1', 'blue'], ['C1', 'blue'],
      ['B3', 'green'],
      ['B2', 'yellow'], ['B4', 'yellow'], ['B5', 'yellow'],
      ['D2', 'blue'], ['D3', 'blue'],
    ])
    const comment = formatTableComment(style({ fill }))
    expect(comment).toBe('<!-- table: fill A1:C1 D2:D3 blue B2 B4:B5 yellow B3 green -->')
    expect(parseTableComment(comment!)?.fill).toEqual(fill)
  })

  it('a block of one colour is one range', () => {
    const color = new Map<string, 'red'>()
    for (const a of ['B2', 'C2', 'B3', 'C3', 'B4', 'C4']) color.set(a, 'red')
    expect(formatTableComment(style({ color }))).toBe('<!-- table: color B2:C4 red -->')
  })
})

describe('named and custom colours (YAZ-3817)', () => {
  it.each(['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'grey', 'brown'])('%s is a fill and a text colour', (name) => {
    const comment = `<!-- table: fill A1 ${name}, color B2 ${name} -->`
    expect(parseTableComment(comment)).toEqual(style({ fill: new Map([['A1', name]]), color: new Map([['B2', name]]) }))
    expect(formatTableComment(parseTableComment(comment)!)).toBe(comment)
  })

  it('a custom colour is `#rrggbb`, read in any case and written lowercase', () => {
    const parsed = parseTableComment('<!-- table: fill A1:B1 #ff8800 C2 teal, color B2 #1A2B3C -->')
    expect(parsed?.fill).toEqual(new Map([['A1', '#ff8800'], ['B1', '#ff8800'], ['C2', 'teal']]))
    expect(parsed?.color).toEqual(new Map([['B2', '#1a2b3c']]))
    expect(formatTableComment(parsed!)).toBe('<!-- table: fill A1:B1 #ff8800 C2 teal, color B2 #1a2b3c -->')
  })

  it.each(['#ff88', '#ff88000', '#gg8800', 'ff8800', '#ff8800aa'])('%s is no colour: the part is ignored', (value) => {
    expect(parseTableComment(`<!-- table: fill A1 ${value}, stripes -->`)).toEqual(style({ stripes: true }))
  })
})

describe('a cell\'s own alignment (YAZ-3819)', () => {
  it('`align` takes A1 ranges and left, center or right; it is written after `color`', () => {
    const comment = '<!-- table: fill A1 blue, color A1 red, align B2:C3 center A4 right, stripes -->'
    const parsed = parseTableComment(comment)
    expect(parsed?.align).toEqual(new Map([['B2', 'center'], ['C2', 'center'], ['B3', 'center'], ['C3', 'center'], ['A4', 'right']]))
    expect(formatTableComment(parsed!)).toBe(comment)
    expect(formatTableComment(parseTableComment('<!-- table: align A1 left, color A1 red -->')!)).toBe('<!-- table: color A1 red, align A1 left -->')
  })

  it.each(['align A1 middle', 'align A1 #ff8800', 'align A1 red', 'align center'])('%s is ignored', (part) => {
    expect(parseTableComment(`<!-- table: ${part}, stripes -->`)).toEqual(style({ stripes: true }))
  })
})

describe('the fixed order', () => {
  const all = '<!-- table: widths 140 240 auto, fill A1:C1 blue B3 green, color B2:B5 red, border 2px 40%, header plain, stripes, height compact, nowrap, freeze 2 rows 1 col -->'

  it('writes every part in the order widths, fill, color, border, header, stripes, height, nowrap, freeze', () => {
    const parsed = parseTableComment(all)
    expect(parsed).not.toBeNull()
    expect(formatTableComment(parsed!)).toBe(all)
  })

  it('reads the parts in any order, and writes them in the fixed order', () => {
    expect(formatTableComment(parseTableComment('<!-- table: nowrap, stripes, widths 100 -->')!)).toBe('<!-- table: widths 100, stripes, nowrap -->')
  })
})

describe('tolerant reading', () => {
  it('an unknown part is ignored, the known parts are kept', () => {
    expect(parseTableComment('<!-- table: stripes, sparkle 3, nowrap -->')).toEqual(style({ stripes: true, nowrap: true }))
  })

  it('`align` is no part: the column alignment is the GFM `:-` row (YAZ-3767)', () => {
    expect(parseTableComment('<!-- table: align center, stripes -->')).toEqual(style({ stripes: true }))
  })

  it('a known part with a value it does not know is ignored', () => {
    expect(parseTableComment('<!-- table: fill A1 magenta, header fancy, stripes -->')).toEqual(style({ stripes: true }))
    expect(parseTableComment('<!-- table: widths 140 wide, border 2px, freeze 0 rows, nowrap -->')).toEqual(style({ nowrap: true }))
  })

  it('any spaces inside the delimiters', () => {
    expect(parseTableComment('<!--table:stripes-->')).toEqual(style({ stripes: true }))
  })

  it.each([
    ['<!-- table: -->'],
    ['<!-- table -->'],
    ['<!-- tables: stripes -->'],
    ['<!-- table: sparkle, glitter 3 -->'],
    ['<!-- a note -->'],
    ['<!-- line: darkness 80% -->'],
    ['stripes'],
  ])('%s is not the table comment: null', (comment) => {
    expect(parseTableComment(comment)).toBeNull()
  })
})
