// YAZ-5696: WHEN a card's title shows in Review. Round 2 (Yaseen: "never, always, after the first click, and with side
// two"). The per-card choice is stored on the card's own line: nothing for Default, `notitle` for Never (as before),
// and one part for the other three: `title-always`, `title-click`, `title-side2`. Round 1's `title-once` and
// `title-front` still read (as Always and After the first click); a write gives the new word. The global default is
// review.json's `titleAt` (Always by default). `titleShows` is the one rule the Mac and the phone both use for a step.
import { describe, expect, it } from 'vitest'
import {
  cardRecords,
  cardTitleAtOf,
  cardTitleChoiceOf,
  formatCardLine,
  isCardNoTitle,
  isCardPropertyName,
  parseCardLine,
  pageCards,
  reviewTitleOf,
  withCardFix,
  withCardNext,
  withCardOff,
  withCardReview,
  withCardTitleChoice,
  type CardLine,
} from '@shared/cardLine'
import { uniteCardLines } from '@shared/cardMerge'
import { DEFAULT_REVIEW_SETTINGS, sanitizeReviewSettings } from '@shared/reviews'
import { CARD_TITLE_CHOICES, CARD_TITLE_HELP, cardTitleChoiceLabel, titleShows } from '@shared/cardTitleShows'
import { splitFrontmatter } from '@shared/frontmatter'
import * as older from './olderCardLine.fixture'

const R1 = '2026-11-01T09:00:00.000Z good'
const parse = (body: string): CardLine => parseCardLine(`<!-- card: ${body} -->`)!
const write = (line: CardLine): string => formatCardLine(line)!.replace(/^<!-- card: | -->$/g, '')

describe('the card line part (read and write)', () => {
  it('reads each word, and writes it back byte for byte', () => {
    for (const [word, at] of [['title-always', 'always'], ['title-click', 'click'], ['title-side2', 'side2']] as const) {
      const line = parse(`WIKI-5, title "Hola", ${word}, ${R1}`)
      expect(cardTitleAtOf(line)).toBe(at)
      expect(cardTitleChoiceOf(line)).toBe(at)
      expect(write(line)).toBe(`WIKI-5, title "Hola", ${word}, ${R1}`)
    }
  })

  it("round 1's words still read: `title-once` as Always, `title-front` as After the first click; a change writes the new word", () => {
    expect(cardTitleChoiceOf(parse('WIKI-5, title-once'))).toBe('always')
    expect(cardTitleChoiceOf(parse('WIKI-5, title-front'))).toBe('click')
    // An answer leaves the old word as it is (its bytes); a new choice writes the new one.
    expect(write(withCardReview(parse('WIKI-5, title-front'), { at: '2026-11-13T10:00:00.000Z', rating: 'good' }))).toBe('WIKI-5, title-front, 2026-11-13T10:00:00.000Z good')
    expect(write(withCardTitleChoice(parse('WIKI-5, title-front'), 'side2'))).toBe('WIKI-5, title-side2')
    expect(write(withCardTitleChoice(parse('WIKI-5, title-once'), 'default'))).toBe('WIKI-5')
  })

  it('Default: no part; Never: `notitle`', () => {
    expect(cardTitleChoiceOf(parse(`WIKI-5, title "Hola", ${R1}`))).toBe('default')
    expect(cardTitleChoiceOf(parse(`WIKI-5, title "Hola", notitle, ${R1}`))).toBe('never')
    expect(cardTitleAtOf(parse(`WIKI-5, title "Hola", ${R1}`))).toBeNull()
  })

  it('each choice writes one part at most, after the head, and takes the other one away', () => {
    const base = parse(`WIKI-5, title "Hola", off, next, ${R1}`)
    expect(write(withCardTitleChoice(base, 'click'))).toBe(`WIKI-5, title "Hola", off, next, title-click, ${R1}`)
    expect(write(withCardTitleChoice(withCardTitleChoice(base, 'click'), 'side2'))).toBe(`WIKI-5, title "Hola", off, next, title-side2, ${R1}`)
    expect(write(withCardTitleChoice(withCardTitleChoice(base, 'click'), 'never'))).toBe(`WIKI-5, title "Hola", off, next, notitle, ${R1}`)
    expect(write(withCardTitleChoice(withCardTitleChoice(base, 'never'), 'always'))).toBe(`WIKI-5, title "Hola", off, next, title-always, ${R1}`)
    expect(write(withCardTitleChoice(withCardTitleChoice(base, 'side2'), 'default'))).toBe(`WIKI-5, title "Hola", off, next, ${R1}`)
    const click = withCardTitleChoice(base, 'click')
    expect(withCardTitleChoice(click, 'click')).toBe(click)
  })

  it('stays put through the other writes (an answer, Up next, Archive card, Fix later)', () => {
    const line = parse(`WIKI-5, title "Hola", title-side2, ${R1}`)
    const after = withCardFix(withCardOff(withCardNext(withCardReview(line, { at: '2026-11-13T10:00:00.000Z', rating: 'again' }), true), true), true)
    expect(cardTitleAtOf(after)).toBe('side2')
    expect(write(after)).toBe(`WIKI-5, title "Hola", off, next, title-side2, fix, ${R1}, 2026-11-13T10:00:00.000Z again`)
  })

  it('is a card line word: never a property name, in any capitals', () => {
    for (const w of ['title-always', 'title-click', 'title-side2', 'title-once', 'title-front', 'Title-Click']) expect(isCardPropertyName(w)).toBe(false)
  })

  it('a word this app does not know stays an unknown part (`title-later`), kept as it is', () => {
    const line = parse(`WIKI-5, title-later, ${R1}`)
    expect(cardTitleAtOf(line)).toBeNull()
    expect(write(line)).toBe(`WIKI-5, title-later, ${R1}`)
  })

  it('a build from before keeps the part, in its place, through its own writes', () => {
    const line = older.withCardReview(older.parseCardLine(`<!-- card: WIKI-5, title-click, ${R1} -->`)!, { at: '2026-11-13T10:00:00.000Z', rating: 'good' })
    expect(older.formatCardLine(line)).toBe(`<!-- card: WIKI-5, title-click, ${R1}, 2026-11-13T10:00:00.000Z good -->`)
    expect(cardTitleAtOf(parse(older.formatCardLine(line)!.replace(/^<!-- card: | -->$/g, '')))).toBe('click')
  })

  it('the index keeps it (`CardRecord.titleAt`)', () => {
    const page = '# P\n\n```card\nHola\n```\n<!-- card: WIKI-5, title "Hola", title-side2 -->\n'
    expect(cardRecords(page)[0].titleAt).toBe('side2')
    expect(isCardNoTitle(parse('WIKI-5, title-side2'))).toBe(false)
  })
})

