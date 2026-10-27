/**
 * A code file in Quick Look (YAZ-3450 S3) with a fake Monaco (`monacoTestKit.ts`): the file's text in
 * one read-only editor, under its own URI, read again on a change; nothing written, the focus left alone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { FileResponse } from '@shared/types'

vi.mock('./monaco', () => import('./monacoTestKit'))

import { fakeWatch } from '../documents/boardTestKit'
import CodePreview from './CodePreview'
import { applyAppTheme, created, resetFakeMonaco } from './monacoTestKit'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const PATH = '/vault/src/app.ts'
const readFile = vi.fn<(path: string) => Promise<FileResponse>>()
const writeFile = vi.fn()
const { watch, watcherSaw } = fakeWatch()
const disk = (content: string, mtime = 100): FileResponse => ({ path: PATH, content, mtime, size: content.length })

let root: Root | null = null
let container: HTMLElement

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve()
  })
}

beforeEach(() => {
  resetFakeMonaco()
  Object.defineProperty(window, 'yaseenDocs', { configurable: true, writable: true, value: { readFile, writeFile } })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container.remove()
  vi.clearAllMocks()
})

describe('CodePreview (YAZ-3450)', () => {
  it('S3: shows the file in one read-only Monaco, under its own URI, in the app theme; nothing is written and the focus stays', async () => {
    const bar = document.createElement('input')
    document.body.appendChild(bar)
    bar.focus()
    readFile.mockResolvedValueOnce(disk('const a: number = 1\n'))
    act(() => root?.render(<CodePreview path={PATH} watch={watch} />))
    await settle()
    expect(readFile).toHaveBeenCalledExactlyOnceWith(PATH)
    expect(created.editors).toHaveLength(1)
    const [editor] = created.editors
    const [model] = created.models
    expect(model.uri).toMatchObject({ scheme: 'code-look', path: PATH })
    expect(model.getValue()).toBe('const a: number = 1\n')
    expect(editor.options).toMatchObject({ readOnly: true, domReadOnly: true, lineNumbers: 'on', showFoldingControls: 'always', minimap: { enabled: false } })
    expect(applyAppTheme).toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(bar)
    bar.remove()
  })

  it('a change on disk shows the new text in the same editor; a change of another file reads nothing', async () => {
    readFile.mockResolvedValueOnce(disk('a\n'))
    act(() => root?.render(<CodePreview path={PATH} watch={watch} />))
    await settle()
    watcherSaw({ type: 'change', path: '/vault/other.ts', mtime: 200 })
    await settle()
    expect(readFile).toHaveBeenCalledTimes(1)
    readFile.mockResolvedValueOnce(disk('a\nb\n', 300))
    watcherSaw({ type: 'change', path: PATH, mtime: 300 })
    await settle()
    expect(created.editors).toHaveLength(1)
    expect(created.models[0].getValue()).toBe('a\nb\n')
  })

  it('a file that will not open says why, and no editor mounts', async () => {
    readFile.mockRejectedValueOnce(new Error('boom'))
    act(() => root?.render(<CodePreview path={PATH} watch={watch} />))
    await settle()
    expect(container.querySelector('.editor-msg--error')?.textContent).toBe('IO_ERROR: boom')
    expect(created.editors).toHaveLength(0)
  })

  it('closing the panel disposes the editor and the model', async () => {
    readFile.mockResolvedValueOnce(disk('a\n'))
    act(() => root?.render(<CodePreview path={PATH} watch={watch} />))
    await settle()
    act(() => root?.render(<></>))
    expect(created.editors[0].disposed).toBe(true)
    expect(created.models[0].isDisposed()).toBe(true)
  })
})
