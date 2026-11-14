// "Give IDs" in a folder whose pages already hold number IDs (YAZ-4922 🔒 D2, gap 1): the box counts the IDs per
// letters and offers to keep the biggest group. Keep writes `ids.json` only. Other letters move the main group's
// numbers, links and file names, as "Change letters" does. The other groups keep their IDs, and a page that has a
// number never gets a fresh one: only a page with no ID gets one. Temp vaults only.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { IDS_FILE } from '@shared/pageId'
import { VAULT_CONFIG_DIR } from '@shared/types'
import { makeFirstMac, removeVault, sleep, vaultFiles } from '../fs/testFixture'
import { _evictAll, checkDuplicates, getIndex, turnIdsOn } from './index'
import { _swept } from './idSweep'

let root: string
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mdapp-keep-'))
})
afterEach(async () => {
  _evictAll()
  await removeVault(root)
})

const CONFIG = `${VAULT_CONFIG_DIR}/${IDS_FILE}`

async function make(files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true })
    await writeFile(path.join(root, rel), content)
  }
}
/** Each file, without its folders and the count files. */
const files = async (): Promise<Record<string, string>> => Object.fromEntries(Object.entries(await vaultFiles(root)).filter(([rel]) => !rel.endsWith('/') && !rel.includes(`${VAULT_CONFIG_DIR}/ids/`)))
const ids = async (): Promise<unknown> => JSON.parse(await readFile(path.join(root, CONFIG), 'utf8'))
const settle = async (): Promise<void> => {
  await _swept(root)
  await sleep(300)
  await _swept(root)
}

/** A folder of pages with `YAS` IDs and built file names, cut out of a `YAS` vault: links between them, and a folder page. */
const WIKI: Record<string, string> = {
  'react-yas-796.md': '---\nid: YAS-796\ntitle: React\n---\n[[YAS-797]] and [[YAS-910|hooks]]\n',
  'state-yas-797.md': '---\nid: YAS-797\ntitle: State\n---\n[[YAS-796]]\n',
  'Hooks/.folder.md': '---\nid: YAS-909\n---\n',
  'Hooks/use-effect-yas-910.md': '---\nid: YAS-910\ntitle: Use effect\nrelated: "[[YAS-796]]"\n---\nbody\n',
  'my own name.md': '---\nid: YAS-911\ntitle: Pages\n---\n[[YAS-910]]\n',
}

describe('the box counts the IDs the pages already hold (ask.groups)', () => {
  it('a vault that has not answered: each letters with how many pages and folders hold them, the biggest first', async () => {
    await make({ ...WIKI, 'tech-1.md': '---\nid: TECH-1\n---\n', 'plain.md': 'no id\n' })
    expect((await getIndex(root)).ask).toMatchObject({ groups: [{ letters: 'YAS', count: 5 }, { letters: 'TECH', count: 1 }] })
  })

  it('what Keep writes: a number only for each page with no ID, and a settings file only for a folder whose page holds no number ID', async () => {
    await make({ ...WIKI, 'tech-1.md': '---\nid: TECH-1\n---\n', 'plain.md': 'no id\n', 'New/a.md': 'a\n' })
    // Hooks/.folder.md holds YAS-909, which Keep keeps: only New takes a settings file.
    expect((await getIndex(root)).ask).toMatchObject({ bare: 2, folders: 1 })
  })

  it('no number IDs: no groups, the box is the one it always was', async () => {
    await make({ 'a.md': 'a\n' })
    expect((await getIndex(root)).ask).toEqual({ pages: 1, folders: 0, foreign: 0 })
  })
})

