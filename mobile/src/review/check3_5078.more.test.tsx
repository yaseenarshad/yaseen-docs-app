// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UpdateLineView } from '../pwa/UpdateLine'
import type { AppMoment } from '../pwa/safeMoment'
import { RESUME_AFTER_MS } from '../pwa/safeMoment'
import type { Updates } from '../pwa/updates'
import { reviewInProgress } from './inProgress'
import { SEEN_MS } from './tapGuard'
import { NOW, cardBlock, page, reviewSetup, type ReviewHarness } from './testing'

// Checker round 3 (YAZ-5078): G1 in a correct form, VoiceOver by the tree, the "in progress" flag, the update line.
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
const OLD = '2026-10-04T09:00Z good'
const dueCards = (n: number) => Array.from({ length: n }, (_, i) => cardBlock(`Q${i + 1}?\n---\n{{w${i + 1}}}`, `DC-${i + 1}, ${OLD}`))
const ids = (hh: ReviewHarness) => hh.answers.waiting().filter((w) => w.op.kind === 'review').map((w) => w.op.id)
const real = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))
const raw = async (hh: ReviewHarness, name: string) => {
  const b = hh.button(name)
  if (b === null) throw new Error(`no ${name}`)
  await act(async () => b.click())
  await hh.settle()
}
const guarded = (hh: ReviewHarness) => hh.host.querySelector('[data-guard]') !== null

describe('checker round 3: G1, the original intent in a correct form', () => {
  it('G1c: a fast Undo; after 1 s the card and the buttons work; the next answer guards the NEXT card for SEEN_MS, then it is free again', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...dueCards(3)) })
    await raw(h, 'Remembered')
    await raw(h, 'Undo') // inside the 400 ms
    await real(1000)
    await h.settle()
    // The intent of round 2's last check: "after 1 s the card and the buttons still work".
    expect(guarded(h)).toBe(false)
    const before = h.cardText()
    await act(async () => h!.host.querySelector<HTMLElement>('.review__card')!.click())
    await h.settle()
    expect(h.cardText()).not.toBe(before)
    await raw(h, 'Remembered')
    expect(ids(h)).toEqual(['DC-1'])
    expect(h.head()).toContain('DC-2')
    // Right after the answer the guard is ON (by design): a second tap is dropped, not queued.
    expect(guarded(h)).toBe(true)
    await raw(h, 'Remembered')
    expect(ids(h)).toEqual(['DC-1'])
    // And it ENDS: the original assertion, at the right moment.
    await real(SEEN_MS + 100)
    expect(guarded(h)).toBe(false)
    await raw(h, 'Remembered')
    expect(ids(h)).toEqual(['DC-1', 'DC-2'])
  })
})

/** What a screen reader reads in the Review box, in order: aria-hidden skipped; role=img by its label; live text marked. */
function readingOrder(root: Element): string[] {
  const out: string[] = []
  const walk = (n: Node) => {
    if (n.nodeType === 3) {
      const t = (n.textContent ?? '').trim()
      if (t) out.push(t)
      return
    }
    if (!(n instanceof HTMLElement)) return
    if (n.getAttribute('aria-hidden') === 'true' || n.hidden) return
    const role = n.getAttribute('role')
    if (role === 'img') return void out.push(`[img: ${n.getAttribute('aria-label') ?? ''}]`)
    if (n.tagName === 'BUTTON') return void out.push(`[button: ${(n.getAttribute('aria-label') ?? n.textContent ?? '').trim()}]`)
    if (n.getAttribute('aria-live')) return void out.push(`[live: ${(n.textContent ?? '').trim()}]`)
    n.childNodes.forEach(walk)
  }
  walk(root)
  return out
}

