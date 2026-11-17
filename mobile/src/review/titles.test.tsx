// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { spokenText } from './ReviewView'
import { NOW, cardBlock, cardFile, page, reviewSetup, type ReviewHarness } from './testing'

/**
 * YAZ-5309 (YAZ-5308, decision D): the Review screen reads a card's title ONLY off its card line (`title "…"`). The
 * card's text is only its sides: its first line is part of the question, never the title. The head is the Mac Inbox's
 * head: "Title · ID", the ID alone for a card with no title, and with `notitle` the ID alone at every step, fully shown and
 * after the answer too (YAZ-5695). VoiceOver (YAZ-5314) never hears a title the head does not show.
 */
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

const vault = (block: string, extra: Record<string, string> = {}) => ({ '.yaseendocs/review.json': '{}', 'p.md': page('Geography', block), ...extra })
const spoken = () => spokenText(h!.host.querySelector('.review')!)

describe('the Review head: the title off the card line', () => {
  it('a card in a page: "Title · ID · in <page>"; the first line of the text is the question, all of it', async () => {
    h = await reviewSetup(vault(cardBlock('Which river?\n---\nThe {{Nile}}', 'TI-1, title "Longest river"')))
    expect(h.head()).toBe('Longest river · TI-1')
    // YAZ-5415: the page is in the crumb, on the chip's line inside the card. YAZ-5682: a page at the vault's top is its name alone.
    expect(h.host.querySelector('.review__crumb')?.textContent).toBe('Geography')
    expect(h.cardText()).toBe('Which river?')
    await h.tap()
    expect(h.cardText()).toBe('Which river? The _')
  })

  it('a card file: its title is on its card line; its properties hold only `kind: card`', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'cards/capital-of-france-ti-2.md': cardFile('Capital of France', cardBlock('The capital is {{Paris}}.', 'TI-2')) })
    expect(h.head()).toBe('Capital of France · TI-2')
    expect(h.cardText()).toBe('The capital is _.')
  })

  it('a title with a quote, a comma, `-->`, a backslash, non-ASCII letters and an emoji shows as it is', async () => {
    h = await reviewSetup(vault(cardBlock('Q?', 'TI-3, title "Ünï \\"q\\", a --\\> b \\\\ 🙂"')))
    expect(h.head()).toBe('Ünï "q", a --> b \\ 🙂 · TI-3')
  })

  it('no title: the ID alone, as the Mac`s Inbox; the question is never shown as the title', async () => {
    h = await reviewSetup(vault(cardBlock('Which river runs through Paris?\n---\nThe Seine', 'TI-4')))
    expect(h.head()).toBe('TI-4')
    expect(h.cardText()).toBe('Which river runs through Paris?')
  })

  it('an empty title part (`title ""`) is no title', async () => {
    h = await reviewSetup(vault(cardBlock('Q?', 'TI-5, title ""')))
    expect(h.head()).toBe('TI-5')
  })

  it('`notitle` ("Title on the front: Hide", YAZ-5695): the ID alone at EVERY step, fully shown too, and after the answer; the text is never cut', async () => {
    h = await reviewSetup(vault(cardBlock('Longest river\n---\nThe {{Nile}}', 'TI-6, title "Rivers", notitle')))
    expect(h.head()).toBe('TI-6')
    expect(h.cardText()).toBe('Longest river')
    await h.tap()
    expect(h.head()).toBe('TI-6')
    await h.tap()
    expect(h.cardText()).toBe('Longest river The Nile')
    expect(h.head()).toBe('TI-6')
    expect(h.text()).not.toContain('Rivers')
    await h.click('Remembered')
    expect(h.text()).toContain('✓ Remembered · TI-6 · ') // YAZ-5693: the Mac's words
    expect(h.text()).not.toContain('Rivers')
  })
})

describe('VoiceOver (YAZ-5314): a title never gives the answer away', () => {
  it('with `notitle`, no title is ever read (YAZ-5695), fully shown too', async () => {
    h = await reviewSetup(vault(cardBlock('Which river?\n---\n{{Nile}}', 'TI-7, title "The Nile", notitle')))
    expect(spoken()).not.toContain('The Nile')
    await h.tap()
    expect(spoken()).not.toContain('The Nile')
    await h.tap()
    expect(h.head()).toBe('TI-7')
    expect(spoken()).not.toContain('The Nile')
  })

  it('a title that holds a hidden-word mark (`{{…}}`) waits as `notitle` does: its words are no answer before the end', async () => {
    h = await reviewSetup(vault(cardBlock('Capital of France?\n---\n{{Paris}}', 'TI-8, title "{{Paris}}"')))
    expect(h.head()).toBe('TI-8')
    expect(spoken()).not.toContain('Paris')
    await h.tap()
    await h.tap()
    expect(h.head()).toBe('{{Paris}} · TI-8')
  })
})

describe('the answer list keeps the title part byte for byte (decision 2 with YAZ-5308)', () => {
  // A comma in the title is `&#44;`, as the Mac writes it (YAZ-5393): a raw comma is encoded on the first write.
  const TITLE = 'title "Ünï \\"q\\"&#44; a --\\> b \\\\ 🙂"'
  it('an answer, Undo, Up next and Archive card, each with its Undo: the title part never moves or changes', async () => {
    h = await reviewSetup(vault(cardBlock('Q?\n---\n{{A}}', `TI-9, ${TITLE}, 2026-11-01T09:00:00.000Z good`)))
    const line = async () => (await h!.answers.text('p.md'))!.split('\n').find((l) => l.startsWith('<!-- card: TI-9'))!
    const before = await line()
    for (const name of ['Up next']) {
      await h.click('More card actions')
      await h.click(name)
      expect((await line()).startsWith(`<!-- card: TI-9, ${TITLE}, `)).toBe(true)
      await h.click('Undo')
      expect(await line()).toBe(before)
    }
    await h.click('More card actions')
    await h.click('Archive card')
    expect(await line()).toBe(`<!-- card: TI-9, ${TITLE}, off, 2026-11-01T09:00:00.000Z good -->`)
    await h.click('Undo')
    expect(await line()).toBe(before)
    await h.click('Remembered')
    expect((await line()).startsWith(`<!-- card: TI-9, ${TITLE}, 2026-11-01T09:00:00.000Z good, 2026-11-13T`)).toBe(true)
    await h.click('Undo')
    expect(await line()).toBe(before)
  })
})
