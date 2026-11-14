// Cards in the index (YAZ-4960): the sweep's card rules, the one counter, and links inside cards.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cardIdOf, cardRecords, formatCardLine, pageCards } from '@shared/cardLine'
import { splitFrontmatter } from '@shared/frontmatter'
import { maskCode, rewritePageLinks } from '@shared/linkRewrite'
import { IDS_FILE } from '@shared/pageId'
import type { IndexRecord } from '@shared/types'
import { makeFirstMac, removeVault, sleep } from '../fs/testFixture'
import { subscribe } from '../fs/watchers'
import { writeConfig } from '../vaultConfig'
import { _swept, giveCardIds, sweepIds } from './idSweep'
import { _evictAll, getIndex } from './index'
import { extractLinks, extractTags, scanFile } from './scan'

let root: string
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mdapp-cardids-'))
  await writeConfig(root, IDS_FILE, { enabled: true, letters: 'YAZ' })
})
afterEach(async () => {
  _evictAll()
  await removeVault(root)
})

const at = (...p: string[]) => path.join(root, ...p)
const read = (rel: string) => readFile(at(rel), 'utf8')
/** The cards' IDs and histories (the sweep's business): each card's title (YAZ-5030) left out. */
const cardsIn = async (rel: string) => cardRecords(splitFrontmatter(await read(rel)).body).map(({ title: _title, ...rest }) => rest)
const card = (text: string, line?: string) => `\`\`\`card\n${text}\n\`\`\`\n${line === undefined ? '' : `<!-- card: ${line} -->\n`}`
const HISTORY = '2026-11-01T09:00Z good, 2026-11-05T09:00Z again'

/** Writes the files, scans them, and returns the map the live index would hold. */
async function vault(files: Record<string, string>): Promise<Map<string, IndexRecord>> {
  const records = new Map<string, IndexRecord>()
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(path.dirname(at(rel)), { recursive: true })
    await writeFile(at(rel), content)
    records.set(at(rel), await scanFile(root, at(rel)))
  }
  return records
}
const rescan = async (records: Map<string, IndexRecord>, rel: string, content: string): Promise<IndexRecord> => {
  await writeFile(at(rel), content)
  const r = await scanFile(root, at(rel))
  records.set(at(rel), r)
  return r
}

