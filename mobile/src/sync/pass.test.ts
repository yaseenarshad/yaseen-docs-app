import { MAX_FILE_BYTES } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { budgetMs } from '../../../client/src/test-perf'
import { GithubError } from '../github/client'
import { INDEX_STATE, type PhoneIndex } from './phoneIndex'
import { BATCH_BYTES, BATCH_FROM, packBatches, syncPass, type PassProgress } from './pass'
import { BRANCH, VAULT, cardFileText, pageText, syncSetup, type SyncSetup } from './testing'

const noYield = async () => {}
const pass = (s: SyncSetup, extra: Partial<Parameters<typeof syncPass>[0]> = {}) => syncPass({ remote: s.remote, store: s.store, vault: VAULT, yieldToUi: noYield, ...extra })

const index = async (s: SyncSetup) => (await s.store.getState<PhoneIndex>(VAULT, INDEX_STATE))!
const text = async (s: SyncSetup, path: string) => (await s.store.read(VAULT, path))?.content

const DEMO = {
  'world-capitals-nc-1.md': pageText('World capitals', 'NC-1', ['NC-2', 'NC-3']),
  'solar-system-nc-15.md': pageText('Solar system', 'NC-15', ['NC-16'], '![[NC-17]]\n\n'),
  'cards/speed-of-light-nc-17.md': cardFileText('Speed of light', 'NC-17'),
  '.yaseendocs/review.json': '{"newPerDay":10}',
  '.yaseendocs/ids.json': '{"letters":"NC"}',
  'topics/.folder.md': '---\nicon: star\n---\n',
  'assets/images/tricolour-flag.png': new Uint8Array([137, 80, 78, 71]),
  'assets/audio/perfect-fifth.mp3': new Uint8Array([73, 68, 51]),
}

