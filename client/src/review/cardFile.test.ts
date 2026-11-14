/**
 * A card file's card as review reads it (YAZ-5044, decision A): its title is the file's `title`, never its text. The
 * card window titles it by `title`; the Inbox reads it with the title as its first line, so "Title on the front"
 * Show / Hide is one rule for both kinds. A card in a page, and a card file from before A, read as before.
 */
import { describe, expect, it, vi } from 'vitest'
import { cardInContent, readCard, titleOfCard } from './cardFile'

const files = vi.hoisted(() => new Map<string, string>())
vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>()
  return { ...real, api: { ...real.api, readFile: vi.fn(async (path: string) => ({ path, content: files.get(path)!, mtime: 1, size: 1 })) } }
})

const CARD = '```card\n---\nThe capital is {{Paris}}.\n```\n<!-- card: GEO-140, notitle -->\n'
const FILE = `---\nkind: card\ntitle: Capital of France\n---\n${CARD}`

describe('a card file`s card (YAZ-5044)', () => {
  it('the card window: its title is the file`s `title`; its text is its sides only', () => {
    const card = cardInContent('/v/c.md', FILE, 'GEO-140', 0)!
    expect(card.text).toBe('---\nThe capital is {{Paris}}.')
    expect(card.fileTitle).toBe('Capital of France')
    expect(titleOfCard(card)).toBe('Capital of France')
  })

  it('the Inbox`s read: the title is the first line of the text, as a card in a page holds it; `notitle` stays on the card', async () => {
    files.set('/v/c.md', FILE)
    expect(await readCard('/v/c.md', 'GEO-140')).toMatchObject({ text: 'Capital of France\n---\nThe capital is {{Paris}}.', notitle: true })
  })

  it('a card in a page, and a card file from before A, read as before: the first line is the title', async () => {
    const page = `---\ntitle: Europe\n---\n\`\`\`card\nCapital of France\n---\nParis\n\`\`\`\n<!-- card: GEO-1 -->\n`
    expect(cardInContent('/v/p.md', page, 'GEO-1', 0)!.fileTitle).toBeUndefined()
    expect(titleOfCard(cardInContent('/v/p.md', page, 'GEO-1', 0)!)).toBe('Capital of France')
    const old = `---\nkind: card\n---\n\`\`\`card\nCapital of France\n---\nParis\n\`\`\`\n<!-- card: GEO-2 -->\n`
    files.set('/v/old.md', old)
    expect(await readCard('/v/old.md', 'GEO-2')).toMatchObject({ text: 'Capital of France\n---\nParis' })
  })
})
