import { describe, expect, it } from 'vitest'
import { cardRecords, cardTitleOf, formatCardLine, isCardNoTitle, parseCardLine, withCardNext, withCardNoTitle, withCardOff, withCardTitle, EMPTY_CARD_LINE } from '@shared/cardLine'
import { cardBacklinks, cardEmbedders, makeCardResolver } from '@shared/cardLinks'
import { cardTitlesMoved, firstLineTitle } from '@shared/cardTitleSweep'
import { makeResolver } from '@shared/linkResolver'
import type { IndexRecord } from '@shared/types'

/** YAZ-5308: a card's title on its card line, shown or hidden on the Inbox's front (YAZ-5030), and links to a card by its ID (D7). */

const rec = (path: string, extra: Partial<IndexRecord> = {}): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const basename = name.replace(/\.md$/, '')
  return { path, name, basename, title: basename, folder: '', ext: 'md', size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [], ...extra }
}
const cardOf = (id: string | null, title?: string, notitle = false) => ({ id, off: false, next: false, reviews: [], ...(title !== undefined && { title }), ...(notitle && { notitle: true as const }) })

describe('the title on the front: the card line part `notitle` (YAZ-5030)', () => {
  it('reads and writes `notitle` byte for byte; absent (every old card) the title shows', () => {
    const text = '<!-- card: DEMO-127, off, notitle, 2026-11-12T14:05Z good -->'
    const line = parseCardLine(text)!
    expect(isCardNoTitle(line)).toBe(true)
    expect(formatCardLine(line)).toBe(text)
    expect(isCardNoTitle(parseCardLine('<!-- card: DEMO-127, 2026-11-12T14:05Z good -->')!)).toBe(false)
  })

  it('Hide puts `notitle` after the ID and any `off` / `next`; Show removes it; the same state writes nothing new', () => {
    const plain = parseCardLine('<!-- card: DEMO-1, off, next, 2026-11-12T14:05Z good -->')!
    const hidden = withCardNoTitle(plain, true)
    expect(formatCardLine(hidden)).toBe('<!-- card: DEMO-1, off, next, notitle, 2026-11-12T14:05Z good -->')
    expect(withCardNoTitle(hidden, true)).toBe(hidden)
    expect(formatCardLine(withCardNoTitle(hidden, false))).toBe('<!-- card: DEMO-1, off, next, 2026-11-12T14:05Z good -->')
    expect(formatCardLine(withCardNoTitle(EMPTY_CARD_LINE, true))).toBe('<!-- card: notitle -->')
  })

  it('the index record holds the title off the card line and the flag; no line of the text is a title', () => {
    const page = '```card\n###### {{Capital of France}}\n\nWhat is the capital of {{France}}?\n```\n<!-- card: DEMO-1, title "Capital", notitle -->\n\n```card\nOld card\n```\n<!-- card: DEMO-2 -->\n\n```card\n```\n<!-- card: DEMO-3 -->\n'
    expect(cardRecords(page)).toEqual([
      { id: 'DEMO-1', off: false, next: false, reviews: [], title: 'Capital', notitle: true },
      { id: 'DEMO-2', off: false, next: false, reviews: [] },
      { id: 'DEMO-3', off: false, next: false, reviews: [] },
    ])
  })
})

