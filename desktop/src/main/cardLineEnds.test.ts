import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cardFileAsPage, cardFromText, moveCardOut, moveTextIntoCard, pageAsCardFile, putCardBack, splitCardFile } from '@shared/cardConvert'
import { cardFileShape } from '@shared/cardFileFormat'
import { cardRecords, changeCard, changeCardText, findCards, pageCards, rewritePageCards, withCardId, withCardNext, withCardNoTitle, withCardOff, withCardReview } from '@shared/cardLine'
import { cardPieces, cardSides, hiddenCount } from '@shared/cardText'
import { cardTitlesMoved } from '@shared/cardTitleSweep'
import { lineKinds, maskCode } from '@shared/fences'
import { inLineEnds, lineEndOf, withLf } from '@shared/lineEnds'
import { scanFile } from './vaultIndex/scan'

/**
 * WINDOWS LINE ENDS (YAZ-5146): a page that ends its lines with `\r\n` has the same cards as its `\n` twin, and each card
 * writer keeps the page's own line end. Every writer test is a twin: the writer on the `\r\n` page gives the `\n` page's
 * result with `\r\n` (no line that ends with `\n` alone), and on the `\n` page a result with no `\r`.
 */

const crlf = (text: string): string => text.replace(/\n/g, '\r\n')
/** No line of `text` ends with `\n` alone. */
const allCrlf = (text: string): boolean => !/(^|[^\r])\n/.test(text)

const PAGE = [
  '---',
  'id: WIKI-100',
  'title: Deck',
  '---',
  '# Pages',
  '',
  '```card',
  'One {{word}}',
  '---',
  'Back',
  '```',
  '<!-- card: WIKI-1, title "One, word", 2026-11-12T14:05Z good -->',
  '',
  '- item',
  '  ```card',
  '  Two `{{code}}` {{1::hidden}}',
  '  ',
  '  ---',
  '  Back two',
  '  ```',
  '',
  '````md',
  '```card',
  'not a card: inside another block',
  '```',
  '````',
  '',
  'Text.',
  '',
].join('\n')

const CARD_FILE = '---\nkind: card\n---\n```card\nThe capital of {{France}}\n---\nParis\n```\n<!-- card: WIKI-1, title "Capital" -->\n'
const OLD_CARD_FILE = '---\nkind: card\ntitle: Capital\n---\n```card\nThe capital of {{France}}\n---\nParis\n```\n<!-- card: WIKI-1 -->\n'
const EMBED_PAGE = '---\nid: WIKI-100\n---\n# Deck\n\n- One\n  ![[WIKI-1]]\n\nEnd.\n'
const ONE_CARD_PAGE = '---\nid: WIKI-100\ntitle: Old\n---\n```card\nCapital\n\nThe {{x}}\n```\n<!-- card: WIKI-1 -->\n'
const MANY_CARD_FILE = '---\nkind: card\ntitle: First\n---\n```card\nA\n```\n<!-- card: WIKI-1 -->\n\n```card\nB title\n\nB\n```\n<!-- card: WIKI-2 -->\n'
const OUTSIDE_CARD_FILE = '---\nkind: card\ntitle: T\n---\nAbove.\n\n```card\nFront\n```\n<!-- card: WIKI-1 -->\n\nBelow.\n'
const NO_CARD_FILE = '---\nkind: card\n---\nJust text\nmore\n'

