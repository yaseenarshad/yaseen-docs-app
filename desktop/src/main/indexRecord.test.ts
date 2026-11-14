import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { extractAliases, extractEmbeds, extractLinks, extractTags, fileTitle, indexRecord, linkTarget, type IndexRecordMeta } from '@shared/indexRecord'
import { FOLDER_SETTINGS_FILE } from '@shared/types'

/**
 * YAZ-5068 (2B): the index record from a file's text, in `shared/` so the phone builds the same records as the Mac.
 * No disk here: `meta` stands in for what the desktop reads off `stat`.
 */
const meta = (rel: string, size = 100): IndexRecordMeta => {
  const name = rel.split('/').pop()!
  const dot = name.lastIndexOf('.')
  return { path: `/vault/${rel}`, name, basename: name.slice(0, dot), folder: rel.split('/').slice(0, -1).join('/'), ext: name.slice(dot + 1), size, ctime: 1, mtime: 2 }
}

describe('indexRecord: text to record (YAZ-5068)', () => {
  it('a page: properties, ID, title, tags, links and embeds; the record keeps its metadata', () => {
    const r = indexRecord(meta('Notes/Paris.md'), '---\nid: WIKI-12\ntitle: Paris\ntags: [city]\naliases: [Lutetia]\n---\nSee [[France]] #europe and ![[map.png]]\n')
    expect(r).toEqual({
      path: '/vault/Notes/Paris.md',
      name: 'Paris.md',
      basename: 'Paris',
      title: 'Paris',
      folder: 'Notes',
      ext: 'md',
      size: 100,
      ctime: 1,
      mtime: 2,
      properties: { id: 'WIKI-12', title: 'Paris', tags: ['city'], aliases: ['Lutetia'] },
      id: 'WIKI-12',
      aliases: ['Lutetia'],
      tags: ['city', 'europe'],
      links: ['France'],
      embeds: ['map.png'],
    })
    expect(r.kind).toBeUndefined()
    expect(r.cards).toBeUndefined()
  })

  it('the keys come in the order the desktop scan wrote them, so a cache file is byte for byte the same', () => {
    const r = indexRecord(meta('a.md'), '---\nid: WIKI-1\nkind: card\n---\n```card\nQ\n```\n<!-- card: WIKI-2 -->\n')
    expect(Object.keys(r)).toEqual(['path', 'name', 'basename', 'title', 'folder', 'ext', 'size', 'ctime', 'mtime', 'properties', 'aliases', 'tags', 'links', 'embeds', 'id', 'kind', 'cards'])
  })

  it('a card file with a `title`: kind card, its title, and its card takes the same title', () => {
    const r = indexRecord(meta('capital-geo-150.md'), ['---', 'kind: card', 'title: Capital of France', '---', '```card', 'Which city?', '---', 'Paris', '```', '<!-- card: GEO-150, 2026-11-10T09:12Z good 12s -->', ''].join('\n'))
    expect(r.kind).toBe('card')
    expect(r.title).toBe('Capital of France')
    expect(r.cards).toEqual([{ id: 'GEO-150', off: false, next: false, reviews: [{ at: '2026-11-10T09:12Z', rating: 'good', seconds: 12 }], title: 'Capital of France' }])
  })

  it('an old card file with no `title`: its card`s first line is the title', () => {
    const r = indexRecord(meta('old-geo-140.md'), ['---', 'kind: " CARD "', '---', '```card', '###### Capital of **France**?', '---', 'Paris', '```', '<!-- card: GEO-140 -->', ''].join('\n'))
    expect(r).toMatchObject({ kind: 'card', title: 'Capital of France?' })
    expect(r.id).toBeUndefined()
    expect(r.cards?.[0].title).toBe('Capital of France?')
  })

  it('a card file with 2 cards keeps both in review; only the first takes the file`s title', () => {
    const r = indexRecord(meta('two.md'), ['---', 'kind: card', 'title: Pair', '---', '```card', 'First', '```', '<!-- card: GEO-141 -->', '', '```card', 'Second', '```', '<!-- card: GEO-142 -->', ''].join('\n'))
    expect(r.cards?.map((c) => [c.id, c.title])).toEqual([
      ['GEO-141', 'Pair'],
      ['GEO-142', 'Second'],
    ])
  })

  it('a page that embeds a card: the ID is in `embeds`, and `cards` stays empty', () => {
    const r = indexRecord(meta('trip.md'), 'Before the trip:\n\n![[GEO-140]]\n')
    expect(r.embeds).toEqual(['GEO-140'])
    expect(r.cards).toBeUndefined()
    expect(r.kind).toBeUndefined()
  })

  it('a file over the size limit (`null` text): metadata only, titled by its name', () => {
    expect(indexRecord(meta('big.md', 10 ** 9), null)).toEqual({
      ...meta('big.md', 10 ** 9),
      title: 'big',
      properties: {},
      aliases: [],
      tags: [],
      links: [],
      embeds: [],
    })
  })

  it('frontmatter `comments` are never a property; a bad frontmatter gives `frontmatterError`', () => {
    expect(indexRecord(meta('c.md'), '---\ncomments: [x]\nstatus: ok\n---\n').properties).toEqual({ status: 'ok' })
    const bad = indexRecord(meta('d.md'), '---\nstatus: [unclosed\n---\n')
    expect(bad.properties).toEqual({})
    expect(bad.frontmatterError).toMatch(/\S/)
  })
})