describe('YAZ-5308 decision D: the title is a part of the card line', () => {
  it('reads and writes `title "…"` byte for byte, right after the ID', () => {
    const text = '<!-- card: DEMO-196, title "Capital of France", 2026-11-12T14:05Z good -->'
    const line = parseCardLine(text)!
    expect(cardTitleOf(line)).toBe('Capital of France')
    expect(formatCardLine(line)).toBe(text)
    expect(cardTitleOf(parseCardLine('<!-- card: DEMO-196 -->')!)).toBe('')
  })

  it('a comma in a title is no part break', () => {
    const line = withCardTitle(parseCardLine('<!-- card: DEMO-1, 2026-11-12T14:05Z good -->')!, 'Paris, France')
    const text = formatCardLine(line)!
    expect(text).toBe('<!-- card: DEMO-1, title "Paris, France", 2026-11-12T14:05Z good -->')
    expect(cardTitleOf(parseCardLine(text)!)).toBe('Paris, France')
    expect(parseCardLine(text)!.parts.map((p) => p.kind)).toEqual(['id', 'title', 'review'])
  })

  it('a quote and a backslash in a title are escaped, and read back as they were', () => {
    const title = 'The "City" of \\ Light'
    const text = formatCardLine(withCardTitle(EMPTY_CARD_LINE, title))!
    expect(text).toBe('<!-- card: title "The \\"City\\" of \\\\ Light" -->')
    expect(cardTitleOf(parseCardLine(text)!)).toBe(title)
  })

  it('a `-->` in a title never ends the line', () => {
    const title = 'a --> b'
    const text = formatCardLine(withCardTitle(parseCardLine('<!-- card: DEMO-1 -->')!, title))!
    expect(text).toBe('<!-- card: DEMO-1, title "a --\\> b" -->')
    expect(text.indexOf('-->')).toBe(text.length - 3)
    expect(cardTitleOf(parseCardLine(text)!)).toBe(title)
  })

  it('a title is plain text on one line; an empty one removes the part; the same one gives the same line', () => {
    const line = parseCardLine('<!-- card: DEMO-1, off, 2026-11-12T14:05Z good -->')!
    const titled = withCardTitle(line, '  Capital\n of   France ')
    expect(formatCardLine(titled)).toBe('<!-- card: DEMO-1, title "Capital of France", off, 2026-11-12T14:05Z good -->')
    expect(withCardTitle(titled, 'Capital of France')).toBe(titled)
    expect(formatCardLine(withCardTitle(titled, 'City'))).toBe('<!-- card: DEMO-1, title "City", off, 2026-11-12T14:05Z good -->')
    expect(formatCardLine(withCardTitle(titled, '  '))).toBe('<!-- card: DEMO-1, off, 2026-11-12T14:05Z good -->')
    // An empty title in a line is no title.
    expect(cardTitleOf(parseCardLine('<!-- card: DEMO-1, title "" -->')!)).toBe('')
  })

  it('`off`, `next` and `notitle` go after the ID and the title', () => {
    const line = parseCardLine('<!-- card: DEMO-1, title "Ser", 2026-11-12T14:05Z good -->')!
    expect(formatCardLine(withCardNoTitle(withCardNext(withCardOff(line, true), true), true))).toBe('<!-- card: DEMO-1, title "Ser", off, next, notitle, 2026-11-12T14:05Z good -->')
  })

  it('a quote never closed keeps the rest of the line as one unknown part, written back as it was', () => {
    const text = '<!-- card: DEMO-1, title "open, 2026-11-12T14:05Z good -->'
    const line = parseCardLine(text)!
    expect(cardTitleOf(line)).toBe('')
    expect(formatCardLine(line)).toBe(text)
  })
})

describe('YAZ-5308: the one-time move of each card title onto its card line', () => {
  it('a card in a page: a plain first line with more front below it moves, with the blank lines after it', () => {
    expect(firstLineTitle('Longest river\n\nWhich is it?\n---\nThe {{Nile}}.')).toEqual({ title: 'Longest river', text: 'Which is it?\n---\nThe {{Nile}}.' })
    expect(firstLineTitle('# **Capital** of France\nThe capital is {{Paris}}.')).toEqual({ title: 'Capital of France', text: 'The capital is {{Paris}}.' })
  })

  it('a first line that is not plain text, or that is the whole front, stays as the question', () => {
    for (const text of ['###### {{Capital of France}}\n\nWhat is it?\n---\nParis', '```js\nlet x = 1\n```\nWhat is x?', 'Hear it ![[tone.mp3]]\nWhich note?', 'See ![map](map.png)\nWhere?', 'About [[Paris]]\nWhat?', 'Which river runs through Paris?\n---\nThe Seine', '---\nBack', '']) // rename-note-to-page: keep (a musical note)
      expect(firstLineTitle(text)).toEqual({ title: '', text })
  })

  it('moves each card of a page; a card with a title on its line is left; the rest stays byte for byte', () => {
    const page = '---\ntags: [geo]\n---\nIntro\n\n```card\nLongest river\n\nWhich is it?\n---\nThe {{Nile}}.\n```\n<!-- card: DEMO-1, 2026-11-12T14:05Z good -->\n\n  ```card\n  Capital\n  Of {{France}}?\n  ```\n\n```card\nKept\nfront\n```\n<!-- card: DEMO-3, title "Own" -->\n'
    expect(cardTitlesMoved(page)).toBe(
      '---\ntags: [geo]\n---\nIntro\n\n```card\nWhich is it?\n---\nThe {{Nile}}.\n```\n<!-- card: DEMO-1, title "Longest river", 2026-11-12T14:05Z good -->\n\n  ```card\n  Of {{France}}?\n  ```\n  <!-- card: title "Capital" -->\n\n```card\nKept\nfront\n```\n<!-- card: DEMO-3, title "Own" -->\n',
    )
    // Done: nothing moves twice.
    expect(cardTitlesMoved(cardTitlesMoved(page)!)).toBeNull()
  })

  it('a card file: its `title` property goes onto its card line and leaves its properties', () => {
    const file = '---\nkind: card\ntitle: Capital of France\ntags: [geo]\n---\n```card\nThe capital is {{Paris}}.\n```\n<!-- card: DEMO-196, 2026-11-12T14:05Z good -->\n'
    expect(cardTitlesMoved(file)).toBe('---\nkind: card\ntags: [geo]\n---\n```card\nThe capital is {{Paris}}.\n```\n<!-- card: DEMO-196, title "Capital of France", 2026-11-12T14:05Z good -->\n')
  })

  it('keeps the file`s own line end (YAZ-5146)', () => {
    const page = '```card\r\nRiver\r\nWhich?\r\n```\r\n<!-- card: DEMO-1 -->\r\n'
    expect(cardTitlesMoved(page)).toBe('```card\r\nWhich?\r\n```\r\n<!-- card: DEMO-1, title "River" -->\r\n')
  })
})

