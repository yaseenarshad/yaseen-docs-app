import { describe, expect, it } from 'vitest'
import { cardRecords, formatCardLine, isCardNoTitle, parseCardLine, withCardNoTitle, EMPTY_CARD_LINE } from '@shared/cardLine'
import { cardBacklinks, cardEmbedders, makeCardResolver } from '@shared/cardLinks'
import { cardPieces, cardSides, cardTitle, cardWithoutTitle, hiddenCount } from '@shared/cardText'
import { makeResolver } from '@shared/linkResolver'
import type { IndexRecord } from '@shared/types'

/** YAZ-5030: a card's title (its first line) shown or hidden on the Inbox's front, and links to a card by its ID (D7). */

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

  it('the index record holds the title (plain text) and the flag; an empty card has no title', () => {
    const page = '```card\n###### {{Capital of France}}\n\nWhat is the capital of {{France}}?\n```\n<!-- card: DEMO-1, notitle -->\n\n```card\nOld card\n```\n<!-- card: DEMO-2 -->\n\n```card\n```\n<!-- card: DEMO-3 -->\n'
    expect(cardRecords(page)).toEqual([
      { id: 'DEMO-1', off: false, next: false, reviews: [], title: 'Capital of France', notitle: true },
      { id: 'DEMO-2', off: false, next: false, reviews: [], title: 'Old card' },
      { id: 'DEMO-3', off: false, next: false, reviews: [] },
    ])
  })

  it('the front without its title (Mochi`s `###### {{Title}}`): the title`s hidden word is no step; the rest is unchanged', () => {
    const text = '###### {{Capital of France}}\n\nWhat is the capital of {{France}}?\n---\n{{Paris}}'
    expect(hiddenCount(cardSides(text)[0])).toBe(2)
    const front = cardWithoutTitle(text)
    expect(front).toBe('What is the capital of {{France}}?\n---\n{{Paris}}')
    expect(cardSides(front).map(hiddenCount)).toEqual([1, 1])
    expect(cardPieces(cardSides(front)[0])).toEqual([{ kind: 'text', text: 'What is the capital of ' }, { kind: 'hidden', text: 'France' }, { kind: 'text', text: '?' }])
    // The title as the label reads it.
    expect(cardTitle(text)).toBe('Capital of France')
    // Leading blank lines stay out of it; a card whose front is only its title keeps its back.
    expect(cardWithoutTitle('\n\nTitle\n---\nBack')).toBe('\n\n---\nBack')
    expect(cardSides(cardWithoutTitle('Title\n---\nBack'))).toEqual(['', 'Back'])
    // No title on the front (an empty first side): nothing comes out.
    expect(cardWithoutTitle('---\nBack')).toBe('---\nBack')
    expect(cardWithoutTitle('')).toBe('')
  })
})

describe('links to a card: `[[DEMO-127]]` (YAZ-5030, D7)', () => {
  const page = rec('/v/Spanish/verbs.md', { cards: [cardOf('DEMO-126', 'Ser'), cardOf(null, 'Draft'), cardOf('DEMO-127', 'Estar', true)] })
  const linker = rec('/v/notes.md', { id: 'DEMO-5', links: ['demo-127', 'Other'] })
  const viaWords = rec('/v/words.md', { links: ['DEMO-127|estar'] })
  const records = [page, linker, viaWords, rec('/v/DEMO-127.md'), rec('/v/note.md', { id: 'DEMO-9' })]

  it('resolves a card`s ID in any case, piped or not, to the card: its page, place and title; a note`s ID or a name is no card', () => {
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

  it('the note resolver finds the card`s PAGE (a link into it), after the notes` own IDs and before names; not in the rename probe', () => {
    const files = records.map((record) => ({ record }))
    const resolve = makeResolver(files, '/v', { letters: ['DEMO'] })
    expect(resolve('DEMO-127')?.record.path).toBe('/v/Spanish/verbs.md')
    // A page merely NAMED like the card's ID never takes its link.
    expect(resolve('[[demo-127]]')?.record.path).toBe('/v/Spanish/verbs.md')
    expect(resolve('DEMO-9')?.record.path).toBe('/v/note.md')
    // The rename probe reads no IDs: a rename of the card's page rewrites no `[[DEMO-127]]`.
    expect(makeResolver(files, '/v', { ids: false })('DEMO-127')?.record.path).toBe('/v/DEMO-127.md')
  })

  it('a card`s backlinks: the pages whose links name its ID, in records order', () => {
    const resolve = makeCardResolver(records, ['DEMO'])
    expect(cardBacklinks(records, 'DEMO-127', resolve).map((r) => r.path)).toEqual(['/v/notes.md', '/v/words.md'])
    expect(cardBacklinks(records, 'DEMO-126', resolve)).toEqual([])
  })

  it('YAZ-5037: a card`s embedders ("Embedded in"): the pages whose `![[ID]]` names it, any case and old letters, never its links', () => {
    const all = [...records, rec('/v/a.md', { embeds: ['demo-127'] }), rec('/v/b.md', { embeds: ['OLD-127', 'Other'] }), rec('/v/c.md', { embeds: ['DEMO-126'] })]
    const resolve = makeCardResolver(all, ['DEMO', 'OLD'])
    expect(cardEmbedders(all, 'DEMO-127', resolve).map((r) => r.path)).toEqual(['/v/a.md', '/v/b.md'])
    // A page that only LINKS to the card is a mention, not an embedder.
    expect(cardEmbedders(all, 'DEMO-127', resolve).some((r) => r.path === '/v/notes.md')).toBe(false)
    expect(cardEmbedders(all, 'DEMO-9', resolve)).toEqual([])
  })
})
