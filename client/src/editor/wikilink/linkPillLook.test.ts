/**
 * The vault's link pills look on a pill (YAZ-4924, `linkPillLook.ts`): the CSS variables the box and each part set,
 * with none for today's look; the pieces a pill gains under its format, with the empty parts and their text dropped;
 * where the icon draws; the spans; and the index as `PathInfos`, built once per snapshot.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import { LINK_PILL_MARKS, LINK_PILL_PARTS, NO_LINK_PILLS, type LinkPills } from '@shared/linkPills'
import { LINK_PILL_MARK_MASK, LINK_PILL_MARK_SVG, headSpan, linkPillVars, pathInfo, pillIconPlace, pillParts, pillsNeedInfo, pillsShowVault, tailKey, tailSpan, type PillEnd } from './linkPillLook'

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
const texts = (end: PillEnd | null) => (end === null ? null : end.pieces.map((p) => (p.part === 'icon' ? 'icon' : p.part === 'mark' ? `mark:${p.icon}` : `${p.part}:${p.text}`)))
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

describe('the {number} and {mark} tokens on a pill (YAZ-4924 round 5)', () => {
  it("{number} is the ID's number alone; an ID with no number shows in full; no ID is empty and takes its text with it", () => {
    expect(ends({ format: '{name} #{number}' }, { info, otherVault: null })).toEqual([null, ['text: #', 'number:12']])
    expect(ends({ format: '{name} #{number}' }, { info: { id: 'AB-CD-305', folder: '' }, otherVault: null })).toEqual([null, ['text: #', 'number:305']])
    expect(ends({ format: '{name} #{number}' }, { info: { id: 'a1b2c3d4e5f6', folder: '' }, otherVault: null })).toEqual([null, ['text: #', 'number:a1b2c3d4e5f6']])
    expect(ends({ format: '{name} #{number}' }, { info: { folder: '' }, otherVault: null })).toEqual([null, null])
    expect(ends({ format: '{name} #{number}' }, { otherVault: null })).toEqual([null, null])
    expect(ends({ format: '{name} (#{number}) · {folder}' }, { info: { folder: 'Boards' }, otherVault: null })).toEqual([null, ['text: · ', 'folder:Boards']])
    expect(ends({ format: '{name} {id} #{number}' }, { info, otherVault: null })).toEqual([null, ['text: ', 'id:YAS-12', 'text: #', 'number:12']])
  })

  it('{mark} is always shown, a missing note too, with the icon the mark part names (the arrow up-right by default); it is no part for the empty-part rule: a run reaches across it', () => {
    expect(ends({ format: '{name}{mark}' }, { otherVault: null })).toEqual([null, ['mark:arrow-up-right']])
    expect(ends({ format: '{name}{mark}' }, { otherVault: null }, 'Mine', false)).toEqual([null, ['mark:arrow-up-right']])
    expect(ends({ format: '{mark} {name}', parts: { mark: { icon: 'star' } } }, { otherVault: null })).toEqual([['mark:star', 'text: '], null])
    expect(ends({ format: '{name} #{number} {mark}' }, { otherVault: null })).toEqual([null, ['mark:arrow-up-right']])
    expect(ends({ format: '{name} #{number}{mark}' }, { otherVault: null })).toEqual([null, ['mark:arrow-up-right']])
    expect(ends({ format: '{name} · {folder}{mark} · {id}' }, { info: { id: 'YAS-12', folder: '' }, otherVault: null })).toEqual([null, ['mark:arrow-up-right', 'text: · ', 'id:YAS-12']])
    expect(ends({ format: '{name} #{number}{mark}' }, { info, otherVault: null })).toEqual([null, ['text: #', 'number:12', 'mark:arrow-up-right']])
    expect(ends({ format: '{name} ({id}){mark}' }, { otherVault: null })).toEqual([null, ['mark:arrow-up-right']])
    expect(ends({ format: '{icon}{name}{mark}' }, { otherVault: null })).toEqual([null, ['mark:arrow-up-right']])
  })

  it('the index is read with {number}; not for {mark} alone', () => {
    expect([pillsNeedInfo({ format: '{name} #{number}' }), pillsNeedInfo({ format: '{name}{mark}' })]).toEqual([true, false])
  })

  it("the number and the mark have their own variables; the mark's icon is a piece, no variable", () => {
    expect(linkPillVars({ parts: { number: { bold: true, color: 'accent', size: 'normal' }, mark: { icon: 'star', color: 'red', size: 'small' } } })).toEqual({
      '--pill-number-weight': 'bold',
      '--pill-number-fg': 'var(--accent)',
      '--pill-number-size': '1em',
      '--pill-mark-fg': 'var(--table-text-red)',
      '--pill-mark-size': '0.85em',
    })
    expect(linkPillVars({ parts: { mark: { icon: 'star' } } })).toEqual({})
  })

  it('each of the eight marks draws a small static SVG icon: no text, the line\'s size (em), the pill\'s colour (currentColor), hidden from screen readers; a pill wears it as a mask, not an svg in the line (YAZ-4991)', () => {
    expect(Object.keys(LINK_PILL_MARK_SVG)).toEqual([...LINK_PILL_MARKS])
    expect(new Set(Object.values(LINK_PILL_MARK_SVG)).size).toBe(8)
    for (const icon of LINK_PILL_MARKS) {
      const { tail } = pillParts({ format: '{name}{mark}', parts: { mark: { icon } } }, { otherVault: null }, 'Mine')
      const t = tailSpan('wikilink link-pill', tail!)
      const mark = t.querySelector(':scope > .link-pill__mark') as HTMLElement
      // No element in the line: an svg is an atomic inline box, and a line may break on either side of one (YAZ-4991).
      expect([mark.textContent, mark.dataset.mark, mark.children.length, mark.style.getPropertyValue('--pill-mark-icon')]).toEqual(['', icon, 0, LINK_PILL_MARK_MASK[icon]])
      // The mask is the same svg, standalone (its namespace), as a data URL.
      const url = LINK_PILL_MARK_MASK[icon]
      expect(url.startsWith('url("data:image/svg+xml,') && url.endsWith('")')).toBe(true)
      const parsed = new DOMParser().parseFromString(decodeURIComponent(url.slice(24, -2)), 'image/svg+xml').documentElement
      expect([parsed.namespaceURI, parsed.getAttribute('width'), parsed.getAttribute('height'), parsed.getAttribute('aria-hidden'), parsed.querySelector('path, circle') !== null]).toEqual(['http://www.w3.org/2000/svg', '1em', '1em', 'true', true])
      expect(decodeURIComponent(url.slice(24, -2))).toBe(LINK_PILL_MARK_SVG[icon].replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '))
      expect(LINK_PILL_MARK_SVG[icon]).not.toMatch(/\bpx\b|[0-9]px/)
    }
    // Two icons are two keys: a change of icon redraws the tail; the same icon redraws nothing.
    const key = (icon: (typeof LINK_PILL_MARKS)[number]) => tailKey(pillParts({ format: '{name}{mark}', parts: { mark: { icon } } }, { otherVault: null }, 'Mine').tail!)
    expect(key('star')).not.toBe(key('dot'))
    expect(key('star')).toBe(key('star'))
  })
})

describe("a pill's size follows its line: a pill in a heading is as big as the heading (YAZ-4924 round 5)", () => {
  const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')
  const wikilinkCss = strip(readFileSync(join(__dirname, 'wikilink.css'), 'utf8'))
  const viewsCss = strip(readFileSync(join(__dirname, '../../views/views.css'), 'utf8'))
  /** Each rule of `css` whose selector names a pill: `[selector, body]`. */
  const pillRules = (css: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]] as const).filter(([sel]) => /link-pill|wikilink/.test(sel))

  it('no pill rule sets a fixed font size: each part is the line\'s size (inherit) or a share of it (em)', () => {
    // The file icon's `::before` is app.css's fixed 14px glyph, no text: its own 14px font only places it (YAZ-4991).
    const text = (sel: string) => !sel.split(',').every((s) => /file-icon::before$/.test(s.trim()))
    const sizes = [...pillRules(wikilinkCss), ...pillRules(viewsCss)].filter(([sel]) => text(sel)).flatMap(([sel, body]) => [...body.matchAll(/font-size:\s*([^;]+);/g)].map((m) => `${sel} → ${m[1].trim()}`))
    expect(sizes.length).toBeGreaterThan(0)
    for (const size of sizes) expect(size).not.toMatch(/\d(px|pt|rem)\b/)
  })

  it('each part, the number and the mark too, reads its own size variable with an em or inherit fallback', () => {
    for (const part of LINK_PILL_PARTS) {
      const rule = part === 'name' ? /--pill-name-size, inherit\)/ : new RegExp(`--pill-${part}-size, (0\\.85em|1em|inherit)\\)`)
      expect(wikilinkCss, part).toMatch(rule)
    }
    // Normal is the line's size and Small 85 % of it, never pixels.
    for (const part of LINK_PILL_PARTS) {
      expect(linkPillVars({ parts: { [part]: { size: 'small' } } })[`--pill-${part}-size`]).toBe('0.85em')
      expect(linkPillVars({ parts: { [part]: { size: 'normal' } } })[`--pill-${part}-size`]).toBe('1em')
    }
  })

  it('a pill holds the punctuation next to it (YAZ-4991): no piece of a pill is an atomic inline box', () => {
    // A line may break before and after an atomic inline box (an inline-block, an svg) even next to a period or a
    // bracket: `Example: [[Redis]].` left the period alone on the next line. Measured in Electron: see YAZ-4991.
    const rules = [...pillRules(wikilinkCss), ...pillRules(viewsCss)]
    expect(rules.filter(([, body]) => /display:\s*inline-(block|flex|grid)|display:\s*block/.test(body)).map(([sel]) => sel)).toEqual([])
    const icon = rules.find(([sel]) => sel.split(',').map((s) => s.trim()).includes('.wikilink.file-icon::before'))
    expect(icon?.[0].split(',').map((s) => s.trim())).toEqual(['.wikilink.file-icon::before', '.wikilink .file-icon::before'])
    expect(icon?.[1]).toMatch(/display:\s*inline !important;[^}]*padding-left:\s*14px;/)
    expect(wikilinkCss).toMatch(/\.link-pill__icon\s*\{\s*display:\s*inline;\s*\}/)
    // The mark is its icon as a mask on an inline span, not an svg; no pill rule draws an svg.
    // Named by the head or the tail it stands in: Crepe's reset (`.milkdown *`, one class) must not take its padding.
    expect(wikilinkCss).toMatch(/:is\(\.link-pill__head, \.link-pill__tail\) \.link-pill__mark\s*\{[^}]*padding-left:\s*1em;[^}]*background-color:\s*currentColor;[^}]*mask:\s*var\(--pill-mark-icon\) center \/ 1em 1em no-repeat;/)
    expect(rules.map(([sel]) => sel).filter((sel) => /\bsvg\b/.test(sel))).toEqual([])
    // A piece with no letter of its own (the mark, an icon piece) has a word joiner for one: an empty inline box stays at
    // the end of the line before when the line breaks right after it (measured in Electron, YAZ-4991).
    expect(wikilinkCss).toMatch(/\.link-pill__mark::after,\s*\.link-pill__icon::after\s*\{\s*content:\s*'\\2060';\s*\}/)
  })

  it("the mark's icon is 1em square: the size of its line, in a paragraph or a heading", () => {
    expect(wikilinkCss).toMatch(/\.link-pill__mark\s*\{[^}]*padding-left:\s*1em;[^}]*center \/ 1em 1em/)
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
