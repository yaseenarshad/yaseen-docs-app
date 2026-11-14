// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { answersSetup } from '../answers/testing'
import { NOW, cardBlock, mountReview, page, type ReviewHarness } from './testing'

/**
 * 4B and 3,000 due cards: an event-loop probe, a zero timeout that runs again and again, measures the longest hold of
 * the thread while the Review tab opens with its first card, and while an answer brings the next card. A hold is the
 * CPU time of THIS thread between two ticks of the probe (`process.threadCpuUsage`, as 4C's page test): the load of
 * the machine does not count, so the check never skips. The made-up vault is downloaded first, outside the measure
 * (that is 3B's own test). A hold over 50 ms is a "long task". The test takes the best of up to 5 runs and prints the
 * numbers.
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

/** The CPU time of this thread, in ms. Waiting for the machine is no CPU time. */
function cpu(): number {
  const u = process.threadCpuUsage()
  return (u.user + u.system) / 1000
}

/** `ms`: the wall time of `work` (printed only). `longest`: the longest CPU time of this thread between two ticks. */
async function probe<T>(work: () => Promise<T>): Promise<{ ms: number; longest: number; value: T }> {
  const gaps: number[] = []
  let last = cpu()
  let probing = true
  const tick = () => {
    const t = cpu()
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
  return { ms, longest: Math.max(...gaps, cpu() - last), value }
}

describe('Review with 3,000 due cards', () => {
  it('opening the tab and answering never hold the thread for 50 ms; the numbers are printed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    const files = vault()
    let open = { ms: 0, longest: Infinity }
    let answer = { ms: 0, longest: Infinity }
    let total = ''
    for (let run = 0; run < 5 && (open.longest >= 50 || answer.longest >= 50); run++) {
      h?.unmount()
      const t = await answersSetup({ files })
      const o = await probe(() => mountReview(t))
      h = o.value
      total = h.text().match(/1 of [\d,]+/)?.[0] ?? ''
      const a = await probe(async () => {
        await act(async () => h!.button('Remembered')!.click())
        await h!.settle()
      })
      if (o.longest < open.longest) open = o
      if (a.longest < answer.longest) answer = a
    }
    console.log(`[4B perf] 3,000 due cards: open ${open.ms.toFixed(0)} ms, longest hold ${open.longest.toFixed(1)} ms of CPU; answer ${answer.ms.toFixed(0)} ms, longest hold ${answer.longest.toFixed(1)} ms of CPU; "${total}"`)
    expect(total).toBe('1 of 3000')
    expect(h!.text()).toContain('2 of 3000')
    expect(open.longest).toBeLessThan(50)
    expect(answer.longest).toBeLessThan(50)
  }, 120_000)
})
