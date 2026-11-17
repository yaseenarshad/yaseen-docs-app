// YAZ-5709: the title's own step. Yaseen: "the third click would then reveal the title. And then the fourth click
// would then reveal the backside", and "after first click, the title should be one click by itself". `nextStep` is
// the one walk of the plain steps (Space, a tap on the card) on the Mac and the phone.
import { describe, expect, it } from 'vitest'
import { START, nextStep, reveal, type Reveal } from './cardSteps'
import type { TitleStep } from '@shared/cardTitleShows'
import { titleStepOf } from '@shared/cardTitleShows'

/** What each plain step shows, from the front to the end: a word's number, "title", or "Side N". */
function walk(counts: number[], title: TitleStep, from: Reveal = START): string[] {
  const out: string[] = []
  let r = from
  for (let n = nextStep(r, counts, title); n !== null; n = nextStep(r, counts, title)) {
    out.push(n.titled && !r.titled ? 'title' : n.sides > r.sides ? `Side ${n.sides}` : `word ${n.open.find((w) => !r.open.includes(w))}`)
    r = n
  }
  return out
}

describe('Before Side 2: the title is its own step, just before Side 2', () => {
  it('2 hidden words on the front + 1 on the back = 5 steps: word, word, title, Side 2, back word', () => {
    expect(walk([2, 1], 'side2')).toEqual(['word 0', 'word 1', 'title', 'Side 2', 'word 2'])
  })

  it('a card of 3 sides: before Side 2, not before the last side', () => {
    expect(walk([1, 1, 0], 'side2')).toEqual(['word 0', 'title', 'Side 2', 'word 1', 'Side 3'])
  })

  it('a one-sided card: the last step, after every hidden word; with none, the one step', () => {
    expect(walk([2], 'side2')).toEqual(['word 0', 'word 1', 'title'])
    expect(walk([0], 'side2')).toEqual(['title'])
  })

  it('no hidden word on the front: the title, then Side 2', () => {
    expect(walk([0, 1], 'side2')).toEqual(['title', 'Side 2', 'word 0'])
  })
})

describe('After the first click: the title is step 1, by itself', () => {
  it('2 hidden words on the front + 1 on the back: title, word, word, Side 2, back word', () => {
    expect(walk([2, 1], 'first')).toEqual(['title', 'word 0', 'word 1', 'Side 2', 'word 2'])
  })

  it('a one-sided card with nothing hidden: the title is the one step', () => {
    expect(walk([0], 'first')).toEqual(['title'])
  })

  it('a click on a blank shows that word only: the title still waits for its own step', () => {
    const clicked = reveal(START, 1, 2)
    expect(clicked.titled).toBe(false)
    expect(walk([2, 1], 'first', clicked)).toEqual(['title', 'word 0', 'Side 2', 'word 2'])
  })
})

describe('no title step: the steps as before', () => {
  it('Always, no title, and a title holding a hidden-word mark (it waits until the card is fully shown)', () => {
    expect(titleStepOf('Hola', 'always')).toBe(null)
    expect(titleStepOf('', 'side2')).toBe(null)
    expect(titleStepOf('Capital: {{Paris}}', 'click')).toBe(null)
    expect(titleStepOf('Hola', 'click')).toBe('first')
    expect(titleStepOf('Hola', 'side2')).toBe('side2')
    expect(walk([2, 1], null)).toEqual(['word 0', 'word 1', 'Side 2', 'word 2'])
    expect(walk([0], null)).toEqual([])
  })
})
