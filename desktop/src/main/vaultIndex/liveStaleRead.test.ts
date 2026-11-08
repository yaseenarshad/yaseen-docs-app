// A watcher read that lands after a later event of the same path (YAZ-4502 polish): the read of an
// `add`/`change` started, the file went (or changed again), the later event ran, and only then did
// the old read land. It must land on nothing: a ghost record, or a ghost board ID, otherwise stays
// until the next event of that path. The watcher here is a fake the test drives, and the one read it
// arms is held AFTER it has read the file, so every order below is exact.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BOARD_META_KEY } from '@shared/drawingAssets'
import type { WatchEvent } from '@shared/types'
import { removeVault } from '../fs/testFixture'
import { _evictAll, boardIdKeeper, getIndex } from './index'

const hold = vi.hoisted(() => ({
  listeners: new Map<string, (ev: WatchEvent) => void>(),
  /** The file whose next read is held, once. */
  file: undefined as string | undefined,
  read: undefined as Promise<void> | undefined,
  readDone: (): void => undefined,
  release: (): void => undefined,
  gate: undefined as Promise<void> | undefined,
  /** Hears each read that is not held, as it returns. */
  onRead: undefined as ((file: string) => void) | undefined,
  arm(file: string): void {
    hold.file = file
    hold.read = new Promise((done) => (hold.readDone = done))
    hold.gate = new Promise((done) => (hold.release = done))
  },
  /** Called with what a read got: the armed read waits at the gate, once. */
  async after<T>(file: string, value: T): Promise<T> {
    if (file !== hold.file) {
      hold.onRead?.(file)
      return value
    }
    hold.file = undefined
    hold.readDone()
    await hold.gate
    return value
  },
}))

vi.mock('../fs/watchers', async (importOriginal) => {
  const real = await importOriginal<typeof import('../fs/watchers')>()
  return {
    ...real,
    subscribe: (root: string, listener: (ev: WatchEvent) => void) => {
      hold.listeners.set(root, listener)
      return () => hold.listeners.delete(root)
    },
  }
})
vi.mock('./scan', async (importOriginal) => {
  const real = await importOriginal<typeof import('./scan')>()
  return { ...real, scanFile: async (root: string, file: string) => hold.after(file, await real.scanFile(root, file)) }
})
vi.mock('../fs/boardHead', async (importOriginal) => {
  const real = await importOriginal<typeof import('../fs/boardHead')>()
  return { ...real, readBoardHead: async (file: string) => hold.after(file, await real.readBoardHead(file)) }
})

let root: string
const at = (name: string) => path.join(root, name)
const emit = (ev: WatchEvent) => hold.listeners.get(root)!(ev)
const recordOf = async (file: string) => (await getIndex(root)).records.find((r) => r.path === file)

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mdapp-stale-read-'))
})
afterEach(async () => {
  hold.release()
  hold.file = undefined
  hold.onRead = undefined
  _evictAll()
  await removeVault(root)
})

describe('a watcher read that lands after a later event of its path', () => {
  it('a note deleted while its read is in flight stays out of the index', async () => {
    await writeFile(at('a.md'), '# a\n')
    expect(await recordOf(at('a.md'))).toBeDefined()
    hold.arm(at('a.md'))
    emit({ type: 'change', path: at('a.md'), mtime: Date.now() })
    await hold.read
    await rm(at('a.md'))
    emit({ type: 'unlink', path: at('a.md') })
    hold.release()
    expect(await recordOf(at('a.md'))).toBeUndefined()
  })

  it('an older read of a note does not overwrite the newer one', async () => {
    await writeFile(at('a.md'), '---\ntitle: One\n---\n')
    await getIndex(root)
    hold.arm(at('a.md'))
    emit({ type: 'change', path: at('a.md'), mtime: Date.now() })
    await hold.read
    await writeFile(at('a.md'), '---\ntitle: Two\n---\n')
    // The newer read lands first; the held one a turn after it.
    hold.onRead = (file) => file === at('a.md') && setImmediate(hold.release)
    emit({ type: 'change', path: at('a.md'), mtime: Date.now() })
    expect((await recordOf(at('a.md')))?.properties.title).toBe('Two')
  })

  it('a board deleted while its head read is in flight keeps no ID in the index', async () => {
    const board = at('Plan.excalidraw')
    await writeFile(board, `${JSON.stringify({ [BOARD_META_KEY]: { createdAt: 1, updatedAt: 2, id: 'TST-7' }, type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} })}\n`)
    await getIndex(root)
    expect(await boardIdKeeper(root, 'TST-7')).toBe(board)
    hold.arm(board)
    emit({ type: 'change', path: board, mtime: Date.now() })
    await hold.read
    await rm(board)
    emit({ type: 'unlink', path: board })
    hold.release()
    await getIndex(root)
    expect(await boardIdKeeper(root, 'TST-7')).toBeUndefined()
  })
})
