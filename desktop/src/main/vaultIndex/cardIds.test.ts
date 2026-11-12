// Note cards in the index (YAZ-4960): the sweep's card rules, the one counter, and links inside cards.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cardRecords } from '@shared/cardLine'
import { splitFrontmatter } from '@shared/frontmatter'
import { maskCode, rewriteNoteLinks } from '@shared/linkRewrite'
import { IDS_FILE } from '@shared/noteId'
import type { IndexRecord } from '@shared/types'
import { makeFirstMac, removeVault, sleep } from '../fs/testFixture'
import { subscribe } from '../fs/watchers'
import { writeConfig } from '../vaultConfig'
import { _swept, sweepIds } from './idSweep'
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
const cardsIn = async (rel: string) => cardRecords(splitFrontmatter(await read(rel)).body)
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

describe('the sweep gives note cards their IDs (YAZ-4960 D2)', () => {
  it('no ID, another vault\'s letters, a note\'s ID, a copy on the page: each gets the next number of the one counter, history kept but for the copy', async () => {
    const records = await vault({
      // The highest number in the vault is a CARD's (YAZ-50): every number given is above it.
      'deck.md': `---\nid: YAZ-1\n---\n# Deck\n\n${card('Fresh')}\n${card('From BUS', `BUS-12, ${HISTORY}`)}\n${card('Note ID', `YAZ-1, ${HISTORY}`)}\n${card('Mine', `YAZ-50, off, ${HISTORY}`)}\n${card('Copy of mine', `YAZ-50, off, ${HISTORY}`)}`,
      'plain.md': 'No ID yet.\n',
    })
    await sweepIds(root, records, [...records.values()], () => undefined)
    const reviews = [
      { at: '2026-11-01T09:00Z', rating: 'good' },
      { at: '2026-11-05T09:00Z', rating: 'again' },
    ]
    expect(await cardsIn('deck.md')).toEqual([
      { id: 'YAZ-52', off: false, reviews: [] },
      { id: 'YAZ-53', off: false, reviews },
      { id: 'YAZ-54', off: false, reviews },
      { id: 'YAZ-50', off: true, reviews },
      { id: 'YAZ-55', off: true, reviews: [] },
    ])
    // The note's own ID is untouched; the note with none took the first number, above the card's YAZ-50.
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
    expect(await cardsIn('b.md')).toEqual([{ id: 'YAZ-7', off: false, reviews: [{ at: '2026-11-01T09:00Z', rating: 'good' }, { at: '2026-11-05T09:00Z', rating: 'again' }] }])
  })

  it('still on both pages after the wait: a copy — the page that took it last gets a new ID and an empty history; of two swept together, the second in path order', async () => {
    const records = await vault({ 'a.md': A })
    const waits = new Map<string, number>()
    const b = await rescan(records, 'b.md', B)
    await sweepIds(root, records, [b], () => undefined, [], { cardWaits: waits })
    await sweepIds(root, records, [b], () => undefined, [], { cardWaits: waits, cardOver: new Set(waits.keys()) })
    expect(await read('a.md')).toBe(A)
    expect(await cardsIn('b.md')).toEqual([{ id: 'YAZ-8', off: false, reviews: [] }])
    // A cold start that sweeps both (the user's "Check for duplicates": no waits) keeps the first in path order.
    const both = await vault({ 'c.md': B.replace('YAZ-2', 'YAZ-3'), 'd.md': B.replace('YAZ-2', 'YAZ-4') })
    const result = await sweepIds(root, both, [...both.values()], () => undefined)
    expect((await cardsIn('c.md')).map((c) => c.id)).toEqual(['YAZ-7'])
    expect(await cardsIn('d.md')).toEqual([{ id: 'YAZ-9', off: false, reviews: [] }])
    expect(result.copies).toEqual([{ title: 'd', id: 'YAZ-9' }].map(({ id }) => ({ title: 'a note card on "d"', id })))
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
    const renamed = rewriteNoteLinks(page, (t) => t === 'Old Name', () => 'New Name')
    expect(renamed).toBe(page.replace('[[Old Name|words]]', '[[New Name|words]]'))
    const records = await vault({ 'deck.md': page })
    expect(records.get(at('deck.md'))).toMatchObject({ links: ['Outside', 'Old Name'], embeds: ['pic.png'], tags: ['card-tag'], cards: [{ id: 'YAZ-3', off: false, reviews: [] }] })
  })
})
