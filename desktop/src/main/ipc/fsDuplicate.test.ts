/**
 * "Duplicate page" (YAZ-4592 S26): `fs:duplicate` copies one page beside itself, as a Paste of a Copy into
 * its own folder does (`copyEntry`), and never touches the app's clipboard or the system clipboard.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { clipboard, ipcMain } from 'electron'
import { CONTRACT, type Envelope } from '@shared/ipc'
import { makeFirstMac } from '../fs/testFixture'
import { createStore, type Store } from '../store'
import { fileClip } from '../fileClip'
import { _evictAll, getIndex } from '../vaultIndex'
import { _swept } from '../vaultIndex/idSweep'
import { registerFsIpc } from './fs'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  shell: { trashItem: vi.fn(async () => undefined) },
  nativeImage: { createFromBuffer: vi.fn() },
  screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ scaleFactor: 2 }) },
  clipboard: { read: vi.fn(() => ''), clear: vi.fn(), writeBuffer: vi.fn() },
}))
vi.mock('../fs/watchers', () => ({ subscribe: vi.fn(() => () => undefined), activeWatcherRoots: () => [] }))

type Handler = (event: unknown, ...args: unknown[]) => Promise<Envelope<unknown>>
const registered = (door: { channel: string }): Handler => {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === door.channel)
  if (call === undefined) throw new Error(`no handler registered for ${door.channel}`)
  return call[1] as unknown as Handler
}
const duplicate = (p: unknown) => registered(CONTRACT.file.duplicate)({ sender: {} }, { path: p })

let base: string
let store: Store
let vault: string
const windows = { idFor: () => 'w-this', vaultNotice: vi.fn() }
const entry = { file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files' as const, bounds: { x: 0, y: 0, width: 800, height: 600 } }

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'yd-fs-duplicate-'))
  store = createStore(path.join(base, 'yaseendocs.json'))
  registerFsIpc(store, windows)
  vault = path.join(base, 'vault')
  await mkdir(path.join(vault, 'Plans'), { recursive: true })
  await mkdir(path.join(vault, '.yaseendocs'), { recursive: true })
  await writeFile(path.join(vault, '.yaseendocs', 'ids.json'), '{"enabled":true}')
  await writeFile(path.join(vault, 'Plans', 'Trip.md'), '---\ntitle: Trip\nstatus: idea\n---\n# Trip\n')
  await makeFirstMac(vault)
  store.upsertWindow({ ...entry, id: 'w-this', root: vault })
  // The index's id sweep gives Trip.md its id first, so no sweep writes under the test.
  await getIndex(vault)
  await _swept(vault)
})
afterAll(async () => {
  _evictAll()
  await _swept(vault)
  await store.flush()
  await rm(base, { recursive: true, force: true })
})

describe('fs:duplicate (YAZ-4592 S26)', () => {
  it('copies the page beside itself as "<title> copy" with a fresh id and the same values; the clipboards stay as they were', async () => {
    const plans = path.join(vault, 'Plans')
    const from = path.join(plans, 'Trip.md')
    const before = await readFile(from, 'utf8')
    const res = (await duplicate(from)) as { ok: true; value: { from: string; to: string; kind: string } }
    expect(res.ok).toBe(true)
    expect(res.value.from).toBe(from)
    expect(res.value.kind).toBe('file')
    expect(path.dirname(res.value.to)).toBe(plans)
    expect(path.basename(res.value.to)).toMatch(/^trip-copy-.+\.md$/)
    const copy = await readFile(res.value.to, 'utf8')
    expect(copy).toContain('title: Trip copy')
    expect(copy).toContain('status: idea')
    expect(copy).toContain('# Trip')
    const idOf = (text: string) => /\nid: (\S+)/.exec(text)?.[1]
    expect(idOf(copy)).toBeDefined()
    expect(idOf(copy)).not.toBe(idOf(before))
    expect(await readFile(from, 'utf8')).toBe(before)
    // Only the two pages: a `.folder.md` the id sweep may write is no concern of this door.
    expect((await readdir(plans)).filter((name) => !name.startsWith('.')).sort()).toEqual(['Trip.md', path.basename(res.value.to)])
    expect(fileClip.get()).toBeNull()
    expect(clipboard.writeBuffer).not.toHaveBeenCalled()
  })

  it('refuses a path no vault of the calling window holds, and a relative one', async () => {
    const outside = path.join(base, 'Elsewhere.md')
    await writeFile(outside, '# elsewhere\n')
    expect(await duplicate(outside)).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } })
    expect(await duplicate('Plans/Trip.md')).toMatchObject({ ok: false, error: { code: 'NOT_ABSOLUTE' } })
  })
})
