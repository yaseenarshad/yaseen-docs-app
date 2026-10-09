// "Change letters" (YAZ-2677 D5, S79 to S87): the vault's `ids.json` takes the new letters first,
// then each `id:` line, link, `also_in` entry, folder-value key and file name follows. Temp vaults only.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { IDS_FILE, vaultNoteId } from '@shared/noteId'
import { VAULT_CONFIG_DIR, type RenameFileResponse } from '@shared/types'
import { failure, removeVault, vaultFiles } from '../fs/testFixture'
import { _evictAll, changeLetters, getIndex, idsState } from './index'

let root: string
let twin: string
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mdapp-reletter-'))
  twin = await mkdtemp(path.join(tmpdir(), 'mdapp-reletter-twin-'))
})
afterEach(async () => {
  _evictAll()
  await removeVault(root, twin)
})

const OLD = 'aaaaaaaaaaa1'
const OLD_2 = 'bbbbbbbbbbb2'
const CONFIG = `${VAULT_CONFIG_DIR}/${IDS_FILE}`
const config = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

/** A vault with the letters `YAZ`: built names, a name the app did not build, each place that holds an ID, and two notes with an old ID. */
const VAULT: Record<string, string> = {
  [CONFIG]: config({ enabled: true, letters: 'YAZ', other: 'kept' }),
  'foo-yaz-1.md': '---\nid: YAZ-1\ntitle: Foo\n---\nFoo\n',
  'bar.md': '---\nid: YAZ-2\nalso_in:\n  - YAZ-3\nin:\n  YAZ-3:\n    status: open\nrelated: "[[YAZ-1]]"\n---\n[[YAZ-1]] [[yaz-1|label]] [[YAZ-1#Head]] ![[YAZ-1]] [[YAZ-12]] [[GPT-4]] `[[YAZ-1]]`\n',
  'Projects/.folder.md': '---\nid: YAZ-3\n---\n',
  'Projects/twelve-yaz-12.md': '---\nid: YAZ-12\ntitle: Twelve\n---\n[[YAZ-2]]\n',
  [`old-${OLD}.md`]: `---\nid: ${OLD}\ntitle: Old\n---\n[[${OLD_2}]]\n`,
  [`Projects/older-${OLD_2}.md`]: `---\nid: ${OLD_2}\ntitle: Older\n---\nbody\n`,
}

/** `VAULT` after `YAZ` became `DOC`. */
const CHANGED: Record<string, string> = {
  [CONFIG]: config({ enabled: true, letters: 'DOC', other: 'kept', was: ['YAZ'] }),
  'foo-doc-1.md': '---\nid: DOC-1\ntitle: Foo\n---\nFoo\n',
  'bar.md': '---\nid: DOC-2\nalso_in:\n  - DOC-3\nin:\n  DOC-3:\n    status: open\nrelated: "[[DOC-1]]"\n---\n[[DOC-1]] [[DOC-1|label]] [[DOC-1#Head]] ![[DOC-1]] [[DOC-12]] [[GPT-4]] `[[YAZ-1]]`\n',
  'Projects/.folder.md': '---\nid: DOC-3\n---\n',
  'Projects/twelve-doc-12.md': '---\nid: DOC-12\ntitle: Twelve\n---\n[[DOC-2]]\n',
  [`old-${OLD}.md`]: VAULT[`old-${OLD}.md`],
  [`Projects/older-${OLD_2}.md`]: VAULT[`Projects/older-${OLD_2}.md`],
}

async function make(dir: string, files: Record<string, string> = VAULT): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, rel)), { recursive: true })
    await writeFile(path.join(dir, rel), content)
  }
}
/** Each file of the vault, without its folders. */
const files = async (dir: string): Promise<Record<string, string>> => Object.fromEntries(Object.entries(await vaultFiles(dir)).filter(([rel]) => !rel.endsWith('/')))
const ids = async (dir: string): Promise<unknown> => JSON.parse(await readFile(path.join(dir, CONFIG), 'utf8'))
const rel = (dir: string, renames: readonly RenameFileResponse[]): string[][] => renames.map((r) => [path.relative(dir, r.oldPath), path.relative(dir, r.newPath)]).sort()

