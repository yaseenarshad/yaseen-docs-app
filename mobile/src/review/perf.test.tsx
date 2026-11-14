// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { answersSetup } from '../answers/testing'
import { NOW, cardBlock, mountReview, page, type ReviewHarness } from './testing'

/**
 * 4B and 3,000 due cards (3B's smoothness method): an event-loop probe, a zero timeout that runs again and again,
 * measures the longest time the thread is held while the Review tab opens with its first card, and while an answer
 * brings the next card. The made-up vault is downloaded first, outside the measure (that is 3B's own test). A hold over 50 ms is a "long task". The test takes the best of up to 5 runs, prints the
 * numbers, and skips the check only when the machine is too busy (an idle probe alone waits more than 15 ms).
 */
let h: ReviewHarness | undefined
afterEach(() => {
  h?.unmount()
  h = undefined
  vi.useRealTimers()
})

const PAGES = 300
const PER_PAGE = 10
function vault(): Record<string, string> {
  const files: Record<string, string> = { '.yaseendocs/review.json': '{}' }
  for (let p = 0; p < PAGES; p++) {
    const cards = Array.from({ length: PER_PAGE }, (_, i) => {
      const n = p * PER_PAGE + i + 1
      // Answered "good" 40 and 30 days ago: due today.
      return cardBlock(`Question ${n}?\n---\nThe answer is {{${n}}}.`, `PF-${n}, 2026-10-04T09:00Z good, 2026-10-14T09:00Z good`)
    })
    files[`deck-${String(p).padStart(3, '0')}.md`] = page(`Deck ${p}`, ...cards)
  }
  return files
}

async function probe<T>(work: () => Promise<T>): Promise<{ ms: number; longest: number; value: T }> {
  const gaps: number[] = []
  let last = performance.now()
  let probing = true
  const tick = () => {
    const t = performance.now()
    gaps.push(t - last)
    last = t
    if (probing) setTimeout(tick, 0)
  }
  setTimeout(tick, 0)
  const t0 = performance.now()
  const value = await work()
  const ms = performance.now() - t0
  probing = false
  await new Promise((r) => setTimeout(r, 0))
  return { ms, longest: Math.max(...gaps, performance.now() - last), value }
}

describe('Review with 3,000 due cards', () => {
  it('opening the tab and answering never hold the thread for 50 ms; the numbers are printed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    const files = vault()
    let open = { ms: 0, longest: Infinity }
    let answer = { ms: 0, longest: Infinity }
    let idle = { ms: 0, longest: Infinity }
    let total = ''
    for (let run = 0; run < 5 && (open.longest >= 50 || answer.longest >= 50); run++) {
      h?.unmount()
      const t = await answersSetup({ files })
      const calm = await probe(() => new Promise((r) => setTimeout(r, 100)))
      const o = await probe(() => mountReview(t))
      h = o.value
      total = h.text().match(/1 of [\d,]+/)?.[0] ?? ''
      const a = await probe(async () => {
        await act(async () => h!.button('Remembered')!.click())
        await h!.settle()
      })
      if (o.longest < open.longest) open = o
      if (a.longest < answer.longest) answer = a
      if (calm.longest < idle.longest) idle = calm
    }
    console.log(`[4B perf] idle probe ${idle.longest.toFixed(1)} ms; 3,000 due cards: open ${open.ms.toFixed(0)} ms, longest hold ${open.longest.toFixed(1)} ms; answer ${answer.ms.toFixed(0)} ms, longest hold ${answer.longest.toFixed(1)} ms; "${total}"`)
    expect(total).toBe('1 of 3000')
    expect(h!.text()).toContain('2 of 3000')
    if (idle.longest > 15 && (open.longest >= 50 || answer.longest >= 50)) {
      console.log('[4B perf] the machine is too busy to measure holds (the idle probe alone waited > 15 ms): check skipped')
      return
    }
    expect(open.longest).toBeLessThan(50)
    expect(answer.longest).toBeLessThan(50)
  }, 120_000)
})
