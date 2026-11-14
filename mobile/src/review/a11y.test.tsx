// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { spokenText } from './ReviewView'
import { NOW, cardBlock, page, reviewSetup, type ReviewHarness } from './testing'

/**
 * YAZ-5314: what VoiceOver gets, by the accessibility tree (`spokenText`: `aria-hidden` parts say nothing, a hidden
 * word says "Hidden word"), at EACH step, for cards with 0, 1 and 3 hidden words and a two-sided card. No hidden word
 * is in the card's text or in the spoken line before it shows; each step speaks only its new part, once.
 */
let h: ReviewHarness | undefined
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  h?.unmount()
  vi.useRealTimers()
})

async function walk(text: string, words: string[]) {
  h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', cardBlock(text, 'AX-1')) })
  const card = () => spokenText(h!.host.querySelector('.review__card')!)
  const live = h.host.querySelector('.review__card ~ p[aria-live]')!
  const steps: { card: string; said: string }[] = [{ card: card(), said: (live.textContent ?? '').trim() }]
  for (let i = 0; i < 6 && h.button('Show the next part') !== null; i++) {
    await h.click('Show the next part')
    await act(async () => void (await new Promise((r) => setTimeout(r, 5))))
    steps.push({ card: card(), said: (live.textContent ?? '').trim() })
  }
  // Nothing hidden is spoken before its step.
  steps.forEach((s, i) => {
    for (const [w, word] of words.entries()) {
      const at = steps.findIndex((x) => x.said === word || x.card.includes(word))
      if (at !== -1) expect([word, i >= at || !s.card.includes(word)]).toEqual([word, true])
      void w
    }
  })
  return steps
}

describe('VoiceOver at each step (YAZ-5314)', () => {
  it('0 hidden words, one side: the question is read; nothing to show', async () => {
    const steps = await walk('Paris is the capital of France.', [])
    expect(steps).toEqual([{ card: 'Paris is the capital of France.', said: '' }])
  })

  it('1 hidden word: "Hidden word" first, then the word, said once', async () => {
    const steps = await walk('The capital of France is {{Paris}}.', ['Paris'])
    expect(steps).toEqual([
      { card: 'The capital of France is Hidden word.', said: '' },
      { card: 'The capital of France is Paris.', said: 'Paris' },
    ])
  })

  it('3 hidden words: one at a time, in order', async () => {
    const steps = await walk('{{Seine}} runs through {{Paris}} to the {{sea}}.', ['Seine', 'Paris', 'sea'])
    expect(steps.map((s) => s.said)).toEqual(['', 'Seine', 'Paris', 'sea'])
    expect(steps[0].card).toBe('Hidden word runs through Hidden word to the Hidden word.')
    expect(steps[2].card).toBe('Seine runs through Paris to the Hidden word.')
  })

  it('two sides, the back with a hidden word: the step to the back says the back with "Hidden word", then the word', async () => {
    const steps = await walk('Hola\n---\nIt means {{Hello}}.', ['Hello'])
    expect(steps.map((s) => s.said)).toEqual(['', 'It means Hidden word.', 'Hello'])
    expect(steps[1].card).not.toContain('Hello')
  })

  it('YAZ-5337: an aria-hidden part OUTSIDE a hidden word (a separator, an icon glyph) says nothing', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p>Rivers <span aria-hidden="true">·</span> of <span aria-hidden="true"><b>France</b></span><span role="img" aria-label="Hidden word"><span aria-hidden="true">Seine</span></span></p>'
    expect(spokenText(el)).toBe('Rivers of Hidden word')
  })
})
