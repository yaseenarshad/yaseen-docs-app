/**
 * `shared/linkPills.ts` (YAZ-4924, version 2): the format parser, what a format may not be, the vault file
 * `.yaseendocs/link-pills.json` as the app uses it, and the table of the first round's fields (version 1) → the
 * version 2 look → the same drawn pill. The module is in `shared/`; its test is here because no vitest project reads
 * `shared/` (the precedent of `textFormatting.test.ts`).
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LINK_PILL_FORMAT,
  DEFAULT_LINK_PILL_MARK,
  LINK_PILLS_VERSION,
  LINK_PILL_MARKS,
  LINK_PILL_READY,
  LINK_PILL_TOKENS,
  fromV1,
  isDefaultLinkPills,
  linkPillFormatProblem,
  linkPillFormatTokens,
  linkPillIconColors,
  linkPillsFile,
  parseLinkPillFormat,
  withLinkPillIconColor,
  sanitizeLinkPills,
  withLinkPillBox,
  withLinkPillPart,
  withLinkPillReady,
  withLinkPills,
  type LinkPills,
} from '@shared/linkPills'
import { pillIconPlace, pillParts, type PillEnd } from '../editor/wikilink/linkPillLook'

describe('parseLinkPillFormat (YAZ-4924)', () => {
  it('each {token} is a token, everything else text, neighbouring text joined; a lone brace is text', () => {
    expect(parseLinkPillFormat('{icon}{name} ({id})')).toEqual({ segments: [{ token: 'icon' }, { token: 'name' }, { text: ' (' }, { token: 'id' }, { text: ')' }], unknown: [] })
    expect(parseLinkPillFormat('→ {name}')).toEqual({ segments: [{ text: '→ ' }, { token: 'name' }], unknown: [] })
    expect(parseLinkPillFormat('{name} { x')).toEqual({ segments: [{ token: 'name' }, { text: ' { x' }], unknown: [] })
    expect(parseLinkPillFormat('')).toEqual({ segments: [], unknown: [] })
  })

  it('an unknown {…} is listed as typed and stays text; the case matters', () => {
    expect(parseLinkPillFormat('{Name} {}{id}')).toEqual({ segments: [{ text: '{Name} {}' }, { token: 'id' }], unknown: ['{Name}', '{}'] })
  })

  it('linkPillFormatProblem: too long, a control character, an unknown token, no {name}; else null', () => {
    expect(linkPillFormatProblem(DEFAULT_LINK_PILL_FORMAT)).toBeNull()
    expect(linkPillFormatProblem('{name}')).toBeNull()
    expect(linkPillFormatProblem(`{name}${'x'.repeat(60)}`)).toBe('At most 60 characters')
    expect(linkPillFormatProblem('{name}\n')).toBe('No line break or control character')
    expect(linkPillFormatProblem('{name} {Id} {}')).toBe('Not a token: {Id} {}')
    expect(linkPillFormatProblem('{icon} {id}')).toBe('The format needs {name}')
    expect(linkPillFormatProblem('')).toBe('The format needs {name}')
  })

  it('linkPillFormatTokens lists the tokens a format holds', () => {
    expect([...linkPillFormatTokens('{vault} › {icon}{name} {path}')]).toEqual(['vault', 'icon', 'name', 'path'])
  })
})

describe('the {number} and {mark} tokens (YAZ-4924 round 5)', () => {
  it('both are tokens: {number} chips next to {id}, {mark} last; a format with them can be saved', () => {
    expect(LINK_PILL_TOKENS).toEqual(['icon', 'name', 'id', 'number', 'vault', 'folder', 'path', 'mark'])
    expect(parseLinkPillFormat('{name} #{number}{mark}')).toEqual({ segments: [{ token: 'name' }, { text: ' #' }, { token: 'number' }, { token: 'mark' }], unknown: [] })
    expect(linkPillFormatProblem('{mark} {icon}{name} #{number}')).toBeNull()
    expect([...linkPillFormatTokens('{icon}{name} #{number}{mark}')]).toEqual(['icon', 'name', 'number', 'mark'])
  })

  it('the mark has eight icons, the arrow up-right the default; its icon is saved as the part\'s style only when not the default, and only on the mark', () => {
    expect(LINK_PILL_MARKS).toEqual(['arrow-up-right', 'arrow-right', 'link', 'return', 'dot', 'diamond', 'star', 'bookmark'])
    expect(DEFAULT_LINK_PILL_MARK).toBe('arrow-up-right')
    expect(sanitizeLinkPills({ version: 2, format: '{name}{mark}', parts: { mark: { icon: 'star' } } })).toEqual({ format: '{name}{mark}', parts: { mark: { icon: 'star' } } })
    for (const icon of LINK_PILL_MARKS) expect(withLinkPillPart({}, 'mark', { icon })).toEqual(icon === DEFAULT_LINK_PILL_MARK ? {} : { parts: { mark: { icon } } })
    expect(sanitizeLinkPills({ version: 2, parts: { mark: { icon: 'arrow-up-right' } } })).toEqual({})
    expect(sanitizeLinkPills({ version: 2, parts: { mark: { icon: 'rocket' } } })).toEqual({})
    expect(sanitizeLinkPills({ version: 2, parts: { name: { icon: 'star' }, number: { icon: 'star' } } })).toEqual({})
    expect(withLinkPillPart({ parts: { mark: { icon: 'star', size: 'small' } } }, 'mark', { icon: undefined })).toEqual({ parts: { mark: { size: 'small' } } })
    expect(linkPillsFile({ format: '{name}{mark}', parts: { mark: { icon: 'bookmark' } } })).toEqual({ version: 2, format: '{name}{mark}', parts: { mark: { icon: 'bookmark' } } })
  })

  it("the number is a quiet part (muted, small); the mark takes the name's colour until it has its own, and is normal size", () => {
    expect(sanitizeLinkPills({ version: 2, parts: { number: { color: 'muted', size: 'small' } } })).toEqual({})
    expect(sanitizeLinkPills({ version: 2, parts: { number: { color: 'accent', bold: true } } })).toEqual({ parts: { number: { color: 'accent', bold: true } } })
    expect(sanitizeLinkPills({ version: 2, parts: { mark: { size: 'normal', color: 'accent' } } })).toEqual({})
    expect(sanitizeLinkPills({ version: 2, parts: { mark: { size: 'small', color: 'red' } } })).toEqual({ parts: { mark: { size: 'small', color: 'red' } } })
    // A red name: the mark follows it, so red is no change; the accent on the mark is one.
    expect(sanitizeLinkPills({ version: 2, parts: { name: { color: 'red' }, mark: { color: 'red' } } })).toEqual({ parts: { name: { color: 'red' } } })
    expect(sanitizeLinkPills({ version: 2, parts: { name: { color: 'red' }, mark: { color: 'accent' } } })).toEqual({ parts: { name: { color: 'red' }, mark: { color: 'accent' } } })
  })

  it('two more ready formats: Name #Number and Name ↗', () => {
    expect(LINK_PILL_READY.map((r) => r.label)).toEqual(['Name', 'Name (ID)', 'Name #Number', 'Name · Folder', 'Vault › Name', '(Name)', '→ Name', 'Name ↗', 'Plain'])
    expect(LINK_PILL_READY.find((r) => r.label === 'Name #Number')?.format).toBe('{icon} {name} #{number}')
    expect(LINK_PILL_READY.find((r) => r.label === 'Name ↗')?.format).toBe('{name}{mark}')
  })

  it('the pill: {number} is the number alone, {mark} a mark piece with its icon', () => {
    expect(drawn({ format: '{icon}{name} #{number}' })).toEqual({ head: null, tail: ['text: #', 'number:12'], icon: 'name' })
    expect(drawn({ format: '{name}{mark}' })).toEqual({ head: null, tail: ['mark:arrow-up-right'], icon: 'none' })
    expect(drawn({ format: '{mark} {name}', parts: { mark: { icon: 'link' } } })).toEqual({ head: ['mark:link', 'text: '], tail: null, icon: 'none' })
  })
})

describe('sanitizeLinkPills, version 2 (YAZ-4924)', () => {
  it('a good file loads as it is, without its version', () => {
    const file = { version: 2, format: '{name} ({id})', box: { shape: 'square', fill: 'blue', strength: 'strong' }, parts: { name: { bold: true, italic: true, underline: true, color: 'same', size: 'small' }, id: { color: 'red', size: 'normal' }, text: { color: 'accent' } }, vault: 'always' }
    const { version: _v, ...pills } = file
    expect(sanitizeLinkPills(file)).toEqual(pills)
  })

  it("a missing file, or one that is not an object, is today's look: nothing set", () => {
    for (const raw of [null, undefined, 'x', 3, [], {}]) expect(sanitizeLinkPills(raw)).toEqual({})
    expect(isDefaultLinkPills(sanitizeLinkPills({ version: 2 }))).toBe(true)
  })

  it('a bad field falls back alone; a default written out is dropped; an empty box or part goes', () => {
    expect(sanitizeLinkPills({ version: 2, format: '{Name}', box: { shape: 'round', fill: 'mauve' }, parts: { name: { bold: false, color: 'accent', size: 'normal' }, id: { color: 'muted', size: 'small', italic: true }, nope: { bold: true } }, vault: 'other' })).toEqual({ parts: { id: { italic: true } } })
    expect(sanitizeLinkPills({ version: 2, format: DEFAULT_LINK_PILL_FORMAT })).toEqual({})
    expect(sanitizeLinkPills({ version: 2, format: '{icon} {id}' })).toEqual({})
  })

  it("the icon (YAZ-5843): its colour alone, and only one that is not Default ('kind'); 'kind' on another part drops; the file keeps it", () => {
    expect(sanitizeLinkPills({ version: 2, parts: { icon: { color: 'teal', size: 'small', bold: true, italic: true, underline: true } } })).toEqual({ parts: { icon: { color: 'teal' } } })
    expect(sanitizeLinkPills({ version: 2, parts: { icon: { color: 'same' } } })).toEqual({ parts: { icon: { color: 'same' } } })
    expect(sanitizeLinkPills({ version: 2, parts: { icon: { color: 'kind' } } })).toEqual({})
    expect(sanitizeLinkPills({ version: 2, parts: { icon: { size: 'small', bold: true } } })).toEqual({})
    expect(sanitizeLinkPills({ version: 2, parts: { icon: { color: 'mauve' } } })).toEqual({})
    expect(sanitizeLinkPills({ version: 2, parts: { name: { color: 'kind', bold: true }, mark: { color: 'kind' } } })).toEqual({ parts: { name: { bold: true } } })
    expect(withLinkPillPart({ parts: { icon: { color: 'red' } } }, 'icon', { color: undefined })).toEqual({})
    expect(linkPillsFile({ parts: { icon: { color: 'red' } } })).toEqual({ version: 2, parts: { icon: { color: 'red' } } })
    // No icon change: the file keeps the old form.
    expect(linkPillsFile({ parts: { name: { bold: true } } })).toEqual({ version: 2, parts: { name: { bold: true } } })
  })

  it('the icon in two rows (YAZ-5972): an old file\'s one colour reads as both; cardColor apart; a default dropped', () => {
    // A file written before YAZ-5972: one colour, both rows.
    const old = sanitizeLinkPills({ version: 2, parts: { icon: { color: 'red' } } })
    expect(linkPillIconColors(old)).toEqual({ pages: 'red', cards: 'red' })
    expect(linkPillIconColors({})).toEqual({ pages: 'kind', cards: 'kind' })
    expect(sanitizeLinkPills({ version: 2, parts: { icon: { color: 'red', cardColor: 'teal' } } })).toEqual({ parts: { icon: { color: 'red', cardColor: 'teal' } } })
    // The cards' default is the pages' colour, else Default: equal to it, it drops.
    expect(sanitizeLinkPills({ version: 2, parts: { icon: { color: 'red', cardColor: 'red' } } })).toEqual({ parts: { icon: { color: 'red' } } })
    expect(sanitizeLinkPills({ version: 2, parts: { icon: { cardColor: 'kind' } } })).toEqual({})
    expect(sanitizeLinkPills({ version: 2, parts: { icon: { color: 'red', cardColor: 'kind' } } })).toEqual({ parts: { icon: { color: 'red', cardColor: 'kind' } } })
    expect(sanitizeLinkPills({ version: 2, parts: { icon: { cardColor: 'mauve', color: 'kind' } } })).toEqual({})
    // cardColor is the icon's alone.
    expect(sanitizeLinkPills({ version: 2, parts: { name: { cardColor: 'red', bold: true } } })).toEqual({ parts: { name: { bold: true } } })
    // A row's pick leaves the other row as it looks: pages red on an empty look keeps cards at Default.
    const pagesRed = withLinkPillIconColor({}, 'pages', 'red')
    expect(pagesRed).toEqual({ parts: { icon: { color: 'red', cardColor: 'kind' } } })
    expect(linkPillIconColors(pagesRed)).toEqual({ pages: 'red', cards: 'kind' })
    const both = withLinkPillIconColor(pagesRed, 'cards', 'teal')
    expect(both).toEqual({ parts: { icon: { color: 'red', cardColor: 'teal' } } })
    expect(withLinkPillIconColor(both, 'pages', 'kind')).toEqual({ parts: { icon: { cardColor: 'teal' } } })
    expect(withLinkPillIconColor(withLinkPillIconColor(both, 'pages', 'kind'), 'cards', 'kind')).toEqual({})
    // The old file's pages pick keeps the cards at the old colour.
    expect(withLinkPillIconColor(old, 'pages', 'blue')).toEqual({ parts: { icon: { color: 'blue', cardColor: 'red' } } })
    expect(linkPillsFile(both)).toEqual({ version: 2, parts: { icon: { color: 'red', cardColor: 'teal' } } })
  })

  it('a custom colour (YAZ-5972): #rrggbb kept lowercase on every part, both icon rows and the box fill; anything else drops', () => {
    expect(sanitizeLinkPills({ version: 2, parts: { name: { color: '#FF00AA' }, id: { color: '#12ab9f' }, mark: { color: '#000000' }, icon: { color: '#ABCDEF', cardColor: '#00Ff00' } } })).toEqual({
      parts: { name: { color: '#ff00aa' }, id: { color: '#12ab9f' }, mark: { color: '#000000' }, icon: { color: '#abcdef', cardColor: '#00ff00' } },
    })
    expect(sanitizeLinkPills({ version: 2, box: { fill: '#3366CC', strength: 'strong' } })).toEqual({ box: { fill: '#3366cc', strength: 'strong' } })
    for (const bad of ['#abc', '#abcdefff', 'abcdef', '#ggggggg', '#gggggg', ' #abcdef', 'rgb(1, 2, 3)', 123])
      expect(sanitizeLinkPills({ version: 2, box: { fill: bad }, parts: { name: { color: bad }, icon: { color: bad, cardColor: bad } } })).toEqual({})
    // The mark's default is the name's, a custom one too.
    expect(sanitizeLinkPills({ version: 2, parts: { name: { color: '#ff00aa' }, mark: { color: '#FF00AA' } } })).toEqual({ parts: { name: { color: '#ff00aa' } } })
  })

  it('YAZ-5894 D2: the default and every ready format put a space after {icon}; the old default (no space) reads as the default; a typed {icon}{name} stays, flush', () => {
    expect(DEFAULT_LINK_PILL_FORMAT).toBe('{icon} {name} ({vault})')
    expect(LINK_PILL_READY.filter((r) => r.format?.includes('{icon}')).every((r) => r.format?.includes('{icon} {name}'))).toBe(true)
    expect(LINK_PILL_READY.some((r) => r.format?.includes('{icon}{name}'))).toBe(false)
    expect(sanitizeLinkPills({ version: 2, format: '{icon}{name} ({vault})' })).toEqual({})
    expect(sanitizeLinkPills({ version: 2, format: '{icon} {name} ({vault})' })).toEqual({})
    expect(sanitizeLinkPills({ version: 2, format: '{icon}{name}({number})' })).toEqual({ format: '{icon}{name}({number})' })
    expect(fromV1({ id: 'show' })).toEqual({ format: '{icon} {name} {id} ({vault})' })
  })

  it('YAZ-5894 D2: a ready format stored before the space (by an older app) reads as today\'s ready format; a typed one that is not a ready string stays flush', () => {
    const old: Array<[string, string]> = [
      ['{icon}{name} ({id})', '{icon} {name} ({id})'],
      ['{icon}{name} #{number}', '{icon} {name} #{number}'],
      ['{icon}{name} · {folder}', '{icon} {name} · {folder}'],
      ['{vault} › {icon}{name}', '{vault} › {icon} {name}'],
      ['({icon}{name})', '({icon} {name})'],
      ['→ {icon}{name}', '→ {icon} {name}'],
    ]
    for (const [stored, today] of old) {
      expect(LINK_PILL_READY.some((r) => r.format === today)).toBe(true)
      expect(sanitizeLinkPills({ version: 2, format: stored })).toEqual({ format: today })
      // The look built from the file has the space: the icon gets the gap, not the flush 1px.
      expect(sanitizeLinkPills({ version: 2, format: stored, parts: { name: { bold: true } } })).toEqual({ format: today, parts: { name: { bold: true } } })
    }
    // Not a ready string: the user's own flush format stays as typed.
    expect(sanitizeLinkPills({ version: 2, format: '{icon}{name} #{number}{mark}' })).toEqual({ format: '{icon}{name} #{number}{mark}' })
    expect(sanitizeLinkPills({ version: 2, format: '{icon}{name}#{number}' })).toEqual({ format: '{icon}{name}#{number}' })
    expect(sanitizeLinkPills({ version: 2, format: '{icon}{name} ({id}) ' })).toEqual({ format: '{icon}{name} ({id}) ' })
  })

  it('a strength needs a palette fill', () => {
    expect(sanitizeLinkPills({ version: 2, box: { strength: 'light' } })).toEqual({})
    expect(sanitizeLinkPills({ version: 2, box: { strength: 'light', fill: 'none' } })).toEqual({ box: { fill: 'none' } })
    expect(sanitizeLinkPills({ version: 2, box: { strength: 'light', fill: 'teal' } })).toEqual({ box: { fill: 'teal', strength: 'light' } })
  })

  it('withLinkPills, withLinkPillPart and withLinkPillBox apply a patch and drop what is back at its default', () => {
    const pills = withLinkPillPart({}, 'name', { bold: true, color: 'blue' })
    expect(pills).toEqual({ parts: { name: { bold: true, color: 'blue' } } })
    expect(withLinkPillPart(pills, 'name', { bold: undefined, color: 'accent' })).toEqual({})
    expect(withLinkPillPart(pills, 'id', { size: 'small' })).toEqual(pills)
    expect(withLinkPillBox(pills, { fill: 'red', strength: 'light' })).toEqual({ ...pills, box: { fill: 'red', strength: 'light' } })
    expect(withLinkPillBox({ box: { fill: 'red', strength: 'light' } }, { fill: undefined })).toEqual({})
    expect(withLinkPills(pills, { format: '{name}', vault: 'never' })).toEqual({ ...pills, format: '{name}', vault: 'never' })
  })

  it('a ready format sets the format and lays its parts and box over the current ones; Plain is a look', () => {
    const [name, nameId, , , , brackets, , , plain] = LINK_PILL_READY
    const current: LinkPills = { parts: { name: { bold: true } }, box: { shape: 'square' } }
    expect(withLinkPillReady(current, nameId!)).toEqual({ ...current, format: '{icon} {name} ({id})' })
    expect(withLinkPillReady(current, brackets!)).toEqual({ ...current, format: '({icon} {name})', parts: { name: { bold: true }, text: { color: 'accent', size: 'normal' } } })
    // Plain (YAZ-5961): every part but the icon in the text's colour and size, no box; the format and the icon stay.
    const same = { color: 'same', size: 'normal' } as const
    expect(withLinkPillReady({ ...current, format: '{icon} {name} #{number}', parts: { ...current.parts, icon: { color: 'teal' } } }, plain!)).toEqual({
      format: '{icon} {name} #{number}',
      parts: { name: { bold: true, color: 'same' }, id: same, number: same, vault: same, folder: same, path: same, icon: { color: 'teal' }, text: same },
      box: { shape: 'square', fill: 'none' },
    })
    expect(withLinkPillReady({ format: '{name}' }, name!)).toEqual({})
  })

  it('the file carries version 2 and only the changes', () => {
    expect(LINK_PILLS_VERSION).toBe(2)
    expect(linkPillsFile({ box: { shape: 'underline' } })).toEqual({ version: 2, box: { shape: 'underline' } })
    expect(linkPillsFile({})).toEqual({ version: 2 })
  })
})

/** The pieces of an end as `part:text`, the icon as `icon`. */
const texts = (end: PillEnd | null) => (end === null ? null : end.pieces.map((p) => (p.part === 'icon' ? 'icon' : p.part === 'mark' ? `mark:${p.icon}` : `${p.part}:${p.text}`)))
const info = { id: 'YAS-12', folder: 'Projects/Plans' }
/** The pill of a page of this vault, with an ID, in Projects/Plans, under `pills`. */
const drawn = (pills: LinkPills, otherVault: string | null = null) => {
  const { head, tail } = pillParts(pills, { info, otherVault }, 'Mine')
  return { head: texts(head), tail: texts(tail), icon: pillIconPlace(pills) }
}