describe('links to a card: `[[DEMO-127]]` (YAZ-5030, D7)', () => {
  const page = rec('/v/Spanish/verbs.md', { cards: [cardOf('DEMO-126', 'Ser'), cardOf(null, 'Draft'), cardOf('DEMO-127', 'Estar', true)] })
  const linker = rec('/v/pages.md', { id: 'DEMO-5', links: ['demo-127', 'Other'] })
  const viaWords = rec('/v/words.md', { links: ['DEMO-127|estar'] })
  const records = [page, linker, viaWords, rec('/v/DEMO-127.md'), rec('/v/page.md', { id: 'DEMO-9' })]

  it('resolves a card`s ID in any case, piped or not, to the card: its page, place and title; a page`s ID or a name is no card', () => {
    const resolve = makeCardResolver(records, ['DEMO'])
    expect(resolve('[[DEMO-127]]')).toEqual({ id: 'DEMO-127', path: '/v/Spanish/verbs.md', index: 2, title: 'Estar', notitle: true })
    expect(resolve('demo-127')?.index).toBe(2)
    expect(resolve('DEMO-127|estar')?.id).toBe('DEMO-127')
    expect(resolve('DEMO-126')?.title).toBe('Ser')
    expect(resolve('DEMO-9')).toBeNull()
    expect(resolve('Other')).toBeNull()
    expect(resolve('DEMO-999')).toBeNull()
    // Letters the vault had before read as the same number.
    expect(makeCardResolver(records, ['NEW', 'DEMO'])('NEW-127')?.id).toBe('DEMO-127')
  })

  it('the page resolver finds the card`s PAGE (a link into it), after the pages` own IDs and before names; not in the rename probe', () => {
    const files = records.map((record) => ({ record }))
    const resolve = makeResolver(files, '/v', { letters: ['DEMO'] })
    expect(resolve('DEMO-127')?.record.path).toBe('/v/Spanish/verbs.md')
    // A page merely NAMED like the card's ID never takes its link.
    expect(resolve('[[demo-127]]')?.record.path).toBe('/v/Spanish/verbs.md')
    expect(resolve('DEMO-9')?.record.path).toBe('/v/page.md')
    // The rename probe reads no IDs: a rename of the card's page rewrites no `[[DEMO-127]]`.
    expect(makeResolver(files, '/v', { ids: false })('DEMO-127')?.record.path).toBe('/v/DEMO-127.md')
  })

  it('a card`s backlinks: the pages whose links name its ID, in records order', () => {
    const resolve = makeCardResolver(records, ['DEMO'])
    expect(cardBacklinks(records, 'DEMO-127', resolve).map((r) => r.path)).toEqual(['/v/pages.md', '/v/words.md'])
    expect(cardBacklinks(records, 'DEMO-126', resolve)).toEqual([])
  })

  it('YAZ-5037: a card`s embedders ("Embedded in"): the pages whose `![[ID]]` names it, any case and old letters, never its links', () => {
    const all = [...records, rec('/v/a.md', { embeds: ['demo-127'] }), rec('/v/b.md', { embeds: ['OLD-127', 'Other'] }), rec('/v/c.md', { embeds: ['DEMO-126'] })]
    const resolve = makeCardResolver(all, ['DEMO', 'OLD'])
    expect(cardEmbedders(all, 'DEMO-127', resolve).map((r) => r.path)).toEqual(['/v/a.md', '/v/b.md'])
    // A page that only LINKS to the card is a mention, not an embedder.
    expect(cardEmbedders(all, 'DEMO-127', resolve).some((r) => r.path === '/v/pages.md')).toBe(false)
    expect(cardEmbedders(all, 'DEMO-9', resolve)).toEqual([])
  })
})
