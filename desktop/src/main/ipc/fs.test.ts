import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BrowserWindow, ipcMain } from 'electron'
import type { IndexResponse } from '@shared/types'
import { CONTRACT, type Envelope } from '@shared/ipc'
import { makeFixture, sleep, vaultFiles } from '../fs/testFixture'
import { createStore, type Store } from '../store'
import { _evictAll } from '../vaultIndex'
import { giveId } from '../vaultIndex/idSweep'
import { fileClip } from '../fileClip'
import * as favorites from '../favorites'
import { registerFsIpc } from './fs'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  // fs:delete goes to the SYSTEM Trash; these tests must not move real files into it, so the
  // trash call is stubbed and the assertions are about the store repair and the broadcast.
  // `remove.test.ts` owns the disk-level behaviour.
  shell: { trashItem: vi.fn(async () => undefined) },
}))
// The favorites.json repair (YAZ-1766 6A, D13) rides the rename/delete handlers; `favorites.test.ts`
// owns its disk behaviour, so here it is a mock whose failure must never fail the file op.
vi.mock('../favorites', () => ({ renamePath: vi.fn(async () => undefined), removePath: vi.fn(async () => undefined) }))

type Handler = (event: unknown, ...args: unknown[]) => Promise<Envelope<unknown>>

function registered(channel: string): Handler {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel)
  if (call === undefined) throw new Error(`no handler registered for ${channel}`)
  return call[1] as unknown as Handler
}

/** A `BrowserWindow` stand-in: only what the broadcaster touches. */
function fakeWindow() {
  return {
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false, send: vi.fn() },
  }
}

let root: string
let cleanup: () => Promise<void>
let storeDir: string
let store: Store
beforeAll(async () => {
  ;({ root, cleanup } = await makeFixture())
  storeDir = await mkdtemp(path.join(tmpdir(), 'yd-fs-ipc-'))
  store = createStore(path.join(storeDir, 'yaseendocs.json'))
})
afterAll(async () => {
  _evictAll()
  await store.flush()
  await cleanup()
  await rm(storeDir, { recursive: true, force: true })
})

/** Sender → window id lookup fake (E1b root guard); tests point `senderWinId` at a store entry. */
let senderWinId: string | undefined
const windows = { idFor: () => senderWinId }

