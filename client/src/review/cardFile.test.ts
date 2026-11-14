/**
 * A card as review reads it (YAZ-5308, decision D): its title is on its card line wherever it lives, never its text,
 * never a card file's properties. Both kinds of card read alike; a card file's card says so (`cardFile`).
 */
import { describe, expect, it, vi } from 'vitest'
import { cardInContent, readCard } from './cardFile'

const files = vi.hoisted(() => new Map<string, string>())
vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>()
  return { ...real, api: { ...real.api, readFile: vi.fn(async (path: string) => ({ path, content: files.get(path)!, mtime: 1, size: 1 })) } }
})

const CARD = '```card\nWhat is it?\n---\nThe capital is {{Paris}}.\n```\n<!-- card: GEO-140, title "Capital of France", notitle -->\n'
const FILE = `---\nkind: card\n---\n${CARD}`

describe('a card`s title is its card line`s (YAZ-5308)', () => {
  it('a card file`s card: the title off its line, its text its sides only, marked as a card file`s', () => {
    const card = cardInContent('/v/c.md', FILE, 'GEO-140', 0)!
    expect(card).toMatchObject({ text: 'What is it?\n---\nThe capital is {{Paris}}.', title: 'Capital of France', notitle: true, cardFile: true })
  })

  it('the Inbox`s read: the same card, the same title; the text holds no title line', async () => {
    files.set('/v/c.md', FILE)
    expect(await readCard('/v/c.md', 'GEO-140')).toMatchObject({ text: 'What is it?\n---\nThe capital is {{Paris}}.', title: 'Capital of France', notitle: true })
  })

  it('a card in a page reads alike; a card with no title on its line has none, whatever its first line', () => {
    const page = `---\ntitle: Europe\n---\n${CARD}\n\`\`\`card\nCapital of Spain\n---\nMadrid\n\`\`\`\n<!-- card: GEO-1 -->\n`
    const first = cardInContent('/v/p.md', page, 'GEO-140', 0)!
    expect([first.title, first.cardFile]).toEqual(['Capital of France', undefined])
    expect(cardInContent('/v/p.md', page, 'GEO-1', 1)).toMatchObject({ title: '', text: 'Capital of Spain\n---\nMadrid' })
  })
})