describe('Keep: the IDs the pages hold stay (gap 1)', () => {
  it('Keep YAS writes `ids.json` only: 0 pages change, and every link still opens its page', async () => {
    await make(WIKI)
    await makeFirstMac(root)
    const before = await files()
    await turnIdsOn(root, 'YAS')
    await settle()
    expect(await files()).toEqual({ ...before, [CONFIG]: `${JSON.stringify({ enabled: true, letters: 'YAS' }, null, 2)}\n` })
    expect((await getIndex(root)).records.map((r) => r.id).sort()).toEqual(['YAS-796', 'YAS-797', 'YAS-910', 'YAS-911'])
  })

  it('mixed letters, the numbers overlapping: Keep YAS keeps the TECH pages’ IDs as they are, and only the page with no ID gets a number', async () => {
    await make({ ...WIKI, 'tech-a.md': '---\nid: TECH-796\ntitle: Tech A\n---\n[[YAS-796]]\n', 'tech-b.md': '---\nid: TECH-2\n---\n[[TECH-796]]\n', 'plain.md': 'no id\n' })
    await makeFirstMac(root)
    const before = await files()
    await turnIdsOn(root, 'YAS')
    await settle()
    const after = await files()
    for (const rel of Object.keys(before).filter((r) => r !== 'plain.md')) expect(after[rel]).toBe(before[rel])
    expect(after['plain.md']).toBe('---\nid: YAS-912\n---\nno id\n')
    expect(await ids()).toEqual({ enabled: true, letters: 'YAS', kept: ['TECH'] })
    // The index hands each kept ID out as it is: `[[TECH-796]]` opens Tech A, and `[[YAS-796]]` opens React.
    const byId = new Map((await getIndex(root)).records.map((r) => [r.id, r.name]))
    expect(byId.get('TECH-796')).toBe('tech-a.md')
    expect(byId.get('YAS-796')).toBe('react-yas-796.md')
    expect(byId.get('TECH-2')).toBe('tech-b.md')
    expect(await checkDuplicates(root)).toBe('No duplicates.')
  })
})

describe('Other letters: the numbers stay, and each ID, link and file name follows (gap 1)', () => {
  it('ABC instead of YAS: YAS-796 becomes ABC-796 in its page, in each link and in its built file name; a name the app did not build stays', async () => {
    await make(WIKI)
    await makeFirstMac(root)
    await turnIdsOn(root, 'ABC')
    await settle()
    expect(await files()).toEqual({
      [CONFIG]: `${JSON.stringify({ enabled: true, letters: 'ABC', was: ['YAS'] }, null, 2)}\n`,
      'react-abc-796.md': '---\nid: ABC-796\ntitle: React\n---\n[[ABC-797]] and [[ABC-910|hooks]]\n',
      'state-abc-797.md': '---\nid: ABC-797\ntitle: State\n---\n[[ABC-796]]\n',
      'Hooks/.folder.md': '---\nid: ABC-909\n---\n',
      'Hooks/use-effect-abc-910.md': '---\nid: ABC-910\ntitle: Use effect\nrelated: "[[ABC-796]]"\n---\nbody\n',
      'my own name.md': '---\nid: ABC-911\ntitle: Pages\n---\n[[ABC-910]]\n',
    })
  })

  it('mixed letters: ABC moves the biggest group (YAS) and keeps TECH as it is; the page with no ID gets the next ABC number', async () => {
    await make({ ...WIKI, 'tech-a.md': '---\nid: TECH-796\ntitle: Tech A\n---\n[[YAS-796]] [[TECH-2]]\n', 'tech-b.md': '---\nid: TECH-2\n---\n', 'plain.md': 'no id\n' })
    await makeFirstMac(root)
    await turnIdsOn(root, 'ABC')
    await settle()
    const after = await files()
    expect(after['tech-a.md']).toBe('---\nid: TECH-796\ntitle: Tech A\n---\n[[ABC-796]] [[TECH-2]]\n')
    expect(after['tech-b.md']).toBe('---\nid: TECH-2\n---\n')
    expect(after['react-abc-796.md']).toBe('---\nid: ABC-796\ntitle: React\n---\n[[ABC-797]] and [[ABC-910|hooks]]\n')
    expect(after['plain.md']).toBe('---\nid: ABC-912\n---\nno id\n')
    expect(await ids()).toEqual({ enabled: true, letters: 'ABC', was: ['YAS'], kept: ['TECH'] })
  })

  it('typing the letters of a smaller group keeps that group, and keeps the others as they are: 0 pages change', async () => {
    await make({ ...WIKI, 'tech-b.md': '---\nid: TECH-2\n---\n' })
    await makeFirstMac(root)
    const before = await files()
    await turnIdsOn(root, 'tech')
    await settle()
    expect(await files()).toEqual({ ...before, [CONFIG]: `${JSON.stringify({ enabled: true, letters: 'TECH', kept: ['YAS'] }, null, 2)}\n` })
  })
})
