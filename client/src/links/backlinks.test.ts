/**
 * Backlinks (Links D, GRO-2193): the pure half — the referencing set over an index snapshot
 * and the on-demand context-snippet extraction. Resolution runs through THE shared resolver
 * (`resolverFor`, wrapped exactly as `WikilinkIndexBridge` wraps it), so alias-form links are
 * mentions for free and nothing here re-implements link matching.
 */
import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import { resolverFor } from '../views/engine'
import type { ResolveLink } from '../editor/wikilink/wikilinkPlugin'
import { linkResolver } from './folderLinks'
import { MAX_SNIPPETS, SNIPPET_MAX_CHARS, backlinksFor, folderMentionSnippets, mentionSnippets, type MentionSnippet } from './backlinks'

interface RecInit {
  links?: string[]
  embeds?: string[]
  aliases?: string[]
}

const rec = (path: string, { links = [], embeds = [], aliases = [] }: RecInit = {}): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const rel = path.slice('/vault/'.length)
  return {
    path,
    name,
    basename: name.replace(/\.md$/, ''),
    folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
    ext: 'md',
    size: 1,
    ctime: 1,
    mtime: 1,
    properties: {},
    aliases,
    tags: [],
    links,
    embeds,
  }
}

/** The resolve function the app feeds the section — `resolverFor` unwrapped to a path (bridge idiom). */
const resolverOver = (records: readonly IndexRecord[]): ResolveLink => {
  const resolve = resolverFor(records, '/vault')
  return (target) => resolve(target)?.record.path ?? null
}

const B = '/vault/B.md'

describe('backlinksFor (Links D, GRO-2193)', () => {
  it('collects the notes whose links resolve to the open note, and only those', () => {
    const records = [rec('/vault/A.md', { links: ['B'] }), rec(B, {}), rec('/vault/C.md', { links: ['Elsewhere'] })]
    expect(backlinksFor(B, records, resolverOver(records), []).map((r) => r.path)).toEqual(['/vault/A.md'])
  })

  it('counts a mention in ANY link form: bare, root-relative, pathed and case-insensitive', () => {
    const records = [
      rec('/vault/A.md', { links: ['b'] }),
      rec('/vault/Sub/Deep.md', { links: ['B.md'] }),
      rec(B, {}),
      rec('/vault/C.md', { links: ['/vault/B.md'] }),
    ]
    expect(backlinksFor(B, records, resolverOver(records), []).map((r) => r.path)).toEqual([
      '/vault/A.md',
      '/vault/C.md',
      '/vault/Sub/Deep.md',
    ])
  })

  it('an ALIAS-form link is a linked mention too (E2 aliases ride the shared resolver)', () => {
    const records = [rec('/vault/A.md', { links: ['CAC'] }), rec(B, { aliases: ['CAC'] })]
    expect(backlinksFor(B, records, resolverOver(records), []).map((r) => r.path)).toEqual(['/vault/A.md'])
  })

  it('an `![[embed]]` is a mention as well (embeds count, locked)', () => {
    const records = [rec('/vault/A.md', { embeds: ['B'] }), rec(B, {})]
    expect(backlinksFor(B, records, resolverOver(records), []).map((r) => r.path)).toEqual(['/vault/A.md'])
  })

  it('never lists the open note itself, even when it links to itself', () => {
    const records = [rec('/vault/A.md', { links: ['B'] }), rec(B, { links: ['B'] })]
    expect(backlinksFor(B, records, resolverOver(records), []).map((r) => r.path)).toEqual(['/vault/A.md'])
  })

  it('one entry per referencing note, whatever the number of mentions it holds', () => {
    const records = [rec('/vault/A.md', { links: ['B', 'b', 'B.md'], embeds: ['B'] }), rec(B, {})]
    expect(backlinksFor(B, records, resolverOver(records), [])).toHaveLength(1)
  })

  it('orders entries by path whatever the input order', () => {
    const records = [
      rec('/vault/Zeta.md', { links: ['B'] }),
      rec('/vault/Alpha.md', { links: ['B'] }),
      rec(B, {}),
      rec('/vault/Sub/Mid.md', { links: ['B'] }),
    ]
    expect(backlinksFor(B, records, resolverOver(records), []).map((r) => r.path)).toEqual([
      '/vault/Alpha.md',
      '/vault/Sub/Mid.md',
      '/vault/Zeta.md',
    ])
  })

  it('no mentions → an empty list (the section renders nothing on this)', () => {
    const records = [rec('/vault/A.md'), rec(B, {})]
    expect(backlinksFor(B, records, resolverOver(records), [])).toEqual([])
  })

  it('memoizes per (resolver identity, path): the same snapshot answers the same array', () => {
    const records = [rec('/vault/A.md', { links: ['B'] }), rec(B, {})]
    const resolve = resolverOver(records)
    expect(backlinksFor(B, records, resolve, [])).toBe(backlinksFor(B, records, resolve, []))
    // A refetched snapshot swaps in a NEW resolver and recomputes (live updates).
    const next = [rec(B, {})]
    expect(backlinksFor(B, next, resolverOver(next), [])).toEqual([])
  })

  it('a new resolver over the SAME records recomputes: a folder the tree just named gains its mentions (YAZ-2290 D10)', () => {
    const records = [rec('/vault/A.md', { links: ['Projects'] })]
    const before = resolverOver(records)
    expect(backlinksFor('/vault/Projects', records, before, [])).toEqual([])
    const after = (target: string) => before(target) ?? (target === 'Projects' ? '/vault/Projects' : null)
    expect(backlinksFor('/vault/Projects', records, after, []).map((r) => r.path)).toEqual(['/vault/A.md'])
  })
})

