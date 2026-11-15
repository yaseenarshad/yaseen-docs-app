import { describe, expect, it } from 'vitest'
import { formatCardLine, parseCardLine, type CardLine } from '@shared/cardLine'
import { rebaseCardLine } from './cardBlockLine'

/** YAZ-5033: the editor's card line step carries a review's seconds; a review is still its time and its rating. */
const line = (body: string): CardLine => parseCardLine(`<!-- card: ${body} -->`)!
const rebase = (now: string, before: string, after: string) => formatCardLine(rebaseCardLine(line(now), line(before), line(after)))

describe('rebaseCardLine with seconds (YAZ-5033)', () => {
  it('an answer that landed in between keeps its seconds; a timed review added by the step comes with them', () => {
    // The Inbox wrote `again 13s` while the page's ⋯ turned review off: the undo of `off` keeps the timed answer.
    expect(rebase('WIKI-1, off, 2026-11-01T09:00Z good, 2026-11-12T14:05Z again 13s', 'WIKI-1, off, 2026-11-01T09:00Z good', 'WIKI-1, 2026-11-01T09:00Z good')).toBe('<!-- card: WIKI-1, 2026-11-01T09:00Z good, 2026-11-12T14:05Z again 13s -->')
    expect(rebase('WIKI-1', 'WIKI-1', 'WIKI-1, 2026-11-12T14:05Z good 7s')).toBe('<!-- card: WIKI-1, 2026-11-12T14:05Z good 7s -->')
  })

  it('a step that only gives a review its seconds (the copy rule keeps the timed copy) gives them to the line; the inverse takes nothing away', () => {
    expect(rebase('WIKI-1, 2026-11-12T14:05Z good, mochi x1', 'WIKI-1, 2026-11-12T14:05Z good', 'WIKI-1, 2026-11-12T14:05Z good 13s')).toBe('<!-- card: WIKI-1, 2026-11-12T14:05Z good 13s, mochi x1 -->')
    // Removing the review removes it, timed or not.
    expect(rebase('WIKI-1, 2026-11-12T14:05Z good 13s', 'WIKI-1, 2026-11-12T14:05Z good', 'WIKI-1')).toBe('<!-- card: WIKI-1 -->')
  })
})

describe('rebaseCardLine and `fix` (YAZ-5097)', () => {
  it('a Fix later step lays `fix` on the newest line; its undo takes it off; an answer that landed in between stays', () => {
    expect(rebase('WIKI-1, 2026-11-12T14:05Z again 13s', 'WIKI-1', 'WIKI-1, fix')).toBe('<!-- card: WIKI-1, fix, 2026-11-12T14:05Z again 13s -->')
    expect(rebase('WIKI-1, fix, 2026-11-12T14:05Z again 13s', 'WIKI-1, fix', 'WIKI-1')).toBe('<!-- card: WIKI-1, 2026-11-12T14:05Z again 13s -->')
    // A step that did not touch `fix` leaves the phone's mark where it is.
    expect(rebase('WIKI-1, fix', 'WIKI-1', 'WIKI-1, off')).toBe('<!-- card: WIKI-1, off, fix -->')
  })
})
