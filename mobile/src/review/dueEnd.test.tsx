// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DueTodayEnd } from '@client/review/useCardReview'
import { NOW, inOrder, cardBlock, page, reviewSetup, type ReviewHarness } from './testing'
import { DueTodayEnd as DueEnd, ringTurns } from '@client/review/DueTodayEnd'
import { DONE_LOOK } from './ReviewView'
import { SEEN_MS } from './tapGuard'

/**
 * YAZ-5495: the end of Due today on the phone, as the Mac's Inbox (YAZ-5043; the Mac's walk-through is
 * `client/src/review/dueTodayEnd.test.tsx`). The REAL engine and answer list on the fake GitHub (`testing.ts`), the
 * real Review screen, and the Mac's shared hook under it: Due today alone, New cards alone, Forgot → the % screen →
 * Review missed cards → Due today is done → Learn new cards; All cards (missed before new); Undo in the hint line; every
 * answer in the answer list. Then the screen itself: Reduce Motion, a hidden app or tab, the ring, the lazy confetti.
 */
const burst = vi.fn((_from: Element, _o?: unknown) => () => undefined)
vi.mock('@client/review/confetti', () => ({ confettiBurst: (from: Element, o?: unknown) => burst(from, o) }))

const OLD = '2026-10-02T09:00:00.000Z good, 2026-10-12T09:00:00.000Z good'
const DUE = ['VRB-1', 'VRB-2', 'VRB-3', 'VRB-4', 'VRB-5']
const NEW = ['PLC-1', 'PLC-2', 'PLC-3']
const FILES = {
  '.yaseendocs/review.json': '{"newPerDay": 3}',
  'verbs.md': page('Verbs', ...DUE.map((id, i) => cardBlock(`Verb ${i + 1}?\n---\n{{answer}}`, `${id}, ${inOrder(OLD, i)}`))),
  'places.md': page('Places', ...NEW.map((id, i) => cardBlock(`Place ${i + 1}?\n---\n{{answer}}`, id))),
}

