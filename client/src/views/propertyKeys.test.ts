/**
 * One key per spelling, capitals ignored (YAZ-4769 demo, option B), the shared helpers alone (`shared/propertyKeys.ts`):
 * keys that differ only by capitals or by spaces at the ends are one key; a file keeps its spelling; a write under one
 * spelling takes the others out of the same file; the app's keys (`keep`) are never folded away.
 * The surfaces built on them are covered in FrontmatterPanel.test.tsx, writeProperty.test.ts, engine.test.ts and
 * columnInheritance.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { findKey, foldedValue, heldKey, keyFold, otherSpellings, respell, sameKey, setOneSpelling, spellings } from '@shared/propertyKeys'

const props = (content: string) => parseFrontmatter(splitFrontmatter(content).frontmatter).properties

describe('YAZ-4769 demo: keyFold / sameKey', () => {
  it('YAZ-4769 demo: capitals and spaces at the ends fold away; spaces inside do not', () => {
    expect(keyFold(' Dessert Column ')).toBe('dessert column')
    expect(sameKey('Dessert Column', 'dessert column')).toBe(true)
    expect(sameKey('DESSERT COLUMN', ' dessert column ')).toBe(true)
    expect(sameKey('Dessert Column', 'DessertColumn')).toBe(false)
    expect(sameKey('Dessert  Column', 'Dessert Column')).toBe(false)
  })
})

describe('YAZ-4769 demo: finding the spelling a set of keys holds', () => {
  it('YAZ-4769 demo: findKey prefers the exact spelling, else the first that folds the same, else undefined', () => {
    expect(findKey(['status', 'Status'], 'Status')).toBe('Status')
    expect(findKey(['STATUS', 'Status'], 'status')).toBe('STATUS')
    expect(findKey(['tags'], 'status')).toBeUndefined()
  })

  it('YAZ-4769 demo: heldKey / foldedValue read a note under whichever spelling it holds', () => {
    const p = { 'dessert column': 'pie', Other: 1 }
    expect(heldKey(p, 'Dessert Column')).toBe('dessert column')
    expect(foldedValue(p, 'DESSERT COLUMN')).toBe('pie')
    expect(foldedValue(p, 'nope')).toBeUndefined()
  })

  it('YAZ-4769 demo: otherSpellings lists the rest, less the kept app keys', () => {
    const p = { Status: 1, status: 2, ' STATUS ': 3, title: 'x', Title: 'y' }
    expect(otherSpellings(p, 'Status').sort()).toEqual([' STATUS ', 'status'])
    expect(otherSpellings(p, 'Title', new Set(['title']))).toEqual([])
  })

  it('YAZ-4769 demo: spellings keeps the first spelling of each key', () => {
    expect([...spellings(['Status', 'status', 'Tags'])]).toEqual([
      ['status', 'Status'],
      ['tags', 'Tags'],
    ])
  })
})

describe('YAZ-4769 demo: respell reads a note in the page column spelling', () => {
  const spell = spellings(['Dessert Column'])

  it("YAZ-4769 demo: a note's `dessert column` reads as `Dessert Column`", () => {
    expect(respell({ 'dessert column': 'pie', other: 1 }, spell)).toEqual({ 'Dessert Column': 'pie', other: 1 })
  })

  it("YAZ-4769 demo: with two spellings, the column's own wins and the other is not shown", () => {
    expect(respell({ 'dessert column': 'cake', 'Dessert Column': 'pie' }, spell)).toEqual({ 'Dessert Column': 'pie' })
  })

  it('YAZ-4769 demo: nothing to move gives back the same object; an app key in `skip` never moves', () => {
    const p = { 'Dessert Column': 'pie' }
    expect(respell(p, spell)).toBe(p)
    expect(respell(p, new Map())).toBe(p)
    const app = { title: 'x' }
    expect(respell(app, spellings(['Title']), new Set(['title']))).toBe(app)
  })
})

describe('YAZ-4769 demo: setOneSpelling writes the key once', () => {
  it('YAZ-4769 demo: a write under another spelling renames the note’s spelling in place, keeping its line', () => {
    const out = setOneSpelling('---\na: 1\ndessert column: cake\nb: 2\n---\nbody\n', 'Dessert Column', 'pie')
    expect(props(out)).toEqual({ a: 1, 'Dessert Column': 'pie', b: 2 })
    expect(out.indexOf('Dessert Column')).toBeLessThan(out.indexOf('b: 2'))
    expect(out.endsWith('body\n')).toBe(true)
  })

  it('YAZ-4769 demo: a note holding two spellings keeps only the written one', () => {
    const out = setOneSpelling('---\nDessert Column: cake\nDESSERT COLUMN: tart\n---\n', 'Dessert Column', 'pie')
    expect(props(out)).toEqual({ 'Dessert Column': 'pie' })
  })

  it('YAZ-4769 demo: a clear (undefined) removes every spelling', () => {
    expect(props(setOneSpelling('---\ndessert column: cake\nDessert Column: pie\nx: 1\n---\n', 'Dessert Column', undefined))).toEqual({ x: 1 })
  })

  it('YAZ-4769 demo: a kept app key is never folded away', () => {
    expect(props(setOneSpelling('---\ntitle: Real\n---\n', 'Title', 'Shown', new Set(['title'])))).toEqual({ title: 'Real', Title: 'Shown' })
  })

  it('YAZ-4769 demo: with no other spelling it is a plain set', () => {
    expect(props(setOneSpelling('---\na: 1\n---\n', 'b', 2))).toEqual({ a: 1, b: 2 })
  })
})