describe('links from FOLDER pages: a folder\'s settings mention what they link', () => {
  const ID = 'k3m9x2pq7abc'
  const TEAM = '/vault/Team'
  const DIRS = ['/vault/Areas', '/vault/Projects', TEAM, '/vault/Work']
  /** The settings record of the folder at `dir`, holding `folder_settings`. */
  const settings = (dir: string, folder_settings: Record<string, unknown>): IndexRecord => ({ ...rec(`${dir}/.folder.md`), properties: { folder_settings } })
  const outline = (text: string) => ({ views: [{ type: 'outline', name: 'Outline', outline: text }] })
  const NOTES = [rec('/vault/A.md', { links: ['B'] }), { ...rec(B), id: ID }, rec('/vault/Work/Plan.md', { links: ['Team'] })]
  const mentions = (path: string, folders: IndexRecord[], records = NOTES) =>
    backlinksFor(path, records, linkResolver(records, '/vault', DIRS, folders), folders).map((r) => r.path)

  it('a folder\'s outline has a link to a note: that note\'s Linked mentions lists the folder', () => {
    expect(mentions(B, [settings('/vault/Projects', outline(`- intro\n    - [[${ID}]]`))])).toEqual(['/vault/A.md', '/vault/Projects/.folder.md'])
    expect(mentions(B, [settings('/vault/Projects', outline('- [[B|the plan]]'))])).toEqual(['/vault/A.md', '/vault/Projects/.folder.md'])
  })

  it('a folder\'s link column has a `target` naming the page, or a view\'s `order` names it: listed the same way', () => {
    const column = settings('/vault/Areas', { columns: { owner: { kind: 'link', target: '[[B]]' } } })
    const order = settings('/vault/Projects', { views: [{ type: 'outline', name: 'Outline', order: ['[[Elsewhere]]', `[[${ID}]]`] }] })
    expect(mentions(B, [column, order])).toEqual(['/vault/A.md', '/vault/Areas/.folder.md', '/vault/Projects/.folder.md'])
  })

  it('a folder\'s own link property (`owner: "[[B]]"` in its `.folder.md`) is a mention, as a note\'s is', () => {
    expect(mentions(B, [rec('/vault/Team/.folder.md', { links: ['B'] })])).toEqual(['/vault/A.md', '/vault/Team/.folder.md'])
  })

  it('a bare string is no link: not a table\'s `order` of column keys, nor a bare `target`', () => {
    const keys = settings('/vault/Areas', { columns: { owner: { kind: 'link', target: 'B' } }, views: [{ type: 'table', name: 'Table', order: ['file.name', 'B'] }] })
    expect(mentions(B, [keys, settings('/vault/Projects', {}), rec('/vault/Work/.folder.md')])).toEqual(['/vault/A.md'])
  })

  it('a link inside the prose of an outline line counts, as one inside a note\'s body does', () => {
    const prose = settings('/vault/Team', outline('- see [[B]] inline'))
    expect(mentions(B, [prose])).toEqual(['/vault/A.md', '/vault/Team/.folder.md'])
  })

  it('a folder that links to itself is not listed, as a note never lists itself', () => {
    const own = settings(TEAM, outline('- [[Team]]'))
    expect(mentions(TEAM, [own])).toEqual(['/vault/Work/Plan.md'])
    // Its links to OTHER pages still count.
    expect(mentions(B, [settings(TEAM, outline('- [[Team]]\n- [[B]]'))])).toEqual(['/vault/A.md', '/vault/Team/.folder.md'])
  })

  it('one entry per referencing note or folder, path-sorted — a folder by its settings file\'s path', () => {
    const many = settings('/vault/Work', { columns: { owner: { kind: 'link', target: '[[B]]' } }, views: [{ type: 'outline', name: 'Outline', order: ['[[B]]'], outline: '- [[B]]\n- [[B]]' }] })
    const records = [rec('/vault/Work/Zed.md', { links: ['B'] }), rec('/vault/A.md', { links: ['B'] }), rec(B), rec('/vault/Work.md', { links: ['B'] })]
    expect(mentions(B, [many, settings('/vault/Areas', outline('- [[B]]'))], records)).toEqual([
      '/vault/A.md',
      '/vault/Areas/.folder.md',
      '/vault/Work.md',
      '/vault/Work/.folder.md',
      '/vault/Work/Zed.md',
    ])
  })

  describe('snippet for a folder entry', () => {
    const resolve = linkResolver(NOTES, '/vault', DIRS)
    const shown = (folder: IndexRecord) => folderMentionSnippets(folder, B, resolve).map((s) => [s.text, ...s.ranges.map((r) => s.text.slice(r.from, r.to))])

    it('the line of its outline that holds the link — the bullet\'s text, as the page shows it', () => {
      expect(shown(settings('/vault/Projects', outline(`- intro\n    * see [[${ID}]] first\n- [[Elsewhere]]\n- [[B|the plan]]`)))).toEqual([
        ['see B first', 'B'],
        ['the plan', 'the plan'],
      ])
    })

    it('every outline of the folder is read, in view order', () => {
      const two = settings('/vault/Projects', { views: [{ type: 'outline', name: 'One', outline: '- [[B]] one' }, { type: 'table', name: 'Table' }, { type: 'outline', name: 'Two', outline: '- two [[B]]' }] })
      expect(shown(two).map(([text]) => text)).toEqual(['B one', 'two B'])
    })

    it('a folder that links only by a view\'s `order` or a column\'s `target` has no snippet', () => {
      expect(shown(settings('/vault/Projects', { columns: { owner: { kind: 'link', target: '[[B]]' } }, views: [{ type: 'outline', name: 'Outline', order: ['[[B]]'] }] }))).toEqual([])
      expect(shown(rec('/vault/Projects/.folder.md'))).toEqual([])
    })
  })
})

