// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DueTodayEnd } from '@client/review/useCardReview'
import { NOW, cardBlock, page, reviewSetup, type ReviewHarness } from './testing'
import { DueEnd, ringTurns } from './DueEnd'
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

const OLD = '2026-10-02T09:00Z good, 2026-10-12T09:00Z good'
const DUE = ['VRB-1', 'VRB-2', 'VRB-3', 'VRB-4', 'VRB-5']
const NEW = ['PLC-1', 'PLC-2', 'PLC-3']
const FILES = {
  '.yaseendocs/review.json': '{"newPerDay": 3}',
  'verbs.md': page('Verbs', ...DUE.map((id, i) => cardBlock(`Verb ${i + 1}?\n---\n{{answer}}`, `${id}, ${OLD}`))),
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
  it('1. Due today alone: only the five due cards, then "Due today is done." with "Learn new cards 3", which starts them', async () => {
    h = await reviewSetup(FILES)
    await pick('Due today')
    const seen: string[] = []
    while (showing() !== null) seen.push(await answer('Remembered'))
    expect(seen).toEqual(DUE)
    expect(title()).toBe('Due today is done.')
    expect(endText()).toContain('You remembered 100% of 5 cards.')
    expect(endButtons()).toEqual(['Learn new cards 3', 'from All folders ›'])
    expect(q('.due-end')?.dataset.kind).toBe('done')
    await h.click('Learn new cards 3')
    expect(h.text()).toContain('New cards ▾')
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
    expect(title()).toBe('No new cards left.')
    expect(h.text()).toContain(`${5 + NEW.length} more in All cards`)
  })

  it('3. Forgot → "You remembered 60% of 5 cards." with ONE button → the missed cards in order → "Due today is done." → Learn new cards', async () => {
    h = await reviewSetup(FILES)
    await pick('Due today')
    for (const r of ['Remembered', 'Forgot', 'Remembered', 'Forgot', 'Remembered'] as const) await answer(r)
    expect(showing()).toBeNull()
    expect(q('.due-end')?.dataset.kind).toBe('missed')
    expect(title()).toBe('You remembered 60% of 5 cards.')
    expect(endText()).toContain('2 cards to look at again while they are fresh.')
    expect(q('.due-end__pct')?.textContent).toBe('60%')
    // No skip: one button.
    expect(endButtons()).toEqual(['Review missed cards 2'])
    // The step bar keeps its grey and red.
    expect([...h.host.querySelectorAll('.review__step[data-answer]')].map((s) => (s as HTMLElement).dataset.answer)).toEqual(['remembered', 'forgot', 'remembered', 'forgot', 'remembered'])
    await h.click('Review missed cards 2')
    expect(await answer('Remembered')).toBe('VRB-2')
    expect(await answer('Remembered')).toBe('VRB-4')
    expect(showing()).toBeNull()
    expect(title()).toBe('Due today is done.')
    // The % counts first answers only.
    expect(endText()).toContain('You remembered 60% of 5 cards.')
    expect(q('.due-end__check')).not.toBeNull()
    await h.click('Learn new cards 3')
    expect(NEW).toContain(showing())
    // Every answer went through the phone's answer list, none past it.
    expect(listed()).toEqual([...DUE, 'VRB-2', 'VRB-4'])
  })

  it('4. All cards: a missed due card comes back BEFORE the new cards, with a stop after each pass; then "Inbox complete"', async () => {
    h = await reviewSetup(FILES)
    const seen: string[] = []
    seen.push(await answer('Forgot'))
    for (let i = 0; i < 4; i++) seen.push(await answer('Remembered'))
    expect(seen).toEqual(DUE)
    expect(title()).toBe('You remembered 80% of 5 cards.')
    await h.click('Review missed cards 1')
    expect(await answer('Remembered')).toBe('VRB-1')
    // The break before the new cards.
    expect(title()).toBe('Due today is done.')
    await h.click('Learn new cards 3')
    expect(h.text()).toContain('All cards ▾')
    while (showing() !== null && seen.length < 20) seen.push(await answer('Remembered'))
    expect(seen.slice(5)).toHaveLength(6)
    expect(seen.slice(5).every((id) => NEW.includes(id))).toBe(true)
    expect(title()).toBe('Inbox complete')
  })

  it('5. Undo in the hint line on the % screen takes the stop back with the last answer: the card shows again', async () => {
    h = await reviewSetup(FILES)
    await pick('Due today')
    for (const r of ['Remembered', 'Remembered', 'Remembered', 'Remembered', 'Forgot'] as const) await answer(r)
    expect(q('.due-end')?.dataset.kind).toBe('missed')
    expect(h.last()).toContain('Undo')
    // S5: the end screen takes no tap in its first 400 ms (a double tap's second tap); this Undo is a later one.
    await act(async () => void (await new Promise((r) => setTimeout(r, SEEN_MS + 50))))
    await h.click('Undo')
    expect(q('.due-end')).toBeNull()
    expect(showing()).toBe('VRB-5')
    expect(await answer('Remembered')).toBe('VRB-5')
    expect(q('.due-end')?.dataset.kind).toBe('done')
    expect(endText()).toContain('You remembered 100% of 5 cards.')
    expect(listed()).toEqual(DUE)
  })

  it('endScreen_ignoresTapsUnder400ms_afterLastAnswer: the second tap of a double tap on ✓ never hits the end screen\'s Undo (S5)', async () => {
    h = await reviewSetup(FILES)
    await pick('Due today')
    for (let i = 0; i < 4; i++) await answer('Remembered')
    await answer('Remembered')
    expect(q('.due-end')?.dataset.kind).toBe('done')
    // The second tap, ~120 ms later, where ✓ was: "↶ Undo" is there now. It does nothing.
    const undo = q('.review__stage--done .review__undo')
    expect(undo).not.toBeNull()
    await act(async () => undo!.click())
    expect(q('.due-end')?.dataset.kind).toBe('done')
    expect(showing()).toBeNull()
    expect(listed()).toEqual(DUE)
    // A tap after the 400 ms is a choice: Undo takes the answer back.
    await act(async () => void (await new Promise((r) => setTimeout(r, SEEN_MS + 50))))
    await h.click('Undo')
    expect(q('.due-end')).toBeNull()
    expect(showing()).toBe('VRB-5')
  })

  it('undo_onDoneScreen_ignoresTapsUnder400ms_onTheReturnedCard: a double tap on Undo never answers the card it brings back (sweep2 M-A)', async () => {
    h = await reviewSetup(FILES)
    await pick('Due today')
    for (const r of ['Remembered', 'Remembered', 'Remembered', 'Remembered', 'Forgot'] as const) await answer(r)
    expect(q('.due-end')?.dataset.kind).toBe('missed')
    await act(async () => void (await new Promise((r) => setTimeout(r, SEEN_MS + 50))))
    // The first tap of the double tap: Undo brings VRB-5 back, with ✓ under the finger.
    await act(async () => q('.review__stage--done .review__undo')!.click())
    await h.settle()
    expect(showing()).toBe('VRB-5')
    // The second tap, 100–300 ms later, lands on ✓, then on the card: both do nothing.
    await act(async () => q('.review__answer[data-rating="good"]')!.click())
    await h.settle()
    await act(async () => q('.review__card')!.click())
    await h.settle()
    expect(showing()).toBe('VRB-5')
    expect(q('.review__sides')?.textContent).toBe('Side 1 of 2')
    expect(listed()).toEqual(DUE.slice(0, 4))
    expect(q('.review__answers')?.dataset.guard).toBe('')
    // After the 400 ms, ✓ answers it (a choice).
    expect(await answer('Remembered')).toBe('VRB-5')
    expect(endText()).toContain('You remembered 100% of 5 cards.')
    expect(listed()).toEqual(DUE)
  })

  it('reviewMissed_doubleTap_staysOnSide1: the second tap of a double tap on "Review missed cards" never shows side 2 (sweep2 nit 3)', async () => {
    h = await reviewSetup(FILES)
    await pick('Due today')
    for (const r of ['Remembered', 'Forgot', 'Remembered', 'Remembered', 'Remembered'] as const) await answer(r)
    expect(q('.due-end')?.dataset.kind).toBe('missed')
    await act(async () => void (await new Promise((r) => setTimeout(r, SEEN_MS + 50))))
    await act(async () => q('.due-end__go')!.click())
    await h.settle()
    expect(showing()).toBe('VRB-2')
    // The second tap lands on the card, ~150 ms later: nothing.
    await act(async () => q('.review__card')!.click())
    await h.settle()
    expect(q('.review__sides')?.textContent).toBe('Side 1 of 2')
    // A tap after 400 ms shows side 2.
    await h.tap()
    expect(q('.review__sides')?.textContent).toBe('Side 2 of 2')
  })

  it('6. "from All folders ›" opens the sheet at its folder page; its ‹ closes it', async () => {
    h = await reviewSetup(FILES)
    await pick('Due today')
    for (let i = 0; i < 5; i++) await answer('Remembered')
    await h.click(/^New cards from All folders/)
    expect(q('.review__sheet')?.getAttribute('aria-label')).toBe('New cards from')
    await h.click(/New cards from…$/)
    expect(q('.review__sheet')).toBeNull()
    expect(title()).toBe('Due today is done.')
  })

  it('7. Due today is done with no new card left: the done screen\'s own lines under it, no "Learn new cards"', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': FILES['.yaseendocs/review.json'], 'verbs.md': FILES['verbs.md'] })
    await pick('Due today')
    for (let i = 0; i < 5; i++) await answer('Remembered')
    expect(title()).toBe('Due today is done.')
    expect(endButtons().some((b) => b.startsWith('Learn new cards'))).toBe(false)
    expect(h.text()).toContain('Nothing else is due today.')
  })

  it('8. Reduce Motion: the ring shows full at once, still, and the confetti never loads', async () => {
    reduce = true
    h = await reviewSetup(FILES)
    await pick('Due today')
    for (let i = 0; i < 5; i++) await answer('Remembered')
    expect(q('.due-end')?.dataset.motion).toBe('still')
    await act(async () => void (await new Promise((r) => setTimeout(r, 700))))
    expect(burst).not.toHaveBeenCalled()
  })
})

