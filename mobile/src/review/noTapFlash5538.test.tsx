// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOW, cardBlock, page, reviewSetup, type ReviewHarness } from './testing'

/**
 * YAZ-5538: no flash on a tap on the card. The card had a press look (`.review__stage:active .review__card`: the
 * accent mixed in, with a 0.12 s fade) that flashed purple on each tap, a hidden word had a press tint, and the word a
 * tap showed flashed once (`.review__flash`). All gone ("no flash: just reveal the words"); the phone's own tap
 * highlight stays off. The tap still does its work: the next hidden word, else ✕ and ✓ ring. Made-up data.
 */
const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'review.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
/** Each rule of the sheet: its selector and its body. */
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }))

let h: ReviewHarness | undefined
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  h?.unmount()
  h = undefined
  vi.useRealTimers()
})

describe('YAZ-5538: no flash on a tap on the card', () => {
  it('no :active look on the card or the stage around it, and no fade of its background', () => {
    const cardPress = rules.filter((r) => r.sel.split(',').some((s) => /:active/.test(s) && /\.review__(card|stage)\b[^ ]*$|\.review__(card|stage):active/.test(s.trim())))
    expect(cardPress.map((r) => r.sel)).toEqual([])
    const card = rules.filter((r) => r.sel === '.review__card')
    expect(card.length).toBeGreaterThan(0)
    for (const r of card) expect(r.body).not.toMatch(/transition/)
    // No press tint on a hidden word, and no flash of the word a tap shows: no rule, no keyframes.
    expect(rules.filter((r) => /\.card__blank[^,]*:active/.test(r.sel)).map((r) => r.sel)).toEqual([])
    expect(css).not.toMatch(/review__flash|review-flash/)
    // The browser's own tap highlight stays off on the whole screen.
    expect(rules.find((r) => r.sel === '.review--mochi')?.body).toMatch(/-webkit-tap-highlight-color: transparent;/)
  })

  it('the tap still works: the next hidden word, then (all shown) ✕ and ✓ ring', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', cardBlock('Q?\n---\n{{one}} {{two}}', 'NF-1, 2026-10-04T09:00Z good')) })
    expect(h.cardText()).toBe('Q?')
    await h.tap()
    expect(h.cardText()).toBe('Q? _ _')
    await h.tap()
    expect(h.cardText()).toBe('Q? one _')
    // The word simply shows: nothing on it plays (no class, no animation).
    const word = h.host.querySelector('.phone-card__body [data-hidden="0"]')!
    expect(word.className).not.toMatch(/flash/)
    expect(h.host.querySelector('.phone-card__body [class*="flash"]')).toBeNull()
    expect(h.host.querySelector('.phone-card__body .review__flash')).toBeNull()
    await h.tap()
    expect(h.cardText()).toBe('Q? one two')
    expect(h.host.querySelector('.review__answers')?.hasAttribute('data-nudge')).toBe(false)
    await h.tap()
    expect(h.host.querySelector('.review__answers')?.getAttribute('data-nudge')).toBe('a')
  })
})