describe('fileTitle on plain strings (YAZ-5068)', () => {
  it('a page: its basename; a folder`s settings file: the folder`s name, as `path.basename(path.dirname(…))` gives', () => {
    for (const p of ['/v/a/b/' + FOLDER_SETTINGS_FILE, '/v/' + FOLDER_SETTINGS_FILE, '/' + FOLDER_SETTINGS_FILE, '/v/sp ace/' + FOLDER_SETTINGS_FILE, '/v/back\\slash/' + FOLDER_SETTINGS_FILE]) {
      expect(fileTitle({ path: p, name: FOLDER_SETTINGS_FILE, basename: '.folder' })).toBe(path.basename(path.dirname(p)))
    }
    expect(fileTitle({ path: '/v/x/Page.md', name: 'Page.md', basename: 'Page' })).toBe('Page')
  })
})

describe('the moved helpers keep their rules', () => {
  it('extractTags, extractAliases, extractLinks, extractEmbeds and linkTarget answer from `shared/`', () => {
    expect(extractTags({ tags: 'x, y' }, '`#code` #kept')).toEqual(['x', 'y', 'kept'])
    expect(extractAliases({ aliases: 'One, two' })).toEqual(['One, two'])
    expect(extractLinks({ aliases: '[[Me]]', up: '[[Up]]' }, '[[a|words]] ![[e]]')).toEqual(['Up', 'a'])
    expect(extractEmbeds('![[e#part]] [[x]]')).toEqual(['e'])
    expect(linkTarget('Page#heading|words')).toBe('Page')
  })

  it('`shared/indexRecord.ts` imports no Node module', () => {
    const src = readFileSync(path.join(__dirname, '../../../shared/indexRecord.ts'), 'utf8')
    expect(src).not.toMatch(/from '(node:|path'|fs'|fs\/)/)
  })
})

// Moved from `desktop/src/main/vaultIndex/scan.test.ts` with the helpers (YAZ-5068), unchanged.
describe('extractTags', () => {
  it('frontmatter list / string / `tag` key; leading # stripped; non-strings ignored', () => {
    expect(extractTags({ tags: ['a', '#b', 3, null] }, '')).toEqual(['a', 'b'])
    expect(extractTags({ tags: 'x, y  z' }, '')).toEqual(['x', 'y', 'z'])
    expect(extractTags({ tag: 'solo' }, '')).toEqual(['solo'])
    expect(extractTags({ tags: 42 }, '')).toEqual([])
  })

  it('inline tags: prefix rules, nested kept, digits-only ignored, case preserved', () => {
    expect(extractTags({}, 'a #One (#two) [#three] x,#four;#five\n#six')).toEqual([
      'One',
      'two',
      'three',
      'four',
      'five',
      'six',
    ])
    expect(extractTags({}, '#first on the first char')).toEqual(['first'])
    expect(extractTags({}, 'see #a/b and #123 and #1a')).toEqual(['a/b', '1a'])
    expect(extractTags({}, 'not#tag and # heading')).toEqual([])
  })

  it('skips fenced code, inline code and URLs', () => {
    expect(extractTags({}, '```\n#fenced\n```\n~~~\n#tilde\n~~~\n#kept')).toEqual(['kept'])
    expect(extractTags({}, '```js\n#fenced\n```')).toEqual([])
    expect(extractTags({}, 'x `#inline` y ``#double`` #kept')).toEqual(['kept'])
    expect(extractTags({}, 'https://x.com/#frag http://y.com/a#b #kept')).toEqual(['kept'])
  })

  it('de-duplicates: frontmatter first, then first appearance', () => {
    expect(extractTags({ tags: ['b'] }, '#a #b #a')).toEqual(['b', 'a'])
  })
})

describe('extractAliases (GRO-2214)', () => {
  it('list items are trimmed; empties and non-strings dropped; de-duplicated', () => {
    expect(extractAliases({ aliases: [' CAC ', '', 'Acquisition Cost', 7, null, 'CAC'] })).toEqual(['CAC', 'Acquisition Cost'])
  })

  it('a scalar string is ONE alias — never comma-split, unlike `tags`', () => {
    expect(extractAliases({ aliases: 'Customer Acquisition Cost, CAC' })).toEqual(['Customer Acquisition Cost, CAC'])
    expect(extractAliases({ aliases: '  CAC  ' })).toEqual(['CAC'])
  })

  it('absent, empty or non-string `aliases` → []; only that key is read', () => {
    expect(extractAliases({})).toEqual([])
    expect(extractAliases({ aliases: [] })).toEqual([])
    expect(extractAliases({ aliases: 42 })).toEqual([])
    expect(extractAliases({ alias: 'CAC' })).toEqual([]) // `alias` singular is not the key (Obsidian's is `aliases`)
  })
})

describe('extractLinks / extractEmbeds', () => {
  it('strips alias, heading and block refs; trims', () => {
    expect(extractLinks({}, '[[A|alias]] [[B#Heading]] [[C#^blk]] [[ D ]]')).toEqual(['A', 'B', 'C', 'D'])
  })

  it('YAZ-4935: the page is the one side that is an ID, in either order — so Linked mentions find both', () => {
    // Words first keeps both sides (YAZ-4954): the resolver picks the right side when the left side is no page.
    expect(extractLinks({}, '[[WIKI-116|staging]] and [[staging|WIKI-116]]')).toEqual(['WIKI-116', 'staging|WIKI-116'])
    expect(extractLinks({}, '[[staging|WIKI-116#Intro]] [[WIKI-116#Intro|staging]]')).toEqual(['staging|WIKI-116', 'WIKI-116'])
    expect(extractLinks({}, '[[the plan|k3m9x2pq7abc]]')).toEqual(['the plan|k3m9x2pq7abc'])
    expect(extractLinks({}, '[[|WIKI-116]]')).toEqual(['WIKI-116'])
    expect(extractLinks({}, '[[Postgres|database]] [[WIKI-116|WIKI-117]]')).toEqual(['Postgres', 'WIKI-116'])
    expect(extractLinks({ related: '[[staging|WIKI-116]]' }, '')).toEqual(['staging|WIKI-116'])
    expect(extractEmbeds('![[EMB-40|640x360 view=120,-40,0.8]]')).toEqual(['EMB-40'])
  })

  it('YAZ-4954: words that LOOK like an ID keep both sides, in the body, the frontmatter and embeds; the other order keeps one', () => {
    expect(extractLinks({}, '[[Covid pages|COVID-19]] and [[COVID-19|Covid pages]]')).toEqual(['Covid pages|COVID-19', 'COVID-19'])
    expect(extractLinks({ related: '[[Covid pages|COVID-19]]', list: ['[[Covid pages#Intro|COVID-19]]'] }, '')).toEqual(['Covid pages|COVID-19'])
    expect(extractEmbeds('![[Covid pages|COVID-19]]')).toEqual(['Covid pages|COVID-19'])
  })

  it('YAZ-4954 part 2: an embed of a file keeps the file when its words look like an ID', () => {
    expect(extractEmbeds('![[photo.png|FIG-1]] ![[FIG-2|chart.pdf]] ![[x.drawio|700x394 locked]]')).toEqual(['photo.png', 'chart.pdf', 'x.drawio'])
    expect(extractLinks({ cover: '[[photo.png|FIG-1]]' }, '[[photo.png|FIG-1]] [[FIG-1|photo.png]]')).toEqual(['photo.png'])
  })

  it('embeds are not links and vice versa', () => {
    const body = '![[img.png]] [[Page]] ![[Other#sec|x]]'
    expect(extractLinks({}, body)).toEqual(['Page'])
    expect(extractEmbeds(body)).toEqual(['img.png', 'Other'])
  })

  it('frontmatter string values (top-level and in lists) matching exactly [[…]] count as links', () => {
    expect(extractLinks({ related: '[[X]]', list: ['[[Y|y]]', 'plain', 7], page: 'see [[Z]]' }, '')).toEqual(['X', 'Y'])
  })

  it('`aliases` values are NEVER links, whatever they look like (GRO-2214)', () => {
    // A `[[X]]`-shaped alias stays an alias literally named `[[X]]` (extractAliases strips
    // nothing) — it just never becomes an outgoing link of this page.
    expect(extractLinks({ aliases: ['[[X]]', 'CAC'], related: '[[Y]]' }, '')).toEqual(['Y'])
    expect(extractLinks({ aliases: '[[X]]' }, '')).toEqual([])
    expect(extractAliases({ aliases: ['[[X]]'] })).toEqual(['[[X]]'])
  })

  it('a link in a folder’s value (`[[id]]`, `[[Name]]`, or a list of them) is in the page’s links, exactly as a top-level whole-value link is', () => {
    const props = { related: '[[Top]]', in: { '3y7505rsr6fd': { owner: '[[k3m9x2pq7abc]]', Status: 'Interview', team: ['[[Sam|S]]', 'plain', 7] }, mzf9cjhn02vm: { lead: '[[Road#Scope]]' } } }
    expect(extractLinks(props, '[[Body]]')).toEqual(['Top', 'k3m9x2pq7abc', 'Sam', 'Road', 'Body'])
  })

  it('a non-link string in a folder’s value that merely contains `[[x]]` inside other text is not a link', () => {
    expect(extractLinks({ in: { '3y7505rsr6fd': { page: 'see [[x]] later', list: ['ask [[y]]'] } } }, '')).toEqual([])
    // A block that is no map holds no values.
    expect(extractLinks({ in: { '3y7505rsr6fd': '[[x]]' } }, '')).toEqual([])
  })

  it('de-duplicates: frontmatter first, then first appearance', () => {
    expect(extractLinks({ a: '[[B]]' }, '[[A]] [[B]] [[A]]')).toEqual(['B', 'A'])
    expect(extractEmbeds('![[a]] ![[b]] ![[a]]')).toEqual(['a', 'b'])
  })

  it('skips fenced code blocks and inline code spans, like tags; the line after a fence still counts', () => {
    const body = '```\n[[Hidden]] ![[x.png]]\n```\n[[After]]\n~~~\n[[Tilde]]\n~~~\nsee `[[Inline]]` and ![[real.png]]'
    expect(extractLinks({}, body)).toEqual(['After'])
    expect(extractEmbeds(body)).toEqual(['real.png'])
  })
})
