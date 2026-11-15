/**
 * YAZ-5515 X2: sync's line merge of a page, after git's own merge said no. Two edits on DIFFERENT lines merge, even
 * when the lines are next to each other (git calls that a conflict); only the SAME line changed two ways is a clash.
 * `shared/lineMerge.ts`; made-up pages only.
 */
import { describe, expect, it } from 'vitest'
import { mergeLinesApart } from '@shared/lineMerge'

describe('mergeLinesApart', () => {
  it('a phone tick or card line write merges with a Mac edit of the adjacent line without a conflict copy', () => {
    // M1: the phone ticks One, the Mac edits Two (the next line).
    expect(mergeLinesApart('# List\n\n- [ ] One\n- [ ] Two\n', '# List\n\n- [x] One\n- [ ] Two\n', '# List\n\n- [ ] One\n- [ ] Two edited\n')).toBe('# List\n\n- [x] One\n- [ ] Two edited\n')
    // M7: the phone ticks One, the Mac ticks Two.
    expect(mergeLinesApart('- [ ] One\n- [ ] Two\n', '- [x] One\n- [ ] Two\n', '- [ ] One\n- [x] Two\n')).toBe('- [x] One\n- [x] Two\n')
    // M9: the phone answers the card, the Mac edits the line right below its card line.
    const base = '```card\nQ\n```\n<!-- card: NC-1 -->\nNext para\n'
    expect(mergeLinesApart(base, base.replace('NC-1 -->', 'NC-1, 2026-11-14T06:01Z good -->'), base.replace('Next para', 'Next para edited'))).toBe('```card\nQ\n```\n<!-- card: NC-1, 2026-11-14T06:01Z good -->\nNext para edited\n')
    // The Mac adds a line right below the phone's tick; and right above it.
    expect(mergeLinesApart('- [ ] One\n- [ ] Two\n', '- [x] One\n- [ ] Two\n', '- [ ] One\n- [ ] New\n- [ ] Two\n')).toBe('- [x] One\n- [ ] New\n- [ ] Two\n')
    expect(mergeLinesApart('- [ ] One\n- [ ] Two\n', '- [ ] One\n- [x] Two\n', '- [ ] One\n- [ ] New\n- [ ] Two\n')).toBe('- [ ] One\n- [ ] New\n- [x] Two\n')
    // A line the Mac deleted next to the phone's.
    expect(mergeLinesApart('a\nb\nc\n', 'a\nB\nc\n', 'a\nb\n')).toBe('a\nB\n')
  })

  it('the SAME line changed two ways, or two different lines added at one place: a clash (null)', () => {
    expect(mergeLinesApart('- [ ] One\n', '- [x] One\n', '- [ ] One edited\n')).toBeNull()
    expect(mergeLinesApart('a\nb\n', 'a\nX\nb\n', 'a\nY\nb\n')).toBeNull()
    // A line one side deleted and the other changed.
    expect(mergeLinesApart('a\nb\nc\n', 'a\nB\nc\n', 'a\nc\n')).toBeNull()
  })

  it('the same edit on both sides is taken once; one side unchanged gives the other', () => {
    expect(mergeLinesApart('a\nb\n', 'a\nB\n', 'a\nB\n')).toBe('a\nB\n')
    expect(mergeLinesApart('a\nb\nc\n', 'A\nb\nC\n', 'A\nb\nc\n')).toBe('A\nb\nC\n')
    expect(mergeLinesApart('a\n', 'a\n', 'b\n')).toBe('b\n')
  })

  it('each line keeps its own line end; a last line with no line end is a line', () => {
    expect(mergeLinesApart('a\r\nb\nc', 'A\r\nb\nc', 'a\r\nb\nC')).toBe('A\r\nb\nC')
    expect(mergeLinesApart('a\nb', 'a\nb\nc', 'A\nb')).toBe('A\nb\nc')
  })

  it('agrees with a plain apply of each side on random edits of different lines', () => {
    let seed = 7
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed % n
    }
    for (let run = 0; run < 2000; run++) {
      const base = Array.from({ length: 2 + rnd(12) }, (_, i) => `line ${i % 4}\n`) // repeats on purpose
      const at = rnd(base.length)
      const other = (at + 1 + rnd(base.length - 1)) % base.length
      const theirs = base.map((l, i) => (i === at ? `T${run}\n` : l))
      const mine = base.map((l, i) => (i === other ? `M${run}\n` : l))
      const want = base.map((l, i) => (i === at ? `T${run}\n` : i === other ? `M${run}\n` : l)).join('')
      expect(mergeLinesApart(base.join(''), theirs.join(''), mine.join(''))).toBe(want)
    }
  })

  it('a 2 MB page with one edit on each side merges fast', () => {
    const base = Array.from({ length: 60000 }, (_, i) => `Line ${i} of the long page, with some words.\n`).join('')
    const theirs = base.replace('Line 30000 ', 'Line 30000 (phone) ')
    const mine = base.replace('Line 30001 ', 'Line 30001 (mac) ')
    const t0 = Date.now()
    const out = mergeLinesApart(base, theirs, mine)
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(out).toBe(base.replace('Line 30000 ', 'Line 30000 (phone) ').replace('Line 30001 ', 'Line 30001 (mac) '))
  })
})
