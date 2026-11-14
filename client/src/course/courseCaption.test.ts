/**
 * The caption is never cut (YAZ-5345). jsdom has no layout, so the test reads the course's CSS: the caption keeps room
 * for two lines and grows (a `min-height`, no fixed `height`, nothing hidden), and the stage above it gives up the
 * height (`flex: 1`). Then the longest captions of the script show whole in the caption line.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COURSE } from './script'

const css = readFileSync(resolve(__dirname, 'course.css'), 'utf8')
/** Every block of a selector (the plain one and the narrow window's), as its declarations. */
const blocks = (selector: string): string[] => [...css.matchAll(new RegExp(`(?:^|\\n)\\s*${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1])

describe('the caption shows whole (YAZ-5345)', () => {
  it('grows with its lines: a min-height, no fixed height, no hidden overflow, no clamp; the font stays readable', () => {
    const caption = blocks('.course__caption')
    expect(caption.length).toBe(2)
    for (const rule of caption) {
      expect(rule).toMatch(/min-height:/)
      expect(rule).not.toMatch(/(^|[^-])height:/)
      expect(rule).not.toMatch(/overflow:\s*hidden|line-clamp|text-overflow/)
      const size = Number(/font-size:\s*(\d+(?:\.\d+)?)px/.exec(rule)?.[1] ?? 17)
      expect(size).toBeGreaterThanOrEqual(16)
    }
    expect(caption[0]).toMatch(/flex:\s*none/)
  })

  it('the stage above gives up the height the caption needs', () => {
    expect(blocks('.course__stage')[0]).toMatch(/flex:\s*1/)
  })

  it('the longest captions of the script are whole text, with no cut of their own (c6-08 is the longest)', () => {
    const clips = COURSE.flatMap((ch) => ch.clips).sort((a, b) => b.text.length - a.text.length)
    expect(clips[0].id).toBe('c6-08')
    // At the caption's width (640 px, 17 px type: about 75 characters a line) the longest needs three lines; the
    // narrow window (about 40 a line) needs five. The rule above lets the line grow to each.
    expect(Math.ceil(clips[0].text.length / 75)).toBe(3)
  })
})