describe('a version 1 file → the version 2 look → the same drawn pill (YAZ-4924)', () => {
  /** Each row: the version 1 field(s), the version 2 look they become, and the pill they draw (its head, its tail, where the icon is). */
  const table: Array<[v1: Record<string, unknown>, v2: LinkPills, pill: ReturnType<typeof drawn>]> = [
    [{}, {}, { head: null, tail: null, icon: 'name' }],
    [{ background: 'none' }, { box: { fill: 'none' } }, { head: null, tail: null, icon: 'name' }],
    [{ background: 'blue' }, { box: { fill: 'blue' } }, { head: null, tail: null, icon: 'name' }],
    [{ background: 'red', strength: 'strong' }, { box: { fill: 'red', strength: 'strong' } }, { head: null, tail: null, icon: 'name' }],
    [{ strength: 'light' }, {}, { head: null, tail: null, icon: 'name' }],
    [{ text: 'same' }, { parts: { name: { color: 'same' } } }, { head: null, tail: null, icon: 'name' }],
    [{ text: 'green' }, { parts: { name: { color: 'green' } } }, { head: null, tail: null, icon: 'name' }],
    [{ icon: 'hide' }, { format: '{name} ({vault})' }, { head: null, tail: null, icon: 'none' }],
    [{ bold: true, italic: true, underline: true }, { parts: { name: { bold: true, italic: true, underline: true } } }, { head: null, tail: null, icon: 'name' }],
    [{ before: '(', after: ')' }, { format: '({icon} {name} ({vault}))', parts: { text: { color: 'accent', size: 'normal' } } }, { head: ['text:('], tail: ['text:)'], icon: 'name' }],
    [{ before: '→ ' }, { format: '→ {icon} {name} ({vault})', parts: { text: { color: 'accent', size: 'normal' } } }, { head: ['text:→ '], tail: null, icon: 'name' }],
    [{ vault: 'always' }, { vault: 'always' }, { head: null, tail: ['text: (', 'vault:Mine', 'text:)'], icon: 'name' }],
    [{ vault: 'always', vaultPlace: 'before' }, { format: '{vault} › {icon} {name}', vault: 'always' }, { head: ['vault:Mine', 'text: › '], tail: null, icon: 'name' }],
    [{ vault: 'never' }, { vault: 'never' }, { head: null, tail: null, icon: 'name' }],
    [{ id: 'show' }, { format: '{icon} {name} {id} ({vault})' }, { head: null, tail: ['text: ', 'id:YAS-12'], icon: 'name' }],
    [{ folder: 'parent' }, { format: '{icon} {name} {folder} ({vault})' }, { head: null, tail: ['text: ', 'folder:Plans'], icon: 'name' }],
    [{ folder: 'full' }, { format: '{icon} {name} {path} ({vault})' }, { head: null, tail: ['text: ', 'path:Projects › Plans'], icon: 'name' }],
    [{ shape: 'square' }, { box: { shape: 'square' } }, { head: null, tail: null, icon: 'name' }],
    [{ shape: 'underline' }, { box: { shape: 'underline' } }, { head: null, tail: null, icon: 'name' }],
    [
      { before: '[', after: ']', icon: 'hide', bold: true, text: 'same', background: 'none', id: 'show', folder: 'parent', vault: 'always', shape: 'square' },
      { format: '[{name} {id} {folder} ({vault})]', parts: { name: { bold: true, color: 'same' }, text: { color: 'accent', size: 'normal' } }, box: { fill: 'none', shape: 'square' }, vault: 'always' },
      { head: ['text:['], tail: ['text: ', 'id:YAS-12', 'text: ', 'folder:Plans', 'text: (', 'vault:Mine', 'text:)]'], icon: 'none' },
    ],
  ]

  it.each(table)('%j → %j', (v1, v2, pill) => {
    const converted = sanitizeLinkPills({ version: 1, ...v1 })
    expect(converted).toEqual(v2)
    expect(fromV1(v1)).toEqual(v2)
    expect(drawn(converted)).toEqual(pill)
  })

  it('a file with no version and a field of the first round is version 1; a bad field falls back alone', () => {
    expect(sanitizeLinkPills({ bold: true, background: 'mauve', before: '' })).toEqual({ parts: { name: { bold: true } } })
  })

  it("today's look draws today's pill: nothing on a pill of this vault, the other vault's name in brackets at the tail (YAZ-3609 D22)", () => {
    expect(drawn({})).toEqual({ head: null, tail: null, icon: 'name' })
    expect(drawn({}, 'Wiki')).toEqual({ head: null, tail: ['text: (', 'vault:Wiki', 'text:)'], icon: 'name' })
    expect(drawn({ vault: 'never' }, 'Wiki')).toEqual({ head: null, tail: null, icon: 'name' })
  })
})
