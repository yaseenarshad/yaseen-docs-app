// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { answersSetup } from '../answers/testing'
import { mount, type Harness } from '../screens/testing'
import { waitingCount } from '../status/dot'
import { saveVaultList } from '../store'
import { BRANCH, REPO, VAULT } from '../sync/testing'
import type { ReviewLink } from './link'
import { SEEN_MS } from './tapGuard'
import { NOW, cardBlock, page } from './testing'


/**
 * YAZ-5304: the Review screen with 150 answers waiting and no signal, on the REAL path a person takes: the whole app
 * (the tabs, the dot, the sheet) with the real engine and answer list on the fake GitHub, 3,000 due cards, and each
 * answer a tap on Remembered at the guard's pace (a fake clock moves `SEEN_MS` after each card shows). Then:
 *  - the list holds 150 answers (by group); the screen says "151 of 3000"; the dot and its sheet say 150;
 *  - Undo of the last one gives 149;
 *  - the next answer holds the thread less than 50 ms of CPU time (the method of `perf.test.tsx`; no skip);
 *  - nothing is left behind per card: the subscriptions, the page listeners and the timers are the same at 10 and 150;
 *  - the signal back: ONE commit carries them all.
 */
let h: Harness | undefined
afterEach(() => {
  h?.unmount()
  h = undefined
  vi.useRealTimers()
})

function vault(): Record<string, string> {
  const files: Record<string, string> = { '.yaseendocs/review.json': '{}' }
  for (let p = 0; p < 300; p++)
    files[`deck-${String(p).padStart(3, '0')}.md`] = page(
      `Deck ${p}`,
      ...Array.from({ length: 10 }, (_, i) => {
        const n = p * 10 + i + 1
        return cardBlock(`Question ${n}?\n---\nThe answer is {{${n}}}.`, `PF-${n}, 2026-10-04T09:00Z good, 2026-10-14T09:00Z good`)
      }),
    )
  return files
}

const cpu = () => {
  const u = process.threadCpuUsage()
  return (u.user + u.system) / 1000
}
async function probe(work: () => Promise<void>): Promise<number> {
  const gaps: number[] = []
  let last = cpu()
  let on = true
  const tick = () => {
    const t = cpu()
    gaps.push(t - last)
    last = t
    if (on) setTimeout(tick, 0)
  }
  setTimeout(tick, 0)
  await work()
  on = false
  await act(async () => void vi.advanceTimersByTime(1))
  return Math.max(...gaps, cpu() - last)
}

/** Counts what is subscribed and listened to now, so a leak per card shows. */
function counters(link: ReviewLink) {
  let subs = 0
  const wrap = <T extends { subscribe: (l: never) => () => void }>(o: T) => {
    const sub = o.subscribe.bind(o)
    o.subscribe = ((l: never) => {
      subs++
      const off = sub(l)
      return () => {
        subs--
        off()
      }
    }) as T['subscribe']
  }
  wrap(link.answers)
  wrap(link.engine as { subscribe: (l: never) => () => void })
  let listeners = 0
  for (const target of [window, document]) {
    const add = target.addEventListener.bind(target)
    const remove = target.removeEventListener.bind(target)
    target.addEventListener = ((type: string, fn: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions) => (listeners++, add(type, fn, opts))) as typeof add
    target.removeEventListener = ((type: string, fn: EventListenerOrEventListenerObject, opts?: boolean | EventListenerOptions) => (listeners--, remove(type, fn, opts))) as typeof remove
  }
  return () => ({ subs, listeners, timers: vi.getTimerCount() })
}

describe('YAZ-5304: the Review screen with 150 answers waiting, no signal', () => {
  it('150 taps at the guard\'s pace: the counts agree, Undo gives 149, the next answer is under 50 ms, nothing leaks, one commit', async () => {
    const t = await answersSetup({ files: vault() })
    t.s.github.offline = true
    await saveVaultList(t.store, { vaults: [{ repo: REPO, branch: BRANCH, addedAt: 0 }], open: VAULT })
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'], shouldAdvanceTime: true })
    vi.setSystemTime(NOW)
    h = await mount({ phone: { store: t.store, tokens: t.s.tokens } })
    await h.syncSet({ status: 'off', vault: VAULT, ready: true, problem: 'OFFLINE' })
    const link: ReviewLink = { engine: t.engine, answers: t.answers, store: t.store }
    const count = counters(link)
    h.sync.review = async () => link
    await h.click('Search')
    await h.click('Review')
    for (let i = 0; i < 40 && !h.text().includes('1 of 3000'); i++) await h.settle()
    expect(h.text()).toContain('1 of 3000')

    const answer = async () => {
      await act(async () => h!.button('Remembered')!.click())
      await h!.settle()
      // The person sees the next card: the guard's time passes.
      await act(async () => void vi.advanceTimersByTime(SEEN_MS + 1))
      await h!.settle()
    }
    let at10 = count()
    for (let n = 1; n <= 150; n++) {
      await answer()
      if (n === 10) at10 = count()
    }
    const at150 = count()
    console.log(`[YAZ-5304] at 10: ${JSON.stringify(at10)}; at 150: ${JSON.stringify(at150)}`)
    expect(at150).toEqual(at10)

    // The counts agree: the list (by group), the screen, the dot and its sheet.
    expect(waitingCount(t.answers.waiting())).toBe(150)
    expect(h.text()).toContain('151 of 3000')
    const dot = h.host.querySelector('.sync-status')!
    expect(dot.getAttribute('aria-label')).toBe('Sync status: 150 answers waiting · no signal')
    await act(async () => (dot as HTMLElement).click())
    await h.settle()
    const sheet = h.host.querySelector('[role="dialog"]')?.textContent ?? ''
    expect(sheet).toContain('150 answers waiting')
    await act(async () => h!.button(/^Close/)?.click())
    await h.settle()

    // Undo of the last one: 149.
    await h.click('Undo')
    expect(waitingCount(t.answers.waiting())).toBe(149)
    expect(h.text()).toContain('150 of 3000')
    expect(h.host.querySelector('.sync-status')!.getAttribute('aria-label')).toBe('Sync status: 149 answers waiting · no signal')
    await answer() // 150 again

    // The next answer with 150 waiting: CPU time of this thread, no skip.
    const longest = await probe(async () => {
      await act(async () => h!.button('Remembered')!.click())
      await h!.settle()
    })
    console.log(`[YAZ-5304] the 151st answer: longest hold ${longest.toFixed(1)} ms of CPU`)
    expect(longest).toBeLessThan(50)
    expect(waitingCount(t.answers.waiting())).toBe(151)

    // The signal comes back: ONE commit carries them all.
    const before = t.commits()
    t.s.github.offline = false
    await act(async () => {
      t.answers.online()
      await t.answers.idle()
    })
    expect(t.commits() - before).toBe(1)
    expect(t.answers.waiting()).toEqual([])
  }, 300_000)
})
