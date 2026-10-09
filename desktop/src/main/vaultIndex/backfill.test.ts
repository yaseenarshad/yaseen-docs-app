// "Give old IDs numbers" (YAZ-2677 D6, S88 to S90): each note with an old 12-character ID takes the
// vault's next number, oldest file first, and each link, `also_in` entry, folder-value key and file
// name follows. Temp vaults only: never a real one.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { IDS_FILE, isNumberId, vaultNoteId } from '@shared/noteId'
import { VAULT_CONFIG_DIR, type RenameFileResponse } from '@shared/types'
import { removeVault, sleep, vaultFiles } from '../fs/testFixture'
import { _evictAll, getIndex, giveOldIdsNumbers, idsState } from './index'
import { COUNT_DIR } from './mint'
import { BACKFILL_FILE } from './reletter'

let root: string
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mdapp-backfill-'))
})
afterEach(async () => {
  _evictAll()
  await removeVault(root)
})

const ZETA = 'aaaaaaaaaaa1'
const ALPHA = 'bbbbbbbbbbb2'
const PLAIN = 'ccccccccccc3'
const FOLDER = 'ddddddddddd4'
const CONFIG = `${VAULT_CONFIG_DIR}/${IDS_FILE}`
const PLAN = `${VAULT_CONFIG_DIR}/${BACKFILL_FILE}`
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

/**
 * A vault with old IDs, in the ORDER THE FILES WERE MADE, which is not the path order: links in
 * each form, an `also_in` entry, a folder value, a folder with an old ID, a name the app did not
 * build, and one note that already has a number (`YAZ-7`, the highest in use).
 */
const VAULT: [string, string][] = [
  [CONFIG, json({ enabled: true, letters: 'YAZ' })],
  [`zeta-${ZETA}.md`, `---\nid: ${ZETA}\ntitle: Zeta\n---\nSee [[${ALPHA}]] and [[${PLAIN}|label]] and [[${ZETA}]].\n`],
  [`alpha-${ALPHA}.md`, `---\nid: ${ALPHA}\ntitle: Alpha\nalso_in:\n  - ${FOLDER}\nin:\n  ${FOLDER}:\n    status: open\n---\nAlpha\n`],
  ['Projects/.folder.md', `---\nid: ${FOLDER}\n---\n`],
  ['Projects/plain.md', `---\nid: ${PLAIN}\n---\n[[${ZETA}#Head]] ![[${ALPHA}]]\n`],
  ['log.md', `---\nid: YAZ-7\nrelated: "[[${ALPHA}]]"\n---\n[[${ALPHA}]] [[${FOLDER}]] [[YAZ-7]] [[Some name]]\n`],
]

/** `VAULT` after the backfill: Zeta 8, Alpha 9, the folder 10, plain 11. */
const DONE: Record<string, string> = {
  [CONFIG]: json({ enabled: true, letters: 'YAZ' }),
  'zeta-yaz-8.md': '---\nid: YAZ-8\ntitle: Zeta\n---\nSee [[YAZ-9]] and [[YAZ-11|label]] and [[YAZ-8]].\n',
  'alpha-yaz-9.md': '---\nid: YAZ-9\ntitle: Alpha\nalso_in:\n  - YAZ-10\nin:\n  YAZ-10:\n    status: open\n---\nAlpha\n',
  'Projects/.folder.md': '---\nid: YAZ-10\n---\n',
  'Projects/plain.md': '---\nid: YAZ-11\n---\n[[YAZ-8#Head]] ![[YAZ-9]]\n',
  'log.md': '---\nid: YAZ-7\nrelated: "[[YAZ-9]]"\n---\n[[YAZ-9]] [[YAZ-10]] [[YAZ-7]] [[Some name]]\n',
}

async function make(files: readonly [string, string][] = VAULT): Promise<void> {
  for (const [rel, content] of files) {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true })
    await writeFile(path.join(root, rel), content)
    // Each file is older than the next: the order of the numbers.
    await sleep(15)
  }
}
/** Each note and config file of the vault: no folder, and not the count files. */
const files = async (): Promise<Record<string, string>> => Object.fromEntries(Object.entries(await vaultFiles(root)).filter(([rel]) => !rel.endsWith('/') && !rel.startsWith(`${VAULT_CONFIG_DIR}/${COUNT_DIR}/`)))
/** This Mac's count file: the one write of the backfill. */
const count = async (): Promise<{ last: number; made: { from: number; to: number }[] }> => {
  const dir = path.join(root, VAULT_CONFIG_DIR, COUNT_DIR)
  const [name] = await readdir(dir)
  return JSON.parse(await readFile(path.join(dir, name), 'utf8')) as { last: number; made: { from: number; to: number }[] }
}
/** Each link of the vault, as `<title of the file>: <target>` to the title of the note it opens. */
async function opens(): Promise<Record<string, string | undefined>> {
  _evictAll()
  const index = await getIndex(root)
  const all = [...index.records, ...index.folders]
  const out: Record<string, string | undefined> = {}
  for (const r of all) for (const target of [...r.links, ...r.embeds]) out[`${r.title}: ${target.length === 12 || isNumberId(target) ? 'id' : target} ${Object.keys(out).length}`] = all.find((o) => o.id !== undefined && o.id === vaultNoteId(target, index.letters ?? []))?.title
  return out
}

