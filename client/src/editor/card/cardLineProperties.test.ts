import { describe, expect, it } from 'vitest'
import { formatCardLine, parseCardLine, type CardLine } from '@shared/cardLine'
import { rebaseCardLine } from './cardBlockLine'

/** YAZ-5383: a card line step (an edit in an open page, and its undo) carries the card's properties (YAZ-5379). */

const line = (body: string): CardLine => parseCardLine(`<!-- card: ${body} -->`)!
const rebase = (now: string, before: string, after: string) => formatCardLine(rebaseCardLine(line(now), line(before), line(after)))

describe('rebaseCardLine carries properties (YAZ-5383)', () => {
  it('a changed value, an added and a removed property land on the line as it is now; the rest of it stays', () => {
    // Between the change and its landing, a review came in: it stays.
    const now = 'WIKI-7, tags "a" "b", level "A2", 2026-11-12T14:05:00.000Z good, 2026-11-13T10:00:00.000Z easy'
    expect(rebase(now, 'WIKI-7, tags "a" "b", level "A2", 2026-11-12T14:05:00.000Z good', 'WIKI-7, tags "a" "b", level "B1", 2026-11-12T14:05:00.000Z good')).toBe(
      '<!-- card: WIKI-7, tags "a" "b", level "B1", 2026-11-12T14:05:00.000Z good, 2026-11-13T10:00:00.000Z easy -->',
    )
    expect(rebase(now, 'WIKI-7, tags "a" "b", level "A2"', 'WIKI-7, tags "a" "b", level "A2", source ""')).toBe(
      '<!-- card: WIKI-7, tags "a" "b", level "A2", source "", 2026-11-12T14:05:00.000Z good, 2026-11-13T10:00:00.000Z easy -->',
    )
    expect(rebase(now, 'WIKI-7, tags "a" "b", level "A2"', 'WIKI-7, level "A2"')).toBe('<!-- card: WIKI-7, level "A2", 2026-11-12T14:05:00.000Z good, 2026-11-13T10:00:00.000Z easy -->')
  })

  it('a rename keeps the place; the undo (the change back) puts the line back byte for byte', () => {
    const before = 'WIKI-7, tags "a" "b", level "A2", 2026-11-12T14:05:00.000Z good'
    const after = 'WIKI-7, topics "a" "b", level "A2", 2026-11-12T14:05:00.000Z good'
    expect(rebase(before, before, after)).toBe(`<!-- card: ${after} -->`)
    expect(rebase(after, after, before)).toBe(`<!-- card: ${before} -->`)
  })

  it('a property the change did not touch is never moved or dropped', () => {
    const now = 'WIKI-7, tags "x", level "A2"'
    expect(rebase(now, 'WIKI-7, off', 'WIKI-7')).toBe('<!-- card: WIKI-7, tags "x", level "A2" -->')
  })
})