describe('the merge rule of sync keeps the choice, three ways', () => {
  const page = (line: string) => `---\nid: YAZ-1\n---\n# Words\n\n\`\`\`card\nHola\n\`\`\`\n<!-- card: ${line} -->\n`
  const lineOf = (text: string) => splitFrontmatter(text).body.split('\n')[pageCards(text)[0].lineAt!]
  const T = '2026-11-13T10:00:00.000Z good 4s'
  const M = '2026-11-13T10:05:00.000Z again 7s'

  it('the Mac sets With Side 2 (mine), the phone answers (theirs): the choice and both answers stay', () => {
    const [t, m] = uniteCardLines(page(`YAZ-7, title "Hola", ${R1}`), page(`YAZ-7, title "Hola", ${R1}, ${T}`), page(`YAZ-7, title "Hola", title-side2, ${R1}, ${M}`))
    expect(t).toBe(m)
    expect(lineOf(t)).toBe(`<!-- card: YAZ-7, title "Hola", title-side2, ${R1}, ${T}, ${M} -->`)
  })

  it('a change from After the first click to With Side 2 on one side wins over the side that left it', () => {
    const [t] = uniteCardLines(page(`YAZ-7, title-click, ${R1}`), page(`YAZ-7, title-click, ${R1}, ${T}`), page(`YAZ-7, title-side2, ${R1}`))
    expect(lineOf(t)).toBe(`<!-- card: YAZ-7, title-side2, ${R1}, ${T} -->`)
  })
})

describe('the global default (review.json `titleAt`)', () => {
  it('is Always, so nothing changes for anyone', () => {
    expect(DEFAULT_REVIEW_SETTINGS.titleAt).toBe('always')
    expect(sanitizeReviewSettings({}).titleAt).toBe('always')
  })
  it("keeps each of the four; round 1's words read as their new meanings; anything else is Always", () => {
    for (const at of ['never', 'always', 'click', 'side2'] as const) expect(sanitizeReviewSettings({ titleAt: at }).titleAt).toBe(at)
    expect(sanitizeReviewSettings({ titleAt: 'once' }).titleAt).toBe('always')
    expect(sanitizeReviewSettings({ titleAt: 'front' }).titleAt).toBe('click')
    expect(sanitizeReviewSettings({ titleAt: 'later' }).titleAt).toBe('always')
  })
})