describe('Give old IDs numbers (S88, S89)', () => {
  it('each old note takes the next number, oldest file first, with one write of the count file; each link, `also_in` entry, folder-value key and built file name follows; each link opens the same note as before', async () => {
    await make()
    expect(await idsState(root)).toEqual({ letters: 'YAZ', notes: 1, stale: 0, old: 4 })
    const before = await opens()
    const renames: RenameFileResponse[] = []
    const state = await giveOldIdsNumbers(root, async (res) => void renames.push(res))
    expect(state).toEqual({ letters: 'YAZ', notes: 5, stale: 0, old: 0 })
    expect(await files()).toEqual(DONE)
    // No file holds an old ID.
    expect(Object.values(await files()).join('\n')).not.toMatch(/[a-d]{11}\d/)
    // R19: all the numbers with one write, after the highest in use.
    expect(await count()).toMatchObject({ last: 11, made: [{ from: 8, to: 11 }] })
    // S86: a file whose name the app built follows its ID, and is told; `plain.md` keeps its name.
    expect(renames.map((r) => [path.relative(root, r.oldPath), path.relative(root, r.newPath)]).sort()).toEqual([
      [`alpha-${ALPHA}.md`, 'alpha-yaz-9.md'],
      [`zeta-${ZETA}.md`, 'zeta-yaz-8.md'],
    ])
    const after = await opens()
    expect(Object.values(after)).toEqual(Object.values(before))
    expect(Object.values(after).filter((title) => title === undefined)).toHaveLength(1) // `[[Some name]]`
  })

  it('a second run changes no byte and takes no number', async () => {
    await make()
    await giveOldIdsNumbers(root)
    const made = await count()
    expect(await giveOldIdsNumbers(root)).toEqual({ letters: 'YAZ', notes: 5, stale: 0, old: 0 })
    expect(await files()).toEqual(DONE)
    expect(await count()).toEqual(made)
  })

  it('a vault with no old ID: nothing is written, and no number is taken', async () => {
    await make([VAULT[0], ['log.md', '---\nid: YAZ-7\n---\n[[YAZ-7]]\n']])
    const before = await vaultFiles(root)
    expect((await giveOldIdsNumbers(root)).old).toBe(0)
    expect(await vaultFiles(root)).toEqual(before)
  })
})

describe('Give old IDs numbers: a run that stopped (S90)', () => {
  it('the app quits in the middle: the old IDs that remain still work, the row shows the new count, and a second run finishes with the SAME numbers', async () => {
    await make()
    const before = await opens()
    // The app quits as the first note takes its new name.
    await expect(
      giveOldIdsNumbers(root, async () => {
        throw new Error('the app quit')
      }),
    ).rejects.toThrow('the app quit')
    const stopped = await files()
    // The plan is on disk before any note changed.
    expect(JSON.parse(stopped[PLAN])).toEqual({ [ZETA]: 'YAZ-8', [ALPHA]: 'YAZ-9', [FOLDER]: 'YAZ-10', [PLAIN]: 'YAZ-11' })
    expect(Object.keys(stopped)).toContain('zeta-yaz-8.md')
    // Each old ID that remains still works: its note holds it, and no link to it was changed.
    const during = await opens()
    for (const [link, title] of Object.entries(before)) if (title !== 'Zeta') expect(during[link]).toBe(title)
    expect((await idsState(root)).old).toBe(3)
    // The second run: the same numbers, and no second write of the count file.
    expect(await giveOldIdsNumbers(root)).toEqual({ letters: 'YAZ', notes: 5, stale: 0, old: 0 })
    expect(await files()).toEqual(DONE)
    expect(await count()).toMatchObject({ last: 11, made: [{ from: 8, to: 11 }] })
    expect(Object.values(await opens())).toEqual(Object.values(before))
  })

  it('a link that already has the number of the plan, to a note that still has its old ID: the note takes THAT number', async () => {
    await make([...VAULT.slice(0, 5), ['log.md', '---\nid: YAZ-7\nrelated: "[[YAZ-9]]"\n---\n[[YAZ-9]] [[YAZ-10]] [[YAZ-7]] [[Some name]]\n'], [PLAN, json({ [ZETA]: 'YAZ-8', [ALPHA]: 'YAZ-9', [FOLDER]: 'YAZ-10', [PLAIN]: 'YAZ-11' })]])
    await giveOldIdsNumbers(root)
    expect(await files()).toEqual(DONE)
  })

  it('a note that is not in the plan of a run that stopped takes a number after each number of the plan', async () => {
    await make([...VAULT, [PLAN, json({ [ZETA]: 'YAZ-20', [ALPHA]: 'YAZ-21' })]])
    await giveOldIdsNumbers(root)
    const after = await files()
    expect(Object.keys(after).sort()).toEqual([CONFIG, 'Projects/.folder.md', 'Projects/plain.md', 'alpha-yaz-21.md', 'log.md', 'zeta-yaz-20.md'].sort())
    expect(after['Projects/.folder.md']).toBe('---\nid: YAZ-22\n---\n')
    expect(after['Projects/plain.md']).toBe('---\nid: YAZ-23\n---\n[[YAZ-20#Head]] ![[YAZ-21]]\n')
  })
})