describe('registerFsIpc', () => {
  it('registers every fs channel the preload invokes (and nothing else)', () => {
    registerFsIpc(store, windows)
    const channels = vi.mocked(ipcMain.handle).mock.calls.map(([ch]) => ch).sort()
    expect(channels).toEqual([CONTRACT.createDir.channel, CONTRACT.createFile.channel, CONTRACT.coldDiff.channel, CONTRACT.file.delete.channel, CONTRACT.file.clip.channel, CONTRACT.file.paste.channel, CONTRACT.file.clipState.channel, CONTRACT.index.channel, CONTRACT.readFile.channel, CONTRACT.readPdf.channel, CONTRACT.readImage.channel, CONTRACT.readAsset.channel, CONTRACT.writeAsset.channel, CONTRACT.file.rename.channel, CONTRACT.file.retitle.channel, CONTRACT.file.repairRename.channel, CONTRACT.tree.channel, CONTRACT.writeFile.channel, CONTRACT.shell.reveal.channel, CONTRACT.shell.openVsCode.channel, CONTRACT.shell.openDefault.channel, CONTRACT.shell.openLink.channel].sort())
  })

  it('answers with an envelope: a tree on success, a BridgeError on failure', async () => {
    const ok = await registered(CONTRACT.tree.channel)({ sender: {} }, root)
    expect(ok.ok).toBe(true)
    if (!ok.ok) throw new Error('expected ok')
    expect((ok.value as { root: string }).root).toBe(root)
    const missing = path.join(root, 'missing.md')
    expect(await registered(CONTRACT.readFile.channel)({ sender: {} }, missing)).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'path does not exist', path: missing },
    })
  })

  it('fs:read-asset answers a local image as base64 + mime, errors as a BridgeError envelope (GRO-2139)', async () => {
    const ok = await registered(CONTRACT.readAsset.channel)({ sender: {} }, root, 'img.png')
    expect(ok.ok).toBe(true)
    if (!ok.ok) throw new Error('expected ok')
    const value = ok.value as { path: string; mime: string; data: string; size: number }
    expect(value.path).toBe(path.join(root, 'assets-only', 'img.png'))
    expect(value.mime).toBe('image/png')
    expect(Buffer.from(value.data, 'base64').toString('utf8')).toBe('png')
    const missing = await registered(CONTRACT.readAsset.channel)({ sender: {} }, root, 'missing.png')
    expect(missing).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'no asset with this name under the root', path: 'missing.png' } })
  })

  it('fs:read-pdf answers with PDF bytes as Uint8Array and envelopes binary-boundary failures', async () => {
    const file = path.join(root, 'ipc-report.pdf')
    const bytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff])
    await writeFile(file, bytes)

    const ok = await registered(CONTRACT.readPdf.channel)({ sender: {} }, file)
    expect(ok.ok).toBe(true)
    if (!ok.ok) throw new Error('expected ok')
    expect((ok.value as { data: Uint8Array }).data).toBeInstanceOf(Uint8Array)
    expect(Buffer.isBuffer((ok.value as { data: Uint8Array }).data)).toBe(true)
    expect((ok.value as { data: Uint8Array }).data).toEqual(Buffer.from(bytes))
    expect(await registered(CONTRACT.readPdf.channel)({ sender: {} }, path.join(root, 'A.md'))).toEqual({
      ok: false,
      error: { code: 'UNSUPPORTED_EXTENSION', message: 'only PDF files can be read as PDF', path: path.join(root, 'A.md') },
    })
  })

  it('fs:read-image answers exact image bytes + MIME and envelopes unsupported paths', async () => {
    const file = path.join(root, 'ipc-image.WEBP')
    const bytes = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x00, 0xff])
    await writeFile(file, bytes)

    const ok = await registered(CONTRACT.readImage.channel)({ sender: {} }, file)
    expect(ok.ok).toBe(true)
    if (!ok.ok) throw new Error('expected ok')
    expect(ok.value).toMatchObject({ path: file, mime: 'image/webp', size: bytes.byteLength })
    expect((ok.value as { data: Uint8Array }).data).toEqual(Buffer.from(bytes))
    expect(await registered(CONTRACT.readImage.channel)({ sender: {} }, path.join(root, 'A.md'))).toEqual({
      ok: false,
      error: { code: 'UNSUPPORTED_EXTENSION', message: 'only supported raster images can be read as images', path: path.join(root, 'A.md') },
    })
  })

  it('fs:write-asset writes a drawing sidecar and envelopes its failures (YAZ-876)', async () => {
    const req = { root, path: 'assets/drawings/scene.excalidraw', content: '{"type":"excalidraw"}' }
    const ok = await registered(CONTRACT.writeAsset.channel)({ sender: {} }, req)
    expect(ok.ok).toBe(true)
    if (!ok.ok) throw new Error('expected ok')
    const file = path.join(root, 'assets', 'drawings', 'scene.excalidraw')
    expect((ok.value as { path: string }).path).toBe(file)
    expect(await readFile(file, 'utf8')).toBe(req.content)
    const bad = await registered(CONTRACT.writeAsset.channel)({ sender: {} }, { ...req, path: 'assets/drawings/scene.png' })
    expect(bad).toEqual({
      ok: false,
      error: { code: 'UNSUPPORTED_EXTENSION', message: 'a text body writes drawing files only', path: path.join(root, 'assets', 'drawings', 'scene.png') },
    })
  })

  it('fs:write-asset takes image BYTES on an image path and passes them through untouched (YAZ-1661)', async () => {
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff])
    const ok = await registered(CONTRACT.writeAsset.channel)({ sender: {} }, { root, path: 'assets/pasted.png', content: bytes })
    expect(ok.ok).toBe(true)
    if (!ok.ok) throw new Error('expected ok')
    const file = path.join(root, 'assets', 'pasted.png')
    expect(ok.value).toMatchObject({ path: file, size: bytes.byteLength })
    expect(await readFile(file)).toEqual(Buffer.from(bytes))
  })

  it('fs:index answers the vault index for the root: markdown records only (GRO-2129)', async () => {
    const res = await registered(CONTRACT.index.channel)({ sender: {} }, root)
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    const value = res.value as IndexResponse
    expect(value.root).toBe(root)
    expect(value.records.length).toBeGreaterThan(0)
    expect(value.records.every((r) => r.ext === 'md' || r.ext === 'markdown')).toBe(true)
  })

  it('fs:cold-diff answers null for an unbuilt root and the reconcile diff after fs:index built one (Links E1c, GRO-2242)', async () => {
    expect(await registered(CONTRACT.coldDiff.channel)({ sender: {} }, path.join(root, 'never-indexed'))).toEqual({ ok: true, value: null })
    expect(await registered(CONTRACT.coldDiff.channel)({ sender: {} }, 42)).toEqual({ ok: true, value: null }) // non-string root: null, never a throw
    const res = await registered(CONTRACT.coldDiff.channel)({ sender: {} }, root) // built by the fs:index test above
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    const value = res.value as { root: string; cacheStatus: string; added: unknown[]; removed: unknown[]; changed: unknown[] }
    expect(value.root).toBe(root)
    // No persistent cache in this env → an honest non-hit with EMPTY lists (never "everything added").
    expect(value.cacheStatus).toBe('miss')
    expect(value).toMatchObject({ added: [], removed: [], changed: [] })
  })

  it('file:repair-rename validates the already-moved claim, repairs the store and broadcasts file:renamed (Links E1c, GRO-2242)', async () => {
    const oldPath = path.join(root, 'ext.md')
    const newPath = path.join(root, 'ext2.md')
    await writeFile(oldPath, '# ext\n')
    await rename(oldPath, newPath) // the EXTERNAL mover already moved it — no fs work left
    store.upsertWindow({ id: 'w-ext', root, file: oldPath, tabs: [oldPath], sidebarCollapsed: false, sidebarLens: 'files', focusList: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
    const w = fakeWindow()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
    const res = await registered(CONTRACT.file.repairRename.channel)({ sender: {} }, { oldPath, newPath })
    expect(res).toEqual({ ok: true, value: { oldPath, newPath, kind: 'file' } })
    expect(await readFile(newPath, 'utf8')).toBe('# ext\n') // repair never touches the disk
    // The SAME store repair and push as fs:rename — the E1 downstream is reused whole.
    expect(store.get().windows.find((win) => win.id === 'w-ext')).toMatchObject({ file: newPath, tabs: [newPath] })
    expect(w.webContents.send).toHaveBeenCalledWith(CONTRACT.file.onRenamed.channel, { oldPath, newPath, kind: 'file' })
  })

  it('file:repair-rename with a live old path answers a BridgeError envelope, repairs nothing and broadcasts nothing', async () => {
    const oldPath = path.join(root, 'A.md') // still on disk — the hypothesis is wrong
    const newPath = path.join(root, 'ext2.md') // exists from the test above
    const w = fakeWindow()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
    const before = store.get()
    expect(await registered(CONTRACT.file.repairRename.channel)({ sender: {} }, { oldPath, newPath })).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'the old path still exists on disk', path: oldPath },
    })
    expect(store.get()).toBe(before)
    expect(w.webContents.send).not.toHaveBeenCalled()
  })

  it('fs:rename renames on disk, repairs the store and broadcasts file:renamed to every window (Links E1, GRO-2194)', async () => {
    const oldPath = path.join(root, 'b.md')
    const newPath = path.join(root, 'bee.md')
    store.upsertWindow({ id: 'w1', root, file: oldPath, tabs: [oldPath], sidebarCollapsed: false, sidebarLens: 'files', focusList: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
    store.setFolder(root, { lastFile: oldPath })
    const w = fakeWindow()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
    const res = await registered(CONTRACT.file.rename.channel)({ sender: {} }, { oldPath, newPath })
    expect(res).toEqual({ ok: true, value: { oldPath, newPath, kind: 'file' } })
    expect(await readFile(newPath, 'utf8')).toMatch(/# b\n$/) // the body; the index call above may have given it an id (YAZ-2293)
    // Store repaired in the SAME handler: window file/tabs and the folder's lastFile follow.
    expect(store.get().windows.find((win) => win.id === 'w1')).toMatchObject({ file: newPath, tabs: [newPath] })
    expect(store.get().folders[root].lastFile).toBe(newPath)
    // Every live window got the push (kind included — a `dir` push remaps by prefix, E1b).
    expect(w.webContents.send).toHaveBeenCalledWith(CONTRACT.file.onRenamed.channel, { oldPath, newPath, kind: 'file' })
  })

  it('fs:rename refuses the calling window\'s own vault root (E1b, GRO-2241) but allows another window\'s subfolder root', async () => {
    const sub = path.join(root, 'Zeta')
    store.upsertWindow({ id: 'w-sub', root: sub, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', focusList: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
    const w = fakeWindow()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
    // The caller's OWN root: refused, nothing moves, nothing broadcast.
    senderWinId = 'w-sub'
    expect(await registered(CONTRACT.file.rename.channel)({ sender: {} }, { oldPath: sub, newPath: path.join(root, 'Zeta2') })).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'the vault root itself cannot be renamed', path: sub },
    })
    expect(w.webContents.send).not.toHaveBeenCalled()
    // The same dir renamed from a window rooted ABOVE it: allowed, and the sub-rooted
    // window's `WindowEntry.root` is repaired by the same handler.
    senderWinId = 'w1'
    const newPath = path.join(root, 'Zeta2')
    const res = await registered(CONTRACT.file.rename.channel)({ sender: {} }, { oldPath: sub, newPath })
    expect(res).toEqual({ ok: true, value: { oldPath: sub, newPath, kind: 'dir' } })
    expect(store.get().windows.find((win) => win.id === 'w-sub')?.root).toBe(newPath)
    expect(w.webContents.send).toHaveBeenCalledWith(CONTRACT.file.onRenamed.channel, { oldPath: sub, newPath, kind: 'dir' })
  })

  it('fs:rename failure answers a BridgeError envelope, repairs nothing and broadcasts nothing', async () => {
    const oldPath = path.join(root, 'A.md')
    const newPath = path.join(root, 'bee.md') // created by the test above
    const w = fakeWindow()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
    const before = store.get()
    expect(await registered(CONTRACT.file.rename.channel)({ sender: {} }, { oldPath, newPath })).toEqual({
      ok: false,
      error: { code: 'ALREADY_EXISTS', message: 'a file with this name already exists', path: newPath },
    })
    expect(store.get()).toBe(before)
    expect(w.webContents.send).not.toHaveBeenCalled()
  })

  describe('fs:retitle (YAZ-2420 🔒 D16)', () => {
    const NOTE = '---\nid: k3m9x2pq7abc\n---\n'
    const windowOn = (id: string) => {
      store.upsertWindow({ id, root, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', focusList: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
      senderWinId = id
    }

    it('a title edit that changes the name runs the rename handler\'s downstream: the store and favorites are repaired and file:renamed reaches every window', async () => {
      const oldPath = path.join(root, 'Retitle.md')
      const newPath = path.join(root, 'big-plan-k3m9x2pq7abc.md')
      await writeFile(oldPath, NOTE)
      windowOn('w-retitle')
      store.setFolder(root, { lastFile: oldPath })
      const w = fakeWindow()
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
      vi.mocked(favorites.renamePath).mockClear()
      expect(await registered(CONTRACT.file.retitle.channel)({ sender: {} }, { path: oldPath, title: 'Big Plan' })).toEqual({ ok: true, value: { oldPath, newPath, kind: 'file' } })
      expect(await readFile(newPath, 'utf8')).toBe('---\nid: k3m9x2pq7abc\ntitle: Big Plan\n---\n')
      expect(store.get().folders[root].lastFile).toBe(newPath)
      expect(vi.mocked(favorites.renamePath)).toHaveBeenCalledWith(expect.arrayContaining([root]), oldPath, newPath)
      expect(w.webContents.send).toHaveBeenCalledWith(CONTRACT.file.onRenamed.channel, { oldPath, newPath, kind: 'file' })
      store.removeWindow('w-retitle')
    })

    it('a title edit that keeps the name writes the title and moves nothing: no repair, no broadcast', async () => {
      const file = path.join(root, 'same-name-k3m9x2pq7abc.md')
      await writeFile(file, NOTE)
      windowOn('w-retitle')
      const w = fakeWindow()
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
      vi.mocked(favorites.renamePath).mockClear()
      const before = store.get()
      expect(await registered(CONTRACT.file.retitle.channel)({ sender: {} }, { path: file, title: 'Same, Name' })).toEqual({ ok: true, value: { oldPath: file, newPath: file, kind: 'file' } })
      expect(await readFile(file, 'utf8')).toBe('---\nid: k3m9x2pq7abc\ntitle: Same, Name\n---\n')
      expect(store.get()).toBe(before)
      expect(vi.mocked(favorites.renamePath)).not.toHaveBeenCalled()
      expect(w.webContents.send).not.toHaveBeenCalled()
      store.removeWindow('w-retitle')
    })

    it("refuses the calling window's own vault root, and a refused edit answers a BridgeError envelope and broadcasts nothing", async () => {
      windowOn('w-retitle')
      const w = fakeWindow()
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
      expect(await registered(CONTRACT.file.retitle.channel)({ sender: {} }, { path: root, title: 'Vault' })).toEqual({
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'the vault root itself cannot be renamed', path: root },
      })
      expect(w.webContents.send).not.toHaveBeenCalled()
      store.removeWindow('w-retitle')
    })
  })

  describe('creating a note or a folder is no answer about IDs (YAZ-2523 V10, V11)', () => {
    it("a note and a folder created in a window's folder do not create `.yaseendocs/`, and nothing already there is written to", async () => {
      const plain = await mkdtemp(path.join(tmpdir(), 'yd-fs-ipc-plain-'))
      try {
        await mkdir(path.join(plain, 'Made in Finder'))
        await writeFile(path.join(plain, 'from an agent.md'), 'body\n')
        await registered(CONTRACT.index.channel)({ sender: {} }, plain) // the window has opened
        store.upsertWindow({ id: 'w-plain', root: plain, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', focusList: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
        senderWinId = 'w-plain'
        expect(await registered(CONTRACT.createFile.channel)({ sender: {} }, path.join(plain, 'First.md'))).toMatchObject({ ok: true })
        expect(await registered(CONTRACT.createDir.channel)({ sender: {} }, { path: path.join(plain, 'First') })).toEqual({ ok: true, value: { path: path.join(plain, 'First') } })
        await sleep(300) // long enough for a write that must not be made
        expect((await readdir(plain)).sort()).toEqual(['First', 'First.md', 'Made in Finder', 'from an agent.md'])
        expect(await readFile(path.join(plain, 'from an agent.md'), 'utf8')).toBe('body\n')
        expect(await readdir(path.join(plain, 'Made in Finder'))).toEqual([])
      } finally {
        senderWinId = undefined
        store.removeWindow('w-plain')
        await rm(plain, { recursive: true, force: true })
      }
    })
  })

  describe("a create, a title edit and a paste follow the calling window's vault (YAZ-2523 V3, V5)", () => {
    const NOTE = '---\nstatus: idea\n---\nbody\n'
    const ID = 'k3m9x2pq7abc'
    /** A window on a fresh vault that holds `Plans/Name.md`; `answer` is what its `ids.json` says, and it has none when undefined. */
    const open = async (answer?: boolean): Promise<string> => {
      const vault = await mkdtemp(path.join(tmpdir(), 'yd-fs-ipc-kind-'))
      await mkdir(path.join(vault, 'Plans'))
      await writeFile(path.join(vault, 'Plans', 'Name.md'), NOTE)
      if (answer !== undefined) {
        await mkdir(path.join(vault, '.yaseendocs'))
        await writeFile(path.join(vault, '.yaseendocs', 'ids.json'), JSON.stringify({ enabled: answer }))
      }
      store.upsertWindow({ id: 'w-kind', root: vault, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', focusList: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
      senderWinId = 'w-kind'
      return vault
    }
    const close = async (...dirs: string[]): Promise<void> => {
      senderWinId = undefined
      store.removeWindow('w-kind')
      fileClip.clear()
      for (const dir of dirs) await rm(dir, { recursive: true, force: true })
    }
    const call = (door: { channel: string }, ...args: unknown[]) => registered(door.channel)({ sender: {} }, ...args)
    const paste = (from: string, targetDir: string) => {
      fileClip.set({ op: 'copy', paths: [from] })
      return call(CONTRACT.file.paste, { targetDir })
    }

    it.each([
      ['said no', false],
      ['has not answered', undefined],
    ])('in a vault that %s a note, a folder and a copy are what Finder would make, a title edit is refused, and nothing else is written', async (_, answer) => {
      const vault = await open(answer)
      try {
        const at = (...p: string[]) => path.join(vault, ...p)
        expect(await call(CONTRACT.createFile, { path: at('Meeting notes.md'), content: NOTE })).toEqual({ ok: true, value: { path: at('Meeting notes.md'), mtime: expect.any(Number), size: NOTE.length } })
        // A request shaped for a vault that uses IDs is refused, and makes nothing.
        expect(await call(CONTRACT.createFile, { path: at(`meeting-notes-${ID}.md`), content: NOTE, id: ID })).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } })
        expect(await call(CONTRACT.createDir, { path: at('q3-plans'), title: 'Q3 Plans' })).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } })
        expect(await call(CONTRACT.createFile, at('Empty.md'))).toMatchObject({ ok: true })
        expect(await call(CONTRACT.createDir, { path: at('Q3 Plans') })).toEqual({ ok: true, value: { path: at('Q3 Plans') } })
        expect(await paste(at('Plans', 'Name.md'), at('Plans'))).toEqual({ ok: true, value: { pasted: [{ from: at('Plans', 'Name.md'), to: at('Plans', 'Name copy.md'), kind: 'file' }], failed: [] } })
        // Into the vault's own folder: the root is in the vault too.
        expect(await paste(at('Plans'), vault)).toEqual({ ok: true, value: { pasted: [{ from: at('Plans'), to: at('Plans copy'), kind: 'dir' }], failed: [] } })
        for (const target of [at('Plans', 'Name.md'), at('Plans')]) {
          expect(await call(CONTRACT.file.retitle, { path: target, title: 'Big Plan' })).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'this vault does not use IDs' } })
        }
        expect(await vaultFiles(vault)).toEqual({
          ...(answer === false && { '.yaseendocs/': '', '.yaseendocs/ids.json': '{"enabled":false}' }),
          'Meeting notes.md': NOTE,
          'Empty.md': '',
          'Q3 Plans/': '',
          'Plans/': '',
          'Plans/Name.md': NOTE,
          'Plans/Name copy.md': NOTE,
          'Plans copy/': '',
          'Plans copy/Name.md': NOTE,
          'Plans copy/Name copy.md': NOTE,
        })
      } finally {
        await close(vault)
      }
    })

    it('in a vault that said yes a note and a folder are born with their ids, a copy is born again, and a title edit goes through', async () => {
      const vault = await open(true)
      try {
        const at = (...p: string[]) => path.join(vault, ...p)
        expect(await call(CONTRACT.createFile, { path: at(`meeting-notes-${ID}.md`), content: NOTE, id: ID })).toMatchObject({ ok: true, value: { id: ID } })
        expect(await readFile(at(`meeting-notes-${ID}.md`), 'utf8')).toBe(`---\nstatus: idea\nid: ${ID}\n---\nbody\n`)
        expect(await call(CONTRACT.createDir, { path: at('q3-plans'), title: 'Q3 Plans' })).toMatchObject({ ok: true })
        expect(await readFile(at('q3-plans', '.folder.md'), 'utf8')).toMatch(/^---\nid: [0-9a-z]{12}\ntitle: Q3 Plans\n---\n$/)
        expect(await paste(at('Plans', 'Name.md'), at('Plans'))).toMatchObject({ ok: true, value: { pasted: [{ to: expect.stringMatching(/\/Plans\/name-copy-[0-9a-z]{12}\.md$/) }] } })
        expect(await paste(at('Plans'), vault)).toMatchObject({ ok: true, value: { pasted: [{ to: at('plans-copy') }] } })
        expect(await call(CONTRACT.file.retitle, { path: at('Plans', 'Name.md'), title: 'Big Plan' })).toMatchObject({ ok: true, value: { newPath: expect.stringMatching(/\/Plans\/big-plan-[0-9a-z]{12}\.md$/) } })
      } finally {
        await close(vault)
      }
    })

    it.each([
      ['first', (yes: string, no: string) => [yes, no]],
      ['second', (yes: string, no: string) => [no, yes]],
    ])('a window that shows two vaults asks the one that HOLDS the path — the vault that said yes is its %s (YAZ-2602 S78)', async (_, order) => {
      const yes = await open(true)
      const no = await open(false)
      const roots = order(yes, no)
      store.upsertWindow({ id: 'w-kind', root: roots[0], roots, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', focusList: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
      // The id a vault gives the note at `Plans/Name.md` with these bytes: the same in every vault and on every device.
      const twin = await mkdtemp(path.join(tmpdir(), 'yd-fs-ipc-twin-'))
      await mkdir(path.join(twin, 'Plans'))
      await writeFile(path.join(twin, 'Plans', 'Name.md'), NOTE)
      const given = await giveId(twin, path.join(twin, 'Plans', 'Name.md'), undefined)
      try {
        const inYes = (...p: string[]) => path.join(yes, ...p)
        const inNo = (...p: string[]) => path.join(no, ...p)
        // In the vault that said yes: born with their ids, and a title edit goes through by that vault's rules.
        expect(await call(CONTRACT.createFile, { path: inYes(`meeting-notes-${ID}.md`), content: NOTE, id: ID })).toMatchObject({ ok: true, value: { id: ID } })
        expect(await call(CONTRACT.createDir, { path: inYes('q3-plans'), title: 'Q3 Plans' })).toMatchObject({ ok: true })
        expect(await paste(inNo('Plans', 'Name.md'), inYes('Plans'))).toMatchObject({ ok: true, value: { pasted: [{ to: expect.stringMatching(/\/Plans\/name-copy-[0-9a-z]{12}\.md$/) }] } })
        // The title edit gives the note the id its OWN vault gives it, and refuses that vault's folder, wherever the vault sits in the window's list (S47).
        expect(await call(CONTRACT.file.retitle, { path: inYes('Plans', 'Name.md'), title: 'Big Plan' })).toMatchObject({ ok: true, value: { newPath: inYes('Plans', `big-plan-${given}.md`) } })
        expect(await call(CONTRACT.file.retitle, { path: yes, title: 'Vault' })).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'the vault root itself cannot be renamed', path: yes } })
        // In the vault that said no, from the SAME window: what Finder would make, and no title edit.
        expect(await call(CONTRACT.createFile, { path: inNo(`meeting-notes-${ID}.md`), content: NOTE, id: ID })).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } })
        expect(await call(CONTRACT.createDir, { path: inNo('q3-plans'), title: 'Q3 Plans' })).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } })
        expect(await call(CONTRACT.createFile, { path: inNo('Meeting notes.md'), content: NOTE })).toMatchObject({ ok: true })
        expect(await paste(inNo('Plans', 'Name.md'), inNo('Plans'))).toEqual({ ok: true, value: { pasted: [{ from: inNo('Plans', 'Name.md'), to: inNo('Plans', 'Name copy.md'), kind: 'file' }], failed: [] } })
        expect(await call(CONTRACT.file.retitle, { path: inNo('Plans', 'Name.md'), title: 'Big Plan' })).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'this vault does not use IDs' } })
        expect(await vaultFiles(no)).toEqual({ '.yaseendocs/': '', '.yaseendocs/ids.json': '{"enabled":false}', 'Meeting notes.md': NOTE, 'Plans/': '', 'Plans/Name.md': NOTE, 'Plans/Name copy.md': NOTE })
      } finally {
        await close(yes, no, twin)
      }
    })

    it('a path outside the calling window\u2019s vault, and a window with no vault, get no id: whatever a vault that said yes would give', async () => {
      const vault = await open(true)
      const other = await mkdtemp(path.join(tmpdir(), 'yd-fs-ipc-other-'))
      try {
        await call(CONTRACT.createFile, path.join(other, 'Out.md'))
        await call(CONTRACT.createDir, { path: path.join(other, 'Out') })
        await paste(path.join(vault, 'Plans', 'Name.md'), other)
        senderWinId = undefined
        await call(CONTRACT.createFile, path.join(other, 'No window.md'))
        expect(await vaultFiles(other)).toEqual({ 'Out.md': '', 'Out/': '', 'Name.md': NOTE, 'No window.md': '' })
      } finally {
        await close(vault, other)
      }
    })
  })

  describe('fs:delete (GRO-2272)', () => {
    it('trashes the file, repairs the store and pushes file:deleted to every window', async () => {
      const target = path.join(root, 'delete-me.md')
      await writeFile(target, '# gone\n')
      store.upsertWindow({ id: 'wd', root, file: target, tabs: [target, path.join(root, 'A.md')], sidebarCollapsed: false, sidebarLens: 'files', focusList: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
      const w = fakeWindow()
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
      senderWinId = undefined
      const res = await registered(CONTRACT.file.delete.channel)({ sender: {} }, { path: target })
      expect(res).toEqual({ ok: true, value: { path: target, kind: 'file' } })
      // Store repaired in the SAME handler: the active file went, so the heir took over and
      // the SURVIVING tab is still there (the invariant removePath protects).
      expect(store.get().windows.find((win) => win.id === 'wd')).toMatchObject({ file: path.join(root, 'A.md'), tabs: [path.join(root, 'A.md')] })
      expect(w.webContents.send).toHaveBeenCalledWith(CONTRACT.file.onDeleted.channel, { path: target, kind: 'file' })
    })

    it("refuses the calling window's own vault root: nothing trashed, nothing broadcast", async () => {
      const w = fakeWindow()
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
      store.upsertWindow({ id: 'w-own', root, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', focusList: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
      senderWinId = 'w-own'
      expect(await registered(CONTRACT.file.delete.channel)({ sender: {} }, { path: root })).toEqual({
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'the vault root itself cannot be deleted', path: root },
      })
      expect(w.webContents.send).not.toHaveBeenCalled()
      await expect(readFile(path.join(root, 'A.md'), 'utf8')).resolves.toMatch(/# A\n$/) // vault intact
      senderWinId = undefined
    })

    it("allows deleting a folder that is ANOTHER window's root — onRootMissing owns that repair, so the stored root is untouched", async () => {
      const sub = path.join(root, 'DeleteMeDir')
      await mkdir(sub, { recursive: true })
      await writeFile(path.join(sub, 'inner.md'), 'inner')
      store.upsertWindow({ id: 'w-other', root: sub, file: path.join(sub, 'inner.md'), tabs: [path.join(sub, 'inner.md')], sidebarCollapsed: false, sidebarLens: 'files', focusList: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
      const w = fakeWindow()
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
      senderWinId = undefined
      expect(await registered(CONTRACT.file.delete.channel)({ sender: {} }, { path: sub })).toEqual({ ok: true, value: { path: sub, kind: 'dir' } })
      const other = store.get().windows.find((win) => win.id === 'w-other')
      expect(other?.root).toBe(sub) // deliberately NOT nulled here
      expect(other?.file).toBeNull() // the file under it went
      expect(w.webContents.send).toHaveBeenCalledWith(CONTRACT.file.onDeleted.channel, { path: sub, kind: 'dir' })
    })

    it('a refused delete (dot-folder) answers a BridgeError envelope and broadcasts nothing', async () => {
      const w = fakeWindow()
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
      const dot = path.join(root, '.obsidian')
      const res = await registered(CONTRACT.file.delete.channel)({ sender: {} }, { path: dot })
      expect(res).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'hidden entries cannot be deleted', path: dot } })
      expect(w.webContents.send).not.toHaveBeenCalled()
    })
  })

  describe('a window that shows several vaults (YAZ-2602 D1)', () => {
    it('fs:rename and fs:delete refuse EACH vault of the calling window; from a window that shows the folder as a subfolder they go through, and the store moves that entry of `roots` and leaves it on a delete (S47, S48, S49)', async () => {
      const base = await mkdtemp(path.join(tmpdir(), 'yd-fs-ipc-vaults-'))
      const first = path.join(base, 'First')
      const parent = path.join(base, 'Parent')
      const second = path.join(parent, 'Second')
      const moved = path.join(parent, 'Moved')
      await mkdir(first)
      await mkdir(second, { recursive: true })
      const entry = { file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files' as const, focusList: [], bounds: { x: 0, y: 0, width: 800, height: 600 } }
      store.upsertWindow({ ...entry, id: 'w-two', root: first, roots: [first, second] })
      store.upsertWindow({ ...entry, id: 'w-parent', root: parent })
      const rootsOfTwo = () => store.get().windows.find((win) => win.id === 'w-two')?.roots
      const w = fakeWindow()
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
      try {
        senderWinId = 'w-two'
        for (const vault of [first, second]) {
          expect(await registered(CONTRACT.file.rename.channel)({ sender: {} }, { oldPath: vault, newPath: `${vault}2` })).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'the vault root itself cannot be renamed', path: vault } })
          expect(await registered(CONTRACT.file.delete.channel)({ sender: {} }, { path: vault })).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'the vault root itself cannot be deleted', path: vault } })
        }
        expect(w.webContents.send).not.toHaveBeenCalled()
        expect([await readdir(base), await readdir(parent)]).toEqual([['First', 'Parent'], ['Second']]) // nothing moved
        expect(rootsOfTwo()).toEqual([first, second])
        // The window that shows `Parent` holds the folder as a subfolder: it may rename it, and the other window's list follows.
        senderWinId = 'w-parent'
        expect(await registered(CONTRACT.file.rename.channel)({ sender: {} }, { oldPath: second, newPath: moved })).toEqual({ ok: true, value: { oldPath: second, newPath: moved, kind: 'dir' } })
        expect(rootsOfTwo()).toEqual([first, moved])
        // It may delete it too. The store leaves the list alone: the window that shows it sees the folder gone.
        expect(await registered(CONTRACT.file.delete.channel)({ sender: {} }, { path: moved })).toEqual({ ok: true, value: { path: moved, kind: 'dir' } })
        expect(rootsOfTwo()).toEqual([first, moved])
      } finally {
        senderWinId = undefined
        store.removeWindow('w-two')
        store.removeWindow('w-parent')
        await rm(base, { recursive: true, force: true })
      }
    })
  })

  describe('favorites.json repair (YAZ-1766 6A, D13)', () => {
    it('fs:rename and file:repair-rename hand the open roots + paths to favorites.renamePath; a repair failure is warned and the op still answers and broadcasts', async () => {
      const oldPath = path.join(root, 'fav-a.md')
      const newPath = path.join(root, 'fav-b.md')
      await writeFile(oldPath, '# fav\n')
      store.upsertWindow({ id: 'w-fav', root, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', focusList: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
      const w = fakeWindow()
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      vi.mocked(favorites.renamePath).mockRejectedValueOnce(new Error('favorites.json is read-only'))
      senderWinId = undefined
      expect(await registered(CONTRACT.file.rename.channel)({ sender: {} }, { oldPath, newPath })).toEqual({ ok: true, value: { oldPath, newPath, kind: 'file' } })
      expect(vi.mocked(favorites.renamePath)).toHaveBeenCalledWith(expect.arrayContaining([root]), oldPath, newPath)
      expect(w.webContents.send).toHaveBeenCalledWith(CONTRACT.file.onRenamed.channel, { oldPath, newPath, kind: 'file' })
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('favorites.json is read-only'))
      // The already-moved repair path takes the same road.
      await rename(newPath, oldPath)
      vi.mocked(favorites.renamePath).mockClear()
      expect(await registered(CONTRACT.file.repairRename.channel)({ sender: {} }, { oldPath: newPath, newPath: oldPath })).toEqual({ ok: true, value: { oldPath: newPath, newPath: oldPath, kind: 'file' } })
      expect(vi.mocked(favorites.renamePath)).toHaveBeenCalledWith(expect.arrayContaining([root]), newPath, oldPath)
      store.removeWindow('w-fav')
    })

    it('fs:delete hands the open roots + path to favorites.removePath; a repair failure is warned and the delete still answers and broadcasts', async () => {
      const target = path.join(root, 'fav-gone.md')
      await writeFile(target, '# gone\n')
      store.upsertWindow({ id: 'w-fav', root, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', focusList: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
      const w = fakeWindow()
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      vi.mocked(favorites.removePath).mockRejectedValueOnce(new Error('boom'))
      senderWinId = undefined
      expect(await registered(CONTRACT.file.delete.channel)({ sender: {} }, { path: target })).toEqual({ ok: true, value: { path: target, kind: 'file' } })
      expect(vi.mocked(favorites.removePath)).toHaveBeenCalledWith(expect.arrayContaining([root]), target)
      expect(w.webContents.send).toHaveBeenCalledWith(CONTRACT.file.onDeleted.channel, { path: target, kind: 'file' })
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('boom'))
      store.removeWindow('w-fav')
    })
  })

  describe('fs:clip / fs:paste (YAZ-1674)', () => {
    const win = (id: string, file: string | null) =>
      store.upsertWindow({ id, root, file, tabs: file === null ? [] : [file], sidebarCollapsed: false, sidebarLens: 'files', focusList: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })

    it('fs:clip stores the ordered selection and pushes clip:changed (count, op and the paths) to EVERY window (D1)', async () => {
      fileClip.clear()
      const a = fakeWindow()
      const b = fakeWindow()
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([a as never, b as never])
      const paths = [path.join(root, 'b.md'), path.join(root, 'Zeta')]
      expect(await registered(CONTRACT.file.clip.channel)({ sender: {} }, { op: 'copy', paths })).toEqual({ ok: true, value: undefined })
      expect(fileClip.get()).toEqual({ op: 'copy', paths })
      for (const w of [a, b]) expect(w.webContents.send).toHaveBeenCalledExactlyOnceWith(CONTRACT.file.onClipChanged.channel, { count: 2, op: 'copy', paths })
    })

    it('fs:clip with bad input answers a BridgeError envelope, keeps the clipboard and pushes nothing', async () => {
      const w = fakeWindow()
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
      const before = fileClip.get()
      expect(await registered(CONTRACT.file.clip.channel)({ sender: {} }, { op: 'cut', paths: ['relative.md'] })).toEqual({
        ok: false,
        error: { code: 'NOT_ABSOLUTE', message: "'paths' must be an absolute path", path: 'relative.md' },
      })
      expect(await registered(CONTRACT.file.clip.channel)({ sender: {} }, { op: 'cut', paths: [] })).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } })
      expect(fileClip.get()).toBe(before)
      expect(w.webContents.send).not.toHaveBeenCalled()
    })

    it('fs:clip-state answers null when empty and { count, op, paths } after a set — the catch-up read for a window that mounts after a clip', async () => {
      fileClip.clear()
      expect(await registered(CONTRACT.file.clipState.channel)({ sender: {} })).toEqual({ ok: true, value: null })
      fileClip.set({ op: 'cut', paths: [path.join(root, 'A.md'), path.join(root, 'b.md')] })
      expect(await registered(CONTRACT.file.clipState.channel)({ sender: {} })).toEqual({ ok: true, value: { count: 2, op: 'cut', paths: [path.join(root, 'A.md'), path.join(root, 'b.md')] } })
      fileClip.clear()
    })

    it('fs:paste with an empty clipboard is BAD_REQUEST "nothing to paste"', async () => {
      fileClip.clear()
      expect(await registered(CONTRACT.file.paste.channel)({ sender: {} }, { targetDir: root })).toEqual({
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'nothing to paste' },
      })
    })

    it('paste of a COPY copies under its own built name (YAZ-2420 D21), repairs NOTHING, pushes NO file event, and KEEPS the clipboard (D2/D4)', async () => {
      const src = path.join(root, 'copy-src.md')
      await writeFile(src, 'copy me')
      win('w-copy', src)
      senderWinId = 'w-copy'
      fileClip.set({ op: 'copy', paths: [src] })
      const w = fakeWindow()
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
      const before = store.get()
      // Into its own folder: Duplicate for free.
      const res = await registered(CONTRACT.file.paste.channel)({ sender: {} }, { targetDir: root })
      const copy = expect.stringMatching(/\/copy-src-copy-[0-9a-z]{12}\.md$/)
      expect(res).toEqual({ ok: true, value: { pasted: [{ from: src, to: copy, kind: 'file' }], failed: [] } })
      expect(await readFile(src, 'utf8')).toBe('copy me')
      expect(store.get()).toBe(before) // nothing moved: no repair
      expect(w.webContents.send).not.toHaveBeenCalled() // no file:renamed, no clip:changed
      expect(fileClip.get()).toEqual({ op: 'copy', paths: [src] }) // a copy pastes again and again
      const again = await registered(CONTRACT.file.paste.channel)({ sender: {} }, { targetDir: root })
      expect(again).toMatchObject({ ok: true, value: { pasted: [{ to: copy }] } })
      expect((await readdir(root)).filter((name) => name.startsWith('copy-src-copy-'))).toHaveLength(2)
    })

    it('paste of a CUT moves through the rename pipeline — store repaired, file:renamed per entry — then CLEARS the clipboard (D2)', async () => {
      const dir = path.join(root, 'cut-target')
      await mkdir(dir)
      const a = path.join(root, 'cut-a.md')
      const b = path.join(root, 'cut-b.md')
      await writeFile(a, 'a')
      await writeFile(b, 'b')
      win('w-cut', a)
      store.setFolder(root, { lastFile: b })
      fileClip.set({ op: 'cut', paths: [a, b] })
      const w = fakeWindow()
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
      const res = await registered(CONTRACT.file.paste.channel)({ sender: {} }, { targetDir: dir })
      const toA = path.join(dir, 'cut-a.md')
      const toB = path.join(dir, 'cut-b.md')
      expect(res).toEqual({ ok: true, value: { pasted: [{ from: a, to: toA, kind: 'file' }, { from: b, to: toB, kind: 'file' }], failed: [] } })
      expect(await readFile(toA, 'utf8')).toBe('a')
      // The SAME downstream as fs:rename, once per entry: window file/tabs and lastFile follow…
      expect(store.get().windows.find((x) => x.id === 'w-cut')).toMatchObject({ file: toA, tabs: [toA] })
      expect(store.get().folders[root].lastFile).toBe(toB)
      // …and every window got file:renamed per entry, then clip:changed null (the cut pasted once).
      expect(w.webContents.send).toHaveBeenNthCalledWith(1, CONTRACT.file.onRenamed.channel, { oldPath: a, newPath: toA, kind: 'file' })
      expect(w.webContents.send).toHaveBeenNthCalledWith(2, CONTRACT.file.onRenamed.channel, { oldPath: b, newPath: toB, kind: 'file' })
      expect(w.webContents.send).toHaveBeenNthCalledWith(3, CONTRACT.file.onClipChanged.channel, null)
      expect(fileClip.get()).toBeNull()
    })

    it('a CUT whose every entry failed keeps the clipboard (the user fixes the cause and pastes again); the failures ride in the envelope', async () => {
      const dir = path.join(root, 'cut-clash')
      await mkdir(dir)
      await writeFile(path.join(dir, 'same.md'), 'keep')
      const src = path.join(root, 'same.md')
      await writeFile(src, 'incoming')
      fileClip.set({ op: 'cut', paths: [src] })
      const w = fakeWindow()
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
      const res = await registered(CONTRACT.file.paste.channel)({ sender: {} }, { targetDir: dir })
      expect(res).toEqual({ ok: true, value: { pasted: [], failed: [{ from: src, code: 'ALREADY_EXISTS', message: 'a file with this name already exists' }] } })
      expect(await readFile(path.join(dir, 'same.md'), 'utf8')).toBe('keep')
      expect(fileClip.get()).toEqual({ op: 'cut', paths: [src] })
      expect(w.webContents.send).not.toHaveBeenCalled()
    })

    it('a missing target folder is a whole-call BridgeError envelope: nothing pasted, clipboard kept', async () => {
      fileClip.set({ op: 'copy', paths: [path.join(root, 'A.md')] })
      const missing = path.join(root, 'no-such-dir')
      expect(await registered(CONTRACT.file.paste.channel)({ sender: {} }, { targetDir: missing })).toEqual({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'path does not exist', path: missing },
      })
      expect(fileClip.get()).not.toBeNull()
      fileClip.clear()
    })
  })
})
