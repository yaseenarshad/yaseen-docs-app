/**
 * The code tab on the REAL document host (YAZ-3448) with a fake Monaco (`monacoTestKit.ts`): the
 * scenarios S1–S4 and S9 of YAZ-3448, the bytes of YAZ-3445 (line break, BOM) through the host, the
 * missing read-only switch, the app's keys over Monaco's (YAZ-3447 S3, S4) and the live theme (S2).
 * The host's own rules (rename, delete, quit flush) are pinned once in `useDocumentHost.test.tsx`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { FileResponse, FileWriteRequest, FileWriteResponse } from '@shared/types'

vi.mock('./monaco', () => import('./monacoTestKit'))

import { BridgeRequestError } from '../api'
import { fakeWatch } from '../documents/boardTestKit'
import { _resetRenameContinuity } from '../lib/renameContinuity'
import { BROKEN_CODE_DOCUMENT, CodeEditor, appCommandOf } from './CodeEditor'
import { applyAppTheme, created, resetFakeMonaco } from './monacoTestKit'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const ROOT = '/vault'
const PATH = '/vault/src/app.ts'

const readFile = vi.fn<(path: string) => Promise<FileResponse>>()
const writeFile = vi.fn<(req: FileWriteRequest) => Promise<FileWriteResponse>>()
const setBoardReadOnly = vi.fn()
const toggleSidebar = vi.fn()

const { watch, watcherSaw } = fakeWatch()

let root: Root | null = null
let container: HTMLElement
let flushListener: (() => Promise<void> | void) | null = null

const disk = (content: string, mtime = 100, path = PATH): FileResponse => ({ path, content, mtime, size: content.length })

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve()
  })
}

async function after(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
}

/** Mount a code tab on `content` (at mtime 100) and wait for its editor. */
async function opened(content: string, path = PATH): Promise<void> {
  readFile.mockResolvedValueOnce(disk(content, 100, path))
  act(() => root?.render(<CodeEditor root={ROOT} path={path} watch={watch} sync={{ root: ROOT, state: 'synced' }} onSyncNow={() => undefined} onToggleSidebar={toggleSidebar} />))
  await settle()
}

const model = () => created.models.at(-1)!
const editor = () => created.editors.at(-1)!
const text = (): string => container.textContent ?? ''
const button = (name: string): HTMLButtonElement | undefined => [...container.querySelectorAll('button')].find((b) => b.textContent === name)