describe('the sync pass (October 2E)', () => {
  it('F2: the first download gets the file list, then the eager files only, with progress; the checkpoint is written', async () => {
    const s = await syncSetup(DEMO)
    const progress: PassProgress[] = []
    const result = await pass(s, { onProgress: (p) => progress.push({ ...p }) })
    expect(result.kind).toBe('synced')
    expect((await s.store.list(VAULT)).map((e) => e.path)).toEqual(['.yaseendocs/ids.json', '.yaseendocs/review.json', 'cards/speed-of-light-nc-17.md', 'solar-system-nc-15.md', 'topics/.folder.md', 'world-capitals-nc-1.md'])
    expect(s.count('blob')).toBe(6)
    expect(progress.at(-1)).toEqual({ done: 6, total: 6 })
    expect(progress[0].done).toBeLessThan(progress.at(-1)!.done)
    const cp = await s.store.checkpoint(VAULT)
    expect(cp!.commit).toBe(s.git.branches.get(BRANCH))
    expect(Object.keys(cp!.shas)).toHaveLength(8) // pictures and sounds are in the map: "not downloaded yet"
    expect(cp!.etag).toMatch(/^W\//)
    expect(await text(s, 'world-capitals-nc-1.md')).toBe(DEMO['world-capitals-nc-1.md'])
  })

  it('the index: shared indexRecord for pages AND card files; a card file is kind card with its title; an embed is an ID in embeds', async () => {
    const s = await syncSetup(DEMO)
    await pass(s)
    const { records, commit } = await index(s)
    expect(commit).toBe(s.git.branches.get(BRANCH))
    expect(Object.keys(records).sort()).toEqual(['cards/speed-of-light-nc-17.md', 'solar-system-nc-15.md', 'topics/.folder.md', 'world-capitals-nc-1.md'])
    const cardFile = records['cards/speed-of-light-nc-17.md']
    expect(cardFile).toMatchObject({ kind: 'card', title: 'Speed of light', path: 'cards/speed-of-light-nc-17.md', folder: 'cards', name: 'speed-of-light-nc-17.md', basename: 'speed-of-light-nc-17', ext: 'md' })
    expect(cardFile.cards).toEqual([expect.objectContaining({ id: 'NC-17', title: 'Speed of light' })])
    const page = records['solar-system-nc-15.md']
    expect(page.kind).toBeUndefined()
    expect(page.embeds).toEqual(['NC-17'])
    expect(page.cards!.map((c) => c.id)).toEqual(['NC-16'])
    expect(records['world-capitals-nc-1.md']).toMatchObject({ id: 'NC-1', title: 'World capitals', folder: '' })
    expect(records['topics/.folder.md'].title).toBe('topics')
  })

  it('R1: nothing changed: one free 304, no tree, no download, nothing written', async () => {
    const s = await syncSetup(DEMO)
    await pass(s)
    const [tree, blob] = [s.count('tree'), s.count('blob')]
    expect(await pass(s)).toEqual({ kind: 'unchanged' })
    expect([s.count('tree'), s.count('blob')]).toEqual([tree, blob])
  })

  it('R2 and R4: a changed page and an added page and card file download; the index has them; a new card joins', async () => {
    const s = await syncSetup(DEMO)
    await pass(s)
    const before = s.count('blob')
    await s.git.push({ 'world-capitals-nc-1.md': pageText('World capitals', 'NC-1', ['NC-2', 'NC-3', 'NC-30']), 'new-nc-40.md': pageText('New', 'NC-40'), 'cards/pi-nc-41.md': cardFileText('Pi', 'NC-41') })
    const result = await pass(s)
    if (result.kind !== 'synced') throw new Error('no')
    expect(result.diff).toMatchObject({ added: ['cards/pi-nc-41.md', 'new-nc-40.md'], changed: ['world-capitals-nc-1.md'] })
    expect(s.count('blob') - before).toBe(3)
    const { records } = await index(s)
    expect(records['world-capitals-nc-1.md'].cards!.map((c) => c.id)).toEqual(['NC-2', 'NC-3', 'NC-30'])
    expect(records['cards/pi-nc-41.md']).toMatchObject({ kind: 'card', title: 'Pi' })
    expect(records['new-nc-40.md'].title).toBe('New')
  })

  it('R5: a deleted page leaves the phone and the index', async () => {
    const s = await syncSetup(DEMO)
    await pass(s)
    await s.git.push({ 'world-capitals-nc-1.md': null })
    const result = await pass(s)
    expect(result.kind === 'synced' && result.diff.removed).toEqual(['world-capitals-nc-1.md'])
    expect(await s.store.read(VAULT, 'world-capitals-nc-1.md')).toBeNull()
    expect((await index(s)).records['world-capitals-nc-1.md']).toBeUndefined()
  })

  it('R6: a rename (same SHA at a new path) moves the stored copy with no download', async () => {
    const s = await syncSetup(DEMO)
    await pass(s)
    const before = s.count('blob')
    await s.git.push({ 'world-capitals-nc-1.md': null, 'geo/world-capitals-nc-1.md': DEMO['world-capitals-nc-1.md'] })
    const result = await pass(s)
    expect(result.kind === 'synced' && result.diff.renamed).toEqual([{ from: 'world-capitals-nc-1.md', to: 'geo/world-capitals-nc-1.md' }])
    expect(s.count('blob')).toBe(before)
    expect(await text(s, 'geo/world-capitals-nc-1.md')).toBe(DEMO['world-capitals-nc-1.md'])
    expect(await s.store.read(VAULT, 'world-capitals-nc-1.md')).toBeNull()
    const { records } = await index(s)
    expect(records['geo/world-capitals-nc-1.md'].folder).toBe('geo')
    expect(records['world-capitals-nc-1.md']).toBeUndefined()
  })

  it('R6a: the Mac moves a card to its own file: one file loses it, one gains it; the index finds it by ID at its new file, with its reviews', async () => {
    const s = await syncSetup({ 'p.md': `${pageText('P', 'NC-1')}\`\`\`card\nMoved\n\`\`\`\n<!-- card: NC-5, 2026-11-12T14:05:00.000Z good -->\n` })
    await pass(s)
    expect((await index(s)).records['p.md'].cards!.map((c) => c.id)).toEqual(['NC-5'])
    await s.git.push({ 'p.md': `${pageText('P', 'NC-1')}![[NC-5]]\n`, 'moved-nc-5.md': `---\nkind: card\n---\n\n\`\`\`card\nMoved\n\`\`\`\n<!-- card: NC-5, title "Moved", 2026-11-12T14:05:00.000Z good -->\n` })
    await pass(s)
    const { records } = await index(s)
    const holders = Object.values(records).filter((r) => r.cards?.some((c) => c.id === 'NC-5'))
    expect(holders.map((r) => r.path)).toEqual(['moved-nc-5.md'])
    expect(holders[0].cards![0].reviews).toHaveLength(1)
    expect(records['p.md'].embeds).toEqual(['NC-5'])
  })

  it('R6b: a card file\'s title changes on the Mac (renamed file, new title): the index has the new title at the new path', async () => {
    const s = await syncSetup(DEMO)
    await pass(s)
    await s.git.push({ 'cards/speed-of-light-nc-17.md': null, 'cards/light-speed-nc-17.md': cardFileText('Light speed', 'NC-17') })
    await pass(s)
    const { records } = await index(s)
    expect(records['cards/speed-of-light-nc-17.md']).toBeUndefined()
    expect(records['cards/light-speed-nc-17.md']).toMatchObject({ kind: 'card', title: 'Light speed' })
    expect(records['cards/light-speed-nc-17.md'].cards![0]).toMatchObject({ id: 'NC-17', title: 'Light speed' })
  })

  it('R7: a picture that changed loses its kept copy; one that did not keeps it; a removed one goes', async () => {
    const s = await syncSetup(DEMO)
    await pass(s)
    await s.store.write(VAULT, 'assets/images/tricolour-flag.png', DEMO['assets/images/tricolour-flag.png'])
    await s.store.write(VAULT, 'assets/audio/perfect-fifth.mp3', DEMO['assets/audio/perfect-fifth.mp3'])
    await s.git.push({ 'assets/images/tricolour-flag.png': new Uint8Array([1, 1, 1]), 'world-capitals-nc-1.md': 'x' })
    await pass(s)
    expect(await s.store.read(VAULT, 'assets/images/tricolour-flag.png')).toBeNull()
    expect(await s.store.read(VAULT, 'assets/audio/perfect-fifth.mp3')).not.toBeNull()
    await s.git.push({ 'assets/audio/perfect-fifth.mp3': null })
    await pass(s)
    expect(await s.store.read(VAULT, 'assets/audio/perfect-fifth.mp3')).toBeNull()
  })

  it('a pass downloads no media: the pictures come after it (media/ahead.ts), so the checkpoint never waits for them', async () => {
    const s = await syncSetup(DEMO)
    await pass(s)
    expect(await s.store.read(VAULT, 'assets/images/tricolour-flag.png')).toBeNull()
    expect(await s.store.read(VAULT, 'assets/audio/perfect-fifth.mp3')).toBeNull()
  })

  it('R8: hundreds of files changed: one tree compare, no compare call', async () => {
    const files = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`p${i}.md`, pageText(`P${i}`, `NC-${i + 1}`)]))
    const s = await syncSetup(files)
    await pass(s)
    await s.git.push(Object.fromEntries(Array.from({ length: 350 }, (_, i) => [`p${i}.md`, pageText(`Q${i}`, `NC-${i + 1}`)])))
    const result = await pass(s)
    expect(result.kind === 'synced' && result.diff.changed).toHaveLength(350)
    expect(s.github.calls.some((c) => c.url.includes('/compare/'))).toBe(false)
    expect((await index(s)).records['p7.md'].title).toBe('Q7')
  })

  it('R11: a force push needs no special case: the phone adopts the new file list', async () => {
    const s = await syncSetup(DEMO)
    await pass(s)
    await s.git.forcePush({ 'only.md': pageText('Only', 'NC-99') })
    await pass(s)
    expect((await s.store.list(VAULT)).map((e) => e.path)).toEqual(['only.md'])
    expect(Object.keys((await index(s)).records)).toEqual(['only.md'])
  })

  it('R13: a settings change is named in the result, so the screens update', async () => {
    const s = await syncSetup(DEMO)
    await pass(s)
    await s.git.push({ '.yaseendocs/review.json': '{"newPerDay":20}', 'topics/.folder.md': '---\nicon: moon\n---\n' })
    const result = await pass(s)
    expect(result.kind === 'synced' && result.settings).toEqual(['.yaseendocs/review.json', 'topics/.folder.md'])
    expect(await text(s, '.yaseendocs/review.json')).toBe('{"newPerDay":20}')
  })

  it('F6: a file list that GitHub cut short stops the pass: nothing stored, no checkpoint, no partial vault', async () => {
    const s = await syncSetup(DEMO)
    s.git.truncateOver = 3
    await expect(pass(s)).rejects.toMatchObject({ code: 'TREE_TRUNCATED' })
    expect(await s.store.list(VAULT)).toEqual([])
    expect(await s.store.checkpoint(VAULT)).toBeNull()
  })

  it('F7: a page over the desktop\'s size limit is not downloaded; its record holds metadata only', async () => {
    const big = 'x'.repeat(MAX_FILE_BYTES + 1)
    const s = await syncSetup({ 'big.md': `---\ntitle: Big\n---\n${big}`, 'small.md': 'hi' })
    await pass(s)
    expect(await s.store.read(VAULT, 'big.md')).toBeNull()
    const { records } = await index(s)
    expect(records['big.md']).toMatchObject({ title: 'big', size: MAX_FILE_BYTES + 20, properties: {} })
    expect(s.count('blob')).toBe(1)
  })

  it('F5: an interrupted first download continues at the next open: stored files are kept and NOT fetched again', async () => {
    const files = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`p${i}.md`, pageText(`P${i}`, `NC-${i + 1}`)]))
    const s = await syncSetup(files)
    let blobs = 0
    s.github.interrupt = (c) => {
      if (c.url.includes('/git/blobs/') && ++blobs > 12) throw new TypeError('Load failed')
      return undefined
    }
    // The one-file path (YAZ-5929: `batchFrom` keeps the batches out): the batched path has its own test below.
    await expect(pass(s, { parallel: 1, batchFrom: Infinity })).rejects.toMatchObject({ code: 'OFFLINE' })
    expect(await s.store.checkpoint(VAULT)).toBeNull()
    const stored = (await s.store.list(VAULT)).map((e) => e.path)
    expect(stored).toHaveLength(12)
    s.github.interrupt = null
    const fetched: string[] = []
    s.github.interrupt = (c) => {
      if (c.url.includes('/git/blobs/')) fetched.push(c.url)
      return undefined
    }
    const progress: PassProgress[] = []
    await pass(s, { onProgress: (p) => progress.push({ ...p }), batchFrom: Infinity })
    expect(fetched).toHaveLength(18)
    expect(progress.at(-1)).toEqual({ done: 30, total: 30 })
    expect(Object.keys((await index(s)).records)).toHaveLength(30)
    expect(await s.store.checkpoint(VAULT)).not.toBeNull()
  })

  it('an interrupted refresh continues from the old checkpoint, without a second fetch of what it stored', async () => {
    const files = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`p${i}.md`, `v1 ${i}`]))
    const s = await syncSetup(files)
    await pass(s)
    await s.git.push(Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`p${i}.md`, `v2 ${i}`])))
    let blobs = 0
    s.github.interrupt = (c) => {
      if (c.url.includes('/git/blobs/') && ++blobs > 4) return new Response('down', { status: 502 })
      return undefined
    }
    await expect(pass(s, { parallel: 1, batchFrom: Infinity })).rejects.toBeInstanceOf(GithubError)
    s.github.interrupt = null
    const before = s.count('blob')
    await pass(s, { batchFrom: Infinity })
    expect(s.count('blob') - before).toBe(6)
    expect(await text(s, 'p9.md')).toBe('v2 9')
    expect(await text(s, 'p0.md')).toBe('v2 0')
  })

  it('the checkpoint is written LAST: a failure while writing the index leaves the old checkpoint', async () => {
    const s = await syncSetup(DEMO)
    await pass(s)
    const old = await s.store.checkpoint(VAULT)
    await s.git.push({ 'world-capitals-nc-1.md': 'changed' })
    const failing = { ...s.store, setState: async () => { throw new Error('disk') } }
    await expect(syncPass({ remote: s.remote, store: failing, vault: VAULT, yieldToUi: noYield })).rejects.toThrow('disk')
    expect(await s.store.checkpoint(VAULT)).toEqual(old)
    await pass(s)
    expect((await index(s)).records['world-capitals-nc-1.md'].title).toBe('world-capitals-nc-1')
  })

  it('after "Reset local copy" (P5) the index is rebuilt in full, not trusted', async () => {
    const s = await syncSetup(DEMO)
    await pass(s)
    await s.store.resetCopy(VAULT)
    await pass(s)
    expect(Object.keys((await index(s)).records)).toHaveLength(4)
    expect(await s.store.list(VAULT)).toHaveLength(6)
  })
})

