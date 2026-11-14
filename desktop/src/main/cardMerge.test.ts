// The card rule of sync (YAZ-5089, decision 5 on YAZ-5055): before the line merge, a card answered or marked on both
// sides takes, on each side, the union of the reviews and a three-way result for its marks.
import { describe, expect, it } from 'vitest'
import { uniteCardLines } from '@shared/cardMerge'
import { cardRecords, pageCards } from '@shared/cardLine'
import { splitFrontmatter } from '@shared/frontmatter'

const card = (text: string, line?: string) => `\`\`\`card\n${text}\n\`\`\`\n${line === undefined ? '' : `<!-- card: ${line} -->\n`}`
const page = (...cards: string[]) => `---\nid: YAZ-1\ntitle: Spanish words\n---\n# Spanish words\n\nSome words.\n\n${cards.join('\n')}\nThe end.\n`
const cardsOf = (text: string) => cardRecords(splitFrontmatter(text).body).map(({ title: _t, ...rest }) => rest)
const lineOf = (text: string, n = 0) => {
  const c = pageCards(text)[n]
  return c.lineAt === null ? null : splitFrontmatter(text).body.split('\n')[c.lineAt]
}

const OLD = '2026-11-01T09:00Z good'
const T = '2026-11-13T10:00Z good 4s'
const M = '2026-11-13T10:05Z again 7s'

