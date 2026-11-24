import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rename, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BOARD_META_KEY } from '@shared/drawingAssets'
import { IDS_FILE } from '@shared/pageId'
import type { WatchEvent } from '@shared/types'
import { makeFirstMac, removeVault } from '../fs/testFixture'
import { writeConfig } from '../vaultConfig'
import { _swept } from './idSweep'
import { _evictAll, getIndex, indexMoved, onExternalRename } from './index'

type WatchListener = (ev: WatchEvent) => void
const listeners = vi.hoisted(() => new Map<string, Set<WatchListener>>())

vi.mock('../fs/watchers', () => ({
  subscribe: vi.fn((root: string, listener: WatchListener) => {
    let set = listeners.get(root)
    if (set === undefined) listeners.set(root, (set = new Set()))
    set.add(listener)
    return () => {
      set?.delete(listener)
      if (set?.size === 0) listeners.delete(root)
    }
  }),
}))

function emit(root: string, ev: WatchEvent): void {
  for (const listener of listeners.get(root) ?? []) listener(ev)
}

const addEv = (filePath: string): WatchEvent => ({ type: 'add', path: filePath, mtime: Date.now() })

const boardWith = (id: string) =>
  `${JSON.stringify({ [BOARD_META_KEY]: { createdAt: 1, updatedAt: 2, id }, type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} }, null, 2)}\n`

