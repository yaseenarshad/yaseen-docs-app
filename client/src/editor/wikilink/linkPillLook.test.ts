/**
 * The vault's link pills look on a pill (YAZ-4924, `linkPillLook.ts`): the CSS variables the box and each part set,
 * with none for today's look; the pieces a pill gains under its format, with the empty parts and their text dropped;
 * where the icon draws; the spans; and the index as `PathInfos`, built once per snapshot.
 */
import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import { NO_LINK_PILLS, type LinkPills } from '@shared/linkPills'
import { headSpan, linkPillVars, pathInfo, pillIconPlace, pillParts, pillsNeedInfo, pillsShowVault, tailSpan, type PillEnd } from './linkPillLook'

const rec = (path: string, folder: string, id?: string): IndexRecord =>
  ({ path, name: path.slice(path.lastIndexOf('/') + 1), basename: 'x', title: 'x', folder, ext: 'md', size: 0, ctime: 0, mtime: 0, properties: {}, aliases: [], tags: [], links: [], embeds: [], ...(id !== undefined && { id }) }) as IndexRecord

describe('linkPillVars (YAZ-4924)', () => {
  it("today's look sets no variable", () => {
    expect(linkPillVars(NO_LINK_PILLS)).toEqual({})
  })

  it('the box: the fill, the strength, the shape; the CSS falls back to today for the rest', () => {
    expect(linkPillVars({ box: { fill: 'none' } })).toEqual({ '--pill-bg': 'transparent', '--pill-pad': '0' })
    expect(linkPillVars({ box: { fill: 'blue' } })).toEqual({ '--pill-bg': 'color-mix(in srgb, var(--table-fill-solid-blue) 30%, transparent)' })
    expect(linkPillVars({ box: { fill: 'red', strength: 'light' } })['--pill-bg']).toContain(' 15%,')
    expect(linkPillVars({ box: { fill: 'red', strength: 'strong' } })['--pill-bg']).toContain(' 50%,')
    expect(linkPillVars({ box: { shape: 'square' } })).toEqual({ '--pill-radius': '0' })
    expect(linkPillVars({ box: { shape: 'underline' } })).toEqual({ '--pill-bg': 'transparent', '--pill-pad': '0', '--pill-radius': '0', '--pill-decoration': 'underline' })
  })

  it("each part's style is its own variables: weight, style, decoration, colour, size", () => {
    expect(linkPillVars({ parts: { name: { bold: true, italic: true, underline: true } } })).toEqual({ '--pill-name-weight': 'bold', '--pill-name-style': 'italic', '--pill-name-decoration': 'underline' })
    expect(linkPillVars({ parts: { name: { color: 'same' }, id: { color: 'accent', size: 'normal' }, text: { color: 'green', size: 'normal' }, vault: { color: 'muted' }, folder: { size: 'small' }, path: { bold: true } } })).toEqual({
      '--pill-name-fg': 'currentColor',
      '--pill-id-fg': 'var(--accent)',
      '--pill-id-size': '1em',
      '--pill-text-fg': 'var(--table-text-green)',
      '--pill-text-size': '1em',
      '--pill-vault-fg': 'var(--fg-muted)',
      '--pill-folder-size': '0.85em',
      '--pill-path-weight': 'bold',
    })
  })

  it('the format and the vault rule set no variable: they are pieces', () => {
    expect(linkPillVars({ format: '({name} {id})', vault: 'always' })).toEqual({})
  })
})

/** The pieces of an end as `part:text`, the icon as `icon`. */
const texts = (end: PillEnd | null) => (end === null ? null : end.pieces.map((p) => (p.part === 'icon' ? 'icon' : `${p.part}:${p.text}`)))
const ends = (pills: LinkPills, meta: Parameters<typeof pillParts>[1], own: string | null = 'Mine', icon = true) => {
  const { head, tail } = pillParts(pills, meta, own, icon)
  return [texts(head), texts(tail)]
}
const info = { id: 'YAS-12', folder: 'Projects/Plans' }

