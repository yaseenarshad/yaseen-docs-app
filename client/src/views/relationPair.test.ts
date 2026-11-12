/**
 * Two-way relations (YAZ-4781 R1, R2): the tied column's declaration, and a tied cell's write turned into the link
 * column's writes in the linking notes — never the row's own note — with the replace ask and an exact Undo.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import type { IndexRecord } from '@shared/types'
import { linkResolver } from '../links/folderLinks'
import { CHANGE_CANCELLED } from './confirmChanges'
import { columnTyping } from './editorType'
import { folderSettings } from './folderSettings'
import { writableKey } from './readOnlyRows'
import { pairPlan, pairedValue, replaceAsk, tiedKeyFor, tiedKeyOf, writeTiedCell, type TiedCellWrite } from './relationPair'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { readFile: vi.fn(), writeFile: vi.fn() },
}))
import { api } from '../api'

/** An in-memory vault behind the api mock: path → file text. */
const disk = new Map<string, string>()
beforeEach(() => {
  disk.clear()
  vi.mocked(api.readFile).mockImplementation(async (path: string) => ({ path, content: disk.get(path) ?? '', mtime: 1, size: 1 }) as never)
  vi.mocked(api.writeFile).mockImplementation(async ({ path, content }) => {
    disk.set(path, content)
    return { path, mtime: 2, size: content.length } as never
  })
})
const fieldOf = (path: string, key: string): unknown => parseFrontmatter(splitFrontmatter(disk.get(path) ?? '').frontmatter).properties[key]

const rec = (path: string, init: Partial<IndexRecord> = {}): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const rel = path.slice('/vault/'.length)
  const basename = name.replace(/\.md$/, '')
  return { path, name, basename, title: basename, folder: rel.slice(0, rel.lastIndexOf('/')), ext: 'md', size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [], ...init }
}
const DIRS = ['/vault/Recipes', '/vault/Recipes/Desserts', '/vault/Other']
const yaml = (props: Record<string, unknown>) => `---\n${Object.entries(props).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n---\nBody.\n`

/** The demo vault, with IDs or without: Chocolate cake pairs with Lemon tart; Apple pie's tied cell is written. */
function vault(ids: boolean, cake: Record<string, unknown> = {}) {
  const apple = rec('/vault/Recipes/Desserts/Apple pie.md', ids ? { id: 'DEMO-1008' } : {})
  const lemon = rec('/vault/Recipes/Desserts/Lemon tart.md', ids ? { id: 'DEMO-1009' } : {})
  const choc = rec('/vault/Recipes/Desserts/Chocolate cake.md', { ...(ids && { id: 'DEMO-1001' }), properties: cake })
  const outside = rec('/vault/Other/Soup.md', ids ? { id: 'DEMO-1020' } : {})
  const locked = rec('/vault/Recipes/Desserts/Flan.md', { ...(ids && { id: 'DEMO-1030' }), properties: { readonly: true } })
  const records = [apple, lemon, choc, outside, locked]
  for (const r of records) disk.set(r.path, yaml({ ...(r.id !== undefined && { id: r.id }), ...r.properties }))
  const resolve = linkResolver(records, '/vault', DIRS, [])
  const write = (over: Partial<TiedCellWrite>): TiedCellWrite => ({
    row: apple,
    rowLink: ids ? '[[DEMO-1008]]' : '[[Apple pie]]',
    column: 'Pairs with',
    owner: '/vault/Recipes',
    ownerName: 'Recipes',
    multi: true,
    before: [],
    next: [],
    resolve,
    recordOf: (page) => records.find((r) => r.path === page),
    ask: async () => true,
    titleOf: (link) => records.find((r) => r.path === resolve(link.slice(2, -2)))?.title ?? link,
    ...over,
  })
  return { apple, lemon, choc, outside, locked, resolve, write }
}

