import { describe, expect, it } from 'vitest'
import { CODE_WIDTH_KEY, readBlockWidth, readOutsideGlow, readPageSwitches, PAGE_SWITCH_KEYS, writeBlockWidth, writeOutsideGlow, writePageSwitch, TABLE_WIDTH_KEY } from '@shared/pageSwitches'
import { OUTSIDE_CHANGE_GLOWS } from '@shared/types'

/**
 * The page cog's on/off rows IN the page (YAZ-4094 G4): read, write, and a page with no choice. The
 * door around them is the editor's `transformFile` (as for `readonly`) and the one-time move of the old
 * app-state lists (`movePageSwitches.test.ts`).
 */

const PAGE = '---\n# the owner\'s comment\ntags: [a, b]\nstatus: "draft"\n---\n# Body\n\ntext\n'

describe('the page switches in the frontmatter', () => {
  it('a page with no frontmatter, no key, or a block that does not parse holds no choice', () => {
    expect(readPageSwitches('# Body\n')).toEqual({})
    expect(readPageSwitches(PAGE)).toEqual({})
    expect(readPageSwitches('---\n---\nbody')).toEqual({})
    expect(readPageSwitches('---\nfolding: false\n  bad: [\n---\n')).toEqual({})
  })

  it('reads each key; only `true` and `false` count, and the word in the body is not a choice', () => {
    expect(readPageSwitches('---\ntoc: false\nsection-indent: true\nguide-lines: false\nfolding: true\n---\n')).toEqual({ toc: false, 'section-indent': true, 'guide-lines': false, folding: true })
    for (const value of ['"yes"', '1', '"false"', 'off', '']) expect(readPageSwitches(`---\nfolding: ${value}\n---\n`), value).toEqual({})
    expect(readPageSwitches('---\npage: folding\n---\nfolding: false\n')).toEqual({})
  })

  it('YAZ-4432: `bullet-threading` is a page switch too, read and written both ways', () => {
    expect(readPageSwitches('---\nbullet-threading: true\n---\n')).toEqual({ 'bullet-threading': true })
    const off = writePageSwitch(PAGE, 'bullet-threading', false)
    expect(off).toBe('---\n# the owner\'s comment\ntags: [a, b]\nstatus: "draft"\nbullet-threading: false\n---\n# Body\n\ntext\n')
    expect(readPageSwitches(writePageSwitch(off, 'bullet-threading', true))).toEqual({ 'bullet-threading': true })
  })

  it('writes `true` and `false` both, keeps every other byte, and a page with no frontmatter gets a block', () => {
    const off = writePageSwitch(PAGE, 'guide-lines', false)
    expect(off).toBe('---\n# the owner\'s comment\ntags: [a, b]\nstatus: "draft"\nguide-lines: false\n---\n# Body\n\ntext\n')
    expect(readPageSwitches(writePageSwitch(off, 'guide-lines', true))).toEqual({ 'guide-lines': true })
    expect(readPageSwitches(writePageSwitch('# Body\n', 'folding', false))).toEqual({ folding: false })
    expect(writePageSwitch('# Body\n', 'folding', false).endsWith('# Body\n')).toBe(true)
  })

  it('the same value again is the SAME string, so the caller writes nothing', () => {
    for (const key of PAGE_SWITCH_KEYS) {
      const on = writePageSwitch(PAGE, key, true)
      expect(writePageSwitch(on, key, true)).toBe(on)
    }
  })
})

describe("the page's own glow for outside changes (YAZ-4272 D2)", () => {
  it('no key, a value that is not a glow, or a block that does not parse follow the app setting', () => {
    expect(readOutsideGlow('# Body\n')).toBeNull()
    expect(readOutsideGlow(PAGE)).toBeNull()
    for (const value of ['true', 'false', '10', '"5s"', '[10s]', '10s', '']) expect(readOutsideGlow(`---\noutside-glow: ${value}\n---\n`), value).toBeNull()
    expect(readOutsideGlow('---\noutside-glow: 10s\n  bad: [\n---\n')).toBeNull()
  })

  it('each value round-trips as plain text, `off` too (YAML 1.2: a bare `off` is text, not false)', () => {
    for (const glow of OUTSIDE_CHANGE_GLOWS) {
      const set = writeOutsideGlow(PAGE, glow)
      expect(set).toBe(`---\n# the owner's comment\ntags: [a, b]\nstatus: "draft"\noutside-glow: ${glow}\n---\n# Body\n\ntext\n`)
      expect(readOutsideGlow(set)).toBe(glow)
      // The same value again is the SAME string, so the caller writes nothing.
      expect(writeOutsideGlow(set, glow)).toBe(set)
    }
    expect(readOutsideGlow(writeOutsideGlow('# Body\n', 'off'))).toBe('off')
  })

  it('null takes the key away, every other byte kept: the page follows the app setting again', () => {
    expect(writeOutsideGlow(writeOutsideGlow(PAGE, '60s'), null)).toBe(PAGE)
    expect(writeOutsideGlow(PAGE, null)).toBe(PAGE)
  })
})

describe("the page's code block and table widths (YAZ-4783 layer 2)", () => {
  it('reads `code-width` and `table-width`: whole px in 240–4000; anything else, a block that does not parse, and no key are null', () => {
    expect(readBlockWidth('---\ncode-width: 900\ntable-width: 1000\n---\n', CODE_WIDTH_KEY)).toBe(900)
    expect(readBlockWidth('---\ncode-width: 900\ntable-width: 1000\n---\n', TABLE_WIDTH_KEY)).toBe(1000)
    expect(readBlockWidth(PAGE, CODE_WIDTH_KEY)).toBeNull()
    expect(readBlockWidth('# Body\ncode-width: 900\n', CODE_WIDTH_KEY)).toBeNull()
    for (const value of ['239', '4001', '900.5', '"900"', '900px', 'wide', 'true', '']) expect(readBlockWidth(`---\ncode-width: ${value}\n---\n`, CODE_WIDTH_KEY), value).toBeNull()
    expect(readBlockWidth('---\ncode-width: 900\n  bad: [\n---\n', CODE_WIDTH_KEY)).toBeNull()
  })

  it('writes the key with every other byte kept; the same value again is the SAME string; null takes it away', () => {
    const set = writeBlockWidth(PAGE, CODE_WIDTH_KEY, 900)
    expect(set).toBe('---\n# the owner\'s comment\ntags: [a, b]\nstatus: "draft"\ncode-width: 900\n---\n# Body\n\ntext\n')
    expect(readBlockWidth(set, CODE_WIDTH_KEY)).toBe(900)
    expect(writeBlockWidth(set, CODE_WIDTH_KEY, 900)).toBe(set)
    const both = writeBlockWidth(set, TABLE_WIDTH_KEY, 1200)
    expect(readBlockWidth(both, TABLE_WIDTH_KEY)).toBe(1200)
    expect(readBlockWidth(both, CODE_WIDTH_KEY)).toBe(900)
    expect(writeBlockWidth(writeBlockWidth(both, TABLE_WIDTH_KEY, null), CODE_WIDTH_KEY, null)).toBe(PAGE)
    expect(writeBlockWidth(PAGE, TABLE_WIDTH_KEY, null)).toBe(PAGE)
    expect(readBlockWidth(writeBlockWidth('# Body\n', TABLE_WIDTH_KEY, 2400), TABLE_WIDTH_KEY)).toBe(2400)
  })
})
