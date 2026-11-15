/**
 * YAZ-4869 S1 (YAZ-4872): a Super table in the table comment. `super` and one `view …` part per view, after the known
 * parts; names and values with spaces, quotes and commas come back as they were; an older build keeps the parts.
 */
import { describe, expect, it } from 'vitest'
import { formatTableComment, parseTableComment, plainTable, type TableStyle } from '../tableComment'
import { columnKeys, formatView, readView, renameColumns, type TableViewDef } from './viewGrammar'

const style = (parts: Partial<TableStyle>): TableStyle => ({ ...plainTable(), ...parts })

const BY_LAYER: TableViewDef = {
  name: 'By layer',
  group: [{ column: 'Layer', highlight: 'blue', large: true }, { column: 'Owner', order: 'desc' }],
  sort: [{ column: 'Piece', desc: true }, { column: 'Name' }],
  filter: [{ column: 'Status', op: 'is', value: 'Done' }, { column: 'Due date', op: 'isNotEmpty' }],
  summary: [{ column: 'Pieces', kind: 'sum' }],
  lines: 'always',
  thread: true,
}

describe('YAZ-4872 S1: the view part', () => {
  it('is one readable part: keywords start the clauses, a name with a space is quoted', () => {
    expect(formatView(BY_LAYER)).toBe(
      'view "By layer" group Layer highlight blue large group Owner desc sort Piece desc sort Name filter Status is Done filter "Due date" isNotEmpty summary Pieces sum lines always thread',
    )
    expect(readView(formatView(BY_LAYER))).toEqual(BY_LAYER)
  })

  it.each([
    ['quotes', 'Say "hi" \\ there'],
    ['commas', 'a, b,c'],
    ['a keyword', 'sort'],
    ['the end of a comment', 'x --> y'],
    ['letters of any language', 'Größe ✓'],
  ])('a name with %s comes back as it was, through the whole comment', (_, name) => {
    const view: TableViewDef = { name, sort: [{ column: name }], filter: [{ column: 'Status', op: 'contains', value: name }] }
    const comment = formatTableComment(style({ stripes: true, super: true, views: [view, { name: 'Second' }] }))!
    expect(comment).not.toMatch(/-->[^]+-->/)
    expect(parseTableComment(comment)).toEqual(style({ stripes: true, super: true, views: [view, { name: 'Second' }] }))
    expect(formatTableComment(parseTableComment(comment)!)).toBe(comment)
  })

  it('super and the views go after the known parts', () => {
    expect(formatTableComment(style({ super: true, views: [{ name: 'All' }], nonow: true, freeze: { rows: 1, cols: 0 } }))).toBe('<!-- table: freeze 1 row, nonow, super, view All -->')
  })

  it('a plain table writes nothing new', () => {
    expect(formatTableComment(plainTable())).toBeNull()
    expect(formatTableComment(style({ stripes: true }))).toBe('<!-- table: stripes -->')
  })

  it('a view part it cannot read stays as its text, beside the views it writes; a second view of the same name too', () => {
    const comment = '<!-- table: super, view A, view B group, view A sort x -->'
    const read = parseTableComment(comment)!
    expect(read.views).toEqual([{ name: 'A' }])
    expect(formatTableComment(read)).toBe(comment)
  })

  it('an older build keeps the parts it does not know: as text, in their place', () => {
    // What an older build holds: the parts, split at every comma, each kept after the known part before it.
    const older = (comment: string): string => {
      const body = /<!-- table: (.*) -->/.exec(comment)![1]!
      return `<!-- table: ${body.split(/\s*,\s*/).join(', ')} -->`
    }
    const comment = formatTableComment(style({ stripes: true, super: true, views: [BY_LAYER] }))!
    expect(older(comment)).toBe(comment)
  })
})

describe('YAZ-4872 S1 / item 16: column keys', () => {
  it('a header is its key; an empty or a repeated one is "Column n"', () => {
    expect(columnKeys(['Layer', '', 'layer', '  Due   date ', 'Column 2'])).toEqual(['Layer', 'Column 2', 'Column 3', 'Due date', 'Column 5'])
  })

  it('item 15: a renamed header renames the column in every view; another width renames nothing', () => {
    expect(renameColumns([BY_LAYER], ['Layer', 'Piece'], ['Tier', 'Piece'])![0]!.group![0]!.column).toBe('Tier')
    expect(renameColumns([BY_LAYER], ['Layer'], ['Tier', 'Piece'])).toBeNull()
    expect(renameColumns([BY_LAYER], ['Unused'], ['Other'])).toBeNull()
  })
})
