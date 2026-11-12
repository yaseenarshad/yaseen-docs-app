// A vault inside a vault (YAZ-4922 🔒 D1): a note's ID vault is the NEAREST folder above it with its own
// `ids.json` answer (`idVault`). The outer vault still lists the inner vault's notes, but it never gives, changes
// or settles their IDs, and the inner vault never does so for notes outside it. With the same letters, the inner
// vault's counter starts above the numbers it can see under the outer vault. Temp vaults only.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { IDS_FILE } from '@shared/noteId'
import { VAULT_CONFIG_DIR } from '@shared/types'
import { makeFirstMac, removeVault, sleep, vaultFiles } from '../fs/testFixture'
import { _evictAll, changeLetters, checkDuplicates, getIndex, giveIdsNow } from './index'
import { _swept } from './idSweep'
import { COUNT_DIR, mintIds } from './mint'

let root: string
let inner: string
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mdapp-nested-'))
  inner = path.join(root, 'Wiki')
})
afterEach(async () => {
  _evictAll()
  await _swept(inner)
  await removeVault(root)
})

const config = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

async function make(files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true })
    await writeFile(path.join(root, rel), content)
  }
}

/** Each note and settings file of both vaults: what an ID pass may change. The count files are left out (a pass that gives nothing writes none). */
const notes = async (): Promise<Record<string, string>> =>
  Object.fromEntries(Object.entries(await vaultFiles(root)).filter(([rel]) => !rel.endsWith('/') && !rel.includes(`${VAULT_CONFIG_DIR}/${COUNT_DIR}/`)))

/** Both indexes built (each runs its first sweep), then "Give IDs" on each, the user's pass on this Mac: every sweep of both vaults. */
async function sweepBoth(): Promise<void> {
  await getIndex(root)
  await getIndex(inner)
  await giveIdsNow(root)
  await giveIdsNow(inner)
  await _swept(root)
  await _swept(inner)
  // Long enough for a watcher event of a write that must not be made, and the sweep it starts.
  await sleep(400)
  await _swept(root)
  await _swept(inner)
}

/**
 * The "Seen for real" shape (11 Nov), made up: an outer vault, and a folder in it that is its own vault. The inner
 * vault's numbers start at `from`: with the same letters, two vaults that never shared a number.
 */
const outer = (letters: string, innerLetters: string, from = 1): Record<string, string> => {
  const n = (i: number): string => `${innerLetters}-${from + i}`
  return {
    [`${VAULT_CONFIG_DIR}/${IDS_FILE}`]: config({ enabled: true, letters }),
    'home.md': `---\nid: ${letters}-1\ntitle: Home\n---\n[[${n(0)}]]\n`,
    'Projects/.folder.md': `---\nid: ${letters}-2\n---\n`,
    'Projects/plan.md': `---\nid: ${letters}-3\ntitle: Plan\n---\nbody\n`,
    [`Wiki/${VAULT_CONFIG_DIR}/${IDS_FILE}`]: config({ enabled: true, letters: innerLetters }),
    'Wiki/react.md': `---\nid: ${n(0)}\ntitle: React\n---\n[[${n(1)}]] [[${letters}-1]]\n`,
    'Wiki/hooks.md': `---\nid: ${n(1)}\ntitle: Hooks\n---\n[[${n(0)}]]\n`,
    'Wiki/Tools/.folder.md': `---\nid: ${n(2)}\n---\n`,
    'Wiki/Tools/vite.md': `---\nid: ${n(3)}\ntitle: Vite\n---\nbody\n`,
  }
}

