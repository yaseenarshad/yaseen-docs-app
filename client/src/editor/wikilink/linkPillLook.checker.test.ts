/**
 * Checker tests (PR #278: YAZ-5859, YAZ-5894). A vault's file goes through the same road as in the app: the file on
 * disk, `sanitizeLinkPills`, then `linkPillVars` and `pillParts`. The default and every ready format keep today's look
 * (the icon on the name, a space as its gap, no variable); `{icon}{name}` is flush; the icon's colour is one variable
 * pair and never touches the other parts.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_LINK_PILL_FORMAT, LINK_PILL_READY, linkPillsFile, sanitizeLinkPills, withLinkPills, type LinkPills } from '@shared/linkPills'
import { linkPillVars, pillIconPlace, pillParts, type PillEnd } from './linkPillLook'

/** The look the app reads back after it saved `pills` to the file. */
const roundTrip = (pills: LinkPills): LinkPills => sanitizeLinkPills(JSON.parse(JSON.stringify(linkPillsFile(pills))))
const meta = { info: { id: 'YAS-12', folder: 'Plans' }, otherVault: 'Wiki' }
const texts = (end: PillEnd | null) => (end === null ? [] : end.pieces.map((p) => ('text' in p ? p.text : `<${p.part}>`)))

describe('link pill look, end to end through the file (checker)', () => {
  it('the default and each ready format with {icon}: the icon sits on the name, no blank piece, no gap variable (the CSS 0.25em); the same with a picked icon colour', () => {
    const formats = [DEFAULT_LINK_PILL_FORMAT, ...LINK_PILL_READY.map((r) => r.format)].filter((f) => f.includes('{icon}'))
    expect(formats.length).toBeGreaterThanOrEqual(7)
    for (const format of formats) {
      const look = roundTrip(withLinkPills({}, { format }))
      expect(pillIconPlace(look), format).toBe('name')
      expect(linkPillVars(look)['--pill-icon-gap'], format).toBeUndefined()
      const { head, tail } = pillParts(look, meta, 'Mine')
      // No piece of the head or the tail is a lone space, and none is the icon (it is on the name).
      for (const t of [...texts(head), ...texts(tail)]) {
        expect(t.trim() === '' && t !== '', `${format}: ${JSON.stringify(t)}`).toBe(false)
        expect(t, format).not.toBe('<icon>')
      }
      // A picked colour adds exactly the icon's pair; the gap stays the format's.
      const red = linkPillVars(roundTrip({ ...look, parts: { icon: { color: 'red' } } }))
      expect(red['--pill-icon-fg']).toBe('var(--table-text-red)')
      expect(red['--pill-icon-on']).toBe('1')
      expect(red['--pill-icon-gap']).toBeUndefined()
    }
    // The default keeps today's look: no variable at all, and nothing written but the version.
    expect(linkPillVars(roundTrip({ format: DEFAULT_LINK_PILL_FORMAT }))).toEqual({})
    expect(linkPillsFile(roundTrip({ format: DEFAULT_LINK_PILL_FORMAT }))).toEqual({ version: 2 })
  })

  it('a file from before the change: the old default reads as today, with no variable; a typed {icon}{name} is flush (1px) in the head, the name and the tail; Default (kind) and an icon size never reach the look', () => {
    const old = sanitizeLinkPills({ version: 2, format: '{icon}{name} ({vault})', parts: { icon: { color: 'kind', size: 'small', bold: true } } })
    expect(old).toEqual({})
    expect(linkPillVars(old)).toEqual({})
    const flush = sanitizeLinkPills({ version: 2, format: '{icon}{name}({number})', parts: { icon: { color: 'teal' }, name: { color: 'same' } } })
    expect(linkPillVars(flush)).toEqual({ '--pill-icon-fg': 'var(--table-text-teal)', '--pill-icon-on': '1', '--pill-icon-gap': '1px', '--pill-name-fg': 'currentColor' })
    expect(texts(pillParts(flush, meta, 'Mine').tail).join('')).toBe('(12)')
    expect(texts(pillParts(flush, meta, 'Mine').head)).toEqual([])
    // A space between the icon and the name in a stored format is the gap, not text, and sets no variable.
    const spaced = sanitizeLinkPills({ version: 2, format: '{icon}   {name}({number})' })
    expect(linkPillVars(spaced)['--pill-icon-gap']).toBeUndefined()
    expect(texts(pillParts(spaced, meta, 'Mine').head)).toEqual([])
    // Other text between them makes the icon a piece again, with no gap variable: the format's text spaces it.
    const dotted = sanitizeLinkPills({ version: 2, format: '{icon} · {name}' })
    expect(pillIconPlace(dotted)).toBe('piece')
    expect(linkPillVars(dotted)['--pill-icon-gap']).toBeUndefined()
    expect(texts(pillParts(dotted, meta, 'Mine').head)).toEqual(['<icon>', ' · '])
  })
})