describe('uniteCardLines', () => {
  it('the same card answered on both sides: each side holds the union of the reviews, in time order, and the same line', () => {
    const base = page(card('Hola', `YAZ-7, ${OLD}`))
    const theirs = page(card('Hola', `YAZ-7, ${OLD}, ${T}`))
    const mine = page(card('Hola', `YAZ-7, ${OLD}, ${M}`))
    const [t, m] = uniteCardLines(base, theirs, mine)
    expect(t).toBe(m)
    expect(lineOf(t)).toBe(`<!-- card: YAZ-7, ${OLD}, ${T}, ${M} -->`)
    // Only the card line changed: the rest of each page is byte for byte.
    expect(t.replace(lineOf(t)!, '')).toBe(theirs.replace(lineOf(theirs)!, ''))
  })

  it('a page with no cards, or no card changed on both sides, comes back as the same strings', () => {
    const plain = '---\ntitle: x\n---\nNo cards here.\r\nNone.\n'
    expect(uniteCardLines(plain, plain.replace('None', 'Some'), plain.replace('No ', 'Not '))).toEqual([plain.replace('None', 'Some'), plain.replace('No ', 'Not ')])
    const base = page(card('A', 'YAZ-7'), card('B', 'YAZ-8'))
    const theirs = page(card('A', `YAZ-7, ${T}`), card('B', 'YAZ-8'))
    const mine = page(card('A', 'YAZ-7'), card('B', `YAZ-8, ${M}`))
    const out = uniteCardLines(base, theirs, mine)
    expect(out[0]).toBe(theirs)
    expect(out[1]).toBe(mine)
  })

  it('one side answers and the other edits the card\'s text: the lines are left for git, which can merge them', () => {
    const base = page(card('Hola\n---\nHello', `YAZ-7, ${OLD}`))
    const theirs = page(card('Hola\n---\nHello!', `YAZ-7, ${OLD}`))
    const mine = page(card('Hola\n---\nHello', `YAZ-7, ${OLD}, ${M}`))
    expect(uniteCardLines(base, theirs, mine)).toEqual([theirs, mine])
  })

  it('one side edits the text and answers, the other answers: the reviews unite, and the text is left for git', () => {
    const base = page(card('Hola\n---\nHello', `YAZ-7, ${OLD}`))
    const theirs = page(card('Hola\n---\nHello!', `YAZ-7, ${OLD}, ${T}`))
    const mine = page(card('Hola\n---\nHello', `YAZ-7, ${OLD}, ${M}`))
    const [t, m] = uniteCardLines(base, theirs, mine)
    expect(lineOf(t)).toBe(lineOf(m))
    expect(cardsOf(t)[0].reviews.map((r) => r.at)).toEqual(['2026-11-01T09:00Z', '2026-11-13T10:00Z', '2026-11-13T10:05Z'])
    expect(pageCards(t)[0].text).toBe('Hola\n---\nHello!')
    expect(pageCards(m)[0].text).toBe('Hola\n---\nHello')
  })

  it('marks: a three-way result for `off`, `next` and unknown parts such as `fix`; the reviews still unite', () => {
    // Theirs archives the card and answers; mine answers (the answer takes `next` away) and adds `fix`.
    const base = page(card('Hola', `YAZ-7, next, ${OLD}`))
    const theirs = page(card('Hola', `YAZ-7, off, next, ${OLD}, ${T}`))
    const mine = page(card('Hola', `YAZ-7, ${OLD}, ${M}, fix`))
    const [t, m] = uniteCardLines(base, theirs, mine)
    expect(t).toBe(m)
    expect(lineOf(t)).toBe(`<!-- card: YAZ-7, off, ${OLD}, ${T}, ${M}, fix -->`)
  })

  it('marks changed on one side only, the reviews on both: the one change stays', () => {
    const base = page(card('Hola', `YAZ-7, off, notitle, future-part, ${OLD}`))
    const theirs = page(card('Hola', `YAZ-7, notitle, future-part, ${OLD}, ${T}`)) // unarchived, and answered
    const mine = page(card('Hola', `YAZ-7, off, notitle, future-part, ${OLD}, ${M}`))
    const [t, m] = uniteCardLines(base, theirs, mine)
    expect(t).toBe(m)
    expect(lineOf(t)).toBe(`<!-- card: YAZ-7, notitle, future-part, ${OLD}, ${T}, ${M} -->`)
  })

  it('marks only, on both sides (no answer): one side puts the card up next, the other archives it', () => {
    const base = page(card('Hola', `YAZ-7, ${OLD}`))
    const theirs = page(card('Hola', `YAZ-7, next, ${OLD}`))
    const mine = page(card('Hola', `YAZ-7, off, ${OLD}`))
    const [t, m] = uniteCardLines(base, theirs, mine)
    expect(t).toBe(m)
    expect(cardsOf(t)).toEqual([{ id: 'YAZ-7', off: true, next: true, reviews: [{ at: '2026-11-01T09:00Z', rating: 'good' }] }])
  })

  it('the same review on both sides is one review; a timed copy of it wins', () => {
    const base = page(card('Hola', 'YAZ-7'))
    const [t, m] = uniteCardLines(base, page(card('Hola', 'YAZ-7, 2026-11-13T10:00Z good')), page(card('Hola', 'YAZ-7, 2026-11-13T10:00Z good 4s, next')))
    expect(t).toBe(m)
    expect(lineOf(t)).toBe('<!-- card: YAZ-7, 2026-11-13T10:00Z good 4s, next -->')
  })

  it('a card that moved pages (a convert on one side) is not united: the page with it is left for the line merge', () => {
    const base = page(card('Hola', `YAZ-7, ${OLD}`), card('Adios', 'YAZ-8'))
    const theirs = page(card('Adios', 'YAZ-8'), '![[YAZ-7]]\n')
    const mine = page(card('Hola', `YAZ-7, ${OLD}, ${M}`), card('Adios', 'YAZ-8'))
    expect(uniteCardLines(base, theirs, mine)).toEqual([theirs, mine])
  })

  it('the card moved inside the page on one side and was answered on both: it unites by ID', () => {
    const base = page(card('Hola', `YAZ-7, ${OLD}`), card('Adios', 'YAZ-8'))
    const theirs = page(card('Adios', 'YAZ-8'), card('Hola', `YAZ-7, ${OLD}, ${T}`))
    const mine = page(card('Hola', `YAZ-7, ${OLD}, ${M}`), card('Adios', 'YAZ-8'))
    const [t, m] = uniteCardLines(base, theirs, mine)
    expect(lineOf(t, 1)).toBe(`<!-- card: YAZ-7, ${OLD}, ${T}, ${M} -->`)
    expect(lineOf(m, 0)).toBe(`<!-- card: YAZ-7, ${OLD}, ${T}, ${M} -->`)
  })

  it('a card file: one card answered on both sides unites, and its properties stay byte for byte', () => {
    const file = (line: string) => `---\nkind: card\ntitle: "Capital: France"\ncreated: 2026-11-01\n---\n${card('Capital of {{France}}\n---\nParis', line)}`
    const [t, m] = uniteCardLines(file(`YAZ-9, ${OLD}`), file(`YAZ-9, ${OLD}, ${T}`), file(`YAZ-9, ${OLD}, ${M}`))
    expect(t).toBe(m)
    expect(t).toBe(file(`YAZ-9, ${OLD}, ${T}, ${M}`))
  })

  it('a page with Windows line ends keeps them', () => {
    const crlf = (s: string) => s.replace(/\n/g, '\r\n')
    const [t, m] = uniteCardLines(crlf(page(card('Hola', 'YAZ-7'))), crlf(page(card('Hola', `YAZ-7, ${T}`))), crlf(page(card('Hola', `YAZ-7, ${M}`))))
    expect(t).toBe(m)
    expect(t).toBe(crlf(page(card('Hola', `YAZ-7, ${T}, ${M}`))))
  })

  it('a new card with one ID on both sides (not in the base): united only when the text is the same', () => {
    const base = page()
    const [t1, m1] = uniteCardLines(base, page(card('Hola', `YAZ-7, ${T}`)), page(card('Hola', `YAZ-7, ${M}`)))
    expect(t1).toBe(m1)
    const theirs = page(card('Hola', `YAZ-7, ${T}`))
    const mine = page(card('Gato', `YAZ-7, ${M}`))
    expect(uniteCardLines(base, theirs, mine)).toEqual([theirs, mine])
    // No base at all (the page is new on both sides): the same rule.
    const [t2, m2] = uniteCardLines(null, page(card('Hola', `YAZ-7, ${T}`)), page(card('Hola', `YAZ-7, ${M}`)))
    expect(t2).toBe(m2)
    expect(uniteCardLines(null, theirs, mine)).toEqual([theirs, mine])
  })

  it('an ID that two cards share on one side (a copy the sweep has not met) is left alone', () => {
    const base = page(card('Hola', 'YAZ-7'))
    const theirs = page(card('Hola', `YAZ-7, ${T}`), card('Hola', 'YAZ-7'))
    const mine = page(card('Hola', `YAZ-7, ${M}`))
    expect(uniteCardLines(base, theirs, mine)).toEqual([theirs, mine])
  })
})
