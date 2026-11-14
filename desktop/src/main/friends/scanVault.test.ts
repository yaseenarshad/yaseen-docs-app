/**
 * YAZ-5252: the closed-vault scan in the count worker (`scanVault.ts`).
 * - YAZ-5395 (4E5i5): the scan follows NO symlink inside a vault, and never reads a file whose real path leaves the
 *   vault's real path. A symlinked `review.json`, `ids.json` or `.yaseendocs` folder: the vault is refused (skipped,
 *   with its reason), never read.
 * - YAZ-5396 (4E5i6): a vault folder swapped for a symlink AFTER main's check is refused by the worker at read time.
 * - The cards equal the live index's (`scanFile`, the shared `indexRecord`): the cheap read takes only the card lines.
 * Made-up vaults in temp folders only.
 */
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { friendStats } from '@shared/friendStats'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import { MAX_FILE_BYTES } from '@shared/types'
import { ClosedVaultsUnreadable, countPayload, makeCounter } from './countJob'
import { scanVaultForCount } from './scanVault'
import { buildCountWorker } from './testing'
import { CACHE_VERSION, cacheFile } from '../vaultIndex/cache'
import { idsOwnedBy, ownOnly, scanFile, walk } from '../vaultIndex/scan'

const NOW = Date.parse('2026-11-14T15:00:00Z')
const R1 = '2026-11-14T13:00Z good 7s'
let dir: string
let worker: string
beforeAll(async () => void (worker = await buildCountWorker()), 60_000)
beforeEach(async () => void (dir = await realpath(await mkdtemp(path.join(tmpdir(), 'yd-scan-')))))
afterEach(() => rm(dir, { recursive: true, force: true }))

/** A made-up vault with IDs on: `n` pages with one card each, answered once today. */
async function vault(name: string, n: number, letters = 'WIKI'): Promise<string> {
  const root = path.join(dir, name)
  await mkdir(path.join(root, '.yaseendocs'), { recursive: true })
  await writeFile(path.join(root, '.yaseendocs', 'ids.json'), `{"enabled":true,"letters":"${letters}"}`)
  for (let i = 0; i < n; i++) await writeFile(path.join(root, `Page ${i}.md`), `# Page ${i}\n\n\`\`\`card\nQ ${i}\n\`\`\`\n<!-- card: ${letters}-${i + 1}, ${R1} -->\n`)
  return root
}
const cardsOf = (stats: { days: { day: string; cards: number }[] }) => stats.days.find((d) => d.day === '2026-11-14')?.cards ?? 0
const refusal = (work: Promise<unknown>) => work.then(() => null, (err: unknown) => err)

describe('no symlink inside a closed vault is followed (YAZ-5395)', () => {
  for (const [what, make] of [
    ['review.json', async (root: string, outside: string) => {
      await writeFile(path.join(outside, 'review.json'), '{"newPerDay":99}')
      await symlink(path.join(outside, 'review.json'), path.join(root, '.yaseendocs', 'review.json'))
    }],
    ['ids.json', async (root: string, outside: string) => {
      await rm(path.join(root, '.yaseendocs', 'ids.json'))
      await writeFile(path.join(outside, 'ids.json'), '{"enabled":true,"letters":"WIKI"}')
      await symlink(path.join(outside, 'ids.json'), path.join(root, '.yaseendocs', 'ids.json'))
    }],
    ['the .yaseendocs folder', async (root: string, outside: string) => {
      await mkdir(path.join(outside, 'cfg'))
      await writeFile(path.join(outside, 'cfg', 'ids.json'), '{"enabled":true,"letters":"WIKI"}')
      await rm(path.join(root, '.yaseendocs'), { recursive: true })
      await symlink(path.join(outside, 'cfg'), path.join(root, '.yaseendocs'))
    }],
    ["a nested folder's ids.json", async (root: string, outside: string) => {
      await mkdir(path.join(root, 'inner', '.yaseendocs'), { recursive: true })
      await writeFile(path.join(root, 'inner', 'Inner.md'), '# Inner\n')
      await writeFile(path.join(outside, 'ids.json'), '{"enabled":true,"letters":"INNR"}')
      await symlink(path.join(outside, 'ids.json'), path.join(root, 'inner', '.yaseendocs', 'ids.json'))
    }],
  ] as const) {
    it(`a symlinked ${what} inside a closed vault: not read, the vault is refused`, async () => {
      const root = await vault('cards', 2)
      const outside = path.join(dir, 'outside')
      await mkdir(outside)
      await make(root, outside)
      const err = await refusal(scanVaultForCount(root))
      expect(err).toBeInstanceOf(ClosedVaultsUnreadable)
      expect((err as ClosedVaultsUnreadable).vaults).toEqual([{ root, why: 'symlink' }])
    })
  }

  it('a symlinked page or folder inside the vault is not walked (as the live index), and the rest still counts', async () => {
    const root = await vault('cards', 2)
    const other = await vault('other', 5, 'OTHR')
    await symlink(path.join(other, 'Page 0.md'), path.join(root, 'Linked page.md'))
    await symlink(other, path.join(root, 'Linked folder'))
    const v = await scanVaultForCount(root)
    expect(v.pages.flatMap((p) => p.cards ?? []).map((c) => c.id).sort()).toEqual(['WIKI-1', 'WIKI-2'])
  })
})

