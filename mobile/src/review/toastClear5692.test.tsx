// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOW, cardBlock, page, reviewSetup, type ReviewHarness } from './testing'

/**
 * YAZ-5692 (parity gap 2 of YAZ-5687, the Mac's YAZ-5680 fix 4): the phone's "Added card to reviews · Undo" never covers
 * the hint line and its Undo. The toast hangs off the hint line itself (its top edge, `bottom: 100%`), so whatever the
 * controls' height (two or four buttons, the update bar), it sits above the line: on a card and on a finish screen.
 * The geometry at 320 / 375 / 390 px is proved in the fixtures build (the Linear result). Made-up data only.
 */
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

const q = (sel: string) => h!.host.querySelector<HTMLElement>(sel)
const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'review.css'), 'utf8')
const rule = (selector: string): string | undefined => {
  const at = css.indexOf(`${selector} {`)
  return at < 0 ? undefined : css.slice(at, css.indexOf('}', at))
}

describe('YAZ-5692: the toast sits above the hint line, never over it', () => {
  it('on a card: the toast is the hint line`s own, the line keeps its words and its Undo', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', cardBlock('New?\n---\n{{n}}', 'LN-1'), cardBlock('Other?\n---\n{{o}}', 'LN-2')) })
    await h.click('Remembered')
    const toast = q('.learned-toast')
    expect(toast?.parentElement?.classList.contains('review__hint')).toBe(true)
    expect(q('.review__hint .review__last .review__undo')).not.toBeNull()
  })

  it('on a finish screen too (New cards, its last card learned)', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', cardBlock('New?\n---\n{{n}}', 'LN-1')) })
    // New cards alone: its last card learned is "Finished learning cards." (under All cards it comes back to review).
    await h.click(/Choose what to review/)
    await h.click(/^New cards$/)
    await h.seen()
    await h.click('Remembered')
    expect(q('.review__done')).not.toBeNull()
    expect(q('.learned-toast')?.parentElement?.classList.contains('review__hint')).toBe(true)
    expect(q('.review__hint .review__last .review__undo')).not.toBeNull()
  })

  it('the CSS: the hint line holds it; its bottom is the line`s top edge; no fixed number over the controls', () => {
    expect(rule('.review__hint')).toMatch(/position: relative;/)
    expect(rule('.review__hint > .learned-toast')).toMatch(/bottom: calc\(100% \+ \d+px\);/)
    expect(rule('.review > .learned-toast')).toBeUndefined()
  })
})