describe('the words: the choices, "Default (Always)", and the eye\'s help', () => {
  it('Default names what it means now; then Never · Always · After the first click · With Side 2', () => {
    expect(CARD_TITLE_CHOICES.map((c) => c.choice)).toEqual(['default', 'never', 'always', 'click', 'side2'])
    expect(cardTitleChoiceLabel('default', 'always')).toBe('Default (Always)')
    expect(cardTitleChoiceLabel('default', 'side2')).toBe('Default (With Side 2)')
    expect(cardTitleChoiceLabel('click', 'always')).toBe('After the first click')
  })
  it('the help says each of the four in one line', () => {
    expect(CARD_TITLE_HELP.map((h) => h.label)).toEqual(['Never', 'Always', 'After the first click', 'With Side 2'])
    for (const h of CARD_TITLE_HELP) expect(h.text).not.toContain('\n')
  })
})

describe('the title in Review: the global Never, the card\'s own choice over it (`reviewTitleOf`)', () => {
  it('a global Never hides every title that has no choice of its own; a card\'s own choice still shows it; `notitle` never', () => {
    expect(reviewTitleOf({ title: 'Hola' }, 'never')).toBe('')
    expect(reviewTitleOf({ title: 'Hola', titleAt: 'always' }, 'never')).toBe('Hola')
    expect(reviewTitleOf({ title: 'Hola', notitle: true }, 'always')).toBe('')
    expect(reviewTitleOf({ title: 'Hola' }, 'always')).toBe('Hola')
  })
})

describe('`titleShows`: the one rule for a step (Mac and phone)', () => {
  // Two sides: two hidden words on the front, one on Side 2 (words 0, 1 | 2).
  const two = { counts: [2, 1] }
  const at = (sides: number, open: number[], next: number | null = null) => ({ ...two, sides, open, next })
  const shows = (when: 'always' | 'click' | 'side2', step: { counts: number[]; sides: number; open: number[]; next: number | null }, title = 'Hola') => titleShows({ title, at: when, ...step })

  it('Always: from the front', () => {
    expect(shows('always', at(1, []))).toBe(true)
  })

  it('After the first click: after the first Space or tap, whatever it shows; a word hidden again keeps it', () => {
    expect(shows('click', at(1, []))).toBe(false)
    expect(shows('click', at(1, [0], 1))).toBe(true)
    // A card with no hidden word on its front: the first click is the flip.
    expect(shows('click', { counts: [0, 1], sides: 1, open: [], next: null })).toBe(false)
    expect(shows('click', { counts: [0, 1], sides: 2, open: [], next: null })).toBe(true)
    // The shown word clicked hidden again: still a click.
    expect(shows('click', at(1, [], 0))).toBe(true)
  })

  it('After the first click on a card with nothing to click: as soon as it is fully shown, at once', () => {
    expect(shows('click', { counts: [0], sides: 1, open: [], next: null })).toBe(true)
  })

  it('With Side 2: when the last side shows; a one-sided card when fully shown', () => {
    expect(shows('side2', at(1, [0, 1]))).toBe(false)
    expect(shows('side2', at(2, [0, 1]))).toBe(true)
    expect(shows('side2', { counts: [2], sides: 1, open: [0], next: 1 })).toBe(false)
    expect(shows('side2', { counts: [2], sides: 1, open: [0, 1], next: null })).toBe(true)
    expect(shows('side2', { counts: [0], sides: 1, open: [], next: null })).toBe(true)
  })

  it('a title that holds a hidden-word mark waits until the card is fully shown, whatever the choice', () => {
    for (const when of ['always', 'click', 'side2'] as const) {
      expect(shows(when, at(2, [0, 1]), 'Capital: {{Paris}}')).toBe(false)
      expect(shows(when, at(2, [0, 1, 2]), 'Capital: {{Paris}}')).toBe(true)
    }
  })

  it('no title: nothing to show', () => {
    expect(shows('always', at(1, []), '')).toBe(false)
  })
})