describe('pillParts (YAZ-4924)', () => {
  it("today's look: nothing, but the other vault's name in its brackets at the tail (YAZ-3609 D22)", () => {
    expect(ends(NO_LINK_PILLS, { info, otherVault: null })).toEqual([null, null])
    expect(ends(NO_LINK_PILLS, { info, otherVault: 'Wiki' })).toEqual([null, ['text: (', 'vault:Wiki', 'text:)']])
    expect(ends(NO_LINK_PILLS, { otherVault: 'Wiki' }, null, false)).toEqual([null, ['text: (', 'vault:Wiki', 'text:)']])
  })

  it('what stands before {name} is the head, what stands after it the tail, each piece in its part', () => {
    expect(ends({ format: '{vault} › {icon}{name} {id} · {folder} / {path}' }, { info, otherVault: null, }, 'Mine')).toEqual([null, ['text: ', 'id:YAS-12', 'text: · ', 'folder:Plans', 'text: / ', 'path:Projects › Plans']])
    expect(ends({ format: '{vault} › {icon}{name}', vault: 'always' }, { info, otherVault: null })).toEqual([['vault:Mine', 'text: › '], null])
    expect(ends({ format: '[{name}]' }, { otherVault: null })).toEqual([['text:['], ['text:]']])
  })

  it('an empty part takes the text that stands only beside it, up to the edge; between two shown parts the first text stays', () => {
    expect(ends({ format: '{name} ({id})' }, { info: { folder: '' }, otherVault: null })).toEqual([null, null])
    expect(ends({ format: '{name} ({id})' }, { otherVault: null })).toEqual([null, null])
    expect(ends({ format: '{name} ({id})' }, { info, otherVault: null })).toEqual([null, ['text: (', 'id:YAS-12', 'text:)']])
    expect(ends({ format: '{vault} › {name}' }, { info, otherVault: null })).toEqual([null, null])
    expect(ends({ format: '({vault}) {name}' }, { info, otherVault: null })).toEqual([null, null])
    expect(ends({ format: '{name} · {folder} · {id}' }, { info: { id: 'YAS-12', folder: '' }, otherVault: null })).toEqual([null, ['text: · ', 'id:YAS-12']])
    expect(ends({ format: '{name} ({folder}/{id})' }, { info: { id: 'YAS-12', folder: '' }, otherVault: null })).toEqual([null, ['text: (', 'id:YAS-12', 'text:)']])
    expect(ends({ format: '{name} ({folder}/{id})' }, { info: { folder: '' }, otherVault: null })).toEqual([null, null])
    expect(ends({ format: '→ {name} ({id})' }, { otherVault: null })).toEqual([['text:→ '], null])
  })

  it('a bracket pair stays together: a bracket whose partner stays is kept out of a dropped piece; both go only together', () => {
    expect(ends({ format: '[{name} {id}]' }, { otherVault: null })).toEqual([['text:['], ['text:]']])
    expect(ends({ format: '[{name} {id} ]' }, { otherVault: null })).toEqual([['text:['], ['text:]']])
    expect(ends({ format: '[{vault} › {name}]' }, { otherVault: null })).toEqual([['text:['], ['text:]']])
    expect(ends({ format: '[{vault} › {name} {id} {folder}]' }, { otherVault: null })).toEqual([null, null])
    expect(ends({ format: '[{vault} › {name} {id} {folder}]' }, { otherVault: 'Wiki' })).toEqual([['text:[', 'vault:Wiki', 'text: › '], ['text:]']])
    expect(ends({ format: '({name} ({id}))' }, { otherVault: null })).toEqual([['text:('], ['text:)']])
    expect(ends({ format: '«{name}» {id}' }, { otherVault: null })).toEqual([['text:«'], ['text:»']])
  })

  it('between two shown parts, a pair that wrapped the empty part goes, a bracket that wraps the shown part stays, else the separator to the next part stays', () => {
    const folderOnly = { info: { folder: 'Boards' }, otherVault: null }
    expect(ends({ format: '{icon}{name} ({id}) · {folder}' }, folderOnly)).toEqual([null, ['text: · ', 'folder:Boards']])
    expect(ends({ format: '{name} ({id} · {folder})' }, folderOnly)).toEqual([null, ['text: (', 'folder:Boards', 'text:)']])
    expect(ends({ format: '{name} · {id} ({folder})' }, folderOnly)).toEqual([null, ['text: (', 'folder:Boards', 'text:)']])
    expect(ends({ format: '{name} ({id}) ({folder})' }, folderOnly)).toEqual([null, ['text: (', 'folder:Boards', 'text:)']])
    expect(ends({ format: '{name}, {id} and {folder}' }, folderOnly)).toEqual([null, ['text: and ', 'folder:Boards']])
    expect(ends({ format: '{icon}{name} ({id}) · {folder}' }, { info, otherVault: null })).toEqual([null, ['text: (', 'id:YAS-12', 'text:) · ', 'folder:Plans']])
  })

  it('the vault rule: other vaults only (today), Always names this vault too, Never none; Always with no name known yet is none', () => {
    expect(ends({ vault: 'always' }, { otherVault: null })).toEqual([null, ['text: (', 'vault:Mine', 'text:)']])
    expect(ends({ vault: 'always' }, { otherVault: 'Wiki' })).toEqual([null, ['text: (', 'vault:Wiki', 'text:)']])
    expect(ends({ vault: 'never' }, { otherVault: 'Wiki' })).toEqual([null, null])
    expect(ends({ vault: 'always' }, { otherVault: null }, null)).toEqual([null, null])
  })

  it('the icon: on the name when {icon}{name} stand together, a piece elsewhere, none without {icon}; a pill with no icon loses it and one blank beside it', () => {
    expect([pillIconPlace(NO_LINK_PILLS), pillIconPlace({ format: '{icon} {name}' }), pillIconPlace({ format: '{name} {icon}' }), pillIconPlace({ format: '{name}' })]).toEqual(['name', 'piece', 'piece', 'none'])
    expect(ends({ format: '{icon} {name}' }, { otherVault: null })).toEqual([['icon', 'text: '], null])
    expect(ends({ format: '{icon} {name}' }, { otherVault: null }, 'Mine', false)).toEqual([null, null])
    expect(ends({ format: '{name} {icon}' }, { otherVault: null })).toEqual([null, ['text: ', 'icon']])
    expect(ends({ format: '{name} {icon}' }, { otherVault: null }, 'Mine', false)).toEqual([null, null])
    expect(ends({ format: '({icon}{name})' }, { otherVault: null }, 'Mine', false)).toEqual([['text:('], ['text:)']])
    expect(ends({ format: '{icon}{name}' }, { otherVault: null }, 'Mine', false)).toEqual([null, null])
  })

  it('pillsNeedInfo only with {id}, {folder} or {path}; pillsShowVault with {vault}', () => {
    expect([pillsNeedInfo(NO_LINK_PILLS), pillsNeedInfo({ format: '{name} {id}' }), pillsNeedInfo({ format: '{name} {path}' }), pillsNeedInfo({ format: '{vault} {name}' })]).toEqual([false, true, true, false])
    expect([pillsShowVault(NO_LINK_PILLS), pillsShowVault({ format: '{name}' })]).toEqual([true, false])
  })

  it('the same look object parses once: the pieces of two draws are equal, and a new look object with the same format draws the same', () => {
    const pills: LinkPills = { format: '{name} ({id})' }
    expect(ends(pills, { info, otherVault: null })).toEqual(ends({ ...pills }, { info, otherVault: null }))
  })

  it('the spans draw the pieces in order, each in its class, the icon with its attributes, spellcheck off', () => {
    const { head, tail } = pillParts({ format: '({icon} {name} {id} ({vault}))', vault: 'always' }, { info, otherVault: null }, 'Mine')
    const h = headSpan('wikilink', head!, { class: 'file-icon file-icon--file', 'data-kind': 'markdown' })
    expect([h.className, h.spellcheck, h.textContent]).toEqual(['wikilink link-pill__head', false, '( '])
    expect([...h.children].map((c) => `${c.className}:${c.textContent}:${c.getAttribute('data-kind') ?? ''}`)).toEqual(['link-pill__text:(:', 'file-icon file-icon--file link-pill__icon::markdown', 'link-pill__text: :'])
    const t = tailSpan('wikilink link-pill', tail!)
    expect(t.className).toBe('wikilink link-pill link-pill__tail')
    expect([...t.children].map((c) => `${c.className}:${c.textContent}`)).toEqual(['link-pill__text: ', 'link-pill__id:YAS-12', 'link-pill__text: (', 'link-pill__vault:Mine', 'link-pill__text:))'])
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
