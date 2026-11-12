/**
 * The vault's link pills look on a pill (YAZ-4924, `linkPillLook.ts`): the CSS variables each choice sets, with none
 * for today's look; the pieces a pill gains at its ends; and the index as `PathInfos`, built once per snapshot.
 */
import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import { NO_LINK_PILLS } from '@shared/linkPills'
import { headSpan, linkPillVars, pathInfo, pillParts, tailSpan } from './linkPillLook'

const rec = (path: string, folder: string, id?: string): IndexRecord =>
  ({ path, name: path.slice(path.lastIndexOf('/') + 1), basename: 'x', title: 'x', folder, ext: 'md', size: 0, ctime: 0, mtime: 0, properties: {}, aliases: [], tags: [], links: [], embeds: [], ...(id !== undefined && { id }) }) as IndexRecord

describe('linkPillVars (YAZ-4924)', () => {
  it("today's look sets no variable", () => {
    expect(linkPillVars(NO_LINK_PILLS)).toEqual({})
  })

  it('each choice is one or two variables; the CSS falls back to today for the rest', () => {
    expect(linkPillVars({ background: 'none' })).toEqual({ '--pill-bg': 'transparent', '--pill-pad': '0' })
    expect(linkPillVars({ background: 'blue' })).toEqual({ '--pill-bg': 'color-mix(in srgb, var(--table-fill-solid-blue) 30%, transparent)' })
    expect(linkPillVars({ background: 'red', strength: 'light' })['--pill-bg']).toContain(' 15%,')
    expect(linkPillVars({ background: 'red', strength: 'strong' })['--pill-bg']).toContain(' 50%,')
    expect(linkPillVars({ text: 'same' })).toEqual({ '--pill-fg': 'currentColor' })
    expect(linkPillVars({ text: 'green' })).toEqual({ '--pill-fg': 'var(--table-text-green)' })
    expect(linkPillVars({ icon: 'hide' })).toEqual({ '--pill-icon-display': 'none' })
    expect(linkPillVars({ bold: true, italic: true, underline: true })).toEqual({ '--pill-weight': 'bold', '--pill-style': 'italic', '--pill-decoration': 'underline' })
    expect(linkPillVars({ shape: 'square' })).toEqual({ '--pill-radius': '0' })
    expect(linkPillVars({ shape: 'underline' })).toEqual({ '--pill-bg': 'transparent', '--pill-pad': '0', '--pill-radius': '0', '--pill-decoration': 'underline' })
  })

  it('the text pieces set no variable: they are widgets', () => {
    expect(linkPillVars({ before: '(', after: ')', vault: 'always', id: 'show', folder: 'full' })).toEqual({})
  })
})

describe('pillParts (YAZ-4924)', () => {
  const info = { id: 'YAS-12', folder: 'Projects/Plans' }

  it("today's look: nothing, but the other vault's name at the tail (YAZ-3609 D22)", () => {
    expect(pillParts(NO_LINK_PILLS, { info, otherVault: null }, 'Mine')).toEqual({ head: null, tail: null })
    expect(pillParts(NO_LINK_PILLS, { info, otherVault: 'Wiki' }, 'Mine')).toEqual({ head: null, tail: { vault: 'Wiki' } })
  })

  it('before and after are the head and the tail; the vault name goes where asked, Always names the own vault too, Never none', () => {
    expect(pillParts({ before: '(', after: ')' }, { otherVault: null }, 'Mine')).toEqual({ head: { before: '(' }, tail: { after: ')' } })
    expect(pillParts({ vault: 'always' }, { otherVault: null }, 'Mine')).toEqual({ head: null, tail: { vault: 'Mine' } })
    expect(pillParts({ vault: 'always' }, { otherVault: 'Wiki' }, 'Mine')).toEqual({ head: null, tail: { vault: 'Wiki' } })
    expect(pillParts({ vault: 'always', vaultPlace: 'before', before: '→ ' }, { otherVault: null }, 'Mine')).toEqual({ head: { before: '→ ', vault: 'Mine' }, tail: null })
    expect(pillParts({ vault: 'never' }, { otherVault: 'Wiki' }, 'Mine')).toEqual({ head: null, tail: null })
    // Always with no name known yet: none.
    expect(pillParts({ vault: 'always' }, { otherVault: null }, null)).toEqual({ head: null, tail: null })
  })

  it('the ID and the folder come from the index; a page at the root shows no folder; the order is ID, folder, vault, after', () => {
    expect(pillParts({ id: 'show', folder: 'parent', vault: 'always', after: ' ↗' }, { info, otherVault: null }, 'Mine')).toEqual({ head: null, tail: { id: 'YAS-12', folder: 'Plans', vault: 'Mine', after: ' ↗' } })
    expect(pillParts({ folder: 'full' }, { info, otherVault: null }, null)).toEqual({ head: null, tail: { folder: 'Projects › Plans' } })
    expect(pillParts({ id: 'show', folder: 'full' }, { info: { folder: '' }, otherVault: null }, null)).toEqual({ head: null, tail: null })
    expect(pillParts({ id: 'show', folder: 'full' }, { otherVault: null }, null)).toEqual({ head: null, tail: null })
  })

  it('the spans draw the pieces in order, the quiet ones in their own classes, spellcheck off', () => {
    const head = headSpan('wikilink', { before: '(', vault: 'Wiki' })
    expect([head.className, head.spellcheck, head.textContent, head.querySelector('.link-pill__vault')?.textContent]).toEqual(['wikilink link-pill__head', false, '(Wiki › ', 'Wiki › '])
    const tail = tailSpan('wikilink link-pill', { id: 'YAS-12', folder: 'Plans', vault: 'Wiki', after: ')' })
    expect(tail.className).toBe('wikilink link-pill link-pill__tail')
    expect([...tail.childNodes].map((n) => (n instanceof HTMLElement ? `${n.className}:${n.textContent}` : n.textContent))).toEqual(['link-pill__id:YAS-12', 'link-pill__folder:Plans', 'link-pill__vault: (Wiki)', ')'])
  })
})

describe('pathInfo (YAZ-4924)', () => {
  it('a note by its path, a folder by its directory, built once per snapshot', () => {
    const records = [rec('/v/Projects/Plans/a.md', 'Projects/Plans', 'YAS-1'), rec('/v/b.md', '')]
    const folders = [rec('/v/Projects/Plans/.folder.md', 'Projects/Plans'), rec('/v/Top/.folder.md', 'Top')]
    const infos = pathInfo(records, folders)
    expect(infos.get('/v/Projects/Plans/a.md')).toEqual({ id: 'YAS-1', folder: 'Projects/Plans' })
    expect(infos.get('/v/b.md')).toEqual({ folder: '' })
    expect(infos.get('/v/Projects/Plans')).toEqual({ folder: 'Projects' })
    expect(infos.get('/v/Top')).toEqual({ folder: '' })
    expect(pathInfo(records, folders)).toBe(infos)
    expect(pathInfo([...records], folders)).not.toBe(infos)
  })
})
