// Card files at scale (YAZ-5037 phase 8): an import makes 5,000 card files. Each is one normal record, so the index
// builds them as it builds 5,000 pages: the mark is one more property read, the title one card already read.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { IDS_FILE } from '@shared/pageId'
import { removeVault } from '../fs/testFixture'
import { writeConfig } from '../vaultConfig'
import { _evictAll, getIndex } from './index'

const N = 5000
let cardsRoot: string
let pagesRoot: string

async function fill(root: string, content: (i: number) => string): Promise<void> {
  await mkdir(path.join(root, 'Imported'), { recursive: true })
  for (let i = 0; i < N; i += 250) await Promise.all(Array.from({ length: 250 }, (_, j) => writeFile(path.join(root, 'Imported', `card-${i + j}.md`), content(i + j))))
}

beforeAll(async () => {
  cardsRoot = await mkdtemp(path.join(tmpdir(), 'mdapp-cardfiles-scale-'))
  pagesRoot = await mkdtemp(path.join(tmpdir(), 'mdapp-pages-scale-'))
  const card = (i: number, title: string) => `\`\`\`card\n${title}---\nIts meaning {{${i}}}.\n\`\`\`\n<!-- card: WIKI-${i + 1}, 2026-11-10T09:12Z good -->\n`
  // A card file holds its title in `title` (YAZ-5044); a card in a page holds it as its first line.
  await fill(cardsRoot, (i) => `---\nkind: card\ntitle: What is word ${i}?\ntags: [import]\n---\n${card(i, '')}`)
  await fill(pagesRoot, (i) => `---\nid: WIKI-${N + i + 1}\ntags: [import]\n---\n${card(i, `What is word ${i}?\n`)}`)
  // Vaults that give IDs (only those have cards, YAZ-4946 D8); every page and card already holds one, and every card
  // file its `title`, so the sweep writes nothing.
  for (const root of [cardsRoot, pagesRoot]) await writeConfig(root, IDS_FILE, { enabled: true, letters: 'WIKI' })
}, 120_000)
afterAll(async () => {
  _evictAll()
  await removeVault(cardsRoot, pagesRoot)
})

describe('5,000 card files in the index (YAZ-5037 phase 8)', () => {
  it('a cold scan of 5,000 card files costs about what 5,000 pages with one card each cost, and gives each its kind and its title', async () => {
    let t0 = performance.now()
    const pages = await getIndex(pagesRoot)
    const pagesMs = performance.now() - t0
    t0 = performance.now()
    const cards = await getIndex(cardsRoot)
    const cardsMs = performance.now() - t0
    console.log(`cold scan: 5,000 pages ${pagesMs.toFixed(0)} ms, 5,000 card files ${cardsMs.toFixed(0)} ms`)
    expect(pages.records).toHaveLength(N)
    expect(cards.records).toHaveLength(N)
    expect(cards.records.every((r) => r.kind === 'card' && r.id === undefined && r.title.startsWith('What is word') && r.cards?.length === 1)).toBe(true)
    expect(pages.records.some((r) => r.kind !== undefined)).toBe(false)
    // Within twice the pages' time, plus a margin for a busy machine: the scan is disk-bound, not mark-bound.
    expect(cardsMs).toBeLessThan(pagesMs * 2 + 2000)
  }, 120_000)
})
