/**
 * Inline code punctuation wrapping (YAZ-6505): Milkdown Crepe's reset.css sets `display: inline-block`
 * on `.milkdown .ProseMirror code`, which lets Chromium break lines right before closing punctuation
 * like `)` or `.` (matching the YAZ-4991 wikilink pill bug and YAZ-5683 table cell bug).
 * This contract ensures inline code stays `display: inline` with `box-decoration-break: clone`
 * across every inline-code style preset (including `classic`).
 */
import { describe, expect, it } from 'vitest'
import appCss from '../app.css?inline'
import crepeResetCss from '@milkdown/crepe/theme/common/reset.css?inline'

const rules = (css: string) =>
  [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({
    selectors: sel.split(/,(?![^(]*\))/).map((s) => s.trim()),
    body: body.replace(/\s+/g, ' ').trim(),
  }))

const INLINE_CODE_SEL = '.milkdown .ProseMirror :not(pre) > code'

describe('inline code flows with adjacent punctuation (YAZ-6505)', () => {
  it('overrides Crepe reset.css inline-block with display: inline and cloned box-decoration', () => {
    const crepe = rules(crepeResetCss).find(({ selectors }) => selectors.includes('.milkdown .ProseMirror code'))
    expect(crepe?.body).toContain('display: inline-block;')

    const override = rules(appCss).find(({ selectors }) => selectors.includes(INLINE_CODE_SEL))
    expect(override?.body).toBe('display: inline; -webkit-box-decoration-break: clone; box-decoration-break: clone;')
  })

  it('no inline-code preset rule in app.css sets display back to inline-block', () => {
    const presetRules = rules(appCss).filter(({ selectors }) =>
      selectors.some((s) => s.includes('data-inline-code-style') && /\bcode$/.test(s)),
    )
    expect(presetRules.length).toBeGreaterThanOrEqual(7)
    for (const rule of presetRules) {
      expect(rule.body).not.toMatch(/display:\s*inline-block/)
    }
  })
})