describe('the end screen (DueEnd): waits while hidden, plays once, lazy confetti', () => {
  let root: Root | null = null
  let el: HTMLElement
  let hidden = false
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') })
  const end = (over: Partial<DueTodayEnd> = {}): DueTodayEnd => ({ kind: 'done', id: `e${Math.random()}`, count: 5, remembered: 4, percent: 80, missed: 0, fresh: 3, ...over })
  const draw = (e: DueTodayEnd, shown = true) => act(() => root!.render(<div className="review"><DueEnd end={e} shown={shown} onGoOn={() => undefined} /></div>))
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

  it('the app hidden: it waits; it plays when the app shows, then the confetti loads once', async () => {
    hidden = true
    const e = end()
    draw(e)
    expect(motion()).toBe('wait')
    await sleep(700)
    expect(burst).not.toHaveBeenCalled()
    hidden = false
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    expect(motion()).toBe('play')
    await sleep(700)
    expect(burst).toHaveBeenCalledTimes(1)
    // Over the Review screen, at most 2× the pixels.
    const options = burst.mock.calls[0][1] as { within: Element; maxDpr: number }
    expect(options.within === el.querySelector('.review')).toBe(true)
    expect(options.maxDpr).toBe(2)
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

  it('the app hides during the fill: the confetti does not start', async () => {
    draw(end())
    expect(motion()).toBe('play')
    hidden = true
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    await sleep(700)
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
  it('every keyframe of the end screen moves only `transform` and `opacity`; Reduce Motion stops each animation', async () => {
    const { readFileSync } = await import('node:fs')
    const { dirname, resolve } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'dueEnd.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const frames = [...css.matchAll(/@keyframes [\w-]+\s*\{([\s\S]*?\}\s*)\}/g)].map((m) => m[1])
    expect(frames.length).toBeGreaterThanOrEqual(6)
    const props = new Set(frames.flatMap((f) => [...f.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1])))
    expect([...props].sort()).toEqual(['opacity', 'transform'])
    expect(css).not.toMatch(/transition\s*:/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important/)
  })
})