describe('checker round 3: VoiceOver by the accessibility tree (YAZ-5268)', () => {
  it('V3: a card with 3 hidden words: reading order; nothing hidden early; each step announced once, only the new part', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', cardBlock('Rivers\n---\n{{Seine}} runs through {{Paris}} to the {{sea}}.\n---\nThe last side.', `RV-1, ${OLD}`)) })
    const box = h.host.querySelector('.review')!
    const live = h.host.querySelector('.review__card ~ p[aria-live]')!
    const order0 = readingOrder(box)
    console.log('[V3] order at start:', JSON.stringify(order0))
    const all = order0.join(' ')
    for (const w of ['Seine', 'Paris', 'sea', 'The last side']) expect(all).not.toContain(w)
    // Count every change of the live text.
    const said: string[] = []
    const mo = new MutationObserver(() => said.push((live.textContent ?? '').trim()))
    mo.observe(live, { childList: true, characterData: true, subtree: true })
    const steps: string[][] = []
    for (let i = 0; i < 5; i++) {
      const before = said.length
      await h.tap()
      await real(20)
      steps.push(said.slice(before))
    }
    mo.disconnect()
    console.log('[V3] announced per step:', JSON.stringify(steps))
    // Side 2 shows with 3 hidden words (no text yet), then each word, then the last side.
    const final = steps.map((s) => s.filter((x) => x !== '').at(-1) ?? '')
    console.log('[V3] the last announcement of each step:', JSON.stringify(final))
    expect(final.slice(1, 5)).toEqual(['Seine', 'Paris', 'sea', 'The last side.'])
    // 4B19: the new side is said as a screen reader reads it: the hidden words as "Hidden word", never the answers.
    expect(final[0]).not.toMatch(/Seine|Paris|sea/)
    // Once: no step announces the same text twice, and no step repeats the step before.
    for (const s of steps) expect(s.filter((x) => x !== '').length).toBeLessThanOrEqual(1)
    const orderEnd = readingOrder(box)
    console.log('[V3] order at the end:', JSON.stringify(orderEnd))
  })
})

describe('checker round 3: VoiceOver, the common card shape', () => {
  it('V4: front "Hola", back "{{Hello}}": the step to the back must not say "Hello" before the word shows', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', cardBlock('Hola\n---\n{{Hello}}', `HL-1, ${OLD}`)) })
    const live = h.host.querySelector('.review__card ~ p[aria-live]')!
    await h.tap()
    await real(20)
    console.log('[V4] after the step to the back:', JSON.stringify(live.textContent), '| the word shows:', h.cardText())
    expect(live.textContent).not.toContain('Hello')
  })
})

describe('checker round 3: "a review is in progress" (YAZ-5269)', () => {
  it('I1: a card on show: set; an answer and Inbox complete with Undo: set; Undo of the last: set; no card and no Undo: clear', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...dueCards(1)) })
    expect(reviewInProgress()).toBe(true)
    await raw(h, 'Remembered')
    expect(h.text()).toContain('Inbox complete')
    expect(reviewInProgress()).toBe(true) // only the Undo keeps it
    await real(2000)
    expect(reviewInProgress()).toBe(true) // and nothing ends it but a new session, the screen going, or Undo
    h.unmount()
    h = undefined
    expect(reviewInProgress()).toBe(false)
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', 'No cards here.') })
    expect(h.text()).toContain('Inbox complete')
    expect(reviewInProgress()).toBe(false)
  })
})

function fakeUpdates() {
  return { applied: 0, ready: () => true, tookOver: () => true, prepare: () => {}, start: async () => {}, subscribe: () => () => {}, apply(this: { applied: number }) { this.applied++ }, check: async () => {} } as unknown as Updates & { applied: number }
}

describe('checker round 3: the update line while a review is in progress on Friends', () => {
  it('U1: Restart is offered and works; a resume after 10 min does not swap; answers sent later: is Restart offered again without a tab change?', async () => {
    const updates = fakeUpdates()
    const moment: AppMoment = { phase: 'ready', routeOpen: false, tab: 'friends', downloading: false, answersWaiting: 0, reviewInProgress: true }
    let waiting = 2
    let t = 0
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const draw = () => act(async () => root.render(<UpdateLineView updates={updates} moment={moment} readWaiting={async () => waiting} now={() => t} />))
    await draw()
    await act(async () => {})
    console.log('[U1] with 2 answers waiting:', JSON.stringify(host.textContent))
    waiting = 0 // the answers are sent; nothing else changes on the screen
    await draw()
    await act(async () => {})
    const stale = host.textContent
    console.log('[U1] answers sent, no tab change:', JSON.stringify(stale), '| Restart:', host.querySelector('button') !== null)
    // A resume after 10 minutes: no swap (the review holds), and the count is read again.
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    await act(async () => void document.dispatchEvent(new Event('visibilitychange')))
    t += 2 * RESUME_AFTER_MS
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    await act(async () => void document.dispatchEvent(new Event('visibilitychange')))
    await act(async () => {})
    expect(updates.applied).toBe(0)
    console.log('[U1] after a resume:', JSON.stringify(host.textContent))
    expect(host.querySelector('button')?.textContent).toBe('Restart')
    await act(async () => host.querySelector('button')!.click())
    await act(async () => {})
    expect(updates.applied).toBe(1)
    act(() => root.unmount())
    host.remove()
  })
})
