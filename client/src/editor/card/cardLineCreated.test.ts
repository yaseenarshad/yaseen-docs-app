import { describe, expect, it } from 'vitest'
import { cardCreatedOf, formatCardLine, parseCardLine, type CardLine } from '@shared/cardLine'
import { rebaseCardLine } from './cardBlockLine'

const STAMP = '2026-11-21T16:05:31.204Z'
const STAMP_2 = '2026-11-22T08:00:00.000Z'
const R1 = '2026-11-21T18:00:00.000Z good'
const R2 = '2026-11-22T09:00:00.000Z easy'

const line = (body: string): CardLine => parseCardLine(`<!-- card: ${body} -->`)!
const rebase = (now: string, before: string, after: string) => formatCardLine(rebaseCardLine(line(now), line(before), line(after)))

describe('rebaseCardLine preserves and rebases created for undo safety (YAZ-6166)', () => {
  it('leaves created (including non-canonical raw bytes) untouched when another part is undone', () => {
    const now = `WIKI-7, created 2026-11-21, title "Card", off, ${R1}, ${R2}`
    const before = `WIKI-7, created 2026-11-21, title "Card", off, ${R1}`
    const after = `WIKI-7, created 2026-11-21, title "Card", ${R1}`
    expect(rebase(now, before, after)).toBe(`<!-- card: WIKI-7, created 2026-11-21, title "Card", ${R1}, ${R2} -->`)
  })

  it('applies a created change cleanly while keeping reviews that landed in between', () => {
    const now = `WIKI-7, title "Card", ${R1}, ${R2}`
    const added = rebaseCardLine(line(now), line(`WIKI-7, title "Card", ${R1}`), line(`WIKI-7, created ${STAMP}, title "Card", ${R1}`))
    expect(cardCreatedOf(added)).toBe(STAMP)
    expect(formatCardLine(added)).toBe(`<!-- card: WIKI-7, created ${STAMP}, title "Card", ${R1}, ${R2} -->`)

    // Undo of adding created removes created and still keeps R2.
    const undone = rebaseCardLine(added, line(`WIKI-7, created ${STAMP}, title "Card", ${R1}`), line(`WIKI-7, title "Card", ${R1}`))
    expect(cardCreatedOf(undone)).toBeNull()
    expect(formatCardLine(undone)).toBe(`<!-- card: WIKI-7, title "Card", ${R1}, ${R2} -->`)
  })

  it('updates created in place when changed in a step', () => {
    const now = `WIKI-7, created ${STAMP}, title "Card", ${R1}`
    expect(rebase(now, `WIKI-7, created ${STAMP}`, `WIKI-7, created ${STAMP_2}`)).toBe(
      `<!-- card: WIKI-7, created ${STAMP_2}, title "Card", ${R1} -->`,
    )
  })
})
