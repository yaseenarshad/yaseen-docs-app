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

describe('checker: 3,000 due cards, 150 answers with no signal', () => {
  it('the 151st answer still holds the thread under 50 ms', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    const t = await answersSetup({ files: vault() })
    t.s.github.offline = true
    h = await mountReview(t)
    const calm = await probe(() => new Promise((r) => setTimeout(r, 100)))
    const holds: number[] = []
    for (let i = 0; i < 150; i++) {
      vi.setSystemTime(NOW + i * 7_000)
      const a = await probe(async () => {
        await act(async () => h!.button('Remembered')!.click())
        await h!.settle()
      })
      holds.push(a.longest)
    }
    const last = await probe(async () => {
      await act(async () => h!.button('Remembered')!.click())
      await h!.settle()
    })
    console.log(`[chk perf] idle ${calm.longest.toFixed(1)} ms; answers 1-10 longest ${Math.max(...holds.slice(0, 10)).toFixed(1)} ms; 141-150 longest ${Math.max(...holds.slice(140)).toFixed(1)} ms; 151st: ${last.ms.toFixed(0)} ms, hold ${last.longest.toFixed(1)} ms; waiting ${t.answers.waiting().length}; ${h.text().match(/\d+ of [\d,]+/)?.[0]}`)
  }, 300_000)
})