describe('a vault folder swapped for a symlink after main checked it (YAZ-5396)', () => {
  it('a vault folder swapped for a symlink after main\'s check: the worker refuses it, no card of the target is counted', async () => {
    const root = await vault('cards', 2)
    const target = await vault('target', 7, 'TRGT')
    // Main checked `root`: a real folder. Then, before the worker reads it, the folder becomes a link to `target`.
    await rename(root, path.join(dir, 'moved'))
    await symlink(target, root)
    const err = await refusal(makeCounter(worker)(countPayload([]), NOW, [{ root, key: 'k' }]))
    expect(err).toBeInstanceOf(ClosedVaultsUnreadable)
    expect((err as ClosedVaultsUnreadable).vaults).toEqual([{ root, why: 'symlink' }])
  }, 60_000)

  it('a folder inside the vault swapped for a symlink during the scan: each read checks the real path, the target is not read', async () => {
    const root = await vault('cards', 1)
    await mkdir(path.join(root, 'sub'))
    await writeFile(path.join(root, 'sub', 'Sub.md'), `\`\`\`card\nQ\n\`\`\`\n<!-- card: WIKI-50, ${R1} -->\n`)
    const target = await vault('target', 3, 'TRGT')
    await writeFile(path.join(target, 'Sub.md'), `\`\`\`card\nQ\n\`\`\`\n<!-- card: TRGT-50, ${R1} -->\n`)
    // The walk saw `sub` as a real folder; the read of `sub/Sub.md` happens after the swap.
    const err = await refusal(scanVaultForCount(root, { afterWalk: async () => {
      await rename(path.join(root, 'sub'), path.join(dir, 'sub-moved'))
      await symlink(target, path.join(root, 'sub'))
    } }))
    expect(err).toBeInstanceOf(ClosedVaultsUnreadable)
    expect((err as ClosedVaultsUnreadable).vaults).toEqual([{ root, why: 'symlink' }])
  })
})

