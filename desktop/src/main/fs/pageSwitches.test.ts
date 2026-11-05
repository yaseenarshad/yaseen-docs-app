import { describe, expect, it } from 'vitest'
import { noteOutsideGlow, notePageSwitches, PAGE_SWITCH_KEYS, setNoteOutsideGlow, setNotePageSwitch } from '@shared/pageSwitches'
import { OUTSIDE_CHANGE_GLOWS } from '@shared/types'

/**
 * The page cog's on/off rows IN the note (YAZ-4094 G4): read, write, and a note with no choice. The
 * door around them is the editor's `transformFile` (as for `readonly`) and the one-time move of the old
 * app-state lists (`movePageSwitches.test.ts`).
 */

const NOTE = '---\n# the owner\'s comment\ntags: [a, b]\nstatus: "draft"\n---\n# Body\n\ntext\n'

describe('the page switches in the frontmatter', () => {
  it('a note with no frontmatter, no key, or a block that does not parse holds no choice', () => {
    expect(notePageSwitches('# Body\n')).toEqual({})
    expect(notePageSwitches(NOTE)).toEqual({})
    expect(notePageSwitches('---\n---\nbody')).toEqual({})
    expect(notePageSwitches('---\nfolding: false\n  bad: [\n---\n')).toEqual({})
  })

  it('reads each key; only `true` and `false` count, and the word in the body is not a choice', () => {
    expect(notePageSwitches('---\ntoc: false\nsection-indent: true\nguide-lines: false\nfolding: true\n---\n')).toEqual({ toc: false, 'section-indent': true, 'guide-lines': false, folding: true })
    for (const value of ['"yes"', '1', '"false"', 'off', '']) expect(notePageSwitches(`---\nfolding: ${value}\n---\n`), value).toEqual({})
    expect(notePageSwitches('---\nnote: folding\n---\nfolding: false\n')).toEqual({})
  })

  it('YAZ-4432: `bullet-threading` is a page switch too, read and written both ways', () => {
    expect(notePageSwitches('---\nbullet-threading: true\n---\n')).toEqual({ 'bullet-threading': true })
    const off = setNotePageSwitch(NOTE, 'bullet-threading', false)
    expect(off).toBe('---\n# the owner\'s comment\ntags: [a, b]\nstatus: "draft"\nbullet-threading: false\n---\n# Body\n\ntext\n')
    expect(notePageSwitches(setNotePageSwitch(off, 'bullet-threading', true))).toEqual({ 'bullet-threading': true })
  })

  it('writes `true` and `false` both, keeps every other byte, and a note with no frontmatter gets a block', () => {
    const off = setNotePageSwitch(NOTE, 'guide-lines', false)
    expect(off).toBe('---\n# the owner\'s comment\ntags: [a, b]\nstatus: "draft"\nguide-lines: false\n---\n# Body\n\ntext\n')
    expect(notePageSwitches(setNotePageSwitch(off, 'guide-lines', true))).toEqual({ 'guide-lines': true })
    expect(notePageSwitches(setNotePageSwitch('# Body\n', 'folding', false))).toEqual({ folding: false })
    expect(setNotePageSwitch('# Body\n', 'folding', false).endsWith('# Body\n')).toBe(true)
  })

  it('the same value again is the SAME string, so the caller writes nothing', () => {
    for (const key of PAGE_SWITCH_KEYS) {
      const on = setNotePageSwitch(NOTE, key, true)
      expect(setNotePageSwitch(on, key, true)).toBe(on)
    }
  })
})

describe("the page's own glow for outside changes (YAZ-4272 D2)", () => {
  it('no key, a value that is not a glow, or a block that does not parse follow the app setting', () => {
    expect(noteOutsideGlow('# Body\n')).toBeNull()
    expect(noteOutsideGlow(NOTE)).toBeNull()
    for (const value of ['true', 'false', '10', '"5s"', '[10s]', '10s', '']) expect(noteOutsideGlow(`---\noutside-glow: ${value}\n---\n`), value).toBeNull()
    expect(noteOutsideGlow('---\noutside-glow: 10s\n  bad: [\n---\n')).toBeNull()
  })

  it('each value round-trips as plain text, `off` too (YAML 1.2: a bare `off` is text, not false)', () => {
    for (const glow of OUTSIDE_CHANGE_GLOWS) {
      const set = setNoteOutsideGlow(NOTE, glow)
      expect(set).toBe(`---\n# the owner's comment\ntags: [a, b]\nstatus: "draft"\noutside-glow: ${glow}\n---\n# Body\n\ntext\n`)
      expect(noteOutsideGlow(set)).toBe(glow)
      // The same value again is the SAME string, so the caller writes nothing.
      expect(setNoteOutsideGlow(set, glow)).toBe(set)
    }
    expect(noteOutsideGlow(setNoteOutsideGlow('# Body\n', 'off'))).toBe('off')
  })

  it('null takes the key away, every other byte kept: the page follows the app setting again', () => {
    expect(setNoteOutsideGlow(setNoteOutsideGlow(NOTE, '60s'), null)).toBe(NOTE)
    expect(setNoteOutsideGlow(NOTE, null)).toBe(NOTE)
  })
})