describe('YAZ-5929: text files download in batches (GitHub GraphQL)', () => {
  const cards = (n: number, from = 0) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`cards/c-nc-${from + i}.md`, cardFileText(`Card ${from + i}`, `NC-${from + i}`)]))
  /** What the pass wrote, to check that no text with a wrong SHA reached the store. */
  const recording = (s: SyncSetup) => {
    const writes: { path: string; content: unknown }[] = []
    const store = { ...s.store, write: async (vault: string, path: string, content: string | Uint8Array) => (writes.push({ path, content }), s.store.write(vault, path, content)) }
    return { store, writes }
  }

  it('a 2,500-card first download takes at most 30 calls to GitHub (it was 2,502); every file is right', async () => {
    const files = cards(2500)
    const s = await syncSetup(files)
    const progress: PassProgress[] = []
    const result = await pass(s, { onProgress: (p) => progress.push({ ...p }) })
    if (result.kind !== 'synced') throw new Error('no')
    const calls = s.github.calls.length
    console.log(`[YAZ-5929] 2,500 text files: ${calls} calls (${s.count('ref')} head, ${s.count('tree')} tree, ${s.count('graphql')} GraphQL batches, ${s.count('blob')} one-file); batch sizes ${JSON.stringify(s.github.graphql.queries)}`)
    expect(calls).toBeLessThanOrEqual(30)
    expect(s.count('blob')).toBe(0)
    expect(s.github.graphql.queries.every((n) => n <= 100)).toBe(true)
    expect(result.fetched).toBe(2500)
    expect(progress.at(-1)).toEqual({ done: 2500, total: 2500 })
    expect(await s.store.list(VAULT)).toHaveLength(2500)
    expect(await text(s, 'cards/c-nc-1234.md')).toBe(files['cards/c-nc-1234.md'])
    expect(Object.keys((await index(s)).records)).toHaveLength(2500)
    expect((await index(s)).records['cards/c-nc-7.md']).toMatchObject({ kind: 'card', title: 'Card 7' })
  })

  it('a binary, a cut-short and a wrong-SHA file fall back to the one-file call; nothing with a wrong SHA is written', async () => {
    const files = { ...cards(12), 'odd.md': 'odd \u0000 bytes', 'long.md': 'long text', 'wrong.md': 'the true text' }
    const s = await syncSetup(files)
    const shas = await s.git.filesAt(s.git.branches.get(BRANCH)!).then(() => s.git.trees.get(s.git.commits.get(s.git.branches.get(BRANCH)!)!.tree)!)
    s.github.graphql.binary.add(shas.get('odd.md')!)
    s.github.graphql.truncated.add(shas.get('long.md')!)
    s.github.graphql.wrong.add(shas.get('wrong.md')!)
    const { store, writes } = recording(s)
    await syncPass({ remote: s.remote, store, vault: VAULT, yieldToUi: noYield })
    expect([s.count('graphql'), s.count('blob')]).toEqual([1, 3])
    const oneFile = s.github.calls.filter((c) => c.url.includes('/git/blobs/')).map((c) => c.url.split('/').at(-1)).sort()
    expect(oneFile).toEqual([shas.get('odd.md'), shas.get('long.md'), shas.get('wrong.md')].sort())
    expect(writes.some((w) => typeof w.content === 'string' && w.content.includes('(not the file)'))).toBe(false)
    expect(writes.filter((w) => w.path === 'wrong.md')).toEqual([{ path: 'wrong.md', content: 'the true text' }])
    expect(await text(s, 'long.md')).toBe('long text')
    expect(await text(s, 'odd.md')).toBe(files['odd.md'])
  })

  it(`under ${BATCH_FROM} files: the one-file path as before (9 files: 9 calls, no GraphQL); ${BATCH_FROM} files: one batch`, async () => {
    expect(BATCH_FROM).toBe(10)
    const nine = await syncSetup(cards(9))
    await pass(nine)
    expect([nine.count('graphql'), nine.count('blob')]).toEqual([0, 9])
    const ten = await syncSetup(cards(10))
    await pass(ten)
    expect([ten.count('graphql'), ten.count('blob')]).toEqual([1, 0])
  })

  it('a later pull of many changes batches too (an agent edits hundreds of cards on the Mac); a few changes do not', async () => {
    const s = await syncSetup(cards(300))
    await pass(s)
    const [g, b] = [s.count('graphql'), s.count('blob')]
    await s.git.push(Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`cards/c-nc-${i}.md`, cardFileText(`Edited ${i}`, `NC-${i}`)])))
    await pass(s)
    expect([s.count('graphql') - g, s.count('blob') - b]).toEqual([3, 0])
    expect((await index(s)).records['cards/c-nc-249.md'].title).toBe('Edited 249')
    await s.git.push({ 'cards/c-nc-1.md': cardFileText('Again', 'NC-1'), 'cards/c-nc-2.md': cardFileText('Again 2', 'NC-2') })
    await pass(s)
    expect([s.count('graphql') - g, s.count('blob') - b]).toEqual([3, 2])
  })

  it('a renamed file with many changes is taken from the stored copy: it is not in a batch', async () => {
    const s = await syncSetup(cards(20))
    await pass(s)
    const before = s.github.graphql.queries.reduce((a, n) => a + n, 0)
    await s.git.push({ 'cards/c-nc-0.md': null, 'moved/c-nc-0.md': cardFileText('Card 0', 'NC-0'), ...cards(15, 100) })
    await pass(s)
    expect(s.github.graphql.queries.reduce((a, n) => a + n, 0) - before).toBe(15)
    expect(await text(s, 'moved/c-nc-0.md')).toBe(cardFileText('Card 0', 'NC-0'))
  })

  it('a GraphQL rate limit fails the pass as RATE_LIMITED at GitHub\'s reset: nothing lost; the next pass gets every file', async () => {
    const s = await syncSetup(cards(40))
    const reset = Math.floor(Date.now() / 1000) + 600
    s.github.graphql.limitedUntil = reset
    await expect(pass(s)).rejects.toMatchObject({ code: 'RATE_LIMITED', resetAt: reset * 1000 })
    expect(await s.store.checkpoint(VAULT)).toBeNull()
    expect(s.count('blob')).toBe(0)
    s.github.graphql.limitedUntil = null
    await pass(s)
    expect(await s.store.list(VAULT)).toHaveLength(40)
    expect(await s.store.checkpoint(VAULT)).not.toBeNull()
  })

  it('F5 with batches: an interrupted first download continues; the stored files are not fetched again', async () => {
    const s = await syncSetup(cards(300))
    let queries = 0
    s.github.interrupt = (c) => {
      if (c.url.endsWith('/graphql') && ++queries === 2) throw new TypeError('Load failed')
      return undefined
    }
    await expect(pass(s, { parallel: 1 })).rejects.toMatchObject({ code: 'OFFLINE' })
    expect(await s.store.checkpoint(VAULT)).toBeNull()
    expect(await s.store.list(VAULT)).toHaveLength(100)
    s.github.interrupt = null
    const asked = s.github.graphql.queries.length
    const progress: PassProgress[] = []
    await pass(s, { onProgress: (p) => progress.push({ ...p }) })
    expect(s.github.graphql.queries.slice(asked)).toEqual([100, 100])
    expect(s.count('blob')).toBe(0)
    expect(progress.at(-1)).toEqual({ done: 300, total: 300 })
    expect(Object.keys((await index(s)).records)).toHaveLength(300)
  })

  it('a failure in one batch: no file writes after it (the other lanes stop at their next file)', async () => {
    const s = await syncSetup(cards(500))
    let queries = 0
    s.github.interrupt = (c) => (c.url.endsWith('/graphql') && ++queries === 2 ? new Response('down', { status: 502 }) : undefined)
    const { store, writes } = recording(s)
    await expect(syncPass({ remote: s.remote, store, vault: VAULT, yieldToUi: noYield })).rejects.toMatchObject({ code: 'GITHUB_DOWN' })
    // Three lanes: batches 1 and 3 were in flight; each stops at its next file. Batches 4 and 5 never start.
    expect(writes.length).toBeLessThan(200)
    const late = new Set(Object.keys(cards(500)).sort().slice(300))
    expect(writes.some((w) => late.has(w.path))).toBe(false)
    expect(s.github.graphql.queries.length).toBeLessThanOrEqual(3)
    expect(await s.store.checkpoint(VAULT)).toBeNull()
  })

  it('packBatches: at most 100 files and about 1 MB a batch, in order; a file over 1 MB goes alone (one-file call)', async () => {
    const sizes: Record<string, number> = { big: BATCH_BYTES + 1 }
    const paths = Array.from({ length: 250 }, (_, i) => `p${i}`)
    for (const p of paths) sizes[p] = 100
    sizes.p5 = 600_000
    sizes.p6 = 600_000
    const { batches, alone } = packBatches([...paths.slice(0, 10), 'big', ...paths.slice(10)], (p) => sizes[p])
    expect(alone).toEqual(['big'])
    expect(batches.flat()).toEqual(paths)
    expect(batches.every((b) => b.length <= 100 && b.reduce((a, p) => a + sizes[p], 0) <= BATCH_BYTES)).toBe(true)
    expect(batches[0]).toEqual(paths.slice(0, 6))
    const s = await syncSetup({ ...cards(11), 'long.md': 'x'.repeat(BATCH_BYTES + 10) })
    await pass(s)
    expect([s.count('graphql'), s.count('blob')]).toEqual([1, 1])
  })
})