describe('readers (rule 1): a `\\r\\n` page has the cards, sides, titles and hidden words of its `\\n` twin', () => {
  it('findCards and pageCards: the same cards at the same lines, each card`s text with `\\n`', () => {
    const shape = (cards: ReturnType<typeof findCards>) => cards.map((c) => [c.open, c.close, c.lineAt, c.indent, c.text, c.line])
    expect(pageCards(PAGE)).toHaveLength(2)
    expect(shape(pageCards(crlf(PAGE)))).toEqual(shape(pageCards(PAGE)))
    expect(shape(findCards(crlf(PAGE)))).toEqual(shape(findCards(PAGE)))
    expect(pageCards(crlf(PAGE)).every((c) => !c.text.includes('\r'))).toBe(true)
  })

  it('the index`s card records (IDs, reviews, titles) are the same', () => {
    expect(cardRecords(crlf(PAGE))).toEqual(cardRecords(PAGE))
    expect(cardRecords(PAGE).map((c) => [c.id, c.title])).toEqual([['WIKI-1', 'One, word'], [null, undefined]])
  })

  it('sides and hidden words: the same off the `\\r\\n` page; a text that still holds `\\r` (the editor`s) splits its sides alike', () => {
    const text = 'Title {{a}}\n\nFront `{{code}}`\n---\nBack {{1::b}}'
    const page = `# P\n\n\`\`\`card\n${text}\n\`\`\`\n<!-- card: WIKI-1 -->\n`
    const [mac] = findCards(page)
    const [win] = findCards(crlf(page))
    expect(win.text).toBe(text)
    for (const read of [cardSides, hiddenCount, (t: string) => cardSides(t).map(cardPieces)] as ((t: string) => unknown)[]) expect(read(win.text)).toEqual(read(mac.text))
    // The raw text: two sides, the same hidden words.
    expect(cardSides(crlf(text)).map(withLf)).toEqual(cardSides(text))
    expect(hiddenCount(cardSides(crlf(text))[1])).toBe(1)
  })

  it('the one fence walk: the same kind for each line; the mask keeps its length', () => {
    const lines = PAGE.split('\n')
    expect(lineKinds(crlf(PAGE).split('\n'))).toEqual(lineKinds(lines))
    expect(maskCode(crlf(PAGE))).toHaveLength(crlf(PAGE).length)
  })

  it('a card file`s shape is the same', () => {
    for (const file of [CARD_FILE, MANY_CARD_FILE, OUTSIDE_CARD_FILE, NO_CARD_FILE]) {
      const body = (content: string) => content.slice(content.indexOf('---', 3) + 3).replace(/^\r?\n/, '')
      const { cards, ...rest } = cardFileShape(body(crlf(file)))
      const lf = cardFileShape(body(file))
      expect(rest).toEqual({ before: lf.before, after: lf.after, problem: lf.problem })
      expect(cards.map((c) => c.text)).toEqual(lf.cards.map((c) => c.text))
    }
  })
})

