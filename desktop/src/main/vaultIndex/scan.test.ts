import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseFrontmatter } from '@shared/frontmatter'
import { textFingerprint } from '@shared/reviews'
import { MAX_FILE_BYTES, VAULT_CONFIG_DIR } from '@shared/types'
import { makeViewsFixture } from '../fs/viewsFixture'
import { extractAliases, extractEmbeds, extractLinks, extractTags, scanFile } from './index'

describe('parseFrontmatter', () => {
  it('parses a YAML map; core schema keeps dates as strings', () => {
    expect(parseFrontmatter('---\ntitle: X\ndate: 2026-08-01\nn: 2\nok: true\nnil: null\n---\n')).toEqual({
      properties: { title: 'X', date: '2026-08-01', n: 2, ok: true, nil: null },
    })
  })

  it('empty block → {}', () => {
    expect(parseFrontmatter('')).toEqual({ properties: {} })
    expect(parseFrontmatter('---\n\n---\n')).toEqual({ properties: {} })
  })

  it('scalar or list → not a map', () => {
    expect(parseFrontmatter('---\njust text\n---\n')).toEqual({ properties: {}, error: 'frontmatter is not a map' })
    expect(parseFrontmatter('---\n- a\n---\n')).toEqual({ properties: {}, error: 'frontmatter is not a map' })
  })

  it('YAML error → message', () => {
    const r = parseFrontmatter('---\nstatus: [unclosed\n---\n')
    expect(r.properties).toEqual({})
    expect(r.error).toMatch(/\S/)
  })

  it('handles CRLF and the `...` terminator', () => {
    expect(parseFrontmatter('---\r\na: 1\r\n...\r\n')).toEqual({ properties: { a: 1 } })
  })
})

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

  it('embeds are not links and vice versa', () => {
    const body = '![[img.png]] [[Note]] ![[Other#sec|x]]'
    expect(extractLinks({}, body)).toEqual(['Note'])
    expect(extractEmbeds(body)).toEqual(['img.png', 'Other'])
  })

  it('frontmatter string values (top-level and in lists) matching exactly [[…]] count as links', () => {
    expect(extractLinks({ related: '[[X]]', list: ['[[Y|y]]', 'plain', 7], note: 'see [[Z]]' }, '')).toEqual(['X', 'Y'])
  })

  it('`aliases` values are NEVER links, whatever they look like (GRO-2214)', () => {
    // A `[[X]]`-shaped alias stays an alias literally named `[[X]]` (extractAliases strips
    // nothing) — it just never becomes an outgoing link of this note.
    expect(extractLinks({ aliases: ['[[X]]', 'CAC'], related: '[[Y]]' }, '')).toEqual(['Y'])
    expect(extractLinks({ aliases: '[[X]]' }, '')).toEqual([])
    expect(extractAliases({ aliases: ['[[X]]'] })).toEqual(['[[X]]'])
  })

  it('a link in a folder’s value (`[[id]]`, `[[Name]]`, or a list of them) is in the note’s links, exactly as a top-level whole-value link is', () => {
    const props = { related: '[[Top]]', in: { '3y7505rsr6fd': { owner: '[[k3m9x2pq7abc]]', Status: 'Interview', team: ['[[Sam|S]]', 'plain', 7] }, mzf9cjhn02vm: { lead: '[[Road#Scope]]' } } }
    expect(extractLinks(props, '[[Body]]')).toEqual(['Top', 'k3m9x2pq7abc', 'Sam', 'Road', 'Body'])
  })

  it('a non-link string in a folder’s value that merely contains `[[x]]` inside other text is not a link', () => {
    expect(extractLinks({ in: { '3y7505rsr6fd': { note: 'see [[x]] later', list: ['ask [[y]]'] } } }, '')).toEqual([])
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

describe('scanFile', () => {
  let root: string
  let cleanup: () => Promise<void>
  beforeAll(async () => ({ root, cleanup } = await makeViewsFixture()))
  afterAll(() => cleanup())
  const note = (...p: string[]) => path.join(root, 'Content Pillars', ...p)

  it('identity + stat fields', async () => {
    const r = await scanFile(root, note('1. Agentic Agency', 'Agentic Agency.md'))
    expect(r).toMatchObject({
      path: note('1. Agentic Agency', 'Agentic Agency.md'),
      name: 'Agentic Agency.md',
      basename: 'Agentic Agency',
      folder: 'Content Pillars/1. Agentic Agency',
      ext: 'md',
      properties: { pillar: 'Agentic Agency', status: 'idea', priority: 2, tags: ['agentic', 'pillar'], published: false, date: '2026-08-01' },
      tags: ['agentic', 'pillar'],
      links: [],
      embeds: [],
    })
    expect(r.size).toBeGreaterThan(0)
    expect(r.ctime).toBeGreaterThan(0)
    expect(r.mtime).toBeGreaterThan(0)
    expect(r.frontmatterError).toBeUndefined()
  })

  it('a note at the root has folder ""; `pillar: null` is present', async () => {
    const r = await scanFile(root, path.join(root, 'VSL-v1.md'))
    expect(r.folder).toBe('')
    expect(r.basename).toBe('VSL-v1')
    expect('pillar' in r.properties).toBe(true)
    expect(r.properties.pillar).toBeNull()
  })

  it('invalid frontmatter → frontmatterError set and properties {}', async () => {
    const r = await scanFile(root, note('4. Tech & Silicon Valley', 'Tech & Silicon Valley.md'))
    expect(r.properties).toEqual({})
    expect(r.frontmatterError).toMatch(/\S/)
  })

  it('frontmatter wikilinks count as links; nested tag kept', async () => {
    const r = await scanFile(root, note('1. Agentic Agency', 'The Levels of an Agency.md'))
    expect(r.tags).toEqual(['agentic/levels'])
    expect(r.links).toEqual(['levels.png', 'Agentic Agency'])
    expect(r.embeds).toEqual([])
  })

  it('no frontmatter: tag inside the fenced block ignored, embed collected', async () => {
    const r = await scanFile(root, note('3. Trust Economy & Paid Ads', 'Attribution.md'))
    expect(r.properties).toEqual({})
    expect(r.frontmatterError).toBeUndefined()
    expect(r.tags).toEqual(['attribution'])
    expect(r.links).toEqual([])
    expect(r.embeds).toEqual(['chart.png'])
  })

  it('`id` is the frontmatter id when it has the note-id shape, else absent (YAZ-2293 D1)', async () => {
    const withId = path.join(root, 'With id.md')
    const foreign = path.join(root, 'Foreign id.md')
    await writeFile(withId, '---\nid: k3m9x2pq7abc\n---\nbody\n')
    await writeFile(foreign, '---\nid: 42\n---\nbody\n')
    expect((await scanFile(root, withId)).id).toBe('k3m9x2pq7abc')
    expect('id' in (await scanFile(root, foreign))).toBe(false)
    expect('id' in (await scanFile(root, path.join(root, 'VSL-v1.md')))).toBe(false)
  })

  it('string `tags:` is split', async () => {
    const r = await scanFile(root, note('2. Creator Economy', 'The Gold In Your Archive.md'))
    expect(r.tags).toEqual(['creator'])
  })

  it('frontmatter `aliases` land on the record and stay out of its links (GRO-2214)', async () => {
    const aliased = path.join(root, 'aliased.md')
    await writeFile(aliased, '---\naliases: [CAC, "Cost of Acquisition"]\nrelated: "[[Attribution]]"\n---\nBody [[Ideas]].\n')
    const r = await scanFile(root, aliased)
    expect(r.aliases).toEqual(['CAC', 'Cost of Acquisition'])
    expect(r.links).toEqual(['Attribution', 'Ideas'])
  })

  it('frontmatter `comments` are the note\'s own, never a property; the other keys stay (YAZ-1472)', async () => {
    const commented = path.join(root, 'commented.md')
    await writeFile(
      commented,
      '---\nstatus: draft\ncomments:\n  - id: 3f9a1c2e\n    at: 2026-09-11T18:22:31Z\n    body: "[[Not A Link]] in a comment"\ntags: [x]\n---\nBody.\n',
    )
    const r = await scanFile(root, commented)
    expect(r.properties).toEqual({ status: 'draft', tags: ['x'] })
    expect(r.frontmatterError).toBeUndefined()
    expect(r.links).toEqual([])
  })

  it('indexing a note never removes a block of `in`: the record carries every folder’s values as written, their links counted, and the file is left byte for byte', async () => {
    const held = path.join(root, 'held.md')
    const content = '---\nin:\n  3y7505rsr6fd:\n    owner: "[[Sam]]"\n  mzf9cjhn02vm:\n    Status: 2-Todo\n---\nbody\n'
    await writeFile(held, content)
    const r = await scanFile(root, held)
    expect(r.properties).toEqual({ in: { '3y7505rsr6fd': { owner: '[[Sam]]' }, mzf9cjhn02vm: { Status: '2-Todo' } } })
    expect(r.links).toEqual(['Sam'])
    expect(await readFile(held, 'utf8')).toBe(content)
  })

  it('frontmatter `reviews` land on the record in time order and are never a property (YAZ-2322)', async () => {
    const reviewed = path.join(root, 'reviewed.md')
    await writeFile(reviewed, '---\nstatus: draft\nreview: false\nreviews:\n  - {at: 2026-11-03T09:00:00Z, rating: keep, text: 9f3a1c2e}\n  - {at: 2026-10-04T14:02:11Z, rating: keep, text: 9f3a1c2e}\n---\nBody.\n')
    const r = await scanFile(root, reviewed)
    expect(r.properties).toEqual({ status: 'draft', review: false })
    expect(r.reviews?.map((e) => e.at)).toEqual(['2026-10-04T14:02:11Z', '2026-11-03T09:00:00Z'])
  })

  it('upkeep off: the index is unchanged — the record still carries the review log and the body fingerprint, `reviews` is never a property, and the note is left byte for byte', async () => {
    const reviewed = path.join(root, 'reviewed-off.md')
    const bytes = '---\nreview: true\nreviews:\n  - {at: 2026-10-04T14:02:11Z, rating: keep, text: 9f3a1c2e}\n---\nBody.\n'
    await writeFile(reviewed, bytes)
    // No review.json, one that says off, one that says on: the same record each time.
    const records = [await scanFile(root, reviewed)]
    await mkdir(path.join(root, VAULT_CONFIG_DIR))
    for (const enabled of [false, true]) {
      await writeFile(path.join(root, VAULT_CONFIG_DIR, 'review.json'), JSON.stringify({ enabled }))
      records.push(await scanFile(root, reviewed))
    }
    await rm(path.join(root, VAULT_CONFIG_DIR), { recursive: true }) // the fixture is an un-adopted folder
    expect(records[0]).toMatchObject({ properties: { review: true }, reviews: [{ at: '2026-10-04T14:02:11Z', rating: 'keep', text: '9f3a1c2e' }], text: textFingerprint('Body.\n') })
    expect(records[1]).toEqual(records[0])
    expect(records[2]).toEqual(records[0])
    expect(await readFile(reviewed, 'utf8')).toBe(bytes)
  })

  it('`text` is the fingerprint of the body alone: a frontmatter change leaves it, a body change moves it (YAZ-2322)', async () => {
    const file = path.join(root, 'fingerprinted.md')
    await writeFile(file, '---\nstatus: draft\n---\nBody.\n')
    const first = await scanFile(root, file)
    expect(first.text).toBe(textFingerprint('Body.\n'))
    expect(first.reviews).toBeUndefined()
    await writeFile(file, '---\nstatus: done\ncomments:\n  - {id: a, at: 2026-09-11T18:22:31Z, body: hi}\n---\nBody.\n')
    expect((await scanFile(root, file)).text).toBe(first.text)
    await writeFile(file, '---\nstatus: done\n---\nBody, edited.\n')
    expect((await scanFile(root, file)).text).not.toBe(first.text)
  })

  it('files over MAX_FILE_BYTES → metadata only', async () => {
    const big = path.join(root, 'big.md')
    await writeFile(big, '---\na: 1\n---\n#tag [[x]]\n' + 'x'.repeat(MAX_FILE_BYTES))
    const r = await scanFile(root, big)
    expect(r.size).toBeGreaterThan(MAX_FILE_BYTES)
    expect(r).toMatchObject({ name: 'big.md', properties: {}, aliases: [], tags: [], links: [], embeds: [] })
    expect(r.text).toBeUndefined() // not read, so never a review card
  })

  it('missing file → BridgeFailure NOT_FOUND', async () => {
    await expect(scanFile(root, path.join(root, 'nope.md'))).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
