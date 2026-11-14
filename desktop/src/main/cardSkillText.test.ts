import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { HELP } from '../cli/cli'

/**
 * The card skill's shipped pages (YAZ-5112). Each page opens with the placeholder line, and no page holds a
 * top-level `card` fence: a duplicate in a vault with IDs would turn it into a real card. A `card` fence shown
 * inside a `markdown` example block is text, and fine.
 *
 * Example fences: a GOOD card goes in a ```markdown block; a card that is bad on purpose (every "Before", every weak
 * card) goes in a ```text block, so a reader can tell the two apart.
 */

const SKILL = fileURLToPath(new URL('../../../skills/card-skill', import.meta.url))
const PLACEHOLDER = "Placeholder text. Yaseen's version replaces this page."
/** Generated from the course script (YAZ-5059), not placeholder text: it opens with its own line. */
const NO_PLACEHOLDER = new Set(['Course transcript.md'])

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
  it('ships the start page, the three guides and the 11 formats', async () => {
    const names = (await pages(SKILL)).map((p) => relative(SKILL, p))
    expect(names).toEqual(
      expect.arrayContaining([
        'Start here.md', 'Rules for a good card.md', 'Titles.md', 'What changed.md',
        ...['acronym', 'concept', 'comparison', 'vocabulary', 'book', 'person', 'fact', 'procedure', 'quote', 'story', 'script and sounds'].map((f) => `formats/${f}.md`),
      ]),
    )
  })

  it('each page starts with the placeholder line and has no top-level `card` fence', async () => {
    for (const page of await pages(SKILL)) {
      const text = await readFile(page, 'utf8')
      const name = relative(SKILL, page)
      if (!NO_PLACEHOLDER.has(name)) expect(text.split('\n')[0], name).toBe(PLACEHOLDER)
      const cards = topFences(text).filter((f) => f.lang === 'card').map((f) => `${name}:${f.line}`)
      expect(cards, 'a bare card fence would become a real card').toEqual([])
    }
  })

  it('each example is in a `markdown` block (a good card) or a `text` block (a bad one on purpose)', async () => {
    const other: string[] = []
    for (const page of await pages(SKILL)) {
      const name = relative(SKILL, page)
      if (NO_PLACEHOLDER.has(name)) continue
      for (const f of topFences(await readFile(page, 'utf8'))) if (f.lang !== 'markdown' && f.lang !== 'text') other.push(`${name}:${f.line} ${f.lang || '(none)'}`)
    }
    expect(other).toEqual([])
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

  it('names the owner only in the placeholder line: the text is for anyone (YAZ-5140)', async () => {
    const found: string[] = []
    for (const page of await pages(SKILL)) {
      const lines = (await readFile(page, 'utf8')).split('\n')
      lines.forEach((line, i) => {
        // The product's name ("Yaseen Docs") and the command (`yaseendocs`) are not the owner's.
        if (i > 0 && /\bYaseen\b/.test(line.replace(/Yaseen Docs/g, ''))) found.push(`${relative(SKILL, page)}:${i + 1}: ${line}`)
      })
    }
    expect(found).toEqual([])
  })

  /**
   * The one rule for the card line (YAZ-5139, Yaseen's option 1), said the same way in the command's help, the start
   * page and the titles page. A change of one place that the others do not get fails here.
   */
  it('HELP, Start here.md and Titles.md say the same rule for the card line (YAZ-5139)', async () => {
    const RULE = [
      "Never change a card line that the app wrote: it holds the card's ID and its reviews.",
      'On a new card that you write by hand, you may put the line `<!-- card: notitle -->` directly below the closing fence; the app adds the ID and keeps the option.',
      'With the command, use `--hide-title`.',
    ]
    const flat = (text: string): string => text.replace(/\s+/g, ' ')
    const places: Record<string, string> = {
      HELP: flat(HELP),
      'Start here.md': flat(await readFile(join(SKILL, 'Start here.md'), 'utf8')),
      'Titles.md': flat(await readFile(join(SKILL, 'Titles.md'), 'utf8')),
    }
    const missing = Object.entries(places).flatMap(([name, text]) => RULE.filter((sentence) => !text.includes(sentence)).map((sentence) => `${name}: ${sentence}`))
    expect(missing).toEqual([])
    // The old, opposite rule is gone from each place.
    for (const [name, text] of Object.entries(places)) expect(text, name).not.toMatch(/Never write (?:or change )?(?:that|a card) line by hand/)
  })

  /**
   * Where a card's title lives (YAZ-5044, YAZ-5151): a card in a page has it as its first line, a card file in `title:`.
   * Said the same way in the three places; the old rule ("a card's first line is its title", for every card) is gone.
   */
  it('HELP, Start here.md and Titles.md say the same rule for the title of each kind of card (YAZ-5151)', async () => {
    const RULE = [
      'A card inside a page has its title as its first line.',
      'A card file has its title in its `title:` property, as a page has, and its card holds only its sides.',
    ]
    const flat = (text: string): string => text.replace(/\s+/g, ' ')
    const places: Record<string, string> = {
      HELP: flat(HELP),
      'Start here.md': flat(await readFile(join(SKILL, 'Start here.md'), 'utf8')),
      'Titles.md': flat(await readFile(join(SKILL, 'Titles.md'), 'utf8')),
    }
    const missing = Object.entries(places).flatMap(([name, text]) => RULE.filter((sentence) => !text.includes(sentence)).map((sentence) => `${name}: ${sentence}`))
    expect(missing).toEqual([])
    for (const [name, text] of Object.entries(places)) expect(text, name).not.toMatch(/The first line of a card is its title|The \*\*first line\*\* is the card's title|a card's first line is its title/)
  })
})