describe('the tied column (YAZ-4781 R1)', () => {
  it('the settings reader keeps `pair` on a Linked mentions column that names its column, and drops it anywhere else', () => {
    const settings = folderSettings(rec('/vault/Recipes/Desserts/.folder.md', {
      properties: { folder_settings: { columns: {
        'Recipes · Pairs with': { kind: 'mentions', from: { column: 'Pairs with', folder: '[[Recipes]]' }, pair: true },
        Owner: { kind: 'link', pair: true },
      } } },
    }), true)
    expect(settings.columns['Recipes · Pairs with']).toEqual({ kind: 'mentions', from: { column: 'Pairs with', folder: '[[Recipes]]' }, pair: true })
    expect(settings.columns.Owner).toEqual({ kind: 'link' })
    expect(settings.problems).toHaveLength(1)
  })

  it('its cells are written and edit as a multi-link picking from the link column\'s folder; a plain Linked mentions column stays read only', () => {
    const columns = { Tied: { kind: 'mentions' as const, from: { column: 'Pairs with', folder: '[[Recipes]]' }, pair: true as const }, Used: { kind: 'mentions' as const } }
    const settings = { ...folderSettings(undefined, true), columns }
    expect(writableKey('note.Tied', columns)).toBe('Tied')
    expect(writableKey('note.Used', columns)).toBeNull()
    expect(columnTyping('note.Tied', [], null, settings)).toEqual({ assigned: 'multi-link', dominant: null, target: '[[Recipes]]' })
    expect(columnTyping('note.Used', [], null, settings)).toBeNull()
  })

  it('is found by its link column and folder; its first key is "<folder> · <column>", numbered when taken', () => {
    const columns = { 'Recipes · Pairs with': { kind: 'mentions' as const, from: { column: 'Pairs with', folder: '[[Recipes]]' }, pair: true as const }, Plain: { kind: 'mentions' as const, from: { column: 'Pairs with' } } }
    expect(tiedKeyOf(columns, 'Pairs with', (folder) => folder === '[[Recipes]]')).toBe('Recipes · Pairs with')
    expect(tiedKeyOf(columns, 'Pairs with', (folder) => folder === '[[Other]]')).toBeUndefined()
    expect(tiedKeyFor('Recipes · Pairs with', columns)).toBe('Recipes · Pairs with 2')
    expect(tiedKeyFor('Recipes · Serves', columns)).toBe('Recipes · Serves')
  })
})

