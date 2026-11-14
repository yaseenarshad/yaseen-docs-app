import { describe, expect, it } from 'vitest'
import {
  cardPropertiesOf,
  cardRecords,
  formatCardLine,
  isCardPropertyName,
  parseCardLine,
  withCardOff,
  withCardProperty,
  withCardTitle,
  withoutCardProperty,
  renameCardProperty,
  EMPTY_CARD_LINE,
} from '@shared/cardLine'

/** YAZ-5379 (YAZ-5349 option A): a card's own properties are parts of its card line, `name "v" "v"`. */

const line = (text: string) => parseCardLine(text)!
const round = (text: string) => formatCardLine(line(text))

describe('property parts on the card line (YAZ-5379)', () => {
  it('reads the mockup line: tags as a list, level and source as text; the line writes back byte for byte', () => {
    const text = '<!-- card: GEO-197, title "Capital of Spain", tags "europe" "capitals", level "A2", source "Atlas, chapter 3", 2026-11-11T09:12Z good -->'
    expect(cardPropertiesOf(line(text))).toEqual({ tags: ['europe', 'capitals'], level: 'A2', source: 'Atlas, chapter 3' })
    expect(round(text)).toBe(text)
  })

  it('each type: text, number, checkbox, list, date, and an empty value', () => {
    let l = withCardTitle(EMPTY_CARD_LINE, 'T')
    l = withCardProperty(l, 'text', 'say "hi" --> \\ ok')
    l = withCardProperty(l, 'count', 3)
    l = withCardProperty(l, 'ratio', -2.5)
    l = withCardProperty(l, 'done', true)
    l = withCardProperty(l, 'later', false)
    l = withCardProperty(l, 'tags', ['a', 'b c'])
    l = withCardProperty(l, 'when', '2026-11-14')
    l = withCardProperty(l, 'empty', null)
    const written = formatCardLine(l)!
    expect(written).toBe('<!-- card: title "T", text "say \\"hi\\" --\\> \\\\ ok", count 3, ratio -2.5, done true, later false, tags "a" "b c", when "2026-11-14", empty "" -->')
    expect(cardPropertiesOf(line(written))).toEqual({ text: 'say "hi" --> \\ ok', count: 3, ratio: -2.5, done: true, later: false, tags: ['a', 'b c'], when: '2026-11-14', empty: '' })
  })

  it('a quoted number stays text; one value is that value (as YAML `tags: europe` does); a list of one or none is in brackets', () => {
    expect(cardPropertiesOf(line('<!-- card: code "007", tags "europe" -->'))).toEqual({ code: '007', tags: 'europe' })
    const l = withCardProperty(withCardProperty(withCardProperty(EMPTY_CARD_LINE, 'tags', ['europe']), 'none', []), 'two', ['a', 'b'])
    const written = formatCardLine(l)!
    expect(written).toBe('<!-- card: tags ["europe"], none [], two "a" "b" -->')
    expect(cardPropertiesOf(line(written))).toEqual({ tags: ['europe'], none: [], two: ['a', 'b'] })
    expect(cardPropertiesOf(line('<!-- card: tags [ "a" "b" ] -->'))).toEqual({ tags: ['a', 'b'] })
    expect(line('<!-- card: tags ["a" -->').parts.map((p) => p.kind)).toEqual(['other'])
  })

  it('a name with a space, or one that does not start with a letter, is quoted', () => {
    const l = withCardProperty(withCardProperty(EMPTY_CARD_LINE, 'Due Date', '2026-11-20'), '2024 goal', 'yes')
    const written = formatCardLine(l)!
    expect(written).toBe('<!-- card: "Due Date" "2026-11-20", "2024 goal" "yes" -->')
    expect(cardPropertiesOf(line(written))).toEqual({ 'Due Date': '2026-11-20', '2024 goal': 'yes' })
  })

  it('a value with a line break keeps it', () => {
    const l = withCardProperty(EMPTY_CARD_LINE, 'note', 'one\ntwo')
    const written = formatCardLine(l)!
    expect(written).not.toContain('\n')
    expect(cardPropertiesOf(line(written))).toEqual({ note: 'one\ntwo' })
  })

  it('the card line words are never a property: reviews, off, next, notitle, the ID and an unknown part keep their kind', () => {
    const text = '<!-- card: GEO-1, off, next, notitle, 2026-11-12T14:05Z good 13s, someday 2027-01, odd -->'
    const l = line(text)
    expect(cardPropertiesOf(l)).toEqual({})
    expect(l.parts.map((p) => p.kind)).toEqual(['id', 'off', 'next', 'notitle', 'review', 'other', 'other'])
    expect(formatCardLine(l)).toBe(text)
  })

  it('refuses a card line word as a name, in any capitals', () => {
    for (const name of ['title', 'Off', 'NEXT', 'notitle', ' tags', '', 'a\nb']) expect(isCardPropertyName(name)).toBe(false)
    for (const name of ['tags', 'Due Date', 'level']) expect(isCardPropertyName(name)).toBe(true)
    expect(() => withCardProperty(EMPTY_CARD_LINE, 'title', 'x')).toThrow()
  })

  it('a property goes after the ID and title and after the other properties; `off` goes after them all', () => {
    let l = line('<!-- card: GEO-1, title "T", 2026-11-12T14:05Z good -->')
    l = withCardProperty(l, 'tags', ['x'])
    l = withCardProperty(l, 'level', 'A2')
    l = withCardOff(l, true)
    expect(formatCardLine(l)).toBe('<!-- card: GEO-1, title "T", tags ["x"], level "A2", off, 2026-11-12T14:05Z good -->')
  })

  it('an edit changes the value in place, under the new spelling; other spellings of the key go; remove drops it', () => {
    let l = line('<!-- card: GEO-1, Tags "a", level "A1", tags "b" -->')
    expect(cardPropertiesOf(l)).toEqual({ Tags: 'a', level: 'A1' })
    l = withCardProperty(l, 'tags', ['c', 'd'])
    expect(formatCardLine(l)).toBe('<!-- card: GEO-1, tags "c" "d", level "A1" -->')
    l = withoutCardProperty(l, 'TAGS')
    expect(formatCardLine(l)).toBe('<!-- card: GEO-1, level "A1" -->')
    expect(withCardProperty(l, 'level', 'A1')).toBe(l)
  })

  it('a rename keeps the value and the place; it refuses a card line word', () => {
    const l = line('<!-- card: GEO-1, tags "a" "b", level "A1", 2026-11-12T14:05Z good -->')
    expect(formatCardLine(renameCardProperty(l, 'TAGS', 'topics'))).toBe('<!-- card: GEO-1, topics "a" "b", level "A1", 2026-11-12T14:05Z good -->')
    expect(formatCardLine(renameCardProperty(l, 'tags', 'Level'))).toBe('<!-- card: GEO-1, Level "a" "b", 2026-11-12T14:05Z good -->')
    expect(renameCardProperty(l, 'missing', 'x')).toBe(l)
    expect(() => renameCardProperty(l, 'tags', 'next')).toThrow()
  })

  it('the index keeps a card\'s properties; a card with none has no `properties`', () => {
    const page = '```card\nQ\n---\nA\n```\n<!-- card: GEO-1, tags "x" "y", level 2 -->\n\n```card\nQ2\n```\n<!-- card: GEO-2 -->\n'
    const [a, b] = cardRecords(page)
    expect(a.properties).toEqual({ tags: ['x', 'y'], level: 2 })
    expect(b).not.toHaveProperty('properties')
  })
})