describe('mentionSnippets (Links D, GRO-2193; display text + line grouping FN9/FN10, GRO-2197)', () => {
  const records = [rec('/vault/A.md'), rec(B, { aliases: ['CAC'] })]
  const resolve = resolverOver(records)

  /** The highlighted runs of one snippet, in order. */
  const marked = (s: MentionSnippet): string[] => s.ranges.map((r) => s.text.slice(r.from, r.to))

  it('returns the mention line as the EDITOR shows it, with the display text highlighted', () => {
    const [snippet] = mentionSnippets('# A\n\nSee [[B]] for more.\n', B, resolve)
    expect(snippet.text).toBe('See B for more.')
    expect(marked(snippet)).toEqual(['B'])
  })

  it('one snippet per LINE, in document order; other links are never highlighted', () => {
    const snippets = mentionSnippets('[[Elsewhere]] then [[B]]\n\nand [[B|the other]] again\n', B, resolve)
    expect(snippets.map((s) => s.text)).toEqual(['Elsewhere then B', 'and the other again'])
    expect(snippets.map(marked)).toEqual([['B'], ['the other']])
  })

  it('a piped mention shows its ALIAS — exactly the editor display, never the raw brackets (FN9)', () => {
    const [snippet] = mentionSnippets('see [[B|Bee alias]] here\n', B, resolve)
    expect(snippet.text).toBe('see Bee alias here')
    expect(marked(snippet)).toEqual(['Bee alias'])
  })

  it('a heading-form mention shows the ` > `-joined display, like the decorations', () => {
    const [snippet] = mentionSnippets('deep [[B#Intro]] link\n', B, resolve)
    expect(snippet.text).toBe('deep B > Intro link')
    expect(marked(snippet)).toEqual(['B > Intro'])
  })

  it('an UNRELATED link on the same line shows display text too, unhighlighted (FN9)', () => {
    const [snippet] = mentionSnippets('[[Other|o]] with [[B]] here\n', B, resolve)
    expect(snippet.text).toBe('o with B here')
    expect(marked(snippet)).toEqual(['B'])
  })

  it('TWO mentions on one line make ONE snippet with TWO highlights (FN10)', () => {
    const snippets = mentionSnippets('See [[B]] and [[B|again]] here\n', B, resolve)
    expect(snippets).toHaveLength(1)
    expect(snippets[0].text).toBe('See B and again here')
    expect(marked(snippets[0])).toEqual(['B', 'again'])
  })

  it('highlights alias-form mentions by display text and embed mentions raw (embeds are undecorated)', () => {
    expect(mentionSnippets('via [[CAC]]\n', B, resolve).map(marked)).toEqual([['CAC']])
    expect(mentionSnippets('shown ![[B]]\n', B, resolve).map(marked)).toEqual([['![[B]]']])
  })

  it('skips fenced blocks and inline code — exactly what the index skips', () => {
    const content = '```\n[[B]]\n```\n\nand `[[B]]` inline\n\nreal [[B]]\n'
    expect(mentionSnippets(content, B, resolve).map((s) => s.text)).toEqual(['real B'])
  })

  it('trims the line and windows a long one around the first mention, ellipsised on both sides', () => {
    const pad = 'x'.repeat(400)
    const [snippet] = mentionSnippets(`   ${pad} [[B]] ${pad}   \n`, B, resolve)
    expect(snippet.text.length).toBeLessThanOrEqual(SNIPPET_MAX_CHARS + 2)
    expect(snippet.text.startsWith('…')).toBe(true)
    expect(snippet.text.endsWith('…')).toBe(true)
    expect(marked(snippet)).toEqual(['B']) // the window always contains the first mention whole
  })

  it('a second mention outside the window is dropped; the first (centred) one never is', () => {
    const pad = 'x'.repeat(400)
    const [snippet] = mentionSnippets(`[[B]] ${pad} [[B]]\n`, B, resolve)
    expect(marked(snippet)).toEqual(['B'])
    expect(snippet.ranges).toHaveLength(1)
  })

  it('a short line keeps its whole text and gets no ellipsis', () => {
    const [snippet] = mentionSnippets('   * [[B]] note   \n', B, resolve)
    expect(snippet.text).toBe('* B note')
  })

  it('mentions of another note, same-file `[[#heading]]` links and plain text yield nothing', () => {
    expect(mentionSnippets('[[Elsewhere]] and [[#top]] and words\n', B, resolve)).toEqual([])
  })

  it('caps the snippet LINES per note (the section stays quiet on link-heavy notes)', () => {
    const content = Array.from({ length: MAX_SNIPPETS + 3 }, (_, i) => `line ${i} [[B]]`).join('\n')
    expect(mentionSnippets(content, B, resolve)).toHaveLength(MAX_SNIPPETS)
  })

  it('reads mentions out of the frontmatter block too (the index counts them as links)', () => {
    const [snippet] = mentionSnippets('---\nparent: "[[B]]"\n---\n\nbody\n', B, resolve)
    expect(snippet.text).toBe('parent: "B"')
  })
})

