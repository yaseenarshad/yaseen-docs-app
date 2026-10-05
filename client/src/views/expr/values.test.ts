import { describe, expect, it } from 'vitest'
import { DateValue, DurationValue, ErrorValue, FileValue, LinkValue, RegexValue, fromYaml, isTruthy, linkText, render } from './index'

const rec = {
  path: 'Notes/Foo.md', name: 'Foo.md', basename: 'Foo', folder: 'Notes', ext: 'md', size: 10,
  ctime: 0, mtime: 0, properties: {}, aliases: [], tags: [], links: [], embeds: [],
}

describe('fromYaml', () => {
  it('detects wiki links', () => {
    expect(fromYaml('[[Foo]]')).toEqual(new LinkValue('Foo'))
    expect(fromYaml('[[Foo|Display]]')).toEqual(new LinkValue('Foo', 'Display'))
    expect(fromYaml('[[Foo')).toBe('[[Foo')
    expect(fromYaml('see [[Foo]]')).toBe('see [[Foo]]')
  })

  it('detects ISO-ish dates', () => {
    const d = fromYaml('2026-08-21') as DateValue
    expect(d).toBeInstanceOf(DateValue)
    expect(d.hasTime).toBe(false)
    expect(d.ms).toBe(new Date(2026, 7, 21).getTime())

    const t = fromYaml('2026-08-21 14:30') as DateValue
    expect(t.hasTime).toBe(true)
    expect(t.ms).toBe(new Date(2026, 7, 21, 14, 30).getTime())
    expect((fromYaml('2026-08-21T14:30:15') as DateValue).ms).toBe(new Date(2026, 7, 21, 14, 30, 15).getTime())
    expect((fromYaml('2026-08-21T14:30:15Z') as DateValue).ms).toBe(Date.UTC(2026, 7, 21, 14, 30, 15))
    expect(fromYaml('2026-13-01')).toBe('2026-13-01')
    expect(fromYaml('not a date')).toBe('not a date')
  })

  it('converts JS Dates, recurses into arrays and objects, passes the rest through', () => {
    expect(fromYaml(new Date(1000))).toEqual(new DateValue(1000, true))
    expect(fromYaml(['[[A]]', '2026-01-01', 3])).toEqual([new LinkValue('A'), new DateValue(new Date(2026, 0, 1).getTime(), false), 3])
    expect(fromYaml({ a: '[[A]]', n: null })).toEqual({ a: new LinkValue('A'), n: null })
    expect(fromYaml(undefined)).toBe(null)
    expect(fromYaml(true)).toBe(true)
    expect(fromYaml(42)).toBe(42)
  })
})

describe('render', () => {
  it('formats every value kind', () => {
    expect(render('s')).toBe('s')
    expect(render(1.5)).toBe('1.5')
    expect(render(true)).toBe('true')
    expect(render(null)).toBe('')
    expect(render(new DateValue(new Date(2026, 7, 21).getTime(), false))).toBe('2026-08-21')
    expect(render(new DateValue(new Date(2026, 7, 21, 9, 5).getTime(), true))).toBe('2026-08-21 09:05')
    expect(render(new DateValue(new Date(2026, 7, 21, 9, 5, 7).getTime(), true))).toBe('2026-08-21 09:05:07')
    expect(render(new DurationValue(26 * 3600e3 + 90e3))).toBe('1d 2h 1m 30s')
    expect(render(new DurationValue(0))).toBe('0s')
    expect(render(new DurationValue(-3600e3))).toBe('-1h')
    expect(render(new LinkValue('Foo'))).toBe('[[Foo]]')
    expect(render(new LinkValue('Foo', 'Bar'))).toBe('[[Foo|Bar]]')
    expect(render(new FileValue(rec))).toBe('[[Foo]]')
    expect(render(new RegexValue(/a+/g))).toBe('/a+/g')
    expect(render(new ErrorValue('boom'))).toBe('#ERROR: boom')
    expect(render([1, 'a', null, [2, 3]])).toBe('1, a, , 2, 3')
    expect(render({ a: 1 })).toBe('{"a":1}')
  })

  // YAZ-2293 D8: the file stores the id; with a resolver, what is shown is the note's title.
  describe('with a resolver (YAZ-2293 D8)', () => {
    const resolve = (target: string) => (target === 'k3m9x2pq7abc' ? new FileValue(rec) : null)

    it('an id link reads as the title of the note it names', () => {
      expect(render(new LinkValue('k3m9x2pq7abc'), resolve)).toBe('[[Foo]]')
      expect(render([new LinkValue('k3m9x2pq7abc'), 'a'], resolve)).toBe('[[Foo]], a')
    })

    it('a hand-typed label, an id naming no note and a name link all render as stored', () => {
      expect(render(new LinkValue('k3m9x2pq7abc', 'Label'), resolve)).toBe('[[k3m9x2pq7abc|Label]]')
      expect(render(new LinkValue('7tq2m8vd4xhn'), resolve)).toBe('[[7tq2m8vd4xhn]]')
      expect(render(new LinkValue('Bar'), resolve)).toBe('[[Bar]]')
    })

    it('without one the stored form is untouched — what every write-back and the collapse key read', () => {
      expect(render(new LinkValue('k3m9x2pq7abc'))).toBe('[[k3m9x2pq7abc]]')
      expect(render([new LinkValue('k3m9x2pq7abc'), new LinkValue('k3m9x2pq7abc')])).toBe('[[k3m9x2pq7abc]], [[k3m9x2pq7abc]]')
    })
  })

  it('linkText: the label, else the title of the note its id names, else the target as written', () => {
    const resolve = (target: string) => (target === 'k3m9x2pq7abc' || target === 'Bar' ? new FileValue(rec) : null)
    expect(linkText(new LinkValue('k3m9x2pq7abc', 'Label'), resolve)).toBe('Label')
    expect(linkText(new LinkValue('k3m9x2pq7abc'), resolve)).toBe('Foo')
    expect(linkText(new LinkValue('7tq2m8vd4xhn'), resolve)).toBe('7tq2m8vd4xhn')
    // A NAME link shows what it shows today, even when it resolves to a note spelled otherwise.
    expect(linkText(new LinkValue('Bar'), resolve)).toBe('Bar')
    expect(linkText(new LinkValue('k3m9x2pq7abc'))).toBe('k3m9x2pq7abc')
    // A `#heading` rides on the id as it would on a name: the id part is what gets the title.
    expect(linkText(new LinkValue('k3m9x2pq7abc#Section'), resolve)).toBe('Foo#Section')
    expect(linkText(new LinkValue('7tq2m8vd4xhn#Section'), resolve)).toBe('7tq2m8vd4xhn#Section')
    expect(render(new LinkValue('k3m9x2pq7abc#Section'), resolve)).toBe('[[Foo#Section]]')
  })
})

describe('isTruthy', () => {
  it('matches the documented table', () => {
    for (const v of [null, false, 0, '', [], new ErrorValue('x'), NaN]) expect(isTruthy(v)).toBe(false)
    for (const v of [true, 1, -1, 'a', [0], {}, new DateValue(0, false), new DurationValue(0), new LinkValue('x')]) {
      expect(isTruthy(v)).toBe(true)
    }
  })
})