describe('the cheap read gives the cards of the live index (YAZ-5390)', () => {
  it('pages, a card file, a nested vault, a folder settings file, a file over the size limit, a page with no card: the same cards as scanFile', async () => {
    const root = await vault('cards', 3)
    await writeFile(path.join(root, 'Card.md'), `---\nkind: card\ntitle: Capital\n---\n\`\`\`card\nParis\n\`\`\`\n<!-- card: WIKI-60, ${R1} -->\n`)
    await writeFile(path.join(root, 'Front.md'), `---\nnote: "\`\`\`card"\n---\n\`\`\`card\nX\n\`\`\`\n<!-- card: WIKI-61, ${R1}, 2026-11-13T09:00Z again 4s -->\n`)
    await writeFile(path.join(root, 'Plain.md'), '# No card\n')
    await mkdir(path.join(root, 'deep', 'er'), { recursive: true })
    await writeFile(path.join(root, 'deep', 'er', 'Deep.md'), `\`\`\`card\nD\n\`\`\`\n<!-- card: WIKI-62, ${R1} -->\n`)
    await writeFile(path.join(root, 'deep', '.folder.md'), `\`\`\`card\nF\n\`\`\`\n<!-- card: WIKI-63, ${R1} -->\n`)
    await writeFile(path.join(root, 'Big.md'), `\`\`\`card\nB\n\`\`\`\n<!-- card: WIKI-64, ${R1} -->\n${'x'.repeat(MAX_FILE_BYTES)}`)
    await mkdir(path.join(root, 'nested', '.yaseendocs'), { recursive: true })
    await writeFile(path.join(root, 'nested', '.yaseendocs', 'ids.json'), '{"enabled":true,"letters":"NEST"}')
    await writeFile(path.join(root, 'nested', 'N.md'), `\`\`\`card\nN\n\`\`\`\n<!-- card: NEST-1, ${R1} -->\n`)
    // The live index's reading of the same folder.
    const files: string[] = []
    await walk(root, files)
    const live = []
    for (const f of (await ownOnly(files, idsOwnedBy(root))).sort()) {
      const r = await scanFile(root, f)
      if (r.cards !== undefined && r.cards.length > 0) live.push({ cards: r.cards })
    }
    const v = await scanVaultForCount(root)
    expect(countPayload([v])).toBe(countPayload([{ pages: live, settings: DEFAULT_REVIEW_SETTINGS }]))
    expect(friendStats([v], NOW)).toEqual(friendStats([{ pages: live, settings: DEFAULT_REVIEW_SETTINGS }], NOW))
  })

  it("a vault that was open once: the scan takes each file's cards from the app's index cache while its time and size match, and reads only the rest", async () => {
    const root = await vault('cards', 4)
    const indexDir = path.join(dir, 'index-cache')
    await mkdir(indexDir)
    const files: string[] = []
    await walk(root, files)
    const records = await Promise.all(files.map((f) => scanFile(root, f)))
    await writeFile(cacheFile(indexDir, root), JSON.stringify({ version: CACHE_VERSION, root, records }))
    const count = makeCounter(worker, { scanDir: path.join(dir, 'scan-cache'), indexDir })
    const first = await count(countPayload([]), NOW, [{ root, key: 'a' }])
    expect(count.read()).toBe(0)
    expect(first).toEqual(friendStats([await scanVaultForCount(root)], NOW))
    // A file changed after the vault was closed: its time moved, so it is read; the index cache of another version is not used.
    await writeFile(path.join(root, 'Page 2.md'), `\`\`\`card\nQ\n\`\`\`\n<!-- card: WIKI-3, ${R1}, 2026-11-14T14:00Z good 3s -->\n`)
    await utimes(path.join(root, 'Page 2.md'), new Date(), new Date(Date.now() + 5_000))
    const fresh = makeCounter(worker, { scanDir: path.join(dir, 'scan-cache-2'), indexDir })
    expect(await fresh(countPayload([]), NOW, [{ root, key: 'b' }])).toEqual(friendStats([await scanVaultForCount(root)], NOW))
    expect(fresh.read()).toBe(1)
    await writeFile(cacheFile(indexDir, root), JSON.stringify({ version: CACHE_VERSION - 1, root, records }))
    const old = makeCounter(worker, { scanDir: path.join(dir, 'scan-cache-3'), indexDir })
    await old(countPayload([]), NOW, [{ root, key: 'c' }])
    expect(old.read()).toBe(4)
  }, 60_000)

  it('the scan keeps a pack per file in its own cache (never in the vault); a changed file is read again, the others are not', async () => {
    const root = await vault('cards', 3)
    const scanDir = path.join(dir, 'scan-cache')
    const count = makeCounter(worker, { scanDir })
    expect(cardsOf(await count(countPayload([]), NOW, [{ root, key: 'a' }]))).toBe(3)
    await writeFile(path.join(root, 'Page 1.md'), `\`\`\`card\nQ\n\`\`\`\n<!-- card: WIKI-2, ${R1}, 2026-11-14T14:00Z good 3s -->\n`)
    await writeFile(path.join(root, 'New.md'), `\`\`\`card\nQ\n\`\`\`\n<!-- card: WIKI-9, ${R1} -->\n`)
    const second = await count(countPayload([]), NOW, [{ root, key: 'b' }])
    expect(cardsOf(second)).toBe(4) // WIKI-1, 2, 3 and the new WIKI-9 (a card answered twice in a day counts once)
    expect(second).toEqual(friendStats([await scanVaultForCount(root)], NOW))
    expect(count.read()).toBe(2)
    const names = await readdir(scanDir)
    expect(names).toHaveLength(1)
    // The cache holds the cards' IDs and answers only: no card text, no page text.
    const cache = await readFile(path.join(scanDir, names[0]), 'utf8')
    expect(cache).toContain('WIKI-9')
    expect(cache).not.toContain('Q 0')
    expect(cache).not.toContain('# Page')
  }, 60_000)
})
