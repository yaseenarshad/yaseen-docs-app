// YAZ-5696 (Design 2): WHEN a card's title shows in Review. The per-card choice is stored on the card's own line:
// nothing for Default, `notitle` for Never (as before), and one new part for the other three: `title-once`,
// `title-front`, `title-side2`. The global default is review.json's `titleAt`. `titleShows` is the one rule the Mac
// and the phone both use for a step.
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
  withCardFix,
  withCardNext,
  withCardOff,
  withCardReview,
  withCardTitleChoice,
  type CardLine,
} from '@shared/cardLine'
import { uniteCardLines } from '@shared/cardMerge'
import { DEFAULT_REVIEW_SETTINGS, sanitizeReviewSettings } from '@shared/reviews'
import { titleShows } from '@shared/cardTitleShows'
import { splitFrontmatter } from '@shared/frontmatter'
import * as older from './olderCardLine.fixture'

const R1 = '2026-11-01T09:00:00.000Z good'
const parse = (body: string): CardLine => parseCardLine(`<!-- card: ${body} -->`)!
const write = (line: CardLine): string => formatCardLine(line)!.replace(/^<!-- card: | -->$/g, '')

describe('the card line part (read and write)', () => {
  it('reads each word, and writes it back byte for byte', () => {
    for (const [word, at] of [['title-once', 'once'], ['title-front', 'front'], ['title-side2', 'side2']] as const) {
      const line = parse(`WIKI-5, title "Hola", ${word}, ${R1}`)
      expect(cardTitleAtOf(line)).toBe(at)
      expect(cardTitleChoiceOf(line)).toBe(at)
      expect(write(line)).toBe(`WIKI-5, title "Hola", ${word}, ${R1}`)
    }
  })

  it('Default: no part; Never: `notitle`', () => {
    expect(cardTitleChoiceOf(parse(`WIKI-5, title "Hola", ${R1}`))).toBe('default')
    expect(cardTitleChoiceOf(parse(`WIKI-5, title "Hola", notitle, ${R1}`))).toBe('never')
    expect(cardTitleAtOf(parse(`WIKI-5, title "Hola", ${R1}`))).toBeNull()
  })

  it('each choice writes one part at most, after the head, and takes the other one away', () => {
    const base = parse(`WIKI-5, title "Hola", off, next, ${R1}`)
    expect(write(withCardTitleChoice(base, 'front'))).toBe(`WIKI-5, title "Hola", off, next, title-front, ${R1}`)
    expect(write(withCardTitleChoice(withCardTitleChoice(base, 'front'), 'side2'))).toBe(`WIKI-5, title "Hola", off, next, title-side2, ${R1}`)
    expect(write(withCardTitleChoice(withCardTitleChoice(base, 'front'), 'never'))).toBe(`WIKI-5, title "Hola", off, next, notitle, ${R1}`)
    expect(write(withCardTitleChoice(withCardTitleChoice(base, 'never'), 'once'))).toBe(`WIKI-5, title "Hola", off, next, title-once, ${R1}`)
    expect(write(withCardTitleChoice(withCardTitleChoice(base, 'side2'), 'default'))).toBe(`WIKI-5, title "Hola", off, next, ${R1}`)
    // The same choice again is the same line.
    const front = withCardTitleChoice(base, 'front')
    expect(withCardTitleChoice(front, 'front')).toBe(front)
  })

  it('stays put through the other writes (an answer, Up next, Archive card, Fix later)', () => {
    const line = parse(`WIKI-5, title "Hola", title-side2, ${R1}`)
    const after = withCardFix(withCardOff(withCardNext(withCardReview(line, { at: '2026-11-13T10:00:00.000Z', rating: 'again' }), true), true), true)
    expect(cardTitleAtOf(after)).toBe('side2')
    expect(write(after)).toBe(`WIKI-5, title "Hola", off, next, title-side2, fix, ${R1}, 2026-11-13T10:00:00.000Z again`)
  })

  it('is a card line word: never a property name, in any capitals', () => {
    for (const w of ['title-once', 'title-front', 'title-side2', 'Title-Front']) expect(isCardPropertyName(w)).toBe(false)
  })

  it('a word this app does not know stays an unknown part (`title-later`), kept as it is', () => {
    const line = parse(`WIKI-5, title-later, ${R1}`)
    expect(cardTitleAtOf(line)).toBeNull()
    expect(write(line)).toBe(`WIKI-5, title-later, ${R1}`)
  })

  it('a build from before keeps the part, in its place, through its own writes', () => {
    const line = older.withCardReview(older.parseCardLine(`<!-- card: WIKI-5, title-front, ${R1} -->`)!, { at: '2026-11-13T10:00:00.000Z', rating: 'good' })
    expect(older.formatCardLine(line)).toBe(`<!-- card: WIKI-5, title-front, ${R1}, 2026-11-13T10:00:00.000Z good -->`)
    expect(cardTitleAtOf(parse(older.formatCardLine(line)!.replace(/^<!-- card: | -->$/g, '')))).toBe('front')
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

  it('a change from After the front to With Side 2 on one side wins over the side that left it', () => {
    const [t] = uniteCardLines(page(`YAZ-7, title-front, ${R1}`), page(`YAZ-7, title-front, ${R1}, ${T}`), page(`YAZ-7, title-side2, ${R1}`))
    expect(lineOf(t)).toBe(`<!-- card: YAZ-7, title-side2, ${R1}, ${T} -->`)
  })
})

describe('the global default (review.json `titleAt`)', () => {
  it('is At once, so nothing changes for anyone', () => {
    expect(DEFAULT_REVIEW_SETTINGS.titleAt).toBe('once')
    expect(sanitizeReviewSettings({}).titleAt).toBe('once')
  })
  it('keeps each of the three, and drops anything else', () => {
    for (const at of ['once', 'front', 'side2'] as const) expect(sanitizeReviewSettings({ titleAt: at }).titleAt).toBe(at)
    expect(sanitizeReviewSettings({ titleAt: 'never' }).titleAt).toBe('once')
  })
})

describe('`titleShows`: the one rule for a step (Mac and phone)', () => {
  // Two sides: two hidden words on the front, one on Side 2 (words 0, 1 | 2).
  const two = { counts: [2, 1] }
  const at = (sides: number, open: number[]) => ({ ...two, sides, open })
  const shows = (when: 'once' | 'front' | 'side2', step: { counts: number[]; sides: number; open: number[] }, title = 'Hola') => titleShows({ title, at: when, ...step })

  it('At once: from the front', () => {
    expect(shows('once', at(1, []))).toBe(true)
  })

  it('After the front: when the front has no hidden word left; hiding one again takes it away', () => {
    expect(shows('front', at(1, []))).toBe(false)
    expect(shows('front', at(1, [0]))).toBe(false)
    expect(shows('front', at(1, [0, 1]))).toBe(true)
    expect(shows('front', at(1, [1]))).toBe(false)
    // A front with no hidden words: at once.
    expect(shows('front', { counts: [0, 1], sides: 1, open: [] })).toBe(true)
  })

  it('With Side 2: when the last side shows', () => {
    expect(shows('side2', at(1, [0, 1]))).toBe(false)
    expect(shows('side2', at(2, [0, 1]))).toBe(true)
  })

  it('a one-sided card: After the front and With Side 2 wait until it is fully shown; no hidden word: at once', () => {
    const one = (open: number[]) => ({ counts: [2], sides: 1, open })
    for (const when of ['front', 'side2'] as const) {
      expect(shows(when, one([0]))).toBe(false)
      expect(shows(when, one([0, 1]))).toBe(true)
      expect(shows(when, { counts: [0], sides: 1, open: [] })).toBe(true)
    }
  })

  it('a title that holds a hidden-word mark waits until the card is fully shown, whatever the choice', () => {
    for (const when of ['once', 'front', 'side2'] as const) {
      expect(shows(when, at(2, [0, 1]), 'Capital: {{Paris}}')).toBe(false)
      expect(shows(when, at(2, [0, 1, 2]), 'Capital: {{Paris}}')).toBe(true)
    }
  })

  it('no title: nothing to show', () => {
    expect(shows('once', at(1, []), '')).toBe(false)
  })
})