let reduce = false
let h: ReviewHarness | undefined
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  reduce = false
  burst.mockClear()
  window.matchMedia = ((q: string) => ({ matches: reduce && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
})
afterEach(() => {
  h?.unmount()
  h = undefined
  vi.useRealTimers()
})

const q = (sel: string) => h!.host.querySelector<HTMLElement>(sel)
const showing = () => (q('.review__card') === null ? null : h!.head())
const answer = async (rating: 'Forgot' | 'Remembered'): Promise<string> => {
  const id = showing()
  if (id === null) throw new Error(`No card on: ${h!.text()}`)
  await h!.click(rating)
  return id
}
const endText = () => (q('.due-end')?.textContent ?? '').replace(/\s+/g, ' ')
const endButtons = () => [...h!.host.querySelectorAll('.due-end button')].map((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim())
const pick = async (filter: string) => {
  await h!.click(/Choose what to review/)
  await h!.click(filter)
}
const title = () => q('.review__done-title')?.textContent ?? null
/** The answers in the phone's list (its safe write), in order. */
const listed = () => h!.answers.waiting().filter((w) => w.op.kind === 'review').map((w) => w.op.id)

describe('YAZ-5495: the end of Due today, walked (the Mac\'s YAZ-5043 flow)', () => {
  it('1. Due today alone: only the five due cards, then "Finished reviewing." (YAZ-5678, Mochi`s words) with "Learn new cards 3", which starts them', async () => {
    h = await reviewSetup(FILES)
    await pick('Due today')
    const seen: string[] = []
    while (showing() !== null) seen.push(await answer('Remembered'))
    expect(seen).toEqual(DUE)
    expect(title()).toBe('Finished reviewing.')
    expect(endText()).toContain('How about learning some new cards?')
    expect(endButtons()).toEqual(['Learn new cards 3', 'from All folders ›'])
    expect(q('.due-end')?.dataset.kind).toBe('done')
    await h.click('Learn new cards 3')
    expect(h.host.querySelector('.review__filter-label')?.textContent).toBe('New cards')
    expect(NEW).toContain(showing())
    expect(listed()).toEqual(DUE)
  })

  it('2. New cards alone: each new card once, no % screen ever stops them; its first Remembered moves it into Due today (YAZ-5610)', async () => {
    h = await reviewSetup(FILES)
    await pick('New cards')
    const seen: string[] = []
    while (showing() !== null) {
      expect(q('.due-end')).toBeNull()
      seen.push(await answer('Remembered'))
    }
    // Yaseen's rule (from Mochi): out of New cards after its first Remembered, back the same day under Due today.
    expect([...seen].sort()).toEqual(NEW)
    // YAZ-5678 (Mochi's words): the learned cards wait under Due today.
    expect(title()).toBe('Finished learning cards.')
    expect(h.text()).toContain(`Review cards ${5 + NEW.length}`)
    // YAZ-5680 check 2: the count stays at the top right, as Mochi's "4 / 4".
    expect(q('.review__place .session-count__done')?.textContent).toContain(`${NEW.length} / ${NEW.length}`)
  })

  it('3. Forgot → "You remembered 60% of cards." (YAZ-5677, Mochi`s words) with ONE button → the missed cards in order → "Due today is done." → Learn new cards', async () => {
    h = await reviewSetup(FILES)
    await pick('Due today')
    for (const r of ['Remembered', 'Forgot', 'Remembered', 'Forgot', 'Remembered'] as const) await answer(r)
    expect(showing()).toBeNull()
    expect(q('.due-end')?.dataset.kind).toBe('missed')
    expect(title()).toBe('You remembered 60% of cards.')
    expect(endText()).toContain("Now let's review the cards you missed again.")
    expect(q('.due-end__pct')?.textContent).toBe('60%')
    // No skip: one button.
    expect(endButtons()).toEqual(['Review missed cards 2'])
    // The bar (YAZ-5676, Mochi's): full, the 2 misses waiting as red at the right end (5 / 7).
    expect(['grey', 'red'].map((p) => Math.round(parseFloat(h!.host.querySelector<HTMLElement>(`.session-bar__${p}`)!.style.width)))).toEqual([71, 100])
    await h.click('Review missed cards 2')
    expect(await answer('Remembered')).toBe('VRB-2')
    expect(await answer('Remembered')).toBe('VRB-4')
    expect(showing()).toBeNull()
    // YAZ-5678: our 🎉 and green ✓, Mochi's words.
    expect(title()).toBe('Finished reviewing missed cards.')
    expect(q('.due-end .done-cheer__party')?.textContent).toBe('🎉')
    await h.click('Learn new cards 3')
    expect(NEW).toContain(showing())
    // Every answer went through the phone's answer list, none past it.
    expect(listed()).toEqual([...DUE, 'VRB-2', 'VRB-4'])
  })

  it('4. YAZ-5707 (Mochi`s E5, as the Mac): All cards is ONE run — the due cards, the new cards and their same-day reviews, the missed card at the end; no stop; then "Inbox complete"', async () => {
    h = await reviewSetup(FILES)
    const seen: string[] = []
    seen.push(await answer('Forgot'))
    while (showing() !== null && seen.length < 20) {
      expect(q('.due-end')).toBeNull()
      seen.push(await answer('Remembered'))
    }
    expect(seen.slice(0, 5)).toEqual(DUE)
    expect(seen.slice(5, 11)).toHaveLength(6)
    expect(seen.slice(5, 11).every((id) => NEW.includes(id))).toBe(true)
    expect(seen.slice(11)).toEqual(['VRB-1'])
    expect(title()).toBe('Inbox complete.')
  })
})

describe('YAZ-5662: "Inbox complete." with a 🎉, a green ✓ and one burst of confetti (the Mac\'s `DoneCheer`)', () => {
  const cheers = () => burst.mock.calls.filter(([from]) => from.classList.contains('done-cheer__party'))
  const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 400))))
  /** All of today, as in 4: one run (YAZ-5707), the five due cards, then the new cards, to "Inbox complete.". */
  const allDone = async () => {
    h = await reviewSetup(FILES)
    for (let i = 0; i < 25 && showing() !== null; i++) await answer('Remembered')
    expect(title()).toBe('Inbox complete.')
  }

  it('the 🎉 above the title, the ✓ its `::before`, today\'s line unchanged, and one lighter burst over the Review screen', async () => {
    await allDone()
    const party = q('.review__done .done-cheer__party')
    expect(party?.textContent).toBe('🎉')
    expect(party?.nextElementSibling?.className).toBe('review__done-title done-cheer__title')
    expect(q('.review__done-today')).not.toBeNull()
    await settle()
    // One burst per landing (YAZ-5678): All cards has one, "Inbox complete." (YAZ-5707: no stop before it).
    expect(cheers()).toHaveLength(1)
    const options = cheers()[0]![1] as { within: Element; maxDpr: number; pieces: number }
    expect(options.within === q('.review')).toBe(true)
    expect([options.maxDpr, options.pieces]).toEqual([2, 80])
  })

  it('once: the app to the background and back plays no second burst', async () => {
    await allDone()
    await settle()
    const visible = Object.getOwnPropertyDescriptor(document, 'visibilityState')
    const away = async (state: 'hidden' | 'visible') => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
      await act(async () => void document.dispatchEvent(new Event('visibilitychange')))
    }
    try {
      await away('hidden')
      await away('visible')
      await settle()
      expect(q('.done-cheer__party')).not.toBeNull()
      expect(cheers()).toHaveLength(1)
    } finally {
      if (visible !== undefined) Object.defineProperty(document, 'visibilityState', visible)
      else delete (document as { visibilityState?: unknown }).visibilityState
    }
  })

  it('Reduce Motion: the 🎉 still, no confetti', async () => {
    reduce = true
    await allDone()
    expect(q('.done-cheer__party')?.dataset.motion).toBe('still')
    await settle()
    expect(cheers()).toHaveLength(0)
  })
})

