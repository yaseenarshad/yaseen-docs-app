// @vitest-environment jsdom
import { SEEN_MS } from './tapGuard'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SAME_WORD } from '@client/vault/unitWordText'
import { answersSetup } from '../answers/testing'
import { VAULT } from '../sync/testing'
import { reviewInProgress } from './inProgress'
import type { ReviewLink } from './link'
import { ReviewView } from './ReviewView'
import { NOW, cardBlock, page } from './testing'

// Checker round 3 (YAZ-5078): each cell of the tap guard's state table on the REAL Review screen (real engine and
// answer list on the fake GitHub), with real timers. Made-up data only.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.setConfig({ testTimeout: 30_000 })

const OLD = '2026-10-04T09:00Z good'
const cards = (n: number, p = 'KC') => Array.from({ length: n }, (_, i) => cardBlock(`Q${i + 1}?\n---\n{{w${i + 1}}}`, `${p}-${i + 1}, ${OLD}`))
const real = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))

async function screen(files: Record<string, string>) {
  const t = await answersSetup({ files })
  const link: ReviewLink = { engine: t.engine, answers: t.answers, store: t.store }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const props = { link, vault: VAULT, vaultName: 'vault', unit: SAME_WORD, open: () => {}, shown: true }
  const render = async (over: Partial<typeof props> = {}) => {
    Object.assign(props, over)
    await act(async () => root.render(createElement(ReviewView, { ...props })))
  }
  const settle = async () => {
    for (let i = 0; i < 6; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
  }
  await render()
  await settle()
  const named = (el: Element) => (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim()
  const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => named(b) === name) ?? null
  const press = async (name: string) => {
    const b = button(name)
    if (b === null) throw new Error(`no ${name} on ${host.textContent}`)
    await act(async () => b.click())
  }
  const tapCard = async () => act(async () => host.querySelector<HTMLElement>('.review__card')!.click())
  return {
    t,
    host,
    render,
    settle,
    button,
    press,
    tapCard,
    guarded: () => host.querySelector('[data-guard]') !== null,
    head: () => (host.querySelector('.review__head')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    cardText: () => (host.querySelector('.phone-card__body')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    reviews: () => t.answers.waiting().filter((w) => w.op.kind === 'review').map((w) => w.op.id),
    text: () => (host.textContent ?? '').replace(/\s+/g, ' '),
    unmount: () => {
      act(() => root.unmount())
      host.remove()
    },
  }
}
type S = Awaited<ReturnType<typeof screen>>
let s: S | undefined
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  s?.unmount()
  s = undefined
  vi.useRealTimers()
})

/** The answer list's write waits `ms` (a slow disk). */
function slowAdd(x: S, ms: number) {
  const add = x.t.answers.add.bind(x.t.answers)
  ;(x.t.answers as { add: unknown }).add = async (...a: Parameters<typeof add>) => {
    await new Promise((r) => setTimeout(r, ms))
    return add(...a)
  }
  return () => void ((x.t.answers as { add: unknown }).add = add)
}

describe('checker round 3: the guard, cell by cell, on the screen', () => {
  it('C1 answering: a tap on the card and on each answer button is dropped while the save runs; then ready', async () => {
    s = await screen({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...cards(3)) })
    slowAdd(s, 300)
    await s.press('Remembered')
    await real(50)
    expect(s.guarded()).toBe(true)
    const before = s.cardText()
    await s.tapCard()
    await s.press('Forgot')
    await s.press('Remembered')
    expect(s.cardText()).toBe(before)
    await real(300)
    await s.settle()
    expect(s.head()).toContain('KC-2')
    expect(s.guarded()).toBe(true) // settling on K-2
    await real(450)
    expect(s.guarded()).toBe(false)
    expect(s.reviews()).toEqual(['KC-1'])
  })

  it('C2 settling: how long taps wait after the next card is ON THE SCREEN, when its text reads slowly (600 ms)', async () => {
    s = await screen({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...cards(3)) })
    const text = s.t.answers.text.bind(s.t.answers)
    let slow = false
    ;(s.t.answers as { text: unknown }).text = async (path: string) => {
      if (slow) await new Promise((r) => setTimeout(r, 600))
      return text(path)
    }
    slow = true
    const t0 = performance.now()
    await s.press('Remembered')
    let shown = -1
    let free = -1
    for (let i = 0; i < 300 && (shown < 0 || free < 0); i++) {
      await real(5)
      if (shown < 0 && s.head().includes('KC-2')) shown = performance.now() - t0
      if (free < 0 && !s.guarded()) free = performance.now() - t0
    }
    console.log(`[C2] next card on the screen at ${shown.toFixed(0)} ms; taps free at ${free.toFixed(0)} ms; free after show ${(free - shown).toFixed(0)} ms`)
    // 4B20: the guard must hold SEEN_MS after the next card is on the screen (the double tap is dropped either way).
    expect(free - shown).toBeGreaterThanOrEqual(380)
  })

  it('C3 answered, no card (the last card): Inbox complete, no guard, the review stays "in progress" while Undo remains; Undo brings the card back, ready', async () => {
    s = await screen({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...cards(1)) })
    expect(reviewInProgress()).toBe(true)
    await s.press('Remembered')
    await s.settle()
    expect(s.text()).toContain('Inbox complete')
    expect(s.guarded()).toBe(false)
    expect(reviewInProgress()).toBe(true) // Undo remains
    await s.press('Undo')
    await s.settle()
    expect(s.head()).toContain('KC-1')
    expect(s.guarded()).toBe(false)
    await s.press('Remembered')
    await s.settle()
    expect(s.reviews()).toEqual(['KC-1'])
  })

  it('C4 a failed save, then Undo of the answer before: the card stays, ready at once; the earlier answer can still be undone?', async () => {
    s = await screen({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...cards(3)) })
    await s.press('Remembered')
    await s.settle()
    await real(450)
    const add = s.t.answers.add.bind(s.t.answers)
    ;(s.t.answers as { add: unknown }).add = async () => {
      throw new Error('the disk is full')
    }
    await s.press('Remembered')
    await s.settle()
    expect(s.head()).toContain('KC-2')
    expect(s.guarded()).toBe(false)
    console.log('[C4] after the failed save: notice', JSON.stringify(s.host.querySelector('.review__notice')?.textContent), '| line', JSON.stringify(s.host.querySelector('.review__last')?.textContent))
    ;(s.t.answers as { add: unknown }).add = add
    await s.press('Remembered')
    await s.settle()
    expect(s.reviews()).toEqual(['KC-1', 'KC-2'])
  })

  for (const ms of [0, 1, 399, 400, 401])
    it(`C5 settling + Undo at ${ms} ms, then Undo again (none to give): ready, the card answers once`, async () => {
      s = await screen({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...cards(3)) })
      await s.press('Remembered')
      await s.settle()
      if (ms > 0) await real(ms)
      await s.press('Undo')
      await s.settle()
      expect(s.head()).toContain('KC-1')
      expect(s.guarded()).toBe(false)
      expect(s.button('Undo')).toBeNull() // Undo then Undo: no second Undo on the screen
      await s.tapCard()
      await s.settle()
      expect(s.cardText()).toContain('w1')
      await s.press('Remembered')
      await s.settle()
      expect(s.reviews()).toEqual(['KC-1'])
    })

  it('C6 settling + the tab hidden, then shown: ready on show; a tap acts', async () => {
    s = await screen({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...cards(3)) })
    await s.press('Remembered')
    await s.settle()
    expect(s.guarded()).toBe(true)
    await s.render({ shown: false })
    await s.render({ shown: true })
    await s.settle()
    expect(s.guarded()).toBe(false)
    await s.press('Remembered')
    await s.settle()
    expect(s.reviews()).toEqual(['KC-1', 'KC-2'])
  })

  it('C7 answering + the tab hidden and shown DURING the save (300 ms): what the next card gets', async () => {
    s = await screen({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...cards(3)) })
    slowAdd(s, 300)
    await s.press('Remembered')
    await real(50)
    await s.render({ shown: false })
    await s.render({ shown: true })
    await real(10)
    console.log('[C7] after hide+show during the save: guarded', s.guarded(), 'head', s.head())
    // A tap now: the guard is ready; the hook is busy, so it writes nothing.
    await s.press('Remembered')
    await real(400)
    await s.settle()
    const head = s.head()
    const guardedAtShow = s.guarded()
    console.log('[C7] the save ended: head', head, '| guarded', guardedAtShow, '| reviews', JSON.stringify(s.reviews()))
    expect(s.reviews()).toEqual(['KC-1'])
    // The next card came with no settling: a tap now answers it at once.
    await s.press('Remembered')
    await real(400)
    await s.settle()
    console.log('[C7] a tap at once on', head, '→ reviews', JSON.stringify(s.reviews()))
    // (builder, YAZ-5315) The rule: the tap on KC-2 within 400 ms of its drawing is dropped; the save kept `answering`
    // through the hide and show, so KC-2 got its 400 ms. The bug was that this tap answered KC-2.
    expect(s.reviews()).toEqual(['KC-1'])
    expect(guardedAtShow).toBe(true)
    await real(SEEN_MS + 50)
    await s.press('Remembered')
    await real(400) // the write takes 300 ms here
    await s.settle()
    expect(s.reviews()).toEqual(['KC-1', 'KC-2'])
  })

  it('C8 ready + Undo, ready + hide/show: still ready; the card answers', async () => {
    s = await screen({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...cards(3)) })
    await s.press('Remembered')
    await s.settle()
    await real(450)
    expect(s.guarded()).toBe(false)
    await s.render({ shown: false })
    await s.render({ shown: true })
    await s.press('Undo')
    await s.settle()
    expect(s.guarded()).toBe(false)
    await s.press('Remembered')
    await s.settle()
    expect(s.reviews()).toEqual(['KC-1'])
  })

  it('C9 a sync pass changes the card on show (its text on GitHub) during settling and in ready: never stuck, the right card answers', async () => {
    s = await screen({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...cards(3)) })
    await s.press('Remembered')
    await s.settle()
    expect(s.guarded()).toBe(true)
    const files = page('P', ...cards(3).map((c) => c.replace('{{w2}}', '{{w2 changed}}')))
    await s.t.s.git.push({ 'p.md': files })
    await act(async () => {
      await s!.t.engine.syncNow()
      await s!.t.engine.idle()
    })
    await s.settle()
    await real(450)
    await s.settle()
    expect(s.guarded()).toBe(false)
    expect(s.head()).toContain('KC-2')
    await s.tapCard()
    await s.settle()
    console.log('[C9] K-2 after the pass:', JSON.stringify(s.cardText()))
    await s.press('Remembered')
    await s.settle()
    expect(s.reviews()).toEqual(['KC-1', 'KC-2'])
  })

  it('C10 the day changes (local midnight) during settling: ready after 400 ms', async () => {
    vi.setSystemTime(new Date(2026, 10, 13, 23, 59, 59, 700).getTime())
    s = await screen({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...cards(3)) })
    await s.press('Remembered')
    await s.settle()
    vi.setSystemTime(new Date(2026, 10, 14, 0, 0, 0, 100).getTime())
    await real(450)
    await s.settle()
    expect(s.guarded()).toBe(false)
    await s.press('Remembered')
    await s.settle()
    expect(s.reviews().length).toBe(2)
  })

  it('C11 a vault switch (a new vault key) during settling, and the session ending (review off): the new screen is ready; the flag follows', async () => {
    s = await screen({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...cards(3)) })
    await s.press('Remembered')
    await s.settle()
    expect(s.guarded()).toBe(true)
    expect(reviewInProgress()).toBe(true)
    await s.render({ vault: 'other/vault@main' })
    await s.settle()
    console.log('[C11] after the switch: flag', reviewInProgress(), 'text', s.text().slice(0, 60))
    await s.render({ vault: VAULT })
    await s.settle()
    expect(s.guarded()).toBe(false)
    expect(reviewInProgress()).toBe(true) // a card shows again
    s.unmount()
    s = undefined
    expect(reviewInProgress()).toBe(false) // the erase or the sign-out takes the screen away
  })

  it('C12 a double tap with 0 ms between the two taps (two events, React draws between): one answer', async () => {
    s = await screen({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...cards(3)) })
    const b = s.button('Remembered')!
    await act(async () => b.click())
    await act(async () => b.click())
    await real(1000)
    await s.settle()
    expect(s.reviews()).toEqual(['KC-1'])
  })
})