describe('a vault inside a vault: each note gets its ID from one vault only (D1)', () => {
  it('different letters (gap 2): both vaults open, every sweep of both run two times, and 0 IDs change: no flip-flop', async () => {
    await make(outer('YAS', 'TECH'))
    await makeFirstMac(root)
    await makeFirstMac(inner)
    const before = await notes()
    await sweepBoth()
    expect(await notes()).toEqual(before)
    await sweepBoth()
    expect(await notes()).toEqual(before)
    // The outer vault still LISTS the inner vault's notes: its sidebar, its search and its links show them.
    expect((await getIndex(root)).records.map((r) => path.relative(root, r.path))).toContain('Wiki/react.md')
  })

  it('a note added inside the inner vault takes the inner vault’s next ID, and one added outside it the outer vault’s', async () => {
    await make(outer('YAS', 'TECH'))
    await makeFirstMac(root)
    await makeFirstMac(inner)
    await sweepBoth()
    await writeFile(path.join(inner, 'new.md'), 'new\n')
    await writeFile(path.join(root, 'out.md'), 'out\n')
    await sweepBoth()
    const files = await notes()
    expect(files['Wiki/new.md']).toBe('---\nid: TECH-5\n---\nnew\n')
    expect(files['out.md']).toBe('---\nid: YAS-4\n---\nout\n')
  })

  it('"Check for duplicates" of the outer vault does not settle two notes of the inner vault, nor one of each', async () => {
    await make({ ...outer('YAS', 'YAS', 11), 'Wiki/copy.md': '---\nid: YAS-14\ntitle: Copy\n---\n', 'Projects/again.md': '---\nid: YAS-1\ntitle: Again\n---\n' })
    await makeFirstMac(root)
    await makeFirstMac(inner)
    const before = await notes()
    await checkDuplicates(root)
    await _swept(root)
    await sleep(300)
    // `Projects/again.md` and `home.md` are both the outer's: that copy is the outer's to settle. Nothing of the inner vault changes.
    const after = await notes()
    for (const rel of Object.keys(before).filter((r) => r.startsWith('Wiki/'))) expect(after[rel]).toBe(before[rel])
  })

  it('"Change letters" of the outer vault does not reach into the inner vault', async () => {
    await make(outer('YAS', 'YAS', 11))
    await makeFirstMac(root)
    const before = await notes()
    await changeLetters(root, 'ABC')
    const after = await notes()
    for (const rel of Object.keys(before).filter((r) => r.startsWith('Wiki/'))) expect(after[rel]).toBe(before[rel])
    expect(after['home.md']).toContain('id: ABC-1')
  })
})

describe('a vault inside a vault with the SAME letters (gap 3): no number is given two times', () => {
  it('the inner vault counts from above the outer vault’s counter, not from its own highest number', async () => {
    await make({ ...outer('YAS', 'YAS', 11), [`${VAULT_CONFIG_DIR}/${COUNT_DIR}/othermac0001.json`]: config({ name: 'air', since: new Date(0).toISOString(), last: 1883, made: [] }) })
    await makeFirstMac(inner)
    expect(await mintIds(inner, 2)).toEqual(['YAS-1884', 'YAS-1885'])
  })

  it('and above the highest number the outer vault’s notes hold, when its index is open on this Mac', async () => {
    await make({ ...outer('YAS', 'YAS', 11), 'Projects/high.md': '---\nid: YAS-950\ntitle: High\n---\n' })
    await makeFirstMac(root)
    await makeFirstMac(inner)
    await getIndex(root)
    expect(await mintIds(inner, 1)).toEqual(['YAS-951'])
  })

  it('the outer vault counts above the inner vault’s notes, which it lists', async () => {
    await make({ ...outer('YAS', 'YAS', 11), 'Wiki/high.md': '---\nid: YAS-700\ntitle: High\n---\n' })
    await makeFirstMac(root)
    await getIndex(root)
    expect(await mintIds(root, 1)).toEqual(['YAS-701'])
  })

  it('both vaults open and swept: 0 IDs change, and a note added in each takes a number no other note holds', async () => {
    await make(outer('YAS', 'YAS', 11))
    await makeFirstMac(root)
    await makeFirstMac(inner)
    const before = await notes()
    await sweepBoth()
    expect(await notes()).toEqual(before)
    await writeFile(path.join(inner, 'new.md'), 'new\n')
    await sweepBoth()
    await writeFile(path.join(root, 'out.md'), 'out\n')
    await sweepBoth()
    const ids = Object.values(await notes()).flatMap((text) => /^id: (.+)$/m.exec(text)?.[1] ?? [])
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('YAS-15')
    expect(ids).toContain('YAS-16')
  })
})
