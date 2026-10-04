import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { FOLDER_SETTINGS_FILE } from '@shared/types'
import { makeViewsFixture } from '../fs/viewsFixture'
import { subscribe } from '../fs/watchers'
import { _evictAll, getIndex } from './index'

// A folder's settings file (YAZ-2290 D1, D8): the ONE dot-entry the index and the watcher see. It
// rides `IndexResponse.folders`, never `records`, so no row, search or completion has to filter it.

const SETTINGS = '---\nfolder_settings:\n  views:\n    - type: table\n      name: Table\n---\n'

const until = async (pred: () => Promise<boolean> | boolean, ms = 3000) => {
  const t0 = Date.now()
  while (!(await pred())) {
    if (Date.now() - t0 > ms) throw new Error('condition not met')
    await new Promise((r) => setTimeout(r, 25))
  }
}

const watcherReady = (root: string): Promise<void> =>
  new Promise((resolve) => {
    const off = subscribe(root, (ev) => {
      if (ev.type !== 'ready') return
      queueMicrotask(() => off())
      resolve()
    })
  })

describe('folder settings in the index', () => {
  let root: string
  let cleanup: () => Promise<void>
  beforeAll(async () => {
    ;({ root, cleanup } = await makeViewsFixture())
    await mkdir(path.join(root, 'Projects', 'Alpha'), { recursive: true })
    await mkdir(path.join(root, '.obsidian'), { recursive: true })
    await writeFile(path.join(root, 'Projects', FOLDER_SETTINGS_FILE), SETTINGS)
    await writeFile(path.join(root, 'Projects', 'Idea.md'), '# Idea\n')
    // Dot-entries that must stay invisible: another dot-file, and a settings file inside a dot-dir.
    await writeFile(path.join(root, 'Projects', '.hidden.md'), '# hidden\n')
    await writeFile(path.join(root, '.obsidian', FOLDER_SETTINGS_FILE), SETTINGS)
  })
  afterAll(async () => {
    _evictAll()
    await cleanup()
  })

  it('a cold scan lists the settings file under `folders`, not `records`', async () => {
    const index = await getIndex(root)
    expect(index.folders.map((r) => r.path)).toEqual([path.join(root, 'Projects', FOLDER_SETTINGS_FILE)])
    expect(index.folders[0].folder).toBe('Projects')
    expect(index.folders[0].properties).toHaveProperty('folder_settings')
    expect(index.records.some((r) => r.name === FOLDER_SETTINGS_FILE)).toBe(false)
    expect(index.records.some((r) => r.name === 'Idea.md')).toBe(true)
  })

  it('every other dot-entry stays invisible', async () => {
    const index = await getIndex(root)
    const all = [...index.records, ...index.folders].map((r) => r.path)
    expect(all).not.toContain(path.join(root, 'Projects', '.hidden.md'))
    expect(all.some((p) => p.includes(`${path.sep}.obsidian${path.sep}`))).toBe(false)
  })

  it('creating, changing and removing a settings file moves `folders` live', async () => {
    await getIndex(root)
    await watcherReady(root)
    const file = path.join(root, 'Projects', 'Alpha', FOLDER_SETTINGS_FILE)
    const has = async () => (await getIndex(root)).folders.find((r) => r.path === file)

    await writeFile(file, SETTINGS)
    await until(async () => (await has()) !== undefined)
    expect((await has())?.folder).toBe('Projects/Alpha')

    await writeFile(file, '---\nowner: Yaseen\n---\n')
    await until(async () => (await has())?.properties.owner === 'Yaseen')

    await rm(file)
    await until(async () => (await has()) === undefined)
  })

  it('a folder the app was only pointed at — no `.yaseendocs` — is given no `.folder.md`: nothing is written, its folders have no id (D13)', async () => {
    await getIndex(root) // the first build has run over every folder of the fixture
    await watcherReady(root)
    const dir = path.join(root, 'Made in Finder')
    await mkdir(dir)
    await writeFile(path.join(dir, 'note.md'), '# note\n')
    await until(async () => (await getIndex(root)).records.some((r) => r.folder === 'Made in Finder'))
    await new Promise((r) => setTimeout(r, 300)) // long enough for a write the sweep must not make
    expect(await readdir(dir)).toEqual(['note.md'])
    expect((await readdir(path.join(root, 'Content Pillars'))).filter((name) => name.startsWith('.'))).toEqual([])
    expect((await getIndex(root)).folders.map((r) => r.path)).toEqual([path.join(root, 'Projects', FOLDER_SETTINGS_FILE)])
  })

  it('removing a folder drops its settings record', async () => {
    await getIndex(root)
    const dir = path.join(root, 'Gone')
    await mkdir(dir)
    await writeFile(path.join(dir, FOLDER_SETTINGS_FILE), SETTINGS)
    await until(async () => (await getIndex(root)).folders.some((r) => r.folder === 'Gone'))
    await rm(dir, { recursive: true })
    await until(async () => !(await getIndex(root)).folders.some((r) => r.folder === 'Gone'))
  })
})
