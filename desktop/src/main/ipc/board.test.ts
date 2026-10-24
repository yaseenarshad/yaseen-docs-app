import { describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'
import { CONTRACT } from '@shared/ipc'
import { registerBoardIpc } from './board'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../fs/drawing', () => ({ loadDrawing: vi.fn(), saveDrawing: vi.fn(async (req: { path: string }) => ({ path: req.path, mtime: 1, size: 1, persisted: [] })) }))
vi.mock('../fs/diagram', () => ({
  loadDiagram: vi.fn(),
  saveDiagram: vi.fn(async (req: { path: string }) => {
    if (req.path.endsWith('conflict.drawio')) throw Object.assign(new Error('changed on disk'), { code: 'CONFLICT' })
    return { path: req.path, mtime: 1, size: 1 }
  }),
}))

type Handler = (event: unknown, ...args: unknown[]) => Promise<{ ok: boolean }>
const registered = (channel: string): Handler => vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel)![1] as unknown as Handler

describe('the save log at the board doors (YAZ-3235 D1, S10)', () => {
  it('a drawing and a diagram save log their file in the vault of the calling window; a save that throws logs nothing', async () => {
    const addEdit = vi.fn()
    const store = { get: () => ({ windows: [{ id: 'w1', roots: ['/v'] }] }), addEdit } as unknown as Parameters<typeof registerBoardIpc>[0]
    registerBoardIpc(store, { idFor: () => 'w1' })
    expect((await registered(CONTRACT.drawing.save.channel)({ sender: {} }, { root: '/v', path: '/v/a.excalidraw', json: '{}' })).ok).toBe(true)
    expect((await registered(CONTRACT.diagram.save.channel)({ sender: {} }, { root: '/v', path: '/v/b.drawio', xml: '<mxfile/>' })).ok).toBe(true)
    expect(addEdit.mock.calls).toEqual([
      [['/v'], '/v/a.excalidraw'],
      [['/v'], '/v/b.drawio'],
    ])
    expect((await registered(CONTRACT.diagram.save.channel)({ sender: {} }, { root: '/v', path: '/v/conflict.drawio', xml: '<mxfile/>' })).ok).toBe(false)
    expect(addEdit).toHaveBeenCalledTimes(2)
  })
})