describe('a tied cell write (YAZ-4781 R2)', () => {
  it('the diff: the pages added and taken out; a link that names no page refuses it', () => {
    const { resolve } = vault(true)
    expect(pairPlan(['[[DEMO-1001]]'], ['[[DEMO-1009]]'], resolve)).toEqual({ add: ['/vault/Recipes/Desserts/Lemon tart.md'], remove: ['/vault/Recipes/Desserts/Chocolate cake.md'] })
    expect(pairPlan(['[[DEMO-1001]]'], ['[[DEMO-1001]]'], resolve)).toEqual({ add: [], remove: [] })
    expect(() => pairPlan([], ['[[Nowhere]]'], resolve)).toThrow("Can't find [[Nowhere]]")
  })

  it('the field: a Multi-link appends and filters; a Link sets and clears; nothing changes twice', () => {
    const { resolve } = vault(true)
    const apple = '/vault/Recipes/Desserts/Apple pie.md'
    expect(pairedValue(['[[DEMO-1009]]'], '[[DEMO-1008]]', apple, true, true, resolve)).toEqual(['[[DEMO-1009]]', '[[DEMO-1008]]'])
    expect(pairedValue(['[[DEMO-1008]]'], '[[DEMO-1008]]', apple, true, true, resolve)).toEqual(['[[DEMO-1008]]'])
    expect(pairedValue(['[[DEMO-1009]]', '[[DEMO-1008]]'], '[[DEMO-1008]]', apple, false, true, resolve)).toEqual(['[[DEMO-1009]]'])
    expect(pairedValue(undefined, '[[DEMO-1008]]', apple, true, false, resolve)).toBe('[[DEMO-1008]]')
    expect(pairedValue('[[DEMO-1008]]', '[[DEMO-1008]]', apple, false, false, resolve)).toBeNull()
    expect(pairedValue('[[DEMO-1009]]', '[[DEMO-1008]]', apple, false, false, resolve)).toBe('[[DEMO-1009]]')
  })

  it('adding Chocolate cake in Apple pie\'s cell writes the ID link into Chocolate cake only; Undo puts its field back', async () => {
    const { choc, apple, write } = vault(true, { 'Pairs with': ['[[DEMO-1009]]'] })
    const appleBefore = disk.get(apple.path)
    const done = await writeTiedCell(write({ next: ['[[DEMO-1001]]'] }))
    expect(fieldOf(choc.path, 'Pairs with')).toEqual(['[[DEMO-1009]]', '[[DEMO-1008]]'])
    expect(disk.get(apple.path)).toBe(appleBefore)
    await done.undoPair()
    expect(fieldOf(choc.path, 'Pairs with')).toEqual(['[[DEMO-1009]]'])
  })

  it('a Link that holds another asks first: Cancel writes nothing, Replace sets it, and Undo brings the old link back', async () => {
    const { choc, write } = vault(true, { 'Pairs with': '[[DEMO-1009]]' })
    const asked: string[] = []
    await expect(writeTiedCell(write({ multi: false, next: ['[[DEMO-1001]]'], ask: async (text) => (asked.push(text), false) }))).rejects.toBe(CHANGE_CANCELLED)
    expect(asked).toEqual(['Chocolate cake pairs with Lemon tart. Replace it with Apple pie?'])
    expect(fieldOf(choc.path, 'Pairs with')).toBe('[[DEMO-1009]]')
    const done = await writeTiedCell(write({ multi: false, next: ['[[DEMO-1001]]'] }))
    expect(fieldOf(choc.path, 'Pairs with')).toBe('[[DEMO-1008]]')
    await done.undoPair()
    expect(fieldOf(choc.path, 'Pairs with')).toBe('[[DEMO-1009]]')
    expect(replaceAsk('Chocolate cake', 'Pairs with', 'Lemon tart', 'Apple pie')).toBe(asked[0])
  })

  it('a vault without IDs works the same by path links: remove clears a Link, filters a Multi-link', async () => {
    const { choc, lemon, write } = vault(false, { 'Pairs with': '[[Apple pie]]' })
    disk.set(lemon.path, yaml({ 'Pairs with': ['[[Apple pie]]', '[[Chocolate cake]]'] }))
    await writeTiedCell(write({ multi: false, before: ['[[Chocolate cake]]'], next: [] }))
    expect(fieldOf(choc.path, 'Pairs with')).toBeNull()
    await writeTiedCell(write({ before: ['[[Lemon tart]]'], next: [] }))
    expect(fieldOf(lemon.path, 'Pairs with')).toEqual(['[[Chocolate cake]]'])
    await writeTiedCell(write({ next: ['[[Lemon tart]]'] }))
    expect(fieldOf(lemon.path, 'Pairs with')).toEqual(['[[Chocolate cake]]', '[[Apple pie]]'])
  })

  it('a note outside the link column\'s folder, or a read-only one, refuses the whole write before any note changes', async () => {
    const { choc, write } = vault(true)
    const before = disk.get(choc.path)
    await expect(writeTiedCell(write({ next: ['[[DEMO-1001]]', '[[DEMO-1020]]'] }))).rejects.toThrow('Soup is not in Recipes')
    await expect(writeTiedCell(write({ next: ['[[DEMO-1001]]', '[[DEMO-1030]]'] }))).rejects.toThrow('Flan is read only')
    expect(disk.get(choc.path)).toBe(before)
  })
})

describe('a tied cell with words that only LOOK like an ID (YAZ-4954 part 2)', () => {
  const notes = [rec('/vault/Other/Covid notes.md'), rec('/vault/Other/COVID-19.md')]
  const resolve = linkResolver(notes, '/vault', DIRS, [])

  it('pairPlan reads the page the editor opens: the left side when it is a page, in both orders', () => {
    expect(pairPlan([], ['[[Covid notes|COVID-19]]'], resolve)).toEqual({ add: ['/vault/Other/Covid notes.md'], remove: [] })
    expect(pairPlan([], ['[[COVID-19|Covid notes]]'], resolve)).toEqual({ add: ['/vault/Other/COVID-19.md'], remove: [] })
  })
})
