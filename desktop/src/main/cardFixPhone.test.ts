// YAZ-5430: the contract with the phone (YAZ-5073, YAZ-5409). The phone writes Fix later with its `applyOps`
// (`mobile/src/answers/ops.ts`: `withCardFix` from this repo's `shared/cardLine.ts`, then `spliceCardLine`, which keeps
// every other part's bytes). The lines below are the bytes its own tests pin (`mobile/src/answers/ops.test.ts`,
// `properties.test.ts`, `reviewHost.test.ts`, `send.test.ts` on `feat/yaz-5055-notecards-phone`). The Mac must read each
// as marked, and the Mac's `withCardFix` must write the same bytes from the same line, so the phone reads it back.
import { describe, expect, it } from 'vitest'
import { cardRecords, formatCardLine, isCardFix, parseCardLine, withCardFix } from '@shared/cardLine'

const R0 = '2026-11-01T09:00Z good'
const line = (body: string) => parseCardLine(`<!-- card: ${body} -->`)!
const write = (l: ReturnType<typeof line>) => formatCardLine(l)!.replace(/^<!-- card: | -->$/g, '')

/** [the line before, the line the phone's applyOps wrote for `{ kind: 'fix', on: true }`]. */
const PHONE_WRITES: [string, string][] = [
  ['NC-2', 'NC-2, fix'],
  ['NC-3, off, next', 'NC-3, off, next, fix'],
  [`NC-1, title "T", tags ["x"], notitle, ${R0}`, `NC-1, title "T", tags ["x"], notitle, fix, ${R0}`],
  [`NC-1, title "Capital of Spain", tags "europe" "capitals", level "A2", off, next, ${R0}`, `NC-1, title "Capital of Spain", tags "europe" "capitals", level "A2", off, next, fix, ${R0}`],
  [`NC-1, title "x", tags "a", off, next, ${R0}`, `NC-1, title "x", tags "a", off, next, fix, ${R0}`],
]

/** Lines in an order the phone keeps byte for byte (an older build's, a person's own): each still reads as marked. */
const KEPT_ORDERS = [`NC-1, title "x", off, next, fix, tags "a", ${R0}`, `NC-1, fix, ${R0}, tags "a", next, title "x", off`, `nc-1,title "a, b" ,off,next,fix,level "A2, B1",${R0}`]

describe('Fix later: the phone writes, the Mac reads (YAZ-5430)', () => {
  it.each(PHONE_WRITES)('the phone`s line for %s reads as marked here, in the index record too', (_, written) => {
    expect(isCardFix(line(written))).toBe(true)
    expect(cardRecords(`\`\`\`card\nQ\n\`\`\`\n<!-- card: ${written} -->\n`)[0].fix).toBe(true)
    // A read and a write here change no byte.
    expect(write(line(written))).toBe(written)
  })

  it.each(KEPT_ORDERS)('a line in another order (%s) reads as marked', (body) => {
    expect(isCardFix(line(body))).toBe(true)
  })
})

describe('Fix later: the Mac writes, the phone reads (YAZ-5430)', () => {
  it.each(PHONE_WRITES)('the Mac`s withCardFix on %s writes the bytes the phone writes, and clears back to the line before', (before, written) => {
    const on = withCardFix(line(before), true)
    expect(write(on)).toBe(written)
    expect(write(withCardFix(line(written), false))).toBe(before)
    // The phone reads the mark with `isCardFix` / `card.fix === true`: one part, kind `fix`.
    expect(on.parts.filter((p) => p.kind === 'fix')).toHaveLength(1)
  })
})
