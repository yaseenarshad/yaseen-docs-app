import { describe, expect, it } from 'vitest'
import { DateValue, DurationValue, ErrorValue, FileValue, LinkValue, RegexValue, fromYaml, isTruthy, linkText, render } from './index'

const rec = {
  path: 'Notes/Foo.md', name: 'Foo.md', basename: 'Foo', title: 'Foo', folder: 'Notes', ext: 'md', size: 10,
  ctime: 0, mtime: 0, properties: {}, aliases: [], tags: [], links: [], embeds: [],
}

describe('fromYaml', () => {
  it('detects wiki links', () => {
    expect(fromYaml('[[Foo]]')).toEqual(new LinkValue('Foo'))
    expect(fromYaml('[[Foo|Display]]')).toEqual(new LinkValue('Foo', 'Display'))
    // YAZ-4935: the page on either side of the `|`. Words first keeps the text whole (YAZ-4954): only the notes can
    // tell whether "staging" is a page, so the resolver picks; written back, the link is its text as written.
    expect(fromYaml('[[staging|WIKI-116]]')).toEqual(new LinkValue('staging|WIKI-116'))
    expect(fromYaml('[[staging|WIKI-116#Intro]]')).toEqual(new LinkValue('staging|WIKI-116#Intro'))
    expect(render(fromYaml('[[staging|WIKI-116]]'))).toBe('[[staging|WIKI-116]]')
    expect(fromYaml('[[|WIKI-116]]')).toBe('[[|WIKI-116]]')
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

  it('an impossible day stays text (YAZ-4644 E3): 2026-02-30 is not March 2, with a time or a zone too', () => {
    expect(fromYaml('2026-02-30')).toBe('2026-02-30')
    expect(fromYaml('2026-02-30 09:00')).toBe('2026-02-30 09:00')
    expect(fromYaml('2026-04-31T10:00Z')).toBe('2026-04-31T10:00Z')
    expect(fromYaml('2026-02-29')).toBe('2026-02-29') // not a leap year
    expect((fromYaml('2028-02-29') as DateValue).ms).toBe(new Date(2028, 1, 29).getTime())
    expect((fromYaml('2026-12-31T23:30-08:00') as DateValue).ms).toBe(Date.UTC(2027, 0, 1, 7, 30)) // a zone may move the day: still a real day
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

  it('E: linkText reads the title its note\'s record holds, not its file name (YAZ-2420 D14)', () => {
    const titled = new FileValue({ ...rec, name: 'up-001-abdul-k3m9x2pq7abc.md', basename: 'up-001-abdul-k3m9x2pq7abc', title: 'UP-001 - Abdul' })
    expect(linkText(new LinkValue('k3m9x2pq7abc#Scope'), () => titled)).toBe('UP-001 - Abdul#Scope')
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

/**
 * YAZ-4954: `fromYaml` knows no notes, so a link whose right side only LOOKS like an ID keeps both sides; the resolver
 * picks where the notes are known (the left side when it is a page, YAZ-4935). The stored text stays as written.
 */
describe('fromYaml: words that only look like an ID (YAZ-4954)', () => {
  const file = (title: string) => new FileValue({ ...rec, path: `/vault/${title}.md`, name: `${title}.md`, basename: title, title })
  const over = (...titles: string[]) => (t: string) => {
    const page = t.split('|')[0]
    return titles.includes(page) ? file(page) : null
  }

  it('keeps both sides as written; the other order and two plain words split as before', () => {
    expect(fromYaml('[[Covid notes|COVID-19]]')).toEqual(new LinkValue('Covid notes|COVID-19'))
    expect(fromYaml('[[Covid notes#Intro|COVID-19]]')).toEqual(new LinkValue('Covid notes#Intro|COVID-19'))
    expect(fromYaml('[[COVID-19|Covid notes]]')).toEqual(new LinkValue('COVID-19', 'Covid notes'))
    expect(fromYaml('[[Postgres|database]]')).toEqual(new LinkValue('Postgres', 'database'))
  })

  it('the stored form is the text as written; a reader with the notes shows the words of the side it picks', () => {
    const v = fromYaml('[[Covid notes|COVID-19]]') as LinkValue
    expect(render(v)).toBe('[[Covid notes|COVID-19]]')
    expect(linkText(v)).toBe('Covid notes|COVID-19')
    // The left side is a page: it is the page, and the words are COVID-19.
    expect(linkText(v, over('Covid notes', 'COVID-19'))).toBe('COVID-19')
    // Only the ID side is a page: it is the page, and the words are "Covid notes".
    expect(linkText(v, (t) => (t === 'COVID-19' ? file('COVID-19') : null))).toBe('Covid notes')
    expect(render(v, over('Covid notes'))).toBe('[[Covid notes|COVID-19]]')
  })
})
