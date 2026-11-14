// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VaultMedia } from '../media/ui/vaultMedia'
import { NOW, cardBlock, cardFile, page, reviewSetup, type ReviewHarness } from './testing'

/** 4B: each kind of card draws with the Mac's own `renderCard`, and a tap steps through it. */
let h: ReviewHarness
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  h?.unmount()
  vi.useRealTimers()
})

const one = (text: string, extra: Record<string, string> = {}) => ({ '.yaseendocs/review.json': '{}', 'p.md': page('P', cardBlock(text, 'QA-1')), ...extra })

describe('Review: the kinds of card', () => {
  it('no hidden word, one side: fully shown at once; a tap changes nothing; the answers work', async () => {
    h = await reviewSetup(one('Paris is the capital of France.'))
    expect(h.cardText()).toBe('Paris is the capital of France.')
    expect(h.host.querySelector('.review__card')?.getAttribute('aria-label')).toBe('Card, fully shown')
    await h.tap()
    expect(h.cardText()).toBe('Paris is the capital of France.')
    await h.click('Remembered')
    expect(h.answers.waiting().map((w) => w.op.kind)).toEqual(['review'])
  })

  it('one hidden word: a blank, then the word', async () => {
    h = await reviewSetup(one('The capital of France is {{Paris}}.'))
    expect(h.cardText()).toBe('The capital of France is _.')
    await h.tap()
    expect(h.cardText()).toBe('The capital of France is Paris.')
  })

  it('five hidden words: one tap shows one word, in order', async () => {
    h = await reviewSetup(one('{{one}} {{two}} {{three}} {{four}} {{five}}'))
    expect(h.cardText()).toBe('_ _ _ _ _')
    const seen: string[] = []
    for (let i = 0; i < 5; i++) {
      await h.tap()
      seen.push(h.cardText()!)
    }
    expect(seen).toEqual(['one _ _ _ _', 'one two _ _ _', 'one two three _ _', 'one two three four _', 'one two three four five'])
  })

  it('two sides: the back shows on the tap; "Side 1 of 2", then "Side 2 of 2"', async () => {
    h = await reviewSetup(one('Front words\n---\nBack words'))
    expect(h.cardText()).toBe('Front words')
    expect(h.text()).toContain('Side 1 of 2')
    await h.tap()
    expect(h.cardText()).toBe('Front words Back words')
    expect(h.text()).toContain('Side 2 of 2')
  })

  it('a table: a real table, its hidden word a blank, in a box that scrolls sideways', async () => {
    h = await reviewSetup(one('Verbs\n\n| I | you |\n| -- | -- |\n| soy | {{eres}} |'))
    const table = h.host.querySelector('.review__card table')
    expect(table).not.toBeNull()
    expect(h.host.querySelector('.card__table')).not.toBeNull()
    expect(h.cardText()).toContain('soy _')
    await h.tap()
    expect(h.cardText()).toContain('soy eres')
  })

  it('code: a code block keeps its lines', async () => {
    // A card that holds a code block is fenced with four backticks, as the Mac writes it.
    const block = '````card\nWhat prints?\n\n```js\nconsole.log(1 + 1)\n```\n---\n{{2}}\n````\n<!-- card: QA-1 -->'
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', block) })
    expect(h.cardText()).toBe('What prints? console.log(1 + 1)')
    expect(h.host.querySelector('.review__card pre code')?.textContent).toContain('console.log(1 + 1)')
  })

  it('a picture: from 3D as a URL, resolved from the file that holds the card', async () => {
    const asked: string[] = []
    const media: VaultMedia = { show: async (path) => (asked.push(path), { status: 'ready', path, url: 'blob:fake-1', type: 'image/png' }) }
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'cards/img/cat.png': 'made-up bytes', 'cards/p.md': page('P', cardBlock('What is this?\n\n![a cat](img/cat.png)', 'QA-1')) }, { media })
    expect(asked).toEqual(['cards/img/cat.png'])
    expect(h.host.querySelector('.review__card img')?.getAttribute('src')).toBe('blob:fake-1')
  })

  it('a picture that is not here with no signal: a calm line in its place, and the text shows (round 12: N3)', async () => {
    const media: VaultMedia = { show: async (path) => ({ status: 'missing', path, why: 'offline' }) }
    h = await reviewSetup(one('What is this?\n\n![a cat](cat.png)\n\nA cat.', { 'cat.png': 'made-up bytes' }), { media })
    expect((h.host.querySelector('.review__card img') as HTMLElement | null)?.hidden).toBe(true)
    expect(h.cardText()).toBe('What is this? Picture · cat.png · Needs a connection A cat.')
  })

  it('a sound: the player, which plays from its own tap (no step)', async () => {
    const media: VaultMedia = { show: async (path) => ({ status: 'ready', path, url: 'blob:fake-sound', type: 'audio/mpeg' }) }
    h = await reviewSetup(one('Listen\n\n![[hola.mp3]]\n---\n{{Hello}}', { 'hola.mp3': 'made-up bytes' }), { media })
    expect(h.host.querySelector('.card__audio')?.getAttribute('data-card-audio')).toBe('blob:fake-sound')
  })

  it('a long card: it scrolls with the screen; the answer buttons are in a dock that stays at the bottom', async () => {
    const long = Array.from({ length: 120 }, (_, i) => `Line ${i + 1} of a long card.`).join('\n\n')
    h = await reviewSetup(one(`${long}\n---\n{{end}}`))
    const dock = h.host.querySelector('.review__dock')!
    expect(dock.contains(h.button('Remembered'))).toBe(true)
    expect(dock.contains(h.button('Forgot'))).toBe(true)
    // jsdom has no layout: the sticky rule is checked in `style.test.ts`. The card is before the dock, the last word too.
    expect(h.host.querySelector('.review__card')!.compareDocumentPosition(dock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await h.tap()
    expect(h.cardText()).toMatch(/Line 120 of a long card\. _$/)
    await h.tap()
    expect(h.cardText()).toMatch(/Line 120 of a long card\. end$/)
  })

  it('a card file: the head is its title and ID, with no page; ⋯ says "Open card" and opens the card alone', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'cards/light-nc-17.md': cardFile('Speed of light', cardBlock('How fast is light?\n---\n{{300,000 km/s}}', 'NC-17')) })
    expect(h.head()).toBe('Speed of light · NC-17')
    await h.click('More card actions')
    expect(h.button('Open page')).toBeNull()
    await h.click('Open card')
    expect(h.opened).toEqual([{ kind: 'card', path: 'cards/light-nc-17.md', id: 'NC-17' }])
  })

  it('a card embedded on two pages counts one time', async () => {
    h = await reviewSetup({
      '.yaseendocs/review.json': '{}',
      'cards/light-nc-17.md': cardFile('Speed of light', cardBlock('How fast is light?\n---\n{{300,000 km/s}}', 'NC-17')),
      'a.md': page('A', '![[NC-17]]'),
      'b.md': page('B', '![[NC-17]]'),
    })
    expect(h.text()).toContain('1 of 1')
  })

  it('"Title on the front: Hide" (notitle): the ID alone until the card is fully shown, then the title', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', cardBlock('Secret title\nWhat is {{this}}?', 'QA-1, notitle')) })
    expect(h.head()).toBe('QA-1 · in P')
    expect(h.cardText()).not.toContain('Secret title')
    await h.tap()
    expect(h.head()).toBe('Secret title · QA-1 · in P')
  })

  it('a card file that is not valid (two cards): "This card file needs a fix on the Mac."; review works', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'cards/two.md': cardFile('Two', cardBlock('First?\n---\n{{one}}', 'NC-1'), `\n${cardBlock('Second?\n---\n{{two}}', 'NC-2')}\n`) })
    expect(h.text()).toContain('This card file needs a fix on the Mac.')
    await h.click('Remembered')
    expect(h.answers.waiting().map((w) => w.op.id)).toEqual(['NC-1'])
  })
})
