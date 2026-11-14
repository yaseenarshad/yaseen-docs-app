import { describe, expect, it } from 'vitest'
import {
  cardFileContent,
  cardFileId,
  cardFileName,
  cardFileShape,
  cardFileTitle,
  cardFileWithBlock,
  indentBlock,
  isCardFileContent,
  isCardKind,
  isCardMark,
  unindentBlock,
} from '@shared/cardFileFormat'
import { findCards, parseCardLine, pageCards } from '@shared/cardLine'
import { splitFrontmatter } from '@shared/frontmatter'

const CARD = ['```card', 'What is the capital of **France**?', '---', 'The capital is {{Paris}}.', '```', '<!-- card: GEO-140, 2026-11-10T09:12Z good 12s -->'].join('\n')
const file = (body: string, props = 'kind: card'): string => `---\n${props}\n---\n${body}`

describe('YAZ-5037 the card file mark', () => {
  it('is `kind: card`, trimmed, any case; any other kind, or `type: card`, is no mark', () => {
    expect(isCardKind({ kind: 'card' })).toBe(true)
    expect(isCardKind({ kind: ' Card ' })).toBe(true)
    expect(isCardKind({ kind: 'book' })).toBe(false)
    expect(isCardKind({ type: 'card' })).toBe(false)
    expect(isCardKind({ kind: ['card'] })).toBe(false)
    expect(isCardMark('kind', 'CARD')).toBe(true)
    expect(isCardMark('kind', 'book')).toBe(false)
  })

  it('is read off the file: properties that do not parse mark nothing; no properties mark nothing', () => {
    expect(isCardFileContent(file(CARD))).toBe(true)
    expect(isCardFileContent(CARD)).toBe(false)
    expect(isCardFileContent('---\nkind: [card\n---\n' + CARD)).toBe(false)
  })
})

describe('YAZ-5037 the shape check', () => {
  const shape = (content: string) => cardFileShape(splitFrontmatter(content).body)

  it('one card and blank lines only: ok', () => {
    expect(shape(file(`\n${CARD}\n\n`))).toMatchObject({ problem: 'ok', before: '', after: '' })
    expect(shape(file(CARD)).cards).toHaveLength(1)
  })

  it('2 or more cards: many, whatever else is there', () => {
    const s = shape(file(`${CARD}\n\n\`\`\`card\nSecond\n\`\`\`\n<!-- card: GEO-141 -->\n\n\`\`\`card\nThird\n\`\`\`\n`))
    expect(s.problem).toBe('many')
    expect(s.cards).toHaveLength(3)
  })

  it('text outside the card: outside, with the text above and below apart', () => {
    const s = shape(file(`Above line\n\n${CARD}\nBelow line\n`))
    expect(s).toMatchObject({ problem: 'outside', before: 'Above line', after: 'Below line' })
  })

  it('no card: none, with the body as the text', () => {
    expect(shape(file('Just some words.\n'))).toMatchObject({ problem: 'none', before: 'Just some words.' })
  })

  it('a card with no card line yet is still the card', () => {
    expect(shape(file('```card\nTitle\n```\n')).problem).toBe('ok')
  })
})

describe('YAZ-5037 a card file is built', () => {
  it('with `kind: card` first, the other properties after (never a `title`, YAZ-5308), and one card of its sides only with its title on its card line', () => {
    const line = parseCardLine('<!-- card: GEO-141 -->')!
    const content = cardFileContent('Capital of France', '---\nParis', line, { tags: ['geo'], title: 'ignored' })
    expect(content).toBe('---\nkind: card\ntags:\n  - geo\n---\n```card\n---\nParis\n```\n<!-- card: GEO-141, title "Capital of France" -->\n')
    expect(isCardFileContent(content)).toBe(true)
    expect(cardFileId(content)).toBe('GEO-141')
    expect(cardFileTitle(content)).toBe('Capital of France')
    // A new card with no text yet: the card is empty, the title on its line.
    expect(cardFileContent('Title', '', line)).toBe('---\nkind: card\n---\n```card\n\n```\n<!-- card: GEO-141, title "Title" -->\n')
  })

  it('from a block byte for byte: the card line, its title and its reviews stay; no line of the card is its title', () => {
    const content = cardFileWithBlock(CARD)
    expect(content).toBe(`---\nkind: card\n---\n${CARD}\n`)
    expect(pageCards(content)[0].text).toBe('What is the capital of **France**?\n---\nThe capital is {{Paris}}.')
    expect(cardFileTitle(content)).toBe('')
    expect(cardFileTitle(cardFileWithBlock('```card\nQ\n```\n<!-- card: GEO-1, title "Mine" -->'))).toBe('Mine')
  })

  it('an indented card comes out without its indent and goes back in with it', () => {
    const page = `- A list\n  ${CARD.split('\n').join('\n  ')}\n`
    const lines = page.split('\n')
    const [card] = findCards(page)
    const block = unindentBlock(lines, card)
    expect(block).toBe(CARD)
    expect(indentBlock(block, '  ')).toBe(lines.slice(1, 7).join('\n'))
  })
})

describe('YAZ-5044 pick 1: a card file is named as a page is', () => {
  it('`<kebab-title>-<id>.md`; the placeholder title and an empty one give `<id>.md`', () => {
    expect(cardFileName('Capital of France', 'GEO-140')).toBe('capital-of-france-geo-140.md')
    expect(cardFileName('Title', 'GEO-141')).toBe('geo-141.md')
    expect(cardFileName('', 'GEO-141')).toBe('geo-141.md')
  })
})
