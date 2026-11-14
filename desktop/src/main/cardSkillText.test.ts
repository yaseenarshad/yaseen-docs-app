import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The card skill's shipped pages (YAZ-5112). Each page opens with the placeholder line, and no page holds a
 * top-level `card` fence: a duplicate in a vault with IDs would turn it into a real card. A `card` fence shown
 * inside a `markdown` example block is text, and fine.
 */

const SKILL = fileURLToPath(new URL('../../../skills/card-skill', import.meta.url))
const PLACEHOLDER = "Placeholder text. Yaseen's version replaces this page."

/** Every `.md` under `dir`, skipping dot folders (`.yaseendocs` belongs to the app). */
async function pages(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await pages(path)))
    else if (entry.name.endsWith('.md')) out.push(path)
  }
  return out.sort()
}

/** A fence the page itself opens (CommonMark: 3+ backticks or tildes, up to 3 spaces of indent), with its language. */
interface Fence { lang: string; line: number }

/** The top-level fences of a page, in order. A fence closes on the same mark, at least as long, with no info string. */
function topFences(text: string): Fence[] {
  const lines = text.split('\n')
  const fences: Fence[] = []
  let open: { mark: string } | null = null
  for (let i = 0; i < lines.length; i++) {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i])
    if (open === null) {
      if (m === null) continue
      const fence: Fence = { lang: m[2].trim().split(/\s+/)[0] ?? '', line: i + 1 }
      open = { mark: m[1] }
      fences.push(fence)
    } else if (m !== null && m[1][0] === open.mark[0] && m[1].length >= open.mark.length && m[2].trim() === '') {
      open = null
    }
  }
  return fences
}

describe('the card skill pages (YAZ-5112)', () => {
  it('ships the start page, the four guides and the 11 formats', async () => {
    const names = (await pages(SKILL)).map((p) => relative(SKILL, p))
    expect(names).toEqual(
      expect.arrayContaining([
        'Start here.md', 'Rules for a good card.md', 'Titles.md', 'Check your card.md', 'What changed.md',
        ...['acronym', 'concept', 'comparison', 'vocabulary', 'book', 'person', 'fact', 'procedure', 'quote', 'story', 'script and sounds'].map((f) => `formats/${f}.md`),
      ]),
    )
  })

  it('each page starts with the placeholder line and has no top-level `card` fence', async () => {
    for (const page of await pages(SKILL)) {
      const text = await readFile(page, 'utf8')
      const name = relative(SKILL, page)
      expect(text.split('\n')[0], name).toBe(PLACEHOLDER)
      const cards = topFences(text).filter((f) => f.lang === 'card').map((f) => `${name}:${f.line}`)
      expect(cards, 'a bare card fence would become a real card').toEqual([])
    }
  })

  it('reads a `card` fence inside a four-backtick `markdown` block as text, and a bare one as a card', () => {
    const shown = '````markdown\n```card\nTitle\n```\n````\n'
    expect(topFences(shown).map((f) => f.lang)).toEqual(['markdown'])
    expect(topFences('Text\n\n```card\nA {{b}}\n```\n').map((f) => f.lang)).toEqual(['card'])
    expect(topFences('~~~card\nA {{b}}\n~~~\n').map((f) => f.lang)).toEqual(['card'])
  })

  it('the Start page tells that the app replaces the copy', async () => {
    const start = await readFile(join(SKILL, 'Start here.md'), 'utf8')
    expect(start).toContain('The app replaces this copy on each update. Duplicate it to change it.')
  })
})