function type(value: string): void {
  act(() => model().type(value))
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  flushListener = null
  resetFakeMonaco()
  Object.defineProperty(window, 'yaseenDocs', {
    configurable: true,
    writable: true,
    value: {
      readFile,
      writeFile,
      setBoardReadOnly,
      window: {
        onFlush: (listener: () => Promise<void> | void) => {
          flushListener = listener
          return () => {
            flushListener = null
          }
        },
      },
    },
  })
  writeFile.mockImplementation(async (req) => ({ path: req.path, mtime: 200, size: req.content.length }))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container.remove()
  _resetRenameContinuity()
  delete document.documentElement.dataset.theme
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('loading', () => {
  it('reads the file once, then mounts one Monaco editor on one model with the D6 layout', async () => {
    await opened('const a = 1\n')
    expect(readFile).toHaveBeenCalledExactlyOnceWith(PATH)
    expect(created.editors).toHaveLength(1)
    expect(model().uri.path).toBe(PATH)
    expect(editor().options).toMatchObject({ lineNumbers: 'on', showFoldingControls: 'always', stickyScroll: { enabled: true }, bracketPairColorization: { enabled: true }, minimap: { enabled: false }, wordWrap: 'on' })
    expect(container.querySelector('section.editor.editor--code')).not.toBeNull()
  })

  it('a file that will not open is one readable state, and no editor mounts', async () => {
    readFile.mockRejectedValueOnce(new BridgeRequestError('IO_ERROR', 'file is not valid UTF-8 text'))
    act(() => root?.render(<CodeEditor root={ROOT} path={PATH} watch={watch} />))
    await settle()
    expect(text()).toContain(`${BROKEN_CODE_DOCUMENT}: file is not valid UTF-8 text.`)
    expect(created.editors).toHaveLength(0)
  })

  it('two tabs on one file get two models with two URIs (S7)', async () => {
    await opened('a\n')
    const first = model().uri
    act(() => root?.render(<></>))
    await opened('a\n')
    expect(model().uri.path).toBe(first.path)
    expect(model().uri.authority).not.toBe(first.authority)
  })
})

describe('S1: autosave', () => {
  it('saves 500 ms after an edit: Unsaved → Saving → Saved, the whole text under the read mtime', async () => {
    let answer: (res: FileWriteResponse) => void = () => undefined
    writeFile.mockImplementationOnce((req) => new Promise((resolve) => (answer = () => resolve({ path: req.path, mtime: 200, size: req.content.length }))))
    await opened('const a = 1\n')
    type('const a = 2\n')
    expect(text()).toContain('Unsaved')
    await after(499)
    expect(writeFile).not.toHaveBeenCalled()
    await after(1)
    expect(writeFile).toHaveBeenCalledExactlyOnceWith({ path: PATH, content: 'const a = 2\n', expectedMtime: 100 })
    expect(text()).toContain('Saving')
    await act(async () => answer({ path: PATH, mtime: 200, size: 12 }))
    expect(text()).toContain('Saved')
    type('const a = 3\n')
    await after(500)
    expect(writeFile).toHaveBeenLastCalledWith({ path: PATH, content: 'const a = 3\n', expectedMtime: 200 })
  })

  it('a CRLF file saves CRLF on every line, an edited line too (YAZ-3445 S2)', async () => {
    await opened('a\r\nb\r\n')
    type('a\nB\nc\n')
    await after(500)
    expect(writeFile.mock.calls[0][0].content).toBe('a\r\nB\r\nc\r\n')
  })

  it('a mixed file saves every line with the FIRST break found, not the one most lines use (YAZ-3445 S3)', async () => {
    await opened('a\r\nb\nc\nd\n')
    const start = model().getAlternativeVersionId()
    type('a\nb\nc\nD\n')
    await after(500)
    expect(writeFile.mock.calls[0][0].content).toBe('a\r\nb\r\nc\r\nD\r\n')
    // The break was chosen at birth: nothing on the undo stack, the load itself is clean.
    expect(start).toBe(1)
  })

  it('a leading BOM stays (YAZ-3445 S4)', async () => {
    await opened('﻿print("a")\n')
    type('print("b")\n')
    await after(500)
    expect(writeFile.mock.calls[0][0].content).toBe('﻿print("b")\n')
  })

  it('S9: a .yaml that starts with --- saves whole: nothing is split as frontmatter', async () => {
    await opened('---\nname: a\n---\nb: 1\n', '/vault/compose.yaml')
    type('---\nname: a\n---\nb: 2\n')
    await after(500)
    expect(writeFile).toHaveBeenCalledExactlyOnceWith({ path: '/vault/compose.yaml', content: '---\nname: a\n---\nb: 2\n', expectedMtime: 100 })
  })

  it('an undo back to the saved text is clean again: nothing is written', async () => {
    await opened('x\n')
    const clean = model().getAlternativeVersionId()
    type('y\n')
    expect(text()).toContain('Unsaved')
    act(() => model().undoTo('x\n', clean))
    expect(text()).toContain('Saved')
    await after(1000)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('S8: closing the window and closing the tab each write a pending edit at once', async () => {
    await opened('x\n')
    type('y\n')
    await act(async () => flushListener?.())
    expect(writeFile).toHaveBeenCalledExactlyOnceWith({ path: PATH, content: 'y\n', expectedMtime: 100 })
    type('z\n')
    act(() => root?.render(<></>))
    await settle()
    expect(writeFile).toHaveBeenLastCalledWith({ path: PATH, content: 'z\n', expectedMtime: 200 })
    // No leak per tab: the editor and the model went with it.
    expect(editor().disposed).toBe(true)
    expect(model().isDisposed()).toBe(true)
  })
})

describe('external changes', () => {
  it('S2: a change on disk reloads a clean tab silently, keeps the view, and is the new baseline', async () => {
    await opened('a\n')
    readFile.mockResolvedValueOnce(disk('a\nfrom outside\n', 300))
    watcherSaw({ type: 'change', path: PATH, mtime: 300 })
    await settle()
    expect(readFile).toHaveBeenLastCalledWith(PATH)
    expect(model().getValue(0, true)).toBe('a\nfrom outside\n')
    expect(editor().restored).toEqual([editor().viewState])
    expect(text()).toContain('Saved')
    expect(container.querySelector('.conflict-bar')).toBeNull()
    await after(1000)
    expect(writeFile).not.toHaveBeenCalled()
    // The next edit saves under the reloaded mtime.
    type('b\n')
    await after(500)
    expect(writeFile).toHaveBeenLastCalledWith({ path: PATH, content: 'b\n', expectedMtime: 300 })
  })

  it('a reload keeps the line break the disk now has', async () => {
    await opened('a\n')
    readFile.mockResolvedValueOnce(disk('a\r\nb\r\n', 300))
    watcherSaw({ type: 'change', path: PATH, mtime: 300 })
    await settle()
    type('a\nb\nc\n')
    await after(500)
    expect(writeFile.mock.calls[0][0].content).toBe('a\r\nb\r\nc\r\n')
  })

  it("S2: the echo of the tab's own save is not a change", async () => {
    await opened('a\n')
    type('b\n')
    await after(500)
    watcherSaw({ type: 'change', path: PATH, mtime: 200 })
    await settle()
    expect(readFile).toHaveBeenCalledTimes(1)
  })

  it('S3: a change on disk while dirty shows the conflict bar; Reload takes the disk, nothing written', async () => {
    await opened('a\n')
    writeFile.mockClear()
    type('mine\n')
    watcherSaw({ type: 'change', path: PATH, mtime: 300 })
    await settle()
    expect(container.querySelector('.conflict-bar')).not.toBeNull()
    expect(button('Reload')).toBeDefined()
    expect(button('Keep mine')).toBeDefined()
    readFile.mockResolvedValueOnce(disk('theirs\n', 300))
    await act(async () => button('Reload')!.click())
    await settle()
    expect(model().getValue(0, true)).toBe('theirs\n')
    expect(container.querySelector('.conflict-bar')).toBeNull()
    await after(1000)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('S3: Keep mine writes the tab over the newer disk version', async () => {
    await opened('a\n')
    type('mine\n')
    watcherSaw({ type: 'change', path: PATH, mtime: 300 })
    await settle()
    await act(async () => button('Keep mine')!.click())
    await settle()
    expect(writeFile).toHaveBeenLastCalledWith({ path: PATH, content: 'mine\n', expectedMtime: 300 })
  })

  it('S4: a save that meets a newer mtime shows the conflict bar, and nothing more is written', async () => {
    writeFile.mockRejectedValueOnce(new BridgeRequestError('CONFLICT', 'file changed on disk since last read', 300, PATH))
    await opened('a\n')
    type('mine\n')
    await after(500)
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(container.querySelector('.conflict-bar')).not.toBeNull()
    expect(text()).not.toContain('Save failed')
    type('mine again\n')
    await after(1000)
    expect(writeFile).toHaveBeenCalledTimes(1)
  })
})

describe('no read-only switch (YAZ-3448)', () => {
  it('shows no page cog and no Read only chip, only the sync and save chips', async () => {
    await opened('a\n')
    const chips = [...container.querySelector('.status-chips')!.children].map((chip) => chip.className.split(' ')[0])
    expect(chips).toEqual(['sync-indicator', 'save-indicator'])
    expect(container.querySelector('.page-settings')).toBeNull()
    expect(container.querySelector('.read-only-chip')).toBeNull()
    type('b\n')
    await after(500)
    expect(setBoardReadOnly).not.toHaveBeenCalled()
  })
})

describe("the app's keys win over Monaco (YAZ-3447)", () => {
  const press = (init: KeyboardEventInit): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    act(() => void editor().input.dispatchEvent(event))
    return event
  }

  it('S3: ⌘K never reaches Monaco and is not taken, so the menu opens the vault search', async () => {
    await opened('a\n')
    const event = press({ key: 'k', code: 'KeyK', metaKey: true })
    expect(editor().keysSeen).toEqual([])
    expect(event.defaultPrevented).toBe(false)
  })

  it('S4: ⌘W, ⌘T and ⌘⇧O (Monaco: Go to Symbol) go to the menu too', async () => {
    await opened('a\n')
    for (const init of [{ key: 'w', code: 'KeyW', metaKey: true }, { key: 't', code: 'KeyT', metaKey: true }, { key: 'O', code: 'KeyO', metaKey: true, shiftKey: true }]) {
      expect(press(init).defaultPrevented).toBe(false)
    }
    expect(editor().keysSeen).toEqual([])
  })

  it('⌘S saves at once, and Monaco does not see it', async () => {
    await opened('a\n')
    type('b\n')
    const event = press({ key: 's', code: 'KeyS', metaKey: true })
    await settle()
    expect(writeFile).toHaveBeenCalledExactlyOnceWith({ path: PATH, content: 'b\n', expectedMtime: 100 })
    expect(event.defaultPrevented).toBe(true)
    expect(editor().keysSeen).toEqual([])
  })

  it('S4: ⌘B toggles the sidebar, as in a diagram', async () => {
    await opened('a\n')
    const event = press({ key: 'b', code: 'KeyB', metaKey: true })
    expect(toggleSidebar).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
    expect(editor().keysSeen).toEqual([])
  })

  it("S5: Monaco's own keys reach Monaco: ⌘D, ⌥↑, ⌘/, F1", async () => {
    await opened('a\n')
    press({ key: 'd', code: 'KeyD', metaKey: true })
    press({ key: 'ArrowUp', code: 'ArrowUp', altKey: true })
    press({ key: '/', code: 'Slash', metaKey: true })
    press({ key: 'F1', code: 'F1' })
    expect(editor().keysSeen).toEqual(['d', 'ArrowUp', '/', 'F1'])
  })

  it('a key the user moved is read at once: search on ⌘P frees ⌘K for Monaco', () => {
    const k = { key: 'k', code: 'KeyK', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }
    expect(appCommandOf(k, undefined)).toBe('search')
    expect(appCommandOf(k, { search: 'CmdOrCtrl+P' })).toBeNull()
    expect(appCommandOf({ ...k, key: 'p', code: 'KeyP' }, { search: 'CmdOrCtrl+P' })).toBe('search')
    expect(appCommandOf({ ...k, key: 'Meta', code: 'MetaLeft' }, undefined)).toBeNull()
  })

  it('off a Mac, Ctrl is the app key: Ctrl+K is the vault search there, and only there', () => {
    const ctrlK = { key: 'k', code: 'KeyK', metaKey: false, ctrlKey: true, altKey: false, shiftKey: false }
    expect(appCommandOf(ctrlK, undefined, false)).toBe('search')
    expect(appCommandOf(ctrlK, undefined, true)).toBeNull()
    // ⌃Tab is Next tab on both.
    expect(appCommandOf({ ...ctrlK, key: 'Tab', code: 'Tab' }, undefined, true)).toBe('nextTab')
    expect(appCommandOf({ ...ctrlK, key: 'Tab', code: 'Tab' }, undefined, false)).toBe('nextTab')
  })
})

describe('Appearance (YAZ-3447 S2)', () => {
  it('applies the theme at mount and again, live, when Appearance flips', async () => {
    document.documentElement.dataset.theme = 'light'
    await opened('a\n')
    expect(applyAppTheme).toHaveBeenLastCalledWith('light')
    document.documentElement.dataset.theme = 'dark'
    await settle()
    expect(applyAppTheme).toHaveBeenLastCalledWith('dark')
    expect(created.editors).toHaveLength(1)
  })
})
