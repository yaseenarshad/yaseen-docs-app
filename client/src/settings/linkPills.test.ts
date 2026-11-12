/**
 * `sanitizeLinkPills` (YAZ-4924): the vault file `.yaseendocs/link-pills.json` as the app uses it. The module is in
 * `shared/`; its test is here because no vitest project reads `shared/` (the precedent of `textFormatting.test.ts`).
 */
import { describe, expect, it } from 'vitest'
import { isDefaultLinkPills, isPlainLinkPills, linkPillsFile, plainLinkPills, sanitizeLinkPills, withLinkPills } from '@shared/linkPills'

describe('sanitizeLinkPills (YAZ-4924)', () => {
  it('a good file loads as it is, without its version', () => {
    const file = { version: 1, background: 'blue', strength: 'strong', text: 'same', icon: 'hide', bold: true, italic: true, underline: true, before: '(', after: ')', vault: 'always', vaultPlace: 'before', id: 'show', folder: 'full', shape: 'square' }
    const { version: _v, ...pills } = file
    expect(sanitizeLinkPills(file)).toEqual(pills)
  })

  it('a missing file, or one that is not an object, is today\'s look: nothing set', () => {
    for (const raw of [null, undefined, 'x', 3, [], {}]) expect(sanitizeLinkPills(raw)).toEqual({})
    expect(isDefaultLinkPills(sanitizeLinkPills({ version: 1 }))).toBe(true)
  })

  it('a bad field falls back alone; a default written out is dropped', () => {
    expect(sanitizeLinkPills({ background: 'mauve', text: 'blue', icon: 'show', bold: false, italic: 'yes', before: '', after: '123456789', vault: 'other', id: 'off', folder: 'none', shape: 'pill' })).toEqual({ text: 'blue' })
    expect(sanitizeLinkPills({ strength: 'medium', background: 'red' })).toEqual({ background: 'red' })
  })

  it('a strength needs a palette background', () => {
    expect(sanitizeLinkPills({ strength: 'light' })).toEqual({})
    expect(sanitizeLinkPills({ strength: 'light', background: 'none' })).toEqual({ background: 'none' })
    expect(sanitizeLinkPills({ strength: 'light', background: 'teal' })).toEqual({ strength: 'light', background: 'teal' })
  })

  it('the text before or after is 1 to 8 characters and holds no control character; spaces and symbols count', () => {
    expect(sanitizeLinkPills({ before: '→ ', after: ' ↗' })).toEqual({ before: '→ ', after: ' ↗' })
    expect(sanitizeLinkPills({ before: '12345678', after: '(\n' })).toEqual({ before: '12345678' })
  })

  it('withLinkPills applies a patch and drops fields set back to their default', () => {
    const pills = withLinkPills({}, { background: 'red', strength: 'light', bold: true })
    expect(pills).toEqual({ background: 'red', strength: 'light', bold: true })
    expect(withLinkPills(pills, { background: undefined })).toEqual({ bold: true })
    expect(withLinkPills(pills, { bold: undefined, strength: undefined })).toEqual({ background: 'red' })
  })

  it('Plain strips the background, the colour and the icon and keeps the rest; Reset is {}', () => {
    const plain = plainLinkPills({ background: 'red', strength: 'strong', bold: true, before: '(' })
    expect(plain).toEqual({ background: 'none', text: 'same', icon: 'hide', bold: true, before: '(' })
    expect(isPlainLinkPills(plain)).toBe(true)
    expect(isPlainLinkPills({ background: 'none' })).toBe(false)
  })

  it('the file carries the version and only the changes', () => {
    expect(linkPillsFile({ shape: 'underline' })).toEqual({ version: 1, shape: 'underline' })
    expect(linkPillsFile({})).toEqual({ version: 1 })
  })
})
