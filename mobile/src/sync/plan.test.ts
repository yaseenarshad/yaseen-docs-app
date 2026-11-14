import { describe, expect, it } from 'vitest'
import { gitBlobSha } from './gitSha'
import { diffTrees, isEager, isIndexed } from './plan'

describe('what downloads at once (October decision 5, decision 6)', () => {
  it('isEager: pages, card files, .yaseendocs and folder settings; not pictures or sounds', () => {
    expect(isEager('a.md')).toBe(true)
    expect(isEager('cards/speed-of-light-nc-17.md')).toBe(true)
    expect(isEager('.yaseendocs/review.json')).toBe(true)
    expect(isEager('folder/.folder.md')).toBe(true)
    expect(isEager('assets/images/flag.png')).toBe(false)
    expect(isEager('assets/audio/fifth.mp3')).toBe(false)
    expect(isEager('board.excalidraw')).toBe(false)
  })

  it('isIndexed: what the Mac\'s scan indexes: Markdown, no dot-folder or node_modules, but a folder\'s .folder.md', () => {
    expect(isIndexed('a.md')).toBe(true)
    expect(isIndexed('f/g/b.markdown')).toBe(true)
    expect(isIndexed('f/.folder.md')).toBe(true)
    expect(isIndexed('.yaseendocs/x.md')).toBe(false)
    expect(isIndexed('.trash/a.md')).toBe(false)
    expect(isIndexed('node_modules/x/README.md')).toBe(false)
    expect(isIndexed('.hidden.md')).toBe(false)
    expect(isIndexed('a.png')).toBe(false)
  })
})

describe('diffTrees: the file-list compare (no compare call, row R8)', () => {
  const tree = (o: Record<string, string>) => new Map(Object.entries(o))
  it('first download: everything is added', () => {
    expect(diffTrees(null, tree({ 'a.md': '1', 'b.md': '2' }))).toEqual({ added: ['a.md', 'b.md'], changed: [], removed: [], renamed: [] })
  })
  it('added, changed, removed, and a rename (a removed path and an added path with the same SHA, row R6)', () => {
    const d = diffTrees({ 'a.md': '1', 'b.md': '2', 'c.md': '3', 'old.md': '4' }, tree({ 'a.md': '1', 'b.md': '22', 'new/place.md': '4', 'd.md': '5' }))
    expect(d).toEqual({ added: ['d.md'], changed: ['b.md'], removed: ['c.md'], renamed: [{ from: 'old.md', to: 'new/place.md' }] })
  })
  it('two removed files with one SHA pair one to one; the rest stay added or removed', () => {
    const d = diffTrees({ 'x.md': 's', 'y.md': 's' }, tree({ 'z.md': 's' }))
    expect(d.renamed).toEqual([{ from: 'x.md', to: 'z.md' }])
    expect(d.removed).toEqual(['y.md'])
  })
  it('hundreds of changes in one compare', () => {
    const before = Object.fromEntries(Array.from({ length: 800 }, (_, i) => [`p${i}.md`, `a${i}`]))
    const after = new Map(Array.from({ length: 800 }, (_, i) => [`p${i}.md`, i < 500 ? `b${i}` : `a${i}`]))
    expect(diffTrees(before, after).changed).toHaveLength(500)
  })
})

describe('gitBlobSha: the phone checks a stored file against the tree with git\'s own hash', () => {
  it('matches `git hash-object`', async () => {
    expect(await gitBlobSha('')).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')
    expect(await gitBlobSha('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a')
    expect(await gitBlobSha(new TextEncoder().encode('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a')
    expect(await gitBlobSha('é')).toBe(await gitBlobSha(new Uint8Array([0xc3, 0xa9])))
  })
})