describe('id links (YAZ-2293): a mention by id, read as the title', () => {
  const ID = 'k3m9x2pq7abc'
  const ROAD = '/vault/Projects/Road Map.md'
  const records = [rec('/vault/A.md', { links: [ID] }), { ...rec(ROAD), id: ID }, rec('/vault/Other.md')]
  const resolve = resolverOver(records)
  const marked = (s: MentionSnippet): string[] => s.ranges.map((r) => s.text.slice(r.from, r.to))

  it('a note linking by id is a linked mention of the note that id names', () => {
    expect(backlinksFor(ROAD, records, resolve, []).map((r) => r.path)).toEqual(['/vault/A.md'])
  })

  it('the snippet shows the note\'s current TITLE where the editor does — heading form and hand-typed label included', () => {
    const [snippet] = mentionSnippets(`See [[${ID}]], [[${ID}#Scope]] and [[${ID}|the plan]].\n`, ROAD, resolve)
    expect(snippet.text).toBe('See Road Map, Road Map > Scope and the plan.')
    expect(marked(snippet)).toEqual(['Road Map', 'Road Map > Scope', 'the plan'])
  })

  it('a link in a folder’s value counts as a linked mention of its target, exactly as a top-level whole-value link does', () => {
    // The index puts a folder value's link in the record's `links` (`scan.test.ts`); the snippet is the value's own line.
    const content = `---\nin:\n  3y7505rsr6fd:\n    Status: Interview\n    owner: "[[${ID}]]"\n---\nBody\n`
    const holder = { ...rec('/vault/Hiring/Noor.md', { links: [ID] }), properties: { in: { '3y7505rsr6fd': { Status: 'Interview', owner: `[[${ID}]]` } } } }
    const all = [holder, { ...rec(ROAD), id: ID }]
    const over = resolverOver(all)
    expect(backlinksFor(ROAD, all, over, []).map((r) => r.path)).toEqual(['/vault/Hiring/Noor.md'])
    expect(mentionSnippets(content, ROAD, over).map((s) => s.text)).toEqual(['owner: "Road Map"'])
  })

  it('an id no note has reads as the raw id, as the editor shows it', () => {
    const [snippet] = mentionSnippets(`gone [[zzzzzzzzzzz9]] but [[${ID}]]\n`, ROAD, resolve)
    expect(snippet.text).toBe('gone zzzzzzzzzzz9 but Road Map')
    expect(marked(snippet)).toEqual(['Road Map'])
  })
})
