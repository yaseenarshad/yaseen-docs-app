// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SAVE_LIMIT_MS, SEEN_MS, guardStep, type GuardState } from './tapGuard'
import { NOW, cardBlock, page, reviewSetup, type ReviewHarness } from './testing'

/** YAZ-5266: the tap guard is a small state machine; every path out of "answering" comes back to "ready". */
const ready: GuardState = { kind: 'ready' }
const answering: GuardState = { kind: 'answering', from: null, follows: false }

describe('the guard, each transition', () => {
  it('ready → answering; a second answer while answering or settling is dropped', () => {
    expect(guardStep(ready, { type: 'answer' })).toEqual(answering)
    expect(guardStep(answering, { type: 'answer' })).toBe(answering)
    const settling = guardStep(answering, { type: 'answered', sameCard: false, cardOnScreen: true })
    expect(settling.kind).toBe('settling')
    expect(guardStep(settling, { type: 'answer' })).toBe(settling)
  })
  it('answered: another card → settling → ready on its own timer only; the same card (a failed save) or no card → ready', () => {
    const settling = guardStep(answering, { type: 'answered', sameCard: false, cardOnScreen: true })
    if (settling.kind !== 'settling') throw new Error('not settling')
    expect(guardStep(settling, { type: 'seen', turn: settling.turn - 1 })).toBe(settling) // an old timer
    expect(guardStep(settling, { type: 'seen', turn: settling.turn })).toEqual(ready)
    expect(guardStep(answering, { type: 'answered', sameCard: true, cardOnScreen: true })).toEqual(ready)
    expect(guardStep(answering, { type: 'answered', sameCard: false, cardOnScreen: false })).toEqual(ready)
  })
  it('YAZ-5315: with `shown` (the screen), the 400 ms count from the DRAWING of the next card, and a hide/show keeps a save', () => {
    const a = guardStep(ready, { type: 'answer', from: 'k1' })
    expect(a).toEqual({ kind: 'answering', from: 'k1', follows: true })
    expect(guardStep(a, { type: 'reset' })).toBe(a) // the tab hidden and shown during the save
    expect(guardStep(a, { type: 'shown', key: 'k1' })).toBe(a) // the old card drawn again: nothing
    const awaiting = guardStep(a, { type: 'answered', sameCard: false, cardOnScreen: true })
    expect(awaiting).toEqual({ kind: 'awaiting', from: 'k1' })
    expect(guardStep(awaiting, { type: 'reset' })).toEqual(ready)
    expect(guardStep(awaiting, { type: 'undo' })).toEqual(ready)
    expect(guardStep(awaiting, { type: 'shown', key: 'k1' })).toBe(awaiting) // the old card drawn again while the next reads
    expect(guardStep(awaiting, { type: 'shown', key: 'k2' }).kind).toBe('settling') // the next card (or the same one back, at a new place)
    expect(guardStep(a, { type: 'shown', key: 'k2' }).kind).toBe('settling') // drawn before the save ended
    expect(guardStep(a, { type: 'answered', sameCard: true, cardOnScreen: true })).toEqual(ready) // a failed save
  })

  it('YAZ-5335: another drawing while settling starts the 400 ms again (only ever longer); the same drawing does not', () => {
    const a = guardStep(ready, { type: 'answer', from: 'd1' })
    const settling = guardStep(guardStep(a, { type: 'answered', sameCard: false, cardOnScreen: true }), { type: 'shown', key: 'd2' })
    if (settling.kind !== 'settling') throw new Error('not settling')
    expect(guardStep(settling, { type: 'shown', key: 'd2' })).toBe(settling)
    const again = guardStep(settling, { type: 'shown', key: 'd3' })
    expect(again.kind).toBe('settling')
    if (again.kind !== 'settling') return
    expect(again.turn).toBeGreaterThan(settling.turn)
    expect(guardStep(again, { type: 'seen', turn: settling.turn })).toBe(again) // the old timer ends nothing
  })

  it('YAZ-5521: undo from the screen after the last card settles; the card that comes back starts its own 400 ms', () => {
    const undone = guardStep(ready, { type: 'undo', fromDone: true })
    expect(undone.kind).toBe('settling')
    const drawn = guardStep(undone, { type: 'shown', key: 'd-back' })
    expect(drawn.kind).toBe('settling')
    expect(drawn).not.toEqual(undone)
    expect(guardStep(drawn, { type: 'seen', turn: (drawn as { turn: number }).turn })).toEqual(ready)
  })

  it('undo goes to ready from every state, reset from all but a running save; answered or seen in ready change nothing', () => {
    const settling = guardStep(answering, { type: 'answered', sameCard: false, cardOnScreen: true })
    for (const s of [ready, answering, settling]) expect(guardStep(s, { type: 'undo' })).toEqual(ready)
    for (const s of [ready, settling]) expect(guardStep(s, { type: 'reset' })).toEqual(ready)
    expect(guardStep(answering, { type: 'reset' })).toBe(answering) // YAZ-5315: a save that runs keeps answering
    expect(guardStep(ready, { type: 'answered', sameCard: false, cardOnScreen: true })).toBe(ready)
    expect(guardStep(ready, { type: 'seen', turn: 1 })).toBe(ready)
  })
})

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
const cards = (n: number) => Array.from({ length: n }, (_, i) => cardBlock(`Q${i + 1}?\n---\n{{w${i + 1}}}`, `GD-${i + 1}, ${OLD}`))
const real = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))
const press = async (hh: ReviewHarness, name: string) => {
  const b = hh.button(name)
  if (b === null) throw new Error(`no ${name}`)
  await act(async () => b.click())
  await hh.settle()
}
const reviews = (hh: ReviewHarness) => hh.answers.waiting().filter((w) => w.op.kind === 'review').map((w) => w.op.id)
const guarded = (hh: ReviewHarness) => hh.host.querySelector('[data-guard]') !== null

