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
    expect(h.host.querySelector('.review__crumb')?.getAttribute('title')).toBe('Geography')
    expect(h.host.querySelector('.review__crumb b')?.textContent).toBe('Geography')
    expect(h.host.querySelectorAll('.review__crumb [data-fold]')).toHaveLength(1)
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
    for (const name of ['Move to Up next']) {
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

describe('when a title shows (YAZ-5696, YAZ-5709: Never · Always · After the first click · Before Side 2): the Mac\'s one rule (`titleShows`, `nextStep`)', () => {
  // Two hidden words on the front, one on Side 2.
  const CARD = 'A {{one}} and {{two}}\n---\n{{three}}'
  const withGlobal = (titleAt: string, line: string) => ({ '.yaseendocs/review.json': JSON.stringify({ titleAt }), 'p.md': page('Geography', cardBlock(CARD, line)) })

  /** What shows after each tap: the card's text and the head. */
  const walk = async (n: number) => {
    const out: string[] = []
    for (let i = 0; i < n; i++) {
      await h!.tap()
      out.push(`${h!.cardText()} | ${h!.head()}`)
    }
    return out
  }

  it('the global After the first click (YAZ-5709): the first tap shows the title BY ITSELF; VoiceOver hears it only then; then the words, then Side 2', async () => {
    h = await reviewSetup(withGlobal('click', 'TI-20, title "Numbers"'))
    expect(h.head()).toBe('TI-20')
    expect(spoken()).not.toContain('Numbers')
    expect(h.text()).toContain('Tap anywhere · 5 left')
    expect(await walk(1)).toEqual(['A _ and _ | Numbers · TI-20'])
    expect(spoken()).toContain('Numbers')
    expect(await walk(4)).toEqual(['A one and _ | Numbers · TI-20', 'A one and two | Numbers · TI-20', 'A one and two _ | Numbers · TI-20', 'A one and two three | Numbers · TI-20'])
  })

  it('Title room (YAZ-5880, mobile.json `titleRoom`): off (the default) gives a waiting title no room; on keeps its room unseen and unread, then it fades in', async () => {
    h = await reviewSetup(withGlobal('click', 'TI-26, title "Numbers"'))
    expect(h.host.querySelector('.review__title-room')).toBeNull()
    h.unmount()
    h = await reviewSetup(withGlobal('click', 'TI-26, title "Numbers"'), { titleRoom: true })
    const room = h.host.querySelector('.review__title-room')
    expect([room?.textContent, room?.getAttribute('aria-hidden')]).toEqual(['Numbers · ', 'true'])
    expect(spoken()).not.toContain('Numbers')
    expect(await walk(1)).toEqual(['A _ and _ | Numbers · TI-26'])
    expect(h.host.querySelector('.review__title-room')).toBeNull()
    expect(h.host.querySelector('.review__title')?.classList.contains('review__title--in')).toBe(true)
    // A title that shows from the front never fades, and Never keeps no room.
    h.unmount()
    h = await reviewSetup(withGlobal('always', 'TI-27, title "Numbers"'), { titleRoom: true })
    expect(h.host.querySelector('.review__title')?.classList.contains('review__title--in')).toBe(false)
    h.unmount()
    h = await reviewSetup(withGlobal('never', 'TI-28, title "Numbers"'), { titleRoom: true })
    expect(h.host.querySelector('.review__title-room, .review__title')).toBeNull()
  })

  it('After the first click: a one-sided card with nothing hidden: the title is the one tap', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': JSON.stringify({ titleAt: 'click' }), 'p.md': page('Geography', cardBlock('Nothing hidden here.', 'TI-25, title "Numbers"')) })
    expect(h.head()).toBe('TI-25')
    expect(h.text()).toContain('Tap anywhere · 1 left')
    expect(await walk(1)).toEqual(['Nothing hidden here. | Numbers · TI-25'])
    expect(h.text()).toContain('Did you remember it?')
  })

  it('the global Never: the ID alone at every step and in the answer\'s line', async () => {
    h = await reviewSetup(withGlobal('never', 'TI-24, title "Numbers"'))
    await h.tap()
    await h.tap()
    await h.tap()
    expect(h.head()).toBe('TI-24')
    await h.click('Remembered')
    expect(h.text()).toContain('Remembered · TI-24 · back')
    expect(h.text()).not.toContain('Numbers')
  })

  it('the card\'s own `title-side2` (Before Side 2, YAZ-5709) wins over the global Always: 5 taps: word, word, the title, Side 2, the back word', async () => {
    h = await reviewSetup(withGlobal('always', 'TI-21, title "Numbers", title-side2'))
    expect(h.head()).toBe('TI-21')
    expect(await walk(5)).toEqual(['A one and _ | TI-21', 'A one and two | TI-21', 'A one and two | Numbers · TI-21', 'A one and two _ | Numbers · TI-21', 'A one and two three | Numbers · TI-21'])
  })

  it('Before Side 2: a card of 3 sides gets its title before Side 2; a one-sided card last (none hidden: the one tap)', async () => {
    const one = (text: string, id: string) => ({ '.yaseendocs/review.json': JSON.stringify({ titleAt: 'side2' }), 'p.md': page('Geography', cardBlock(text, `${id}, title "Numbers"`)) })
    h = await reviewSetup(one('A {{one}}\n---\nB {{two}}\n---\nC', 'TI-26'))
    expect(await walk(5)).toEqual(['A one | TI-26', 'A one | Numbers · TI-26', 'A one B _ | Numbers · TI-26', 'A one B two | Numbers · TI-26', 'A one B two C | Numbers · TI-26'])
    h.unmount()
    h = await reviewSetup(one('A {{one}} and {{two}}', 'TI-27'))
    expect(await walk(3)).toEqual(['A one and _ | TI-27', 'A one and two | TI-27', 'A one and two | Numbers · TI-27'])
    h.unmount()
    h = await reviewSetup(one('Nothing hidden here.', 'TI-28'))
    expect(await walk(1)).toEqual(['Nothing hidden here. | Numbers · TI-28'])
  })

  it('Before Side 2: an answer before the title shows still works; Undo brings the card back at its step, the title step still to come', async () => {
    h = await reviewSetup(withGlobal('side2', 'TI-29, title "Numbers"'))
    await h.tap()
    await h.click('Remembered')
    expect(h.last()).toContain('Remembered · Numbers')
    await h.click('Undo')
    expect(`${h.cardText()} | ${h.head()}`).toBe('A one and _ | TI-29')
    expect(await walk(3)).toEqual(['A one and two | TI-29', 'A one and two | Numbers · TI-29', 'A one and two _ | Numbers · TI-29'])
  })

  it('the card\'s own `title-always` wins over the global Never', async () => {
    h = await reviewSetup(withGlobal('never', 'TI-22, title "Numbers", title-always'))
    expect(h.head()).toBe('Numbers · TI-22')
  })

  it("round 1's `title-front` reads as After the first click; an answer keeps its bytes", async () => {
    h = await reviewSetup(withGlobal('always', 'TI-23, title "Numbers", title-front'))
    expect(h.head()).toBe('TI-23')
    await h.tap()
    expect(h.head()).toBe('Numbers · TI-23')
    await h.click('Remembered')
    const line = (await h.answers.text('p.md'))!.split('\n').find((l) => l.startsWith('<!-- card: TI-23'))!
    expect(line).toMatch(/^<!-- card: TI-23, title "Numbers", title-front, \S+ good( \d+s)? -->$/)
  })
})
