import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FileOperationTarget } from '@shared/automationNavigation'
import { boardImageCommand } from './boardImages'
import { editorCommand } from './editor'
import type { NavigationHost } from './navigation'
import { checked } from './contract'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'docs-cli-board-image-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

const sent: FileOperationTarget[] = []
const host = { windows: () => [{ id: 'w1' }], operate: async (_window: string, target: FileOperationTarget) => {
  sent.push(target)
  if (target.command !== 'board.export') return { rendererApplied: true }
  return target.format === 'pdf' ? { format: 'pdf', svg: '<svg/>', width: 96, height: 48, path: '/v/B.excalidraw', dirty: true } : { format: target.format, data: new Uint8Array([137, 80]), path: '/v/B.excalidraw', dirty: false }
} } as unknown as NavigationHost
const print = vi.fn(async () => Buffer.from('%PDF'))
const run = (args: Record<string, unknown>, command = 'drawing.exportImage') => checked(command, boardImageCommand(host, command, { window: 'w1', tab: 't1', ...args }, print))

describe('live board image export (YAZ-4515)', () => {
  beforeEach(() => { sent.length = 0; print.mockClear() })
  it('writes the renderer bytes to a new file and passes only the given export settings', async () => {
    const outputFile = join(dir, 'Board.png')
    expect(await run({ format: 'png', outputFile, scale: 2, background: false })).toEqual({ window: 'w1', tab: 't1', path: '/v/B.excalidraw', format: 'png', outputFile, size: 2, dirty: false, source: 'live', diskSaved: true })
    expect([...await readFile(outputFile)]).toEqual([137, 80])
    expect(sent).toEqual([{ command: 'board.export', tab: 't1', kind: 'drawing', format: 'png', options: { scale: 2, background: false } }])
  })
  it('prints a PDF from the renderer SVG with the export box printer, titled by the file name', async () => {
    const outputFile = join(dir, 'Plan.pdf')
    expect(await run({ format: 'pdf', outputFile })).toMatchObject({ format: 'pdf', size: 4, dirty: true })
    expect(print).toHaveBeenCalledWith('<svg/>', { width: 96, height: 48 }, 'Plan')
    expect(await readFile(outputFile, 'utf8')).toBe('%PDF')
  })
  it('refuses an existing file, a wrong extension, PDF-only conflicts and a closed window before rendering', async () => {
    const taken = join(dir, 'Taken.svg')
    await writeFile(taken, 'mine')
    await expect(run({ format: 'svg', outputFile: taken })).rejects.toMatchObject({ code: 'ALREADY_EXISTS' })
    expect(await readFile(taken, 'utf8')).toBe('mine')
    await expect(run({ format: 'png', outputFile: join(dir, 'x.svg') })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(run({ format: 'pdf', outputFile: join(dir, 'x.pdf'), scale: 2 })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(run({ format: 'png', outputFile: join(dir, 'x.png'), window: 'gone' })).rejects.toMatchObject({ code: 'WINDOW_NOT_FOUND' })
    expect(sent).toEqual([])
  })
  it('sends a diagram export as a diagram', async () => {
    await run({ format: 'svg', outputFile: join(dir, 'D.svg') }, 'diagram.exportImage')
    expect(sent[0]).toMatchObject({ kind: 'diagram', format: 'svg', options: {} })
  })
  it('maps drawing editor commands to the live tab action', async () => {
    await editorCommand(host, 'editor.deleteSelection', { window: 'w1', tab: 't1', revision: 'r' }, Buffer.alloc(0))
    await editorCommand(host, 'editor.selectElements', { window: 'w1', tab: 't1', revision: 'r', ids: ['a'] }, Buffer.alloc(0))
    await editorCommand(host, 'editor.undo', { window: 'w1', tab: 't1', revision: 'r' }, Buffer.alloc(0))
    expect(sent.map(target => target.command === 'editor.action' && target.edit)).toEqual([{ action: 'deleteSelection' }, { action: 'selectElements', ids: ['a'] }, { action: 'undo' }])
  })
})
