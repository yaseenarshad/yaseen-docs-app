import { describe, expect, it } from 'vitest'
import {
  cardFileContent,
  cardFileId,
  cardFileName,
  cardFileShape,
  cardFileWithBlock,
  indentBlock,
  isCardFileContent,
  isCardKind,
  isCardMark,
  unindentBlock,
} from '@shared/cardFileFormat'
import { cardFileTitle, cardFileTitleMoved, hasTitleProperty } from '@shared/cardConvert'
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
  it('with `kind: card` first, its `title` (YAZ-5044), the other properties after, and one card of its sides only; the fence is the one `cardBlock` writes', () => {
    const line = parseCardLine('<!-- card: GEO-141 -->')!
    const content = cardFileContent('Capital of France', '---\nParis', line, { tags: ['geo'], title: 'ignored' })
    expect(content).toBe('---\nkind: card\ntitle: Capital of France\ntags:\n  - geo\n---\n```card\n---\nParis\n```\n<!-- card: GEO-141 -->\n')
    expect(isCardFileContent(content)).toBe(true)
    expect(cardFileId(content)).toBe('GEO-141')
    expect(cardFileTitle(content)).toBe('Capital of France')
    expect(hasTitleProperty(content)).toBe(true)
    // A new card with no text yet: the card is empty, the title is the file's.
    expect(cardFileContent('Title', '', line)).toBe('---\nkind: card\ntitle: Title\n---\n```card\n\n```\n<!-- card: GEO-141 -->\n')
  })

  it('from a block byte for byte: the card line and its reviews stay; with no `title` yet, the title reads off the card`s first line', () => {
    const content = cardFileWithBlock(CARD)
    expect(content).toBe(`---\nkind: card\n---\n${CARD}\n`)
    expect(pageCards(content)[0].text).toBe('What is the capital of **France**?\n---\nThe capital is {{Paris}}.')
    expect(hasTitleProperty(content)).toBe(false)
    expect(cardFileTitle(content)).toBe('What is the capital of France?')
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

describe('YAZ-5044 decision A: the one-time move of a card file`s title into `title`', () => {
  it('moves the card`s first line into `title` (plain text); the card line, its reviews, the other properties and the rest of the card stay', () => {
    const before = file(`${CARD}\n`, '# comments: - {by: <name>, body: <text>}\nkind: card\ntags: [geo]')
    const after = cardFileTitleMoved(before)!
    expect(after).toBe(`---\n# comments: - {by: <name>, body: <text>}\nkind: card\ntags: [geo]\ntitle: What is the capital of France?\n---\n\`\`\`card\n---\nThe capital is {{Paris}}.\n\`\`\`\n${CARD.split('\n').at(-1)}\n`)
    expect(cardFileTitle(after)).toBe('What is the capital of France?')
    expect(pageCards(after)[0].line).toEqual(pageCards(before)[0].line)
    // One time only: a file with a `title` moves nothing more.
    expect(cardFileTitleMoved(after)).toBeNull()
  })

  it('the blank lines after the title go with it; a placeholder "Title" leaves an empty card', () => {
    expect(cardFileTitleMoved(file('```card\nLongest river\n\n---\nThe {{Nile}}.\n```\n<!-- card: GEO-205 -->\n'))).toBe(file('```card\n---\nThe {{Nile}}.\n```\n<!-- card: GEO-205 -->\n', 'kind: card\ntitle: Longest river'))
    expect(cardFileTitleMoved(file('```card\nTitle\n```\n<!-- card: GEO-210 -->\n'))).toBe(file('```card\n\n```\n<!-- card: GEO-210 -->\n', 'kind: card\ntitle: Title'))
  })

  it('a title line with a hidden word, or a code line, stays in the card: nothing to answer is lost', () => {
    const cloze = file('```card\nThe capital is {{Paris}}\n```\n<!-- card: GEO-9 -->\n')
    expect(cardFileTitleMoved(cloze)).toBe(file('```card\nThe capital is {{Paris}}\n```\n<!-- card: GEO-9 -->\n', 'kind: card\ntitle: The capital is Paris'))
  })

  it('with `dropPageId` the stray page `id:` goes in the same write', () => {
    expect(cardFileTitleMoved(file('```card\nTest\n```\n<!-- card: GEO-212 -->\n', 'kind: card\nid: GEO-198'), true)).toBe(file('```card\n\n```\n<!-- card: GEO-212 -->\n', 'kind: card\ntitle: Test'))
  })

  it('nothing to move: a page, a card file with a `title`, one with no card, or a card with no title', () => {
    expect(cardFileTitleMoved(`${CARD}\n`)).toBeNull()
    expect(cardFileTitleMoved(file(`${CARD}\n`, 'kind: card\ntitle: Kept'))).toBeNull()
    expect(cardFileTitleMoved(file('Just words.\n'))).toBeNull()
    expect(cardFileTitleMoved(file('```card\n---\nBack\n```\n'))).toBeNull()
  })
})
