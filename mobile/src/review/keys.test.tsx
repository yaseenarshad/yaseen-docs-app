// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reviewKey, type KeyFacts } from './keys'
import { NOW, cardBlock, page, reviewSetup, type ReviewHarness } from './testing'

/** YAZ-5644: Review with a keyboard on a computer: Space or Enter for the next part, 1 to 4 to answer. */
const facts = (key: string, more: Partial<KeyFacts> = {}): KeyFacts => ({ key, repeat: false, altKey: false, ctrlKey: false, metaKey: false, defaultPrevented: false, target: document.body, ...more })

describe('reviewKey', () => {
  it('Space and Enter show the next part; 1 and 2 answer (four buttons: 1 to 4)', () => {
    expect(reviewKey(facts(' '), 2)).toEqual({ kind: 'next' })
    expect(reviewKey(facts('Enter'), 2)).toEqual({ kind: 'next' })
    expect(reviewKey(facts('1'), 2)).toEqual({ kind: 'answer', index: 0 })
    expect(reviewKey(facts('2'), 2)).toEqual({ kind: 'answer', index: 1 })
    expect(reviewKey(facts('3'), 2)).toBeNull()
    expect(reviewKey(facts('4'), 4)).toEqual({ kind: 'answer', index: 3 })
  })

  it('NOT: ← →, other keys, a held key, ⌘ / Ctrl / Alt, a key already taken', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'a', '0', '5', 'Escape']) expect(reviewKey(facts(key), 4)).toBeNull()
    expect(reviewKey(facts(' ', { repeat: true }), 2)).toBeNull()
    expect(reviewKey(facts('1', { metaKey: true }), 2)).toBeNull()
    expect(reviewKey(facts('1', { ctrlKey: true }), 2)).toBeNull()
    expect(reviewKey(facts('1', { altKey: true }), 2)).toBeNull()
    expect(reviewKey(facts(' ', { defaultPrevented: true }), 2)).toBeNull()
  })

  it('NOT in a field (typing)', () => {
    for (const html of ['<input>', '<textarea></textarea>', '<select></select>', '<div contenteditable="true"></div>']) {
      const box = document.createElement('div')
      box.innerHTML = html
      document.body.append(box)
      expect(reviewKey(facts('1', { target: box.firstElementChild }), 2)).toBeNull()
      expect(reviewKey(facts(' ', { target: box.firstElementChild }), 2)).toBeNull()
      box.remove()
    }
  })

  it('a button the keyboard moved to keeps its own Enter; one that a click left focused does not', () => {
    const button = document.createElement('button')
    document.body.append(button)
    const visible = vi.spyOn(button, 'matches').mockImplementation((q: string) => q === ':focus-visible')
    expect(reviewKey(facts('Enter', { target: button }), 2)).toBeNull()
    visible.mockReturnValue(false)
    expect(reviewKey(facts(' ', { target: button }), 2)).toEqual({ kind: 'next' })
    button.remove()
  })
})

describe('the keys on the Review screen (the real engine and answer list)', () => {
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
  const OLD = '2026-10-04T09:00:00.000Z good'
  const FILES = { '.yaseendocs/review.json': '{}', 'p.md': page('Memory', cardBlock('{{Spaced}} repetition.', `MC-1, ${OLD}`), cardBlock('Two?', `MC-2, ${OLD}`)) }
  const press = async (key: string, target: EventTarget = document.body) => {
    await h!.seen()
    await act(async () => void target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })))
    await h!.settle()
  }
  const shown = () => [...h!.host.querySelectorAll('.phone-card__body .card__hidden')].map((e) => e.textContent?.trim())
  const reviews = () => h!.answers.waiting().flatMap((w) => (w.op.kind === 'review' ? [[w.op.id, w.op.review.rating]] : []))

  it('Space shows the hidden part; 2 answers Remembered, the next card comes; 1 answers Forgot', async () => {
    h = await reviewSetup(FILES)
    await press(' ')
    expect(shown()).toEqual(['Spaced'])
    await press('2')
    expect(reviews()).toEqual([['MC-1', 'good']])
    await press('1')
    expect(reviews()).toEqual([
      ['MC-1', 'good'],
      ['MC-2', 'again'],
    ])
  })

  it('NOT while a menu is open, nor while typing in a field', async () => {
    h = await reviewSetup(FILES)
    await h.click('More card actions')
    await press('2')
    expect(reviews()).toEqual([])
    await h.click('More card actions')
    const field = document.createElement('input')
    document.body.append(field)
    await press('2', field)
    expect(reviews()).toEqual([])
    field.remove()
  })
})
