/**
 * `shared/linkPills.ts` (YAZ-4924, version 2): the format parser, what a format may not be, the vault file
 * `.yaseendocs/link-pills.json` as the app uses it, and the table of the first round's fields (version 1) → the
 * version 2 look → the same drawn pill. The module is in `shared/`; its test is here because no vitest project reads
 * `shared/` (the precedent of `textFormatting.test.ts`).
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LINK_PILL_FORMAT,
  LINK_PILLS_VERSION,
  LINK_PILL_READY,
  fromV1,
  isDefaultLinkPills,
  linkPillFormatProblem,
  linkPillFormatTokens,
  linkPillsFile,
  parseLinkPillFormat,
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
    const [name, nameId, , , brackets, , plain] = LINK_PILL_READY
    const current: LinkPills = { parts: { name: { bold: true } }, box: { shape: 'square' } }
    expect(withLinkPillReady(current, nameId!)).toEqual({ ...current, format: '{icon}{name} ({id})' })
    expect(withLinkPillReady(current, brackets!)).toEqual({ ...current, format: '({icon}{name})', parts: { name: { bold: true }, text: { color: 'accent', size: 'normal' } } })
    expect(withLinkPillReady(current, plain!)).toEqual({ format: '{name}', parts: { name: { bold: true, color: 'same' } }, box: { shape: 'square', fill: 'none' } })
    expect(withLinkPillReady({ format: '{name}' }, name!)).toEqual({})
  })

  it('the file carries version 2 and only the changes', () => {
    expect(LINK_PILLS_VERSION).toBe(2)
    expect(linkPillsFile({ box: { shape: 'underline' } })).toEqual({ version: 2, box: { shape: 'underline' } })
    expect(linkPillsFile({})).toEqual({ version: 2 })
  })
})

/** The pieces of an end as `part:text`, the icon as `icon`. */
const texts = (end: PillEnd | null) => (end === null ? null : end.pieces.map((p) => (p.part === 'icon' ? 'icon' : `${p.part}:${p.text}`)))
const info = { id: 'YAS-12', folder: 'Projects/Plans' }
/** The pill of a note of this vault, with an ID, in Projects/Plans, under `pills`. */
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
    [{ before: '(', after: ')' }, { format: '({icon}{name} ({vault}))', parts: { text: { color: 'accent', size: 'normal' } } }, { head: ['text:('], tail: ['text:)'], icon: 'name' }],
    [{ before: '→ ' }, { format: '→ {icon}{name} ({vault})', parts: { text: { color: 'accent', size: 'normal' } } }, { head: ['text:→ '], tail: null, icon: 'name' }],
    [{ vault: 'always' }, { vault: 'always' }, { head: null, tail: ['text: (', 'vault:Mine', 'text:)'], icon: 'name' }],
    [{ vault: 'always', vaultPlace: 'before' }, { format: '{vault} › {icon}{name}', vault: 'always' }, { head: ['vault:Mine', 'text: › '], tail: null, icon: 'name' }],
    [{ vault: 'never' }, { vault: 'never' }, { head: null, tail: null, icon: 'name' }],
    [{ id: 'show' }, { format: '{icon}{name} {id} ({vault})' }, { head: null, tail: ['text: ', 'id:YAS-12'], icon: 'name' }],
    [{ folder: 'parent' }, { format: '{icon}{name} {folder} ({vault})' }, { head: null, tail: ['text: ', 'folder:Plans'], icon: 'name' }],
    [{ folder: 'full' }, { format: '{icon}{name} {path} ({vault})' }, { head: null, tail: ['text: ', 'path:Projects › Plans'], icon: 'name' }],
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