describe('nothing heavy on the UI thread: a made-up 1,700-file vault', () => {
  it('the slicer yields after sliceMs of work, and parallel workers share ONE yield (no worker runs on while another waits)', async () => {
    const { uiSlicer } = await import('./yieldToUi')
    let time = 0
    let release: () => void = () => {}
    let yields = 0
    const slice = uiSlicer(() => (yields++, new Promise<void>((r) => (release = r))), 8, () => time)
    await slice()
    expect(yields).toBe(0)
    time = 8
    const a = slice()
    const b = slice()
    expect(yields).toBe(1)
    let bDone = false
    void b.then(() => (bDone = true))
    await Promise.resolve()
    expect(bDone).toBe(false)
    release()
    await Promise.all([a, b])
    time = 15
    await slice()
    expect(yields).toBe(1)
  })

  // timing test: up to 3 tries so a busy CI machine doesn't fail it (YAZ-4965); still fails if slow every time
  it('first download and a refresh never hold the thread for long; the numbers are printed', { retry: 2 }, async () => {
    const files: Record<string, string | Uint8Array> = {}
    for (let i = 0; i < 520; i++) files[`pages/p${i}.md`] = pageText(`Page ${i}`, `NC-${i + 1}`, [`NC-${2000 + i * 2}`, `NC-${2001 + i * 2}`], `Links [[Page ${(i + 1) % 520}]] #tag${i % 9}\n\n${'Some made-up words. '.repeat(40)}\n\n`)
    for (let i = 0; i < 90; i++) files[`cards/c-nc-${5000 + i}.md`] = cardFileText(`Card ${i}`, `NC-${5000 + i}`)
    files['.yaseendocs/review.json'] = '{}'
    for (let i = 0; i < 1089; i++) files[`assets/images/i${i}.png`] = new Uint8Array([i % 256, 1, 2, 3])
    expect(Object.keys(files)).toHaveLength(1700)

    // The probe: a zero timeout that runs again and again. The longest gap between two of its runs is the longest time
    // the thread was held (a "long task"), as the phone would feel it. Waits for the network do not count.
    let probing = true
    let gaps: number[] = []
    let last = performance.now()
    const probe = () => {
      const t = performance.now()
      gaps.push(t - last)
      last = t
      if (probing) setTimeout(probe, 0)
    }
    setTimeout(probe, 0)
    // YAZ-5092 H2: the CPU time of the work between two yields (`process.cpuUsage`, as `media/ahead.test.ts`): another
    // process on a busy machine does not add to it, so this check never skips. `budgetMs(50)`: a long task, with slack.
    const cpuMs = () => {
      const u = process.cpuUsage()
      return (u.user + u.system) / 1000
    }
    let cpuMark = cpuMs()
    let cpuHolds: number[] = []
    const realYield = () => {
      cpuHolds.push(cpuMs() - cpuMark)
      return new Promise<void>((r) =>
        setTimeout(() => {
          cpuMark = cpuMs()
          r()
        }, 0),
      )
    }
    const measure = async (run: () => Promise<unknown>) => {
      await new Promise((r) => setTimeout(r, 5))
      gaps = []
      last = performance.now()
      cpuHolds = []
      cpuMark = cpuMs()
      const t0 = performance.now()
      await run()
      cpuHolds.push(cpuMs() - cpuMark)
      return { ms: performance.now() - t0, longest: Math.max(...gaps, performance.now() - last), cpu: Math.max(...cpuHolds) }
    }
    // The machine that runs the tests may be busy (other agents): the OS then stops this process at random points, and
    // a gap is not the pass's. So: the best of up to five runs, each on a fresh vault, for the first download and the
    // refresh each, and an idle calibration first.
    let idle = { ms: 0, longest: Infinity, cpu: Infinity }
    let first = { ms: 0, longest: Infinity, cpu: Infinity }
    let refresh = { ms: 0, longest: Infinity, cpu: Infinity }
    let idx: PhoneIndex | undefined
    for (let run = 0; run < 5 && (first.longest >= budgetMs(50) || refresh.longest >= budgetMs(50)); run++) {
      const s = await syncSetup(files)
      const calm = await measure(() => new Promise((r) => setTimeout(r, 100)))
      const f = await measure(() => pass(s, { yieldToUi: realYield }))
      // YAZ-5929: 611 text files come in batches of up to 100 (about 1 MB), not 611 one-file calls.
      expect([s.count('blob'), s.count('graphql')]).toEqual([0, 7])
      await s.git.push(Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`pages/p${i}.md`, pageText(`Changed ${i}`, `NC-${i + 1}`)])))
      const r = await measure(() => pass(s, { yieldToUi: realYield }))
      if (f.longest < first.longest) first = { ...f, cpu: Math.min(f.cpu, first.cpu) }
      else first.cpu = Math.min(f.cpu, first.cpu)
      if (r.longest < refresh.longest) refresh = { ...r, cpu: Math.min(r.cpu, refresh.cpu) }
      else refresh.cpu = Math.min(r.cpu, refresh.cpu)
      if (calm.longest < idle.longest) idle = calm
      idx = await index(s)
    }
    probing = false
    const t2 = performance.now()
    structuredClone(idx)
    const cloneMs = performance.now() - t2

    console.log(`[3B perf] idle probe ${idle.longest.toFixed(1)} ms; 1,700 files: first download ${first.ms.toFixed(0)} ms, longest hold ${first.longest.toFixed(1)} ms (CPU ${first.cpu.toFixed(1)} ms); refresh of 60 ${refresh.ms.toFixed(0)} ms, longest hold ${refresh.longest.toFixed(1)} ms (CPU ${refresh.cpu.toFixed(1)} ms); index ${Object.keys(idx!.records).length} records, clone ${cloneMs.toFixed(1)} ms, ${JSON.stringify(idx).length} bytes`)
    // A "long task" is 50 ms. The pass gives the thread back every ~8 ms of work. The CPU check always holds.
    expect(first.cpu).toBeLessThan(budgetMs(50))
    expect(refresh.cpu).toBeLessThan(budgetMs(50))
    // The wall clock (what the phone feels) only when the machine is calm enough to measure it.
    if (idle.longest > 15 && (first.longest >= budgetMs(50) || refresh.longest >= budgetMs(50))) {
      console.log('[3B perf] the machine is too busy to measure wall-clock holds (the idle probe alone waited > 15 ms): the wall check skipped, the CPU check ran')
      return
    }
    expect(first.longest).toBeLessThan(budgetMs(50))
    expect(refresh.longest).toBeLessThan(budgetMs(50))
  })
})