describe('Change letters: each ID of the vault follows (S81, S86, S87)', () => {
  it('`YAZ` to `DOC`: `ids.json` first, then each `id:` line, link, `also_in` entry, folder-value key and built file name; an old ID, a name link and code stay', async () => {
    await make(root)
    const renames: RenameFileResponse[] = []
    const seen: unknown[] = []
    const state = await changeLetters(root, 'doc', async (res) => {
      // S81: the letters are saved before any note changes.
      if (renames.length === 0) seen.push(await ids(root))
      renames.push(res)
    })
    expect(seen).toEqual([{ enabled: true, letters: 'DOC', other: 'kept', was: ['YAZ'] }])
    expect(await files(root)).toEqual(CHANGED)
    // S86: each file that took a new name is told, so its tab and its favorite follow; `bar.md` kept its name.
    expect(rel(root, renames)).toEqual([
      ['Projects/twelve-yaz-12.md', 'Projects/twelve-doc-12.md'],
      ['foo-yaz-1.md', 'foo-doc-1.md'],
    ])
    expect(renames.every((r) => r.kind === 'file')).toBe(true)
    expect(state).toEqual({ letters: 'DOC', notes: 4, stale: 0, old: 2, unfinished: false })
  })

  it('a second run changes no byte', async () => {
    await make(root)
    await changeLetters(root, 'DOC')
    const renames: RenameFileResponse[] = []
    await changeLetters(root, 'DOC', async (res) => void renames.push(res))
    expect(await files(root)).toEqual(CHANGED)
    expect(renames).toEqual([])
  })

  it('S84: the same change on two Macs writes the same bytes', async () => {
    await make(root)
    await cp(root, twin, { recursive: true })
    await changeLetters(root, 'DOC')
    await changeLetters(twin, 'DOC')
    expect(await files(twin)).toEqual(await files(root))
    expect(await files(root)).toEqual(CHANGED)
  })

  it('S85: the same letters change nothing, and letters in `was` move back to `letters`', async () => {
    await make(root)
    const before = await files(root)
    expect(await changeLetters(root, 'yaz')).toEqual({ letters: 'YAZ', notes: 4, stale: 0, old: 2, unfinished: false })
    expect(await files(root)).toEqual(before)
    await changeLetters(root, 'DOC')
    await changeLetters(root, 'YAZ')
    // An ID that changed comes back as the app writes it: in capitals (R2).
    expect(await files(root)).toEqual({ ...before, 'bar.md': before['bar.md'].replace('[[yaz-1|label]]', '[[YAZ-1|label]]'), [CONFIG]: config({ enabled: true, letters: 'YAZ', other: 'kept', was: ['DOC'] }) })
  })

  it.each(['', 'Y', 'ABCDEF', 'YA1', 'YA Z', 7])('bad letters (%j) are refused and nothing is written (S80)', async (letters) => {
    await make(root)
    const before = await files(root)
    expect((await failure(changeLetters(root, letters))).code).toBe('BAD_REQUEST')
    expect(await files(root)).toEqual(before)
  })

  it('a vault that does not use IDs is refused and not written to', async () => {
    await make(root, { ...VAULT, [CONFIG]: config({ enabled: false, letters: 'YAZ' }) })
    const before = await files(root)
    expect((await failure(changeLetters(root, 'DOC'))).code).toBe('BAD_REQUEST')
    expect((await failure(idsState(root))).code).toBe('BAD_REQUEST')
    expect(await files(root)).toEqual(before)
  })
})

describe('Change letters: a change that did not reach each file (S82, S83)', () => {
  it('S83: the app quits in the middle: `ids.json` has the new letters, each note opens, Settings counts the notes that are left, and "Finish" ends at the bytes of a run that did not stop', async () => {
    await make(root)
    const quit = changeLetters(root, 'DOC', async () => {
      throw new Error('the app quit')
    })
    await expect(quit).rejects.toThrow('the app quit')
    expect(await ids(root)).toEqual({ enabled: true, letters: 'DOC', other: 'kept', was: ['YAZ'] })
    // Each note opens: the index hands each number ID out with the letters of now.
    _evictAll()
    const index = await getIndex(root)
    expect(index.letters).toEqual(['DOC', 'YAZ'])
    expect([...index.records, ...index.folders].map((r) => r.id).sort()).toEqual(['DOC-1', 'DOC-12', 'DOC-2', 'DOC-3', OLD, OLD_2].sort())
    const state = await idsState(root)
    expect(state.letters).toBe('DOC')
    expect(state.stale).toBeGreaterThan(0)
    // "Finish" is the same change again.
    expect(await changeLetters(root, 'DOC')).toEqual({ letters: 'DOC', notes: 4, stale: 0, old: 2, unfinished: false })
    expect(await files(root)).toEqual(CHANGED)
  })

  it('S83: a note whose content changed and whose file kept the old name is counted, and is renamed by "Finish"', async () => {
    const { 'foo-doc-1.md': foo, ...rest } = CHANGED
    await make(root, { ...rest, 'foo-yaz-1.md': foo })
    expect((await idsState(root)).stale).toBe(1)
    const renames: RenameFileResponse[] = []
    await changeLetters(root, 'DOC', async (res) => void renames.push(res))
    expect(rel(root, renames)).toEqual([['foo-yaz-1.md', 'foo-doc-1.md']])
    expect(await files(root)).toEqual(CHANGED)
  })

  it('S82: a link `[[YAZ-1]]` in a file that came later still opens note 1, is counted, and "Finish" changes it', async () => {
    await make(root)
    await changeLetters(root, 'DOC')
    await writeFile(path.join(root, 'late.md'), '---\nid: DOC-20\n---\n[[YAZ-1]]\n')
    _evictAll()
    const index = await getIndex(root)
    const foo = index.records.find((r) => r.title === 'Foo')
    expect(vaultNoteId('YAZ-1', index.letters ?? [])).toBe(foo?.id)
    expect((await idsState(root)).stale).toBe(1)
    expect((await changeLetters(root, 'DOC')).stale).toBe(0)
    expect(await readFile(path.join(root, 'late.md'), 'utf8')).toBe('---\nid: DOC-20\n---\n[[DOC-1]]\n')
  })
})

describe('Change letters: a vault with no `letters` in its `ids.json` (R11)', () => {
  it('the row shows the default letters, and a change saves the new letters and changes the notes that carry the default', async () => {
    // The default of a folder named `mdapp-reletter-…` is `MDA`.
    await make(root, { [CONFIG]: config({ enabled: true }), 'one-mda-1.md': '---\nid: MDA-1\ntitle: One\n---\n[[MDA-1]]\n', 'two.md': `---\nid: ${OLD}\n---\n` })
    expect(await idsState(root)).toEqual({ letters: 'MDA', notes: 1, stale: 0, old: 1, unfinished: false })
    expect(await changeLetters(root, 'DOC')).toEqual({ letters: 'DOC', notes: 1, stale: 0, old: 1, unfinished: false })
    expect(await files(root)).toEqual({ [CONFIG]: config({ enabled: true, letters: 'DOC', was: ['MDA'] }), 'one-doc-1.md': '---\nid: DOC-1\ntitle: One\n---\n[[DOC-1]]\n', 'two.md': `---\nid: ${OLD}\n---\n` })
  })
})