describe('the guard on the screen (YAZ-5266)', () => {
  for (const ms of [0, 100, 399, 401])
    it(`Undo ${ms} ms after an answer: the card comes back, and it takes taps and answers again`, async () => {
      h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...cards(3)) })
      await press(h, 'Remembered')
      if (ms > 0) await real(ms)
      await press(h, 'Undo')
      expect(h.head()).toBe('GD-1')
      expect(guarded(h)).toBe(false)
      const before = h.cardText()
      await act(async () => h!.host.querySelector<HTMLElement>('.review__card')!.click())
      await h.settle()
      expect(h.cardText()).not.toBe(before)
      await press(h, 'Remembered')
      expect(reviews(h)).toEqual(['GD-1'])
    })

  it('a save that fails: plain words, the card stays and is answerable at once', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...cards(2)) })
    const add = h.answers.add.bind(h.answers)
    ;(h.answers as { add: unknown }).add = async () => {
      throw new Error('the disk is full')
    }
    await press(h, 'Remembered')
    expect(h.head()).toBe('GD-1')
    expect(h.host.querySelector('.review__notice')?.textContent).toBe("Can't save the answer.")
    expect(guarded(h)).toBe(false)
    ;(h.answers as { add: unknown }).add = add
    await press(h, 'Remembered')
    expect(reviews(h)).toEqual(['GD-1'])
  })

  it('the next card: taps wait SEEN_MS, then act; the last card answered: no guard on the done screen', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...cards(2)) })
    await press(h, 'Remembered')
    expect(guarded(h)).toBe(true)
    await press(h, 'Remembered') // dropped
    expect(reviews(h)).toEqual(['GD-1'])
    await real(SEEN_MS + 50)
    expect(guarded(h)).toBe(false)
    await press(h, 'Remembered')
    expect(reviews(h)).toEqual(['GD-1', 'GD-2'])
    // YAZ-5495 (the Mac's YAZ-5043): the last due card answered: "Due today is done.".
    expect(h.text()).toContain('Due today is done.')
    expect(guarded(h)).toBe(false)
  })

  it('YAZ-5316: a failed save keeps the line of the answer before: its Undo stays and works', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...cards(3)) })
    await press(h, 'Remembered')
    await real(SEEN_MS + 50)
    const add = h.answers.add.bind(h.answers)
    ;(h.answers as { add: unknown }).add = async () => {
      throw new Error('the disk is full')
    }
    await press(h, 'Remembered')
    expect(h.host.querySelector('.review__notice')?.textContent).toBe("Can't save the answer.")
    expect(h.last()).toBe('Last: GD-1 (Remembered) · ↶ Undo')
    ;(h.answers as { add: unknown }).add = add
    await press(h, 'Undo')
    expect(h.head()).toBe('GD-1')
    expect(reviews(h)).toEqual([])
  })
})

describe('YAZ-5596 item 2: a save with no answer (iOS storage after a wake)', () => {
  it('after SAVE_LIMIT_MS the card stays and takes taps again; the save goes on, and when it lands the answer counts once', async () => {
    // The 10 s limit, made short for the test (the other timers keep their times).
    const realSetTimeout = globalThis.setTimeout
    const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number, ...rest: unknown[]) => realSetTimeout(fn, ms === SAVE_LIMIT_MS ? 60 : ms, ...rest)) as typeof setTimeout)
    try {
      h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...cards(2)) })
      const add = h.answers.add.bind(h.answers)
      let release: () => void = () => {}
      ;(h.answers as { add: unknown }).add = (entries: Parameters<typeof add>[0]) => new Promise((resolve, reject) => (release = () => void add(entries).then(resolve, reject)))
      await press(h, 'Remembered')
      expect(guarded(h)).toBe(true)
      await real(120)
      // The save has no answer: the taps act again, the card stays, and the screen says so.
      expect(guarded(h)).toBe(false)
      expect(h.head()).toBe('GD-1')
      expect(h.host.querySelector('.review__notice')?.textContent).toBe('That did not save yet. It will try again.')
      const before = h.cardText()
      await act(async () => h!.host.querySelector<HTMLElement>('.review__card')!.click())
      await h.settle()
      expect(h.cardText()).not.toBe(before)
      // The storage answers: the answer lands once, and the next card shows.
      ;(h.answers as { add: unknown }).add = add
      await act(async () => release())
      await h.settle()
      await real(SEEN_MS + 50)
      expect(reviews(h)).toEqual(['GD-1'])
      expect(h.head()).toBe('GD-2')
      expect(h.host.querySelector('.review__notice')).toBeNull()
    } finally {
      spy.mockRestore()
    }
  })
})
