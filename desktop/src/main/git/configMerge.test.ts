import { describe, expect, it } from 'vitest'
import { keepUnknownKeys, mergeConfigFile } from '@shared/configMerge'
import { mergesByKey } from './resolve'

/** YAZ-5483: the key-by-key merge of a vault settings file, and the rule that picks the files. Pure. */
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`
const merge = (base: unknown, theirs: unknown, mine: unknown) => {
  const res = mergeConfigFile(base === null ? null : json(base), json(theirs), json(mine))
  return { value: JSON.parse(res.text) as unknown, clashes: res.clashes, dropped: res.dropped }
}

describe('mergeConfigFile', () => {
  it('a key only one side changed takes that side; both sides changing different keys keeps both', () => {
    expect(merge({ a: 1, b: 1 }, { a: 2, b: 1 }, { a: 1, b: 3 })).toEqual({ value: { a: 2, b: 3 }, clashes: [], dropped: null })
  })

  it("a key both sides changed to different values takes the remote's, and is named", () => {
    expect(merge({ a: 1, b: 1 }, { a: 2, b: 1 }, { a: 3, b: 4 })).toEqual({ value: { a: 2, b: 4 }, clashes: ['a'], dropped: null })
  })

  it('the same change on both sides is no clash', () => {
    expect(merge({ a: 1 }, { a: 2 }, { a: 2 }).clashes).toEqual([])
  })

  it('a delete is a change: deleted on one side, untouched on the other, it stays deleted', () => {
    expect(merge({ a: 1, b: 1 }, { b: 1 }, { a: 1, b: 2 }).value).toEqual({ b: 2 })
    expect(merge({ a: 1, b: 1 }, { a: 1, b: 2 }, { b: 1 }).value).toEqual({ b: 2 })
  })

  it("deleted on one side, changed on the other: the remote's side wins (a delete there too)", () => {
    expect(merge({ a: 1 }, {}, { a: 2 })).toEqual({ value: {}, clashes: ['a'], dropped: null })
    expect(merge({ a: 1 }, { a: 2 }, {})).toEqual({ value: { a: 2 }, clashes: ['a'], dropped: null })
  })

  it('two objects under one key merge inside, by the same rule', () => {
    const res = merge({ h1: { size: 20 } }, { h1: { size: 20, bold: true } }, { h1: { size: 24 } })
    expect(res.value).toEqual({ h1: { size: 24, bold: true } })
    expect(res.clashes).toEqual([])
    expect(merge({ h1: { size: 20 } }, { h1: { size: 22 } }, { h1: { size: 24 } }).clashes).toEqual(['h1.size'])
  })

  it('an array is one value: never spliced', () => {
    expect(merge({ places: ['a', null, null] }, { places: ['a', 'b', null] }, { places: ['c', null, null] })).toEqual({ value: { places: ['a', 'b', null] }, clashes: ['places'], dropped: null })
  })

  it('no base (both Macs made the file): keys of one side kept, a clash to the remote', () => {
    expect(merge(null, { a: 1, b: 2 }, { a: 3, c: 4 })).toEqual({ value: { a: 1, b: 2, c: 4 }, clashes: ['a'], dropped: null })
  })

  it('a malformed side is dropped and the valid side kept whole; neither valid keeps the remote text', () => {
    expect(mergeConfigFile(json({ a: 1 }), '{"a": 2', json({ a: 3, b: 1 }))).toEqual({ text: json({ a: 3, b: 1 }), clashes: [], dropped: 'theirs' })
    expect(mergeConfigFile(json({ a: 1 }), json({ a: 2 }), 'not json')).toEqual({ text: json({ a: 2 }), clashes: [], dropped: 'mine' })
    expect(mergeConfigFile(json({ a: 1 }), json({ a: 2 }), '[1, 2]').dropped).toBe('mine')
    expect(mergeConfigFile(null, '{x', '{y')).toEqual({ text: '{x', clashes: [], dropped: 'both' })
  })

  it('YAZ-5491 daily-pages.json: one Mac moves the folder, the other changes the style: both kept', () => {
    const base = { version: 1, enabled: true, folder: 'Daily', format: 'YYYY-MM-DD', dayFolder: false }
    expect(merge(base, { ...base, folder: 'Journal' }, { ...base, format: 'MM_DD' })).toEqual({ value: { ...base, folder: 'Journal', format: 'MM_DD' }, clashes: [], dropped: null })
  })

  it('YAZ-5486 new-places.json: one Mac edits a shortcut, the other where new pages go: both kept', () => {
    const base = { version: 1, places: [null, null, null], newPage: { location: 'folder', folder: 'Inbox' } }
    expect(merge(base, { ...base, places: ['Notes', null, null] }, { ...base, newPage: { location: 'root' } }).value).toEqual({ version: 1, places: ['Notes', null, null], newPage: { location: 'root' } })
  })

  it('a malformed base merges as if the file were new', () => {
    expect(mergeConfigFile('{oops', json({ a: 1 }), json({ b: 2 })).text).toBe(json({ a: 1, b: 2 }))
  })
})

describe('YAZ-5484: card-look.json merges key by key', () => {
  it('two Macs change different settings of the look: both stay; a clash takes the remote\'s', () => {
    const base = json({ version: 1, hiddenWords: 'box', custom: { line: 2 } })
    const theirs = json({ version: 1, hiddenWords: 'underline', custom: { line: 2, gap: 4 } })
    const mine = json({ version: 1, hiddenWords: 'box', textSize: 18, custom: { line: 1.15 } })
    expect(JSON.parse(mergeConfigFile(base, theirs, mine).text)).toEqual({ version: 1, hiddenWords: 'underline', textSize: 18, custom: { line: 1.15, gap: 4 } })
  })
})

describe('YAZ-5487: table-look.json merges key by key', () => {
  it('two Macs change different table settings: both stay, a header row part by part; a clash takes the remote\'s', () => {
    const base = json({ version: 1, look: { rowBand: 'all', headerRow: { color: 'blue' } } })
    const theirs = json({ version: 1, look: { rowBand: 'off', headerRow: { color: 'blue', weight: 'regular' } }, newTables: { dayStart: 360 } })
    const mine = json({ version: 1, look: { rowBand: 'calendar', headerRow: { color: 'red' }, dimPast: 'text' } })
    expect(JSON.parse(mergeConfigFile(base, theirs, mine).text)).toEqual({ version: 1, look: { rowBand: 'off', headerRow: { color: 'red', weight: 'regular' }, dimPast: 'text' }, newTables: { dayStart: 360 } })
    expect(mergesByKey('.yaseendocs/table-look.json')).toBe(true)
  })
})

describe('mergesByKey: the files AutoSync merges key by key, by rule', () => {
  it.each(['text-formatting.json', 'link-pills.json', 'link-click.json', 'show-ids.json', 'review.json', 'new-places.json', 'daily-pages.json', 'unit-word.json', 'read-only.json', 'github.json', 'card-look.json', 'some-file-of-a-later-build.json'])('%s: yes', (name) => {
    expect(mergesByKey(`.yaseendocs/${name}`)).toBe(true)
  })

  it.each([
    // their own merge
    'favorites.json',
    'favorites-workspace.json',
    'icons.json',
    'shares.json',
    'people.json',
    'friends.json',
    // not settings
    'ids.json',
    'ids-backfill.json',
    'properties.json',
  ])('%s: no', (name) => {
    expect(mergesByKey(`.yaseendocs/${name}`)).toBe(false)
  })

  it('only straight in the vault root dotfolder, and only .json', () => {
    expect(mergesByKey('.yaseendocs/ids/0123456789ab.json')).toBe(false)
    expect(mergesByKey('sub/.yaseendocs/review.json')).toBe(false)
    expect(mergesByKey('.yaseendocs/notes.txt')).toBe(false)
    expect(mergesByKey('review.json')).toBe(false)
  })
})

describe('keepUnknownKeys', () => {
  it('keeps a key of the file the writer does not know; a known key absent from the value is dropped (the default)', () => {
    expect(keepUnknownKeys({ version: 1, h1: { size: 30 }, spacing: { line: 1.6 } }, { version: 1, h2: { bold: true } }, ['version', 'h1', 'h2'])).toEqual({
      version: 1,
      h2: { bold: true },
      spacing: { line: 1.6 },
    })
  })

  it("the writer's value wins over the file's for a key it writes", () => {
    expect(keepUnknownKeys({ a: 1, z: 9 }, { a: 2 }, ['a'])).toEqual({ a: 2, z: 9 })
  })

  it('an absent or malformed file carries nothing', () => {
    expect(keepUnknownKeys(null, { a: 1 }, ['a'])).toEqual({ a: 1 })
    expect(keepUnknownKeys([1], { a: 1 }, ['a'])).toEqual({ a: 1 })
  })
})