describe('the first pass`s end screen (the shared DueTodayEnd, YAZ-5665): waits while hidden, plays once, no confetti', () => {
  let root: Root | null = null
  let el: HTMLElement
  let hidden = false
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') })
  const end = (over: Partial<DueTodayEnd> = {}): DueTodayEnd => ({ kind: 'missed', id: `e${Math.random()}`, count: 5, remembered: 4, percent: 80, missed: 1, fresh: 3, ...over })
  const draw = (e: DueTodayEnd, shown = true) => act(() => root!.render(<div className="review"><DueEnd end={e} shown={shown} look={DONE_LOOK} onGoOn={() => undefined} /></div>))
  const motion = () => el.querySelector<HTMLElement>('.due-end')?.dataset.motion
  const sleep = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))
  beforeEach(() => {
    hidden = false
    el = document.createElement('div')
    document.body.append(el)
    root = createRoot(el)
  })
  afterEach(() => {
    act(() => root?.unmount())
    el.remove()
  })

  it('the app hidden: it waits; it plays when the app shows (YAZ-5678: the confetti is the finish screens`, never the ring`s)', async () => {
    hidden = true
    const e = end()
    draw(e)
    expect(motion()).toBe('wait')
    hidden = false
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    expect(motion()).toBe('play')
    await sleep(700)
    expect(burst).not.toHaveBeenCalled()
  })

  it('the Review tab off the screen: it waits; shown, it plays; hidden and shown again, it never starts over', async () => {
    const e = end({ kind: 'missed', percent: 60, missed: 2 })
    draw(e, false)
    expect(motion()).toBe('wait')
    draw(e, true)
    expect(motion()).toBe('play')
    draw(e, false)
    draw(e, true)
    expect(motion()).not.toBe('wait')
    await sleep(700)
    // The % screen has no confetti.
    expect(burst).not.toHaveBeenCalled()
  })

  it('a stop seen already shows still (each stop plays once)', () => {
    const e = end()
    draw(e)
    expect(motion()).toBe('play')
    act(() => root!.unmount())
    root = createRoot(el)
    draw(e)
    expect(motion()).toBe('still')
  })

  it('the ring fills by turning its two halves: the right half to the %, then the left', () => {
    expect(ringTurns(100)).toMatchObject({ '--due-r1': '45deg', '--due-r2': '225deg', '--due-d1': '300ms', '--due-d2': '300ms' })
    expect(ringTurns(50)).toMatchObject({ '--due-r1': '45deg', '--due-r2': '45deg', '--due-d1': '600ms', '--due-d2': '0ms' })
    expect(ringTurns(25)).toMatchObject({ '--due-r1': '-45deg', '--due-r2': '45deg' })
    expect(ringTurns(80)).toMatchObject({ '--due-r1': '45deg', '--due-r2': '153deg', '--due-d1': '375ms', '--due-at2': '595ms' })
    expect(ringTurns(0)).toMatchObject({ '--due-r1': '-135deg', '--due-r2': '45deg', '--due-d1': '0ms' })
  })
})

describe('smooth on a phone', () => {
  it('every keyframe of the end screen (the Mac\'s and the phone\'s one CSS, YAZ-5665) moves only `transform` and `opacity`; Reduce Motion stops each animation', async () => {
    const { readFileSync } = await import('node:fs')
    const { dirname, resolve } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../client/src/review/dueTodayEnd.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const frames = [...css.matchAll(/@keyframes [\w-]+\s*\{([\s\S]*?\}\s*)\}/g)].map((m) => m[1])
    expect(frames.length).toBeGreaterThanOrEqual(5)
    const props = new Set(frames.flatMap((f) => [...f.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1])))
    expect([...props].sort()).toEqual(['opacity', 'transform'])
    expect(css).not.toMatch(/transition\s*:/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important/)
  })
})
