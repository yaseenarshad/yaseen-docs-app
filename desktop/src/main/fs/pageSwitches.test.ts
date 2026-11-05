import { describe, expect, it } from 'vitest'
import { notePageSwitches, PAGE_SWITCH_KEYS, setNotePageSwitch } from '@shared/pageSwitches'

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
