import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copyFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ipcMain } from 'electron'
import { CONTRACT } from '@shared/ipc'
import type { DrawingLoadResponse, DrawingSaveResponse } from '@shared/types'
import { referencedFileIds, unpersistedFiles } from '@shared/drawingAssets'
import { registerBoardIpc } from './board'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, BrowserWindow: { getAllWindows: () => [] }, nativeImage: {} }))

/**
 * YAZ-3943 end to end, through the main bridge (the real board doors behind their IPC channels, a
 * real temp vault, no Electron window): the case that lost Yasin 36 pictures. A board is saved the
 * way a tab saves it, then ONLY its file is copied to an empty folder, and it opens there with
 * every picture.
 */

type Handler = (event: unknown, ...args: unknown[]) => Promise<{ ok: boolean; value?: unknown; error?: unknown }>
const registered = (channel: string): Handler => vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel)![1] as unknown as Handler
async function call<T>(channel: string, req: unknown): Promise<T> {
  const answer = await registered(channel)({ sender: {} }, req)
  if (!answer.ok) throw new Error(JSON.stringify(answer.error))
  return answer.value as T
}

const png = (text: string) => `data:image/png;base64,${Buffer.from(text).toString('base64')}`
const imageEl = (fileId: string) => ({ id: `el-${fileId}`, type: 'image', fileId })
const sent = (elements: unknown[]) => `${JSON.stringify({ type: 'excalidraw', version: 2, source: 'yaseen-docs', elements, appState: {}, files: {} }, null, 2)}\n`

let vault: string
let elsewhere: string
beforeEach(async () => {
  vault = await mkdtemp(path.join(tmpdir(), 'pictures-vault-'))
  elsewhere = await mkdtemp(path.join(tmpdir(), 'pictures-copy-'))
  const store = { get: () => ({ windows: [{ id: 'w1', roots: [vault] }] }), addEdit: vi.fn() } as unknown as Parameters<typeof registerBoardIpc>[0]
  registerBoardIpc(store, { idFor: () => 'w1' })
})
afterEach(async () => {
  await rm(vault, { recursive: true, force: true })
  await rm(elsewhere, { recursive: true, force: true })
})

describe('YAZ-3943 D5 end to end: a copied board keeps its pictures', () => {
  it('save an "inside" board, copy only the file to an empty folder, load it there: every picture is present', async () => {
    const created = await call<{ path: string }>(CONTRACT.createBoard.channel, { root: vault, path: path.join(vault, 'Trip.excalidraw') })
    const rel = path.relative(vault, created.path)
    const opened = await call<DrawingLoadResponse>(CONTRACT.drawing.load.channel, { root: vault, path: rel })

    // The tab pastes two pictures and saves: the small scene, and the pictures main has not had yet.
    const files = { aaa: { mimeType: 'image/png', dataURL: png('first picture') }, bbb: { mimeType: 'image/jpeg', dataURL: `data:image/jpeg;base64,${Buffer.from('second').toString('base64')}` } }
    const elements = [imageEl('aaa'), imageEl('bbb')]
    const newFiles = unpersistedFiles(files, referencedFileIds(elements), new Set(opened.stored))
    const first = await call<DrawingSaveResponse>(CONTRACT.drawing.save.channel, { root: vault, path: rel, json: sent(elements), expectedMtime: opened.mtime, newFiles })
    expect(first.persisted).toEqual(['aaa', 'bbb'])
    // A second save of an edit sends no picture again, and keeps them both.
    const again = await call<DrawingSaveResponse>(CONTRACT.drawing.save.channel, { root: vault, path: rel, json: sent([...elements, { id: 'r', type: 'rectangle' }]), expectedMtime: first.mtime, newFiles: unpersistedFiles(files, referencedFileIds(elements), new Set(first.persisted)) })
    expect(await stat(path.join(vault, 'assets')).catch(() => null)).toBeNull()

    await mkdir(elsewhere, { recursive: true })
    await copyFile(created.path, path.join(elsewhere, 'Trip.excalidraw'))
    const there = await call<DrawingLoadResponse>(CONTRACT.drawing.load.channel, { root: elsewhere, path: 'Trip.excalidraw' })
    expect(there.files).toEqual(files)
    expect(there.size).toBe(again.size)
  })

  it('"Move pictures out" through the bridge: the copied file then holds labels only, as before D5', async () => {
    const created = await call<{ path: string }>(CONTRACT.createBoard.channel, { root: vault, path: path.join(vault, 'Out.excalidraw') })
    const rel = path.relative(vault, created.path)
    const opened = await call<DrawingLoadResponse>(CONTRACT.drawing.load.channel, { root: vault, path: rel })
    const saved = await call<DrawingSaveResponse>(CONTRACT.drawing.save.channel, { root: vault, path: rel, json: sent([imageEl('aaa')]), expectedMtime: opened.mtime, newFiles: [{ fileId: 'aaa', mimeType: 'image/png', dataURL: png('A') }] })
    await call(CONTRACT.setBoardPictures.channel, { root: vault, path: rel, out: true, expectedMtime: saved.mtime })

    await copyFile(created.path, path.join(elsewhere, 'Out.excalidraw'))
    expect((await call<DrawingLoadResponse>(CONTRACT.drawing.load.channel, { root: elsewhere, path: 'Out.excalidraw' })).files).toEqual({})
    expect((await call<DrawingLoadResponse>(CONTRACT.drawing.load.channel, { root: vault, path: rel })).files).toEqual({ aaa: { mimeType: 'image/png', dataURL: png('A') } })
  })
})
