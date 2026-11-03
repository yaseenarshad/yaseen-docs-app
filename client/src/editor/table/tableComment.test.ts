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

  it.each(['#ff88', '#ff88000', '#gg8800', 'ff8800', '#ff8800aa'])('%s is no colour: the part is not read, and is kept as its text (YAZ-4176)', (value) => {
    expect(parseTableComment(`<!-- table: fill A1 ${value}, stripes -->`)).toEqual(style({ stripes: true, unknown: [{ after: null, text: `fill A1 ${value}` }] }))
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

  it.each(['align A1 middle', 'align A1 #ff8800', 'align A1 red', 'align center'])('%s is not read, and is kept as its text (YAZ-4176)', (part) => {
    expect(parseTableComment(`<!-- table: ${part}, stripes -->`)).toEqual(style({ stripes: true, unknown: [{ after: null, text: part }] }))
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
  it('an unknown part is kept as its text, after the known part before it; the known parts are read (YAZ-4161)', () => {
    expect(parseTableComment('<!-- table: stripes, sparkle 3, nowrap -->')).toEqual(style({ stripes: true, nowrap: true, unknown: [{ after: 'stripes', text: 'sparkle 3' }] }))
  })

  it('`align center` is no column alignment: that is the GFM `:-` row (YAZ-3767); the part is kept as its text (YAZ-4176)', () => {
    expect(parseTableComment('<!-- table: align center, stripes -->')).toEqual(style({ stripes: true, unknown: [{ after: null, text: 'align center' }] }))
  })

  it('a known part with a value it does not know is not read, and is kept as its text (YAZ-4176)', () => {
    const kept = (...texts: string[]) => texts.map((text) => ({ after: null, text }))
    expect(parseTableComment('<!-- table: fill A1 magenta, header fancy, stripes -->')).toEqual(style({ stripes: true, unknown: kept('fill A1 magenta', 'header fancy') }))
    expect(parseTableComment('<!-- table: widths 140 wide, border 2px, freeze 0 rows, nowrap -->')).toEqual(style({ nowrap: true, unknown: kept('widths 140 wide', 'border 2px', 'freeze 0 rows') }))
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

describe('parts it does not know (YAZ-4161)', () => {
  it('a comment with an unknown part between known ones saves byte for byte', () => {
    const comment = '<!-- table: widths 140 auto, future 1 2, stripes -->'
    const parsed = parseTableComment(comment)
    expect(parsed).toEqual(style({ widths: [140, null], stripes: true, unknown: [{ after: 'widths', text: 'future 1 2' }] }))
    expect(formatTableComment(parsed!)).toBe(comment)
  })

  it('an unknown part with no known part before it goes after the known parts; unknown parts keep their order', () => {
    expect(formatTableComment(parseTableComment('<!-- table: alpha 1, beta, stripes, gamma x  y, nowrap -->')!)).toBe('<!-- table: stripes, gamma x  y, nowrap, alpha 1, beta -->')
  })

  it('an unknown part whose known part is no longer set goes after the known parts', () => {
    const parsed = parseTableComment('<!-- table: stripes, future 1, nowrap -->')!
    expect(formatTableComment({ ...parsed, stripes: undefined })).toBe('<!-- table: nowrap, future 1 -->')
  })

  it('a known part with a value it does not know is kept in its place (YAZ-4176); it is no anchor', () => {
    const parsed = parseTableComment('<!-- table: stripes, header fancy, future, nowrap -->')!
    expect(parsed.unknown).toEqual([{ after: 'stripes', text: 'header fancy' }, { after: 'stripes', text: 'future' }])
    expect(formatTableComment(parsed)).toBe('<!-- table: stripes, header fancy, future, nowrap -->')
  })

  it('a line break inside an unknown part is one space', () => {
    expect(formatTableComment(parseTableComment('<!-- table: stripes, future\n   1 -->')!)).toBe('<!-- table: stripes, future 1 -->')
  })

  it('a comment with only unknown parts is still not ours', () => {
    expect(parseTableComment('<!-- table: future 1, later -->')).toBeNull()
  })
})

describe('a known part with a value this build cannot read (YAZ-4176)', () => {
  // A newer build can write a new slot length, a wider zoom or a new `valign` value.
  const NEWER = '<!-- table: widths 140 auto, valign A2 justify, zoom 500%, stripes, calendar 45m -->'

  it('is kept as its text, in its place, as an unknown part: the comment saves byte for byte', () => {
    const parsed = parseTableComment(NEWER)
    expect(parsed).toEqual(style({
      widths: [140, null],
      stripes: true,
      unknown: [{ after: 'widths', text: 'valign A2 justify' }, { after: 'widths', text: 'zoom 500%' }, { after: 'stripes', text: 'calendar 45m' }],
    }))
    expect(formatTableComment(parsed!)).toBe(NEWER)
  })

  it('is dropped only when this build writes that part itself', () => {
    const parsed = parseTableComment(NEWER)!
    expect(formatTableComment({ ...parsed, calendar: 30 })).toBe('<!-- table: widths 140 auto, valign A2 justify, zoom 500%, stripes, calendar 30m -->')
    expect(formatTableComment({ ...parsed, zoom: 90, valignTable: 'middle' })).toBe('<!-- table: widths 140 auto, valign middle, zoom 90%, stripes, calendar 45m -->')
  })

  it('a comment with only such parts is still not ours: the editor keeps it as its text', () => {
    expect(parseTableComment('<!-- table: calendar 45m, zoom 500% -->')).toBeNull()
  })
})