describe('the index (rule 4): the same `cards` records for the two kinds of page', () => {
  let dir: string
  beforeEach(async () => {
    dir = await realpath(await mkdtemp(path.join(tmpdir(), 'yaz-5146-')))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('a page and a card file', async () => {
    for (const [name, content] of [['deck.md', PAGE], ['capital-wiki-1.md', CARD_FILE]]) {
      await writeFile(path.join(dir, `mac-${name}`), content)
      await writeFile(path.join(dir, `win-${name}`), crlf(content))
      const mac = await scanFile(dir, path.join(dir, `mac-${name}`))
      const win = await scanFile(dir, path.join(dir, `win-${name}`))
      expect(mac.cards?.length).toBeGreaterThan(0)
      expect(win.cards).toEqual(mac.cards)
      expect([win.kind, win.title]).toEqual([mac.kind, mac.title])
    }
  })
})

const at = '2026-11-20T09:00Z'
/** Each card writer, as the app calls it: a review, Archive, Up next, hide the title, Edit card`s Done, the ID sweep, the moves and the fixes. */
const WRITERS: [string, string, (content: string) => string][] = [
  ['an answer', PAGE, (c) => changeCard(c, 'WIKI-1', (l) => withCardReview(l, { at, rating: 'good', seconds: 7 }))],
  ['Archive', PAGE, (c) => changeCard(c, 'WIKI-1', (l) => withCardOff(l, true))],
  ['Up next', PAGE, (c) => changeCard(c, 'WIKI-1', (l) => withCardNext(l, true))],
  ['hide the title', PAGE, (c) => changeCard(c, 'WIKI-1', (l) => withCardNoTitle(l, true))],
  ['an empty card line goes', PAGE, (c) => changeCard(c, 'WIKI-1', () => ({ parts: [] }))],
  ['Edit card`s Done', PAGE, (c) => changeCardText(c, 'WIKI-1', 'New front\n\n```js\nx\n```\n---\nNew back\n')],
  ['Edit card`s Done, a card in a list', PAGE, (c) => changeCardText(c, null, 'Two\n---\nBack', 1)],
  ['the ID sweep', PAGE, (c) => rewritePageCards(c, (card, i) => (i === 1 ? withCardId(card.line, 'WIKI-2') : undefined))],
  ['move to a card file (the page)', PAGE, (c) => moveCardOut(c, 'WIKI-1').page],
  ['put back', EMBED_PAGE, (c) => putCardBack(c, 'WIKI-1', 0, crlf(CARD_FILE), 'WIKI-1')],
  ['turn into a page', CARD_FILE, (c) => cardFileAsPage(c).content],
  ['turn into a card file', ONE_CARD_PAGE, (c) => pageAsCardFile(c)!.content],
  ['split (the card file that stays)', MANY_CARD_FILE, (c) => splitCardFile(c)!.keep],
  ['move into the card', OUTSIDE_CARD_FILE, (c) => moveTextIntoCard(c)!],
  ['make a card from the text', NO_CARD_FILE, (c) => cardFromText(c)!],
  ['the one-time title move', OLD_CARD_FILE, (c) => cardTitlesMoved(c)!],
  ['the one-time title move, a card in a page', ONE_CARD_PAGE, (c) => cardTitlesMoved(c)!],
]

describe('writers (rules 2, 3, 6): each writes the page`s own line end, never both', () => {
  it.each(WRITERS)('%s: a `\\r\\n` page stays all `\\r\\n` and holds its `\\n` twin`s result; a `\\n` page gets no `\\r`', (_name, page, write) => {
    const mac = write(page)
    const win = write(crlf(page))
    expect(mac).not.toBe(page)
    expect(mac.includes('\r')).toBe(false)
    expect(allCrlf(win)).toBe(true)
    expect(win).toBe(crlf(mac))
  })

  it('put back into a `\\n` page from a `\\r\\n` card file, and the other way: the page keeps its own line end', () => {
    expect(putCardBack(EMBED_PAGE, 'WIKI-1', 0, crlf(CARD_FILE), 'WIKI-1')).toBe(putCardBack(EMBED_PAGE, 'WIKI-1', 0, CARD_FILE, 'WIKI-1'))
    expect(putCardBack(crlf(EMBED_PAGE), 'WIKI-1', 0, CARD_FILE, 'WIKI-1')).toBe(crlf(putCardBack(EMBED_PAGE, 'WIKI-1', 0, CARD_FILE, 'WIKI-1')))
  })

  it('a NEW card file is written with `\\n`, from a `\\r\\n` page too: move to a card file, split', () => {
    const moved = moveCardOut(crlf(PAGE), 'WIKI-1').card
    expect(moved).toEqual(moveCardOut(PAGE, 'WIKI-1').card)
    expect(moved.content.includes('\r')).toBe(false)
    expect(splitCardFile(crlf(MANY_CARD_FILE))!.cards).toEqual(splitCardFile(MANY_CARD_FILE)!.cards)
  })

  it('a write that changes nothing gives the bytes back as they were', () => {
    const win = crlf(PAGE)
    expect(changeCard(win, 'WIKI-1', (l) => l)).toBe(win)
    expect(changeCardText(win, 'WIKI-1', 'One {{word}}\n---\nBack')).toBe(win)
    expect(rewritePageCards(win, () => undefined)).toBe(win)
  })

  it('rule 7: a `\\r\\n` page the editor saved (its properties `\\r\\n`, its text `\\n`) takes `\\n`, as the editor writes', () => {
    const saved = crlf(PAGE.slice(0, PAGE.indexOf('# Pages'))) + PAGE.slice(PAGE.indexOf('# Pages'))
    expect(lineEndOf(saved)).toBe('\n')
    const next = changeCard(saved, 'WIKI-1', (l) => withCardReview(l, { at, rating: 'good' }))
    expect(next.includes('\r')).toBe(false)
    expect(next).toBe(changeCard(PAGE, 'WIKI-1', (l) => withCardReview(l, { at, rating: 'good' })))
  })
})

describe('the page`s line end (`shared/lineEnds.ts`)', () => {
  it('is the one most lines end with; `\\n` with none and on a tie; a lone `\\r` is no line end', () => {
    expect([lineEndOf(''), lineEndOf('a'), lineEndOf('a\r\nb\r\n'), lineEndOf('a\r\nb\nc\n'), lineEndOf('a\r\nb\n'), lineEndOf('a\rb\r')]).toEqual(['\n', '\n', '\r\n', '\n', '\n', '\n'])
    expect(inLineEnds('a\r\nb\r\n', (t) => `${t}c\n`)).toBe('a\r\nb\r\nc\r\n')
    expect(inLineEnds('a\nb\n', (t) => `${t}c\n`)).toBe('a\nb\nc\n')
  })
})
