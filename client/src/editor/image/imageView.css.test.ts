/**
 * Image node view CSS specificity and alignment rules (YAZ-6422), read as text (jsdom computes no imported sheet):
 * lone non-board, non-folded pictures align via --image-align-start/end, bullet-nested pictures stay flush left
 * unless explicitly aligned, and data-align overrides win without `!important`.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { beats, rules, specificity } from '../cssRules'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const imageCss = read('./imageView.css')

const LONE_IMAGE_SELECTOR = ".milkdown p:has(> .image-view:only-child:not(.board-embed):not([data-outline-folded-image='true'])) > .image-view"

describe('imageView.css', () => {
  it('YAZ-6422: lone pictures align via --image-align-start/end, guard bullet nesting, and honor data-align overrides', () => {
    const baseInline = rules(imageCss, '.milkdown .image-view').find((r) => r.selector === '.milkdown .image-view')
    expect(baseInline).toBeDefined()

    const lone = rules(imageCss, LONE_IMAGE_SELECTOR).find(
      (r) =>
        r.selector === LONE_IMAGE_SELECTOR &&
        /display:\s*block/.test(r.body) &&
        /width:\s*fit-content/.test(r.body) &&
        /margin-inline:\s*var\(--image-align-start,\s*0\)\s*var\(--image-align-end,\s*auto\)/.test(r.body),
    )
    expect(lone).toBeDefined()
    expect(lone!.body).not.toContain('!important')
    expect(beats(specificity(lone!.selector), specificity(baseInline!.selector))).toBe(true)

    const bulletGuard = rules(imageCss, 'li p:has(> .image-view:only-child:not(.board-embed):not([data-outline-folded-image=\'true\'])) > .image-view:not([data-align])').find((r) =>
      /margin-inline:\s*0 auto/.test(r.body),
    )
    expect(bulletGuard).toBeDefined()
    expect(bulletGuard!.body).not.toContain('!important')
    expect(beats(specificity(bulletGuard!.selector), specificity(lone!.selector))).toBe(true)

    for (const [align, expected] of [
      ['left', /margin-inline:\s*0 auto/],
      ['center', /margin-inline:\s*auto/],
      ['right', /margin-inline:\s*auto 0/],
    ] as const) {
      const override = rules(imageCss, `[data-align='${align}']`).find((r) => expected.test(r.body))
      expect(override).toBeDefined()
      expect(override!.body).not.toContain('!important')
      expect(beats(specificity(override!.selector), specificity(lone!.selector))).toBe(true)
      expect(imageCss.indexOf(override!.selector)).toBeGreaterThan(imageCss.indexOf(lone!.selector))
    }
  })
})