describe('vaultIndex external rename detection (YAZ-6438)', () => {
  let root: string
  let detected: Array<{ root: string; oldPath: string; newPath: string }>

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'yd-ext-rename-'))
    detected = []
    onExternalRename((r, oldPath, newPath) => detected.push({ root: r, oldPath, newPath }))
  })

  afterEach(async () => {
    onExternalRename(undefined)
    _evictAll()
    listeners.clear()
    vi.restoreAllMocks()
    await removeVault(root)
  })

  it('detects markdown page rename by Page ID when unlink arrives before add', async () => {
    await writeConfig(root, IDS_FILE, { enabled: true, letters: 'YAZ' })
    await makeFirstMac(root)
    const oldPath = path.join(root, 'Note-YAZ-1.md')
    const newPath = path.join(root, 'Renamed-YAZ-1.md')
    await writeFile(oldPath, '---\nid: YAZ-1\n---\n\nHello\n')
    await getIndex(root)

    await rename(oldPath, newPath)
    emit(root, { type: 'unlink', path: oldPath })
    emit(root, addEv(newPath))
    // Drain in-flight scan via getIndex.
    await getIndex(root)

    expect(detected).toEqual([{ root, oldPath, newPath }])
  })

  it('detects markdown page rename by Page ID when add arrives before unlink, without false idSweep renumbering', async () => {
    await writeConfig(root, IDS_FILE, { enabled: true, letters: 'YAZ' })
    await makeFirstMac(root)
    const oldPath = path.join(root, 'Alpha-YAZ-7.md')
    const newPath = path.join(root, 'Beta-YAZ-7.md')
    await writeFile(oldPath, '---\nid: YAZ-7\n---\n\nBody\n')
    await getIndex(root)

    await rename(oldPath, newPath)
    emit(root, addEv(newPath))
    // Let the add scan finish before unlink arrives so entry.records holds both paths briefly.
    await getIndex(root)
    emit(root, { type: 'unlink', path: oldPath })
    await _swept(root)

    expect(detected).toEqual([{ root, oldPath, newPath }])
    // The page must keep its original ID (onDisk stat check sees oldPath is gone, so no duplicate renumber).
    expect(await readFile(newPath, 'utf8')).toContain('id: YAZ-7')
  })

  it('detects board (.excalidraw) rename by Board ID in both event orders', async () => {
    await writeConfig(root, IDS_FILE, { enabled: true, letters: 'DEM' })
    const b1Old = path.join(root, 'BoardA.excalidraw')
    const b1New = path.join(root, 'BoardA-renamed.excalidraw')
    const b2Old = path.join(root, 'BoardB.excalidraw')
    const b2New = path.join(root, 'BoardB-renamed.excalidraw')
    await writeFile(b1Old, boardWith('DEM-10'))
    await writeFile(b2Old, boardWith('DEM-11'))
    await getIndex(root)

    // Order 1: unlink then add
    await rename(b1Old, b1New)
    emit(root, { type: 'unlink', path: b1Old })
    emit(root, addEv(b1New))
    await getIndex(root)

    // Order 2: add then unlink
    await rename(b2Old, b2New)
    emit(root, addEv(b2New))
    await getIndex(root)
    emit(root, { type: 'unlink', path: b2Old })

    expect(detected).toEqual([
      { root, oldPath: b1Old, newPath: b1New },
      { root, oldPath: b2Old, newPath: b2New },
    ])
  })

  it('detects non-ID markdown page rename by unique (size, mtime) in both orders', async () => {
    const aOld = path.join(root, 'plain-a.md')
    const aNew = path.join(root, 'plain-a-moved.md')
    const bOld = path.join(root, 'plain-b.md')
    const bNew = path.join(root, 'plain-b-moved.md')
    await writeFile(aOld, '# Plain A\n\nSome content\n')
    await writeFile(bOld, '# Plain B\n\nDifferent content here\n')
    await getIndex(root)

    // Order 1: unlink then add
    await rename(aOld, aNew)
    emit(root, { type: 'unlink', path: aOld })
    emit(root, addEv(aNew))
    await getIndex(root)

    // Order 2: add then unlink
    await rename(bOld, bNew)
    emit(root, addEv(bNew))
    await getIndex(root)
    emit(root, { type: 'unlink', path: bOld })

    expect(detected).toEqual([
      { root, oldPath: aOld, newPath: aNew },
      { root, oldPath: bOld, newPath: bNew },
    ])
  })

  it('ignores non-unique (size, mtime) when multiple non-ID pages are unlinked with identical stats', async () => {
    const f1 = path.join(root, 'dup1.md')
    const f2 = path.join(root, 'dup2.md')
    const added = path.join(root, 'dup-new.md')
    const body = 'identical bytes\n'
    const fixedTime = new Date('2026-01-15T12:00:00.000Z')
    await writeFile(f1, body)
    await writeFile(f2, body)
    await utimes(f1, fixedTime, fixedTime)
    await utimes(f2, fixedTime, fixedTime)
    await getIndex(root)

    await writeFile(added, body)
    await utimes(added, fixedTime, fixedTime)
    emit(root, { type: 'unlink', path: f1 })
    emit(root, { type: 'unlink', path: f2 })
    emit(root, addEv(added))
    await getIndex(root)

    expect(detected).toEqual([])
  })

  it('ignores pairs separated by more than 5 seconds', async () => {
    await writeConfig(root, IDS_FILE, { enabled: true, letters: 'YAZ' })
    const oldPath = path.join(root, 'Slow-YAZ-2.md')
    const newPath = path.join(root, 'Slow-renamed-YAZ-2.md')
    await writeFile(oldPath, '---\nid: YAZ-2\n---\n\nHi\n')
    await getIndex(root)

    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(10_000)
    await rename(oldPath, newPath)
    emit(root, { type: 'unlink', path: oldPath })

    now.mockReturnValue(15_001)
    emit(root, addEv(newPath))
    await getIndex(root)

    expect(detected).toEqual([])
  })

  it('does not fire for in-app renames already recorded by indexMoved', async () => {
    await writeConfig(root, IDS_FILE, { enabled: true, letters: 'YAZ' })
    const oldPath = path.join(root, 'InApp-YAZ-3.md')
    const newPath = path.join(root, 'InApp-moved-YAZ-3.md')
    await writeFile(oldPath, '---\nid: YAZ-3\n---\n\nHi\n')
    await getIndex(root)

    await rename(oldPath, newPath)
    await indexMoved(oldPath, newPath, 'file')
    // Watcher echo arrives afterwards in either order.
    emit(root, { type: 'unlink', path: oldPath })
    emit(root, addEv(newPath))
    await getIndex(root)

    expect(detected).toEqual([])
  })
})