describe('the sweep gives cards their IDs (YAZ-4960 D2)', () => {
  it('no ID, another vault\'s letters, a page\'s ID, a copy on the page: each gets the next number of the one counter, history kept but for the copy (the same text twice)', async () => {
    const records = await vault({
      // The highest number in the vault is a CARD's (YAZ-50): every number given is above it.
      'deck.md': `---\nid: YAZ-1\n---\n# Deck\n\n${card('Fresh')}\n${card('From BUS', `BUS-12, ${HISTORY}`)}\n${card('Page ID', `YAZ-1, ${HISTORY}`)}\n${card('Mine', `YAZ-50, off, ${HISTORY}`)}\n${card('Mine', `YAZ-50, off, ${HISTORY}`)}`,
      'plain.md': 'No ID yet.\n',
    })
    await sweepIds(root, records, [...records.values()], () => undefined)
    const reviews = [
      { at: '2026-11-01T09:00Z', rating: 'good' },
      { at: '2026-11-05T09:00Z', rating: 'again' },
    ]
    expect(await cardsIn('deck.md')).toEqual([
      { id: 'YAZ-52', off: false, next: false, reviews: [] },
      { id: 'YAZ-53', off: false, next: false, reviews },
      { id: 'YAZ-54', off: false, next: false, reviews },
      { id: 'YAZ-50', off: true, next: false, reviews },
      { id: 'YAZ-55', off: true, next: false, reviews: [] },
    ])
    // The page's own ID is untouched; the page with none took the first number, above the card's YAZ-50.
    expect(await read('deck.md')).toMatch(/^---\nid: YAZ-1\n---\n# Deck\n\n```card\nFresh\n```\n<!-- card: YAZ-52 -->\n/)
    expect(await read('plain.md')).toMatch(/^---\nid: YAZ-51\n---\n/)
    // A second pass gives nothing more.
    const again = new Map([...records.keys()].map((p) => [p, p]))
    for (const p of again.keys()) records.set(p, await scanFile(root, p))
    await sweepIds(root, records, [...records.values()], (p) => records.get(p)?.id)
    expect((await cardsIn('deck.md')).map((c) => c.id)).toEqual(['YAZ-52', 'YAZ-53', 'YAZ-54', 'YAZ-50', 'YAZ-55'])
  })

  it('a vault that does not give IDs: no card is given one, and the file is left byte for byte', async () => {
    await writeConfig(root, IDS_FILE, { enabled: false })
    const bytes = card('Fresh')
    const records = await vault({ 'deck.md': bytes })
    await sweepIds(root, records, [...records.values()], () => undefined)
    expect(await read('deck.md')).toBe(bytes)
  })
})

describe('a new card written by hand with `<!-- card: notitle -->` (YAZ-5139)', () => {
  it('the sweep adds the ID and keeps `notitle`, in a page and in a card file', async () => {
    const records = await vault({
      'deck.md': `---\nid: YAZ-1\n---\n# Deck\n\n${card('Terse\nUsing few words: {{terse}}', 'notitle')}`,
      'terse.md': `---\nkind: card\n---\n${card('Laconic\nUsing very few words: {{laconic}}', 'notitle')}`,
    })
    await sweepIds(root, records, [...records.values()], () => undefined)
    expect(await read('deck.md')).toMatch(/```\n<!-- card: YAZ-\d+, notitle -->\n$/)
    expect(await read('terse.md')).toMatch(/```\n<!-- card: YAZ-\d+, notitle -->\n$/)
  })
})

describe('card files (YAZ-5037): the card\'s ID is the file\'s ID', () => {
  it('a card file takes no page ID: its card is given one, and a second pass gives nothing more', async () => {
    const records = await vault({ 'new-card.md': `---\nkind: card\ntitle: Title\n---\n${card('')}`, 'plain.md': 'No ID yet.\n' })
    await sweepIds(root, records, [...records.values()], () => undefined)
    const content = await read('new-card.md')
    expect(content).toMatch(/^---\nkind: card\ntitle: Title\n---\n```card\n\n```\n<!-- card: YAZ-\d+ -->\n$/)
    expect(content).not.toMatch(/^id:/m)
    expect(await read('plain.md')).toMatch(/^---\nid: YAZ-\d+\n---\n/)
    // One number for the card, one for the page: the card file took no second.
    const ids = [(await cardsIn('new-card.md'))[0].id, parseInt((await read('plain.md')).match(/YAZ-(\d+)/)![1])]
    expect(ids).toHaveLength(2)
    for (const p of records.keys()) records.set(p, await scanFile(root, p))
    const before = await read('new-card.md')
    await sweepIds(root, records, [...records.values()], (p) => records.get(p)?.id)
    expect(await read('new-card.md')).toBe(before)
  })

  it('a card file that keeps the `id:` of the page it was (pick 6) keeps it, and its card keeps its own', async () => {
    const bytes = `---\nkind: card\nid: YAZ-7\ntitle: Capital of France\n---\n${card('---\nParis', `YAZ-9, ${HISTORY}`)}`
    const records = await vault({ 'capital-of-france-yaz-9.md': bytes })
    await sweepIds(root, records, [...records.values()], () => undefined)
    expect(await read('capital-of-france-yaz-9.md')).toBe(bytes)
  })

  it('the live index: a card file that lands in a vault takes one number, for its card, and no `id:` line', async () => {
    await makeFirstMac(root)
    await mkdir(at('Cards'), { recursive: true })
    const ready = new Promise<void>((resolve) => {
      const off = subscribe(root, (ev) => {
        if (ev.type !== 'ready') return
        queueMicrotask(() => off())
        resolve()
      })
    })
    await getIndex(root)
    await ready
    await writeFile(at('Cards', 'fresh.md'), `---\nkind: card\ntitle: Fresh card\n---\n${card('')}`)
    let content = ''
    for (let t0 = Date.now(); Date.now() - t0 < 5000; ) {
      await _swept(root)
      await sleep(50)
      content = await read('Cards/fresh.md')
      if (/<!-- card: YAZ-/.test(content)) break
    }
    await _swept(root)
    content = await read('Cards/fresh.md')
    expect(content).toMatch(/<!-- card: YAZ-\d+ -->/)
    expect(content).not.toMatch(/^id:/m)
  })
})

describe('the one-time move of a card file`s title into `title` (YAZ-5044 decision A, point 9)', () => {
  it('a card file from before A: its first line moves into `title`; its card ID, history and the rest of the card stay; a second pass writes nothing', async () => {
    const records = await vault({ 'Cards/capital-of-france-yaz-196.md': `---\nkind: card\ntags: [geo]\n---\n${card('Capital of France\n---\nThe capital is {{Paris}}.', `YAZ-196, ${HISTORY}`)}` })
    const before = await cardsIn('Cards/capital-of-france-yaz-196.md')
    await sweepIds(root, records, [...records.values()], () => undefined)
    const moved = await read('Cards/capital-of-france-yaz-196.md')
    expect(moved).toBe(`---\nkind: card\ntags: [geo]\ntitle: Capital of France\n---\n${card('---\nThe capital is {{Paris}}.', `YAZ-196, ${HISTORY}`)}`)
    expect(await cardsIn('Cards/capital-of-france-yaz-196.md')).toEqual(before)
    // The index reads the title from `title` now; the next pass moves nothing.
    const r = await rescan(records, 'Cards/capital-of-france-yaz-196.md', moved)
    expect(r.title).toBe('Capital of France')
    expect(r.cards?.[0].title).toBe('Capital of France')
    await sweepIds(root, records, [...records.values()], (p) => records.get(p)?.id)
    expect(await read('Cards/capital-of-france-yaz-196.md')).toBe(moved)
  })

  it('a stray page `id:` (an old build gave it) goes in the same write when nothing links to it; one a page links to stays (pick 6)', async () => {
    const records = await vault({
      'test-yaz-212.md': `---\nkind: card\nid: YAZ-198\n---\n${card('test', 'YAZ-212')}`,
      'linked-yaz-213.md': `---\nkind: card\nid: YAZ-201\n---\n${card('Linked', 'YAZ-213')}`,
      'page.md': '---\nid: YAZ-1\n---\nSee [[YAZ-201]].\n',
    })
    await sweepIds(root, records, [...records.values()], (p) => records.get(p)?.id)
    expect(await read('test-yaz-212.md')).toBe(`---\nkind: card\ntitle: test\n---\n${card('', 'YAZ-212')}`)
    expect(await read('linked-yaz-213.md')).toBe(`---\nkind: card\nid: YAZ-201\ntitle: Linked\n---\n${card('', 'YAZ-213')}`)
  })

  it('a card file with no card ID yet: the title moves, and its card is given its number in the same pass', async () => {
    const records = await vault({ 'fresh.md': `---\nkind: card\n---\n${card('Fresh words\n---\nBack')}` })
    await sweepIds(root, records, [...records.values()], () => undefined)
    expect(await read('fresh.md')).toMatch(/^---\nkind: card\ntitle: Fresh words\n---\n```card\n---\nBack\n```\n<!-- card: YAZ-\d+ -->\n$/)
  })

  it('a page is never touched: its cards keep their first lines as their titles', async () => {
    const bytes = `---\nid: YAZ-3\n---\n${card('Capital of France\n---\nParis', 'YAZ-4')}`
    const records = await vault({ 'page.md': bytes })
    await sweepIds(root, records, [...records.values()], (p) => records.get(p)?.id)
    expect(await read('page.md')).toBe(bytes)
  })
})

describe('a sync conflict copy never keeps a card (YAZ-5056)', () => {
  // GitHub AutoSync keeps both sides of a conflict: `P.md` and `P (conflict <host>, <day>).md`. A space sorts before a
  // dot, so the copy is FIRST in path order.
  const mine = '2026-11-01T09:00Z good, 2026-11-05T09:00Z again'
  const theirs = '2026-11-01T09:00Z good, 2026-11-06T09:00Z good'
  const union = [
    { at: '2026-11-01T09:00Z', rating: 'good' },
    { at: '2026-11-05T09:00Z', rating: 'again' },
    { at: '2026-11-06T09:00Z', rating: 'good' },
  ]

  it('`P.md` keeps the ID and the union of reviews; the copy\'s card takes a new ID, no reviews, and `off`', async () => {
    const copyName = 'P (conflict Host, 2026-11-13).md'
    const records = await vault({ 'P.md': `---\nid: YAZ-1\n---\n${card('Same text', `YAZ-7, ${mine}`)}`, [copyName]: `---\nid: YAZ-1\n---\n${card('Same text', `YAZ-7, ${theirs}`)}` })
    expect([...records.keys()].sort()[0]).toBe(at(copyName))
    await sweepIds(root, records, [...records.values()], () => undefined)
    expect(await cardsIn('P.md')).toEqual([{ id: 'YAZ-7', off: false, next: false, reviews: union }])
    const [copied] = await cardsIn(copyName)
    expect(copied.id).not.toBe('YAZ-7')
    expect(copied).toMatchObject({ off: true, next: false, reviews: [] })
    // The page's own ID follows the same rule: `P.md` keeps YAZ-1, the copy takes a new one.
    expect(await read('P.md')).toMatch(/^---\nid: YAZ-1\n---\n/)
    expect(await read(copyName)).not.toMatch(/^---\nid: YAZ-1\n/)
  })

  it('a numbered conflict copy and a card file follow the rule too', async () => {
    const copyName = 'Capital (conflict Mac-B, 2026-11-13 2).md'
    const records = await vault({ 'Capital.md': `---\nkind: card\n---\n${card('Capital of France', `YAZ-9, ${mine}`)}`, [copyName]: `---\nkind: card\n---\n${card('Capital of France', `YAZ-9, ${theirs}`)}` })
    await sweepIds(root, records, [...records.values()], () => undefined)
    expect(await cardsIn('Capital.md')).toEqual([{ id: 'YAZ-9', off: false, next: false, reviews: union }])
    expect(await cardsIn(copyName)).toMatchObject([{ off: true, reviews: [] }])
    expect((await cardsIn(copyName))[0].id).not.toBe('YAZ-9')
  })

  it('the original swept alone keeps its card; two conflict copies with no original settle by path order', async () => {
    const copyName = 'P (conflict Host, 2026-11-13).md'
    const P = `---\nid: YAZ-1\n---\n${card('Same text', `YAZ-7, ${mine}`)}`
    const records = await vault({ 'P.md': P, [copyName]: `---\nid: YAZ-2\n---\n${card('Same text', `YAZ-7, ${theirs}`)}` })
    await sweepIds(root, records, [records.get(at('P.md'))!], () => undefined, [], { cardWaits: new Map() })
    expect(await read('P.md')).toBe(P)
    const a = 'Q (conflict A, 2026-11-13).md'
    const b = 'Q (conflict B, 2026-11-13).md'
    const more = await vault({ [a]: card('Q', 'YAZ-20'), [b]: card('Q', 'YAZ-20') })
    await sweepIds(root, more, [...more.values()], () => undefined)
    expect((await cardsIn(a))[0].id).toBe('YAZ-20')
    expect((await cardsIn(b))[0].id).not.toBe('YAZ-20')
  })

  it('a conflict copy alone (the original was deleted) keeps its card as it is', async () => {
    const copyName = 'P (conflict Host, 2026-11-13).md'
    const bytes = `---\nid: YAZ-1\n---\n${card('Same text', `YAZ-7, ${mine}`)}`
    const records = await vault({ [copyName]: bytes })
    await sweepIds(root, records, [...records.values()], () => undefined)
    expect(await read(copyName)).toBe(bytes)
  })
})

describe('one card ID on two pages (YAZ-4960): a cut and paste keeps the card, a copy does not', () => {
  const A = `---\nid: YAZ-1\n---\n# A\n\n${card('Moving card', `YAZ-7, ${HISTORY}`)}`
  const B = `---\nid: YAZ-2\n---\n# B\n\n${card('Moving card', `YAZ-7, ${HISTORY}`)}`

  it('at the moment both pages hold it, nothing is written; once page A drops it, page B keeps its ID and history', async () => {
    const records = await vault({ 'a.md': A })
    const waits = new Map<string, number>()
    // The paste into B lands first: both pages hold YAZ-7 now.
    const b = await rescan(records, 'b.md', B)
    await sweepIds(root, records, [b], () => undefined, [], { cardWaits: waits })
    expect(await read('b.md')).toBe(B)
    expect([...waits.keys()]).toEqual([`${at('b.md')}\nYAZ-7`])
    // The cut of A is saved; the index has not read it yet. The wait ends: the disk says only B holds it.
    await writeFile(at('a.md'), '---\nid: YAZ-1\n---\n# A\n\nCut.\n')
    await sweepIds(root, records, [b], () => undefined, [], { cardWaits: waits, cardOver: new Set(waits.keys()) })
    expect(await read('b.md')).toBe(B)
    expect(await cardsIn('b.md')).toEqual([{ id: 'YAZ-7', off: false, next: false, reviews: [{ at: '2026-11-01T09:00Z', rating: 'good' }, { at: '2026-11-05T09:00Z', rating: 'again' }] }])
  })

  it('still on both pages after the wait: a copy — the page that took it last gets a new ID and an empty history; of two swept together, the second in path order', async () => {
    const records = await vault({ 'a.md': A })
    const waits = new Map<string, number>()
    const b = await rescan(records, 'b.md', B)
    await sweepIds(root, records, [b], () => undefined, [], { cardWaits: waits })
    await sweepIds(root, records, [b], () => undefined, [], { cardWaits: waits, cardOver: new Set(waits.keys()) })
    expect(await read('a.md')).toBe(A)
    expect(await cardsIn('b.md')).toEqual([{ id: 'YAZ-8', off: false, next: false, reviews: [] }])
    // A cold start that sweeps both (the user's "Check for duplicates": no waits) keeps the first in path order.
    const both = await vault({ 'c.md': B.replace('YAZ-2', 'YAZ-3'), 'd.md': B.replace('YAZ-2', 'YAZ-4') })
    const result = await sweepIds(root, both, [...both.values()], () => undefined)
    expect((await cardsIn('c.md')).map((c) => c.id)).toEqual(['YAZ-7'])
    expect(await cardsIn('d.md')).toEqual([{ id: 'YAZ-9', off: false, next: false, reviews: [] }])
    expect(result.copies).toEqual([{ title: 'd', id: 'YAZ-9' }].map(({ id }) => ({ title: 'a card on "d"', id })))
  })

  it('in the live index: the paste lands while page A still holds the card, and no file changes', async () => {
    await makeFirstMac(root)
    await vault({ 'a.md': A })
    const ready = new Promise<void>((resolve) => {
      const off = subscribe(root, (ev) => {
        if (ev.type !== 'ready') return
        queueMicrotask(() => off())
        resolve()
      })
    })
    await getIndex(root)
    await ready
    await writeFile(at('b.md'), B)
    for (let t0 = Date.now(); !(await getIndex(root)).records.some((r) => r.path === at('b.md')); ) {
      if (Date.now() - t0 > 5000) throw new Error('b.md never indexed')
      await sleep(25)
    }
    await _swept(root)
    await sleep(200)
    await _swept(root)
    expect(await read('a.md')).toBe(A)
    expect(await read('b.md')).toBe(B)
  })
})

describe('two or more cards with one ID: the sweep never drops a review (YAZ-4993)', () => {
  const r = (day: number) => `2026-11-${String(day).padStart(2, '0')}T09:00Z good`
  const page = (n: number, ...cards: string[]) => `---\nid: YAZ-${n}\n---\n# P${n}\n\n${cards.join('\n')}`
  /** Each review of each page, as `<time> <rating>`, and each card's line, for the checks every case makes. */
  const look = async (rels: string[]) => {
    const cards = (await Promise.all(rels.map(async (rel) => pageCards(await read(rel)).map((c) => ({ rel, line: c.line }))))).flat()
    const reviews = (line: (typeof cards)[number]['line']) => line.parts.flatMap((p) => (p.kind === 'review' ? [`${p.review.at} ${p.review.rating}`] : []))
    return { cards, all: new Set(cards.flatMap((c) => reviews(c.line))), lines: cards.map((c) => `${c.rel}: ${formatCardLine(c.line) ?? ''}`), dup: cards.some((c) => new Set(reviews(c.line)).size !== reviews(c.line).length) }
  }
  type Case = {
    name: string
    files: Record<string, string>
    /** One ID on two pages: the page swept after the wait (else every page is swept at once, as a cold start). */
    took?: string
    /** Written after the scan and before the sweep: the page changed under the sweep. */
    under?: Record<string, string>
    /** Each card's line after the sweep; `NEW` is a fresh number of this vault. */
    want: string[]
  }
  const NEW = /^YAZ-\d+$/
  const cases: Case[] = [
    { name: 'same text, same reviews', files: { 'a.md': page(1, card('Q', `YAZ-9, ${r(1)}, ${r(5)}`), card('Q', `YAZ-9, ${r(1)}, ${r(5)}`)) }, want: [`a.md: <!-- card: YAZ-9, ${r(1)}, ${r(5)} -->`, 'a.md: <!-- card: NEW -->'] },
    { name: 'same text, disjoint reviews (a git "keep both")', files: { 'a.md': page(1, card('Q', `YAZ-9, ${r(7)}`), card('Q', `YAZ-9, ${r(1)}`)) }, want: [`a.md: <!-- card: YAZ-9, ${r(1)}, ${r(7)} -->`, 'a.md: <!-- card: NEW -->'] },
    { name: 'same text, overlapping reviews', files: { 'a.md': page(1, card('Q', `YAZ-9, ${r(1)}, ${r(5)}`), card('Q', `YAZ-9, ${r(1)}, ${r(5)}, ${r(7)}`)) }, want: [`a.md: <!-- card: YAZ-9, ${r(1)}, ${r(5)}, ${r(7)} -->`, 'a.md: <!-- card: NEW -->'] },
    { name: 'different text, different reviews: both keep theirs', files: { 'a.md': page(1, card('Q, reworded', `YAZ-9, ${r(1)}`), card('Q', `YAZ-9, ${r(1)}, ${r(7)}`)) }, want: [`a.md: <!-- card: YAZ-9, ${r(1)} -->`, `a.md: <!-- card: NEW, ${r(1)}, ${r(7)} -->`] },
    {
      name: 'three cards with one ID (two with the first text, one with another)',
      files: { 'a.md': page(1, card('Q', `YAZ-9, ${r(1)}`), card('Q', `YAZ-9, ${r(3)}, ${r(1)}`), card('Other', `YAZ-9, ${r(5)}`)) },
      want: [`a.md: <!-- card: YAZ-9, ${r(1)}, ${r(3)} -->`, 'a.md: <!-- card: NEW -->', `a.md: <!-- card: NEW, ${r(5)} -->`],
    },
    { name: 'the keeper lower on the page: the editor saved a pasted copy above with no ID', files: { 'a.md': page(1, card('Q'), card('Q', `YAZ-9, ${r(1)}, ${r(5)}`)) }, want: ['a.md: <!-- card: NEW -->', `a.md: <!-- card: YAZ-9, ${r(1)}, ${r(5)} -->`] },
    { name: 'the original lower on the page: an agent wrote a stale copy above it', files: { 'a.md': page(1, card('Q', `YAZ-9, ${r(1)}`), card('Q', `YAZ-9, ${r(1)}, ${r(7)}`)) }, want: [`a.md: <!-- card: YAZ-9, ${r(1)}, ${r(7)} -->`, 'a.md: <!-- card: NEW -->'] },
    {
      name: '`off` and unknown parts stay on their own card',
      files: { 'a.md': page(1, card('Q', `YAZ-9, off, ${r(1)}, zz-later`), card('Q', `YAZ-9, ${r(5)}, yy-later`)) },
      want: [`a.md: <!-- card: YAZ-9, off, ${r(1)}, ${r(5)}, zz-later -->`, 'a.md: <!-- card: NEW, yy-later -->'],
    },
    { name: 'a foreign-letter ID with history', files: { 'a.md': page(1, card('Q', `BUS-12, ${r(1)}, ${r(5)}`)) }, want: [`a.md: <!-- card: NEW, ${r(1)}, ${r(5)} -->`] },
    {
      name: 'two pages after the wait, the same text: page A takes the union first, page B empties',
      files: { 'a.md': page(1, card('Q', `YAZ-7, ${r(1)}, ${r(5)}`)), 'b.md': page(2, card('Q', `YAZ-7, ${r(1)}, ${r(7)}`)) },
      took: 'b.md',
      want: [`a.md: <!-- card: YAZ-7, ${r(1)}, ${r(5)}, ${r(7)} -->`, 'b.md: <!-- card: NEW -->'],
    },
    {
      name: 'two pages after the wait, another text: both keep theirs',
      files: { 'a.md': page(1, card('Q', `YAZ-7, ${r(1)}`)), 'b.md': page(2, card('Q, edited', `YAZ-7, ${r(7)}`)) },
      took: 'b.md',
      want: [`a.md: <!-- card: YAZ-7, ${r(1)} -->`, `b.md: <!-- card: NEW, ${r(7)} -->`],
    },
    {
      name: 'a cut and paste to another page: the card keeps its ID and history there, nothing doubled',
      files: { 'a.md': page(1, card('Q', `YAZ-7, ${r(1)}, ${r(5)}`)), 'b.md': page(2, card('Q', `YAZ-7, ${r(1)}, ${r(5)}`)) },
      took: 'b.md',
      under: { 'a.md': page(1, 'Cut.\n') },
      want: [`b.md: <!-- card: YAZ-7, ${r(1)}, ${r(5)} -->`],
    },
    {
      name: 'the page changed under the sweep (another card now at that place): it takes nothing',
      files: { 'a.md': page(1, card('Q', `YAZ-9, ${r(1)}`), card('Q', `YAZ-9, ${r(7)}`)) },
      under: { 'a.md': page(1, card('Q', `YAZ-9, ${r(1)}`), card('Q', `YAZ-30, ${r(7)}`)) },
      want: [`a.md: <!-- card: YAZ-9, ${r(1)} -->`, `a.md: <!-- card: YAZ-30, ${r(7)} -->`],
    },
  ]

  it.each(cases)('$name', async ({ files, took, under, want }) => {
    const rels = Object.keys(files)
    const records = await vault(took === undefined ? files : Object.fromEntries(Object.entries(files).filter(([rel]) => rel !== took)))
    const before = await look(rels.filter((rel) => records.has(at(rel))))
    if (took === undefined) {
      for (const [rel, content] of Object.entries(under ?? {})) await writeFile(at(rel), content)
      await sweepIds(root, records, [...records.values()], () => undefined)
    } else {
      const waits = new Map<string, number>()
      const b = await rescan(records, took, files[took])
      for (const c of (await look([took])).all) before.all.add(c)
      await sweepIds(root, records, [b], () => undefined, [], { cardWaits: waits })
      // While the wait runs, nothing is written.
      for (const rel of rels) expect(await read(rel)).toBe(files[rel])
      for (const [rel, content] of Object.entries(under ?? {})) await writeFile(at(rel), content)
      await sweepIds(root, records, [b], () => undefined, [], { cardWaits: waits, cardOver: new Set(waits.keys()) })
    }
    const after = await look(rels)
    // No review leaves the vault, none is twice on one card, and no two cards share an ID.
    for (const review of before.all) expect(after.all, review).toContain(review)
    expect(after.dup).toBe(false)
    const ids = after.cards.map((c) => cardIdOf(c.line))
    expect(new Set(ids).size).toBe(ids.length)
    expect(after.lines.length).toBe(want.length)
    after.lines.forEach((line, i) => {
      const [head, tail] = want[i].split('NEW')
      if (tail === undefined) return expect(line).toBe(head)
      expect(line.startsWith(head) && line.endsWith(tail)).toBe(true)
      expect(line.slice(head.length, line.length - tail.length)).toMatch(NEW)
    })
  })

  it('the keeper on another page is written FIRST, with its own compare-and-set: a keeper that changed under the sweep stops the copy`s write', async () => {
    await vault({ 'a.md': page(1, card('Q', `YAZ-7, ${r(1)}`)), 'b.md': page(2, card('Q', `YAZ-7, ${r(7)}`)) })
    const B = await read('b.md')
    // Page A no longer holds YAZ-7 (a cut): no copy now, and page B keeps its line.
    await writeFile(at('a.md'), page(1, 'Cut.\n'))
    expect(await giveCardIds(at('b.md'), [{ index: 0, held: 'YAZ-7', history: false, keeper: at('a.md') }], ['YAZ-40'])).toBe(false)
    expect(await read('b.md')).toBe(B)
  })
})

describe('links inside cards (YAZ-4960 D17)', () => {
  const page = ['Intro [[Outside]]', '', '```card', 'Front [[Old Name|words]] and #card-tag', '---', '![[pic.png]] back', '```', '<!-- card: YAZ-3 -->', '', '```js', '[[In code]] #code-tag', '```', ''].join('\n')

  it('count as links, embeds and tags, and a rename rewrites them; another fence\'s text stays out', async () => {
    expect(extractLinks({}, page)).toEqual(['Outside', 'Old Name'])
    expect(extractTags({}, page)).toEqual(['card-tag'])
    const masked = maskCode(page)
    expect(masked).toHaveLength(page.length)
    expect(masked).toContain('Front [[Old Name|words]]')
    expect(masked).not.toContain('[[In code]]')
    expect(masked).not.toContain('```')
    const renamed = rewritePageLinks(page, (t) => t === 'Old Name', () => 'New Name')
    expect(renamed).toBe(page.replace('[[Old Name|words]]', '[[New Name|words]]'))
    const records = await vault({ 'deck.md': page })
    expect(records.get(at('deck.md'))).toMatchObject({ links: ['Outside', 'Old Name'], embeds: ['pic.png'], tags: ['card-tag'], cards: [{ id: 'YAZ-3', off: false, next: false, reviews: [] }] })
  })
})
