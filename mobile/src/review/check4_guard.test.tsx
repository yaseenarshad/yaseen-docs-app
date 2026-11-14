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

describe('check4: the 400 ms count from the drawing, when the OLD card is drawn again during the save or before the next card', () => {
  for (const when of ['during the save', 'after the save, while the next card reads'] as const)
    it(`a sync pass changes the shown card ${when}: taps stay dropped until 400 ms after the NEXT card is on the screen`, async () => {
      s = await screen({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...cards(3)) })
      const text = s.t.answers.text.bind(s.t.answers)
      let slow = false
      ;(s.t.answers as { text: unknown }).text = async (path: string) => {
        if (slow) await new Promise((r) => setTimeout(r, 600))
        return text(path)
      }
      if (when === 'during the save') slowAdd(s, 300)
      const t0 = performance.now()
      await s.press('Remembered')
      await real(when === 'during the save' ? 50 : 20)
      // The Mac changes KC-1 (the card on the screen) and the phone syncs it.
      await s.t.s.git.push({ 'p.md': page('P', ...cards(3).map((c) => c.replace('Q1?', 'Q1 changed?'))) })
      await act(async () => {
        await s!.t.engine.syncNow()
        await s!.t.engine.idle()
      })
      slow = true
      let shown = -1
      let free = -1
      const log: string[] = []
      for (let i = 0; i < 400 && (shown < 0 || free < 0); i++) {
        await real(5)
        if (i % 20 === 0) log.push(`${(performance.now() - t0).toFixed(0)}:${s.head()}:${s.guarded() ? 'G' : 'free'}`)
        if (shown < 0 && s.head().includes('KC-2')) shown = performance.now() - t0
        if (free < 0 && shown >= 0 && !s.guarded()) free = performance.now() - t0
        if (free < 0 && shown < 0 && !s.guarded()) log.push(`FREE BEFORE NEXT CARD at ${(performance.now() - t0).toFixed(0)} on ${s.head()}`)
      }
      console.log(`[check4 ${when}] next card at ${shown.toFixed(0)} ms; free at ${free.toFixed(0)} ms; after show ${(free - shown).toFixed(0)} ms; reviews ${JSON.stringify(s.reviews())}\n  ${log.slice(0, 30).join(' | ')}`)
      expect(log.filter((l) => l.startsWith('FREE BEFORE'))).toEqual([])
      expect(free - shown).toBeGreaterThanOrEqual(380)
      expect(s.reviews()).toEqual(['KC-1'])
    })
})
