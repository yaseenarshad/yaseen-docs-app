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
import { FOLD_KEYS } from '../editor/outline/foldKeys'
import { ZOOM_EVENT } from '../editor/zoomRequest'
import { readPageView } from '../lib/pageView'
import { _resetRenameContinuity } from '../lib/renameContinuity'
import { storage } from '../lib/storage'
import { BROKEN_CODE_DOCUMENT, CodeEditor, appCommandOf } from './CodeEditor'
import { applyAppTheme, created, resetFakeMonaco } from './monacoTestKit'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const ROOT = '/vault'
const PATH = '/vault/src/app.ts'

const readFile = vi.fn<(path: string) => Promise<FileResponse>>()
const writeFile = vi.fn<(req: FileWriteRequest) => Promise<FileWriteResponse>>()
const setBoardReadOnly = vi.fn()
const setFolds = vi.fn(async () => undefined)
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
      state: { setFolds },
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
  storage.setFolds(ROOT, PATH, [])
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
    expect(editor().options).toMatchObject({ lineNumbers: 'on', showFoldingControls: 'always', stickyScroll: { enabled: true }, bracketPairColorization: { enabled: true }, minimap: { enabled: false }, wordWrap: 'on', readOnly: false })
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
  it('S2: a change on disk reloads a clean tab silently, as one edit over the changed part only, and is the new baseline', async () => {
    await opened('a\n')
    readFile.mockResolvedValueOnce(disk('a\nfrom outside\n', 300))
    watcherSaw({ type: 'change', path: PATH, mtime: 300 })
    await settle()
    expect(readFile).toHaveBeenLastCalledWith(PATH)
    expect(model().getValue(0, true)).toBe('a\nfrom outside\n')
    // The unchanged first line is not in the edit, so the cursor and the scroll anchor on it stay.
    expect(model().edits).toEqual([{ range: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 1 }, text: 'from outside\n' }])
    expect(model().setValueCalls).toBe(0)
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

describe('no read-only switch in the file (YAZ-3448)', () => {
  it('with no door to the settings: no page cog and no Read only chip, only the sync and save chips', async () => {
    await opened('a\n')
    const chips = [...container.querySelector('.status-chips')!.children].map((chip) => chip.className.split(' ')[0])
    // The text size pill (YAZ-3451) is this tab's own; no cog without a door to the settings.
    expect(chips).toEqual(['document-zoom', 'sync-indicator', 'save-indicator'])
    expect(container.querySelector('.page-settings')).toBeNull()
    expect(container.querySelector('.read-only-chip')).toBeNull()
    type('b\n')
    await after(500)
    expect(setBoardReadOnly).not.toHaveBeenCalled()
  })
})

describe('Settings › Code: read only, wrap, minimap (YAZ-3449)', () => {
  const OTHER = '/vault/src/other.py'
  type Code = { codeReadOnly?: boolean; codeWrap?: boolean; codeMinimap?: boolean }
  const changeCode = vi.fn()
  /** Two code tabs side by side, as two layers of one window, on the same settings. */
  function twoTabs(settings: Code): void {
    act(() =>
      root?.render(
        <>
          <div data-tab="a"><CodeEditor root={ROOT} path={PATH} watch={watch} onChangeCodeSettings={changeCode} {...settings} /></div>
          <div data-tab="b"><CodeEditor root={ROOT} path={OTHER} watch={watch} onChangeCodeSettings={changeCode} {...settings} /></div>
        </>,
      ),
    )
  }
  async function openTwo(settings: Code): Promise<void> {
    readFile.mockImplementation(async (path) => disk('a\n', 100, path))
    twoTabs(settings)
    await settle()
  }
  const tab = (id: string): HTMLElement => container.querySelector<HTMLElement>(`[data-tab="${id}"]`)!
  const chipIn = (id: string) => tab(id).querySelector('.read-only-chip')
  const cogRows = (id: string): string[] => {
    act(() => tab(id).querySelector<HTMLButtonElement>('.page-settings__trigger')!.click())
    const rows = [...tab(id).querySelectorAll('.page-settings__menu button')].map((b) => b.textContent ?? '')
    act(() => tab(id).querySelector<HTMLButtonElement>('.page-settings__trigger')!.click())
    return rows
  }
  const clickRow = (id: string, label: string): void => {
    // The menu stays open after a row (as a note's does): open it only when it is closed.
    if (tab(id).querySelector('.page-settings__menu') === null) act(() => tab(id).querySelector<HTMLButtonElement>('.page-settings__trigger')!.click())
    act(() => [...tab(id).querySelectorAll<HTMLButtonElement>('.page-settings__menu button')].find((b) => b.textContent?.startsWith(label))!.click())
  }

  afterEach(() => readFile.mockReset())

  it('the cog has the three rows, in order, with the settings as they are; each row writes its setting for all code files', async () => {
    await openTwo({ codeReadOnly: false, codeWrap: true, codeMinimap: false })
    expect(cogRows('a')).toEqual(['Read only (all code files)', 'Wrap long lines✓', 'Minimap'])
    clickRow('a', 'Read only')
    expect(changeCode).toHaveBeenLastCalledWith({ codeReadOnly: true })
    clickRow('a', 'Wrap long lines')
    expect(changeCode).toHaveBeenLastCalledWith({ codeWrap: false })
    clickRow('b', 'Minimap')
    expect(changeCode).toHaveBeenLastCalledWith({ codeMinimap: true })
    // The cog only asks: the setting changes when App hands it back (below).
    expect(created.editors.every((e) => e.options.readOnly === false)).toBe(true)
  })

  it('S1, S3: Read only on locks every open code tab at once, and each shows the chip', async () => {
    await openTwo({ codeReadOnly: false })
    expect(chipIn('a')).toBeNull()
    twoTabs({ codeReadOnly: true })
    await settle()
    expect(created.editors.map((e) => e.options.readOnly)).toEqual([true, true])
    expect(chipIn('a')).not.toBeNull()
    expect(chipIn('b')).not.toBeNull()
    expect(cogRows('a')[0]).toBe('Read only (all code files)✓')
    // Nothing is written: the switch is a setting, never the file's.
    expect(setBoardReadOnly).not.toHaveBeenCalled()
  })

  it('a tab opened while Read only is on is born read only', async () => {
    await openTwo({ codeReadOnly: true })
    expect(created.editors.map((e) => e.options.readOnly)).toEqual([true, true])
  })

  it('S2: "Allow edits" unlocks only that tab, the setting stays; a closed and reopened tab is locked again', async () => {
    await openTwo({ codeReadOnly: true })
    const [a, b] = created.editors
    act(() => chipIn('a')!.querySelector<HTMLButtonElement>('.read-only-chip__button')!.click())
    act(() => chipIn('a')!.querySelector<HTMLButtonElement>('.read-only-chip__allow')!.click())
    expect(a.options.readOnly).toBe(false)
    expect(chipIn('a')).toBeNull()
    expect(b.options.readOnly).toBe(true)
    expect(chipIn('b')).not.toBeNull()
    expect(changeCode).not.toHaveBeenCalled()
    // Close both, open again: the unlock went with the tab.
    act(() => root?.render(<></>))
    await openTwo({ codeReadOnly: true })
    expect(created.editors.slice(2).map((e) => e.options.readOnly)).toEqual([true, true])
  })

  it('S1: the setting going off and on again locks a tab that "Allow edits" had unlocked', async () => {
    await openTwo({ codeReadOnly: true })
    act(() => chipIn('a')!.querySelector<HTMLButtonElement>('.read-only-chip__button')!.click())
    act(() => chipIn('a')!.querySelector<HTMLButtonElement>('.read-only-chip__allow')!.click())
    twoTabs({ codeReadOnly: false })
    await settle()
    twoTabs({ codeReadOnly: true })
    await settle()
    expect(created.editors.map((e) => e.options.readOnly)).toEqual([true, true])
    expect(chipIn('a')).not.toBeNull()
  })

  it('S4: ⌥Z flips one tab and saves nothing; a change of Wrap then sets every tab, the flipped one too', async () => {
    await openTwo({ codeWrap: true })
    const [a, b] = created.editors
    expect(a.actions.get('editor.action.toggleWordWrap')?.keybindings).toEqual([512 | 56])
    act(() => a.runAction('editor.action.toggleWordWrap'))
    expect(a.options.wordWrap).toBe('off')
    expect(b.options.wordWrap).toBe('on')
    expect(changeCode).not.toHaveBeenCalled()
    twoTabs({ codeWrap: false })
    await settle()
    expect([a.options.wordWrap, b.options.wordWrap]).toEqual(['off', 'off'])
    twoTabs({ codeWrap: true })
    await settle()
    expect([a.options.wordWrap, b.options.wordWrap]).toEqual(['on', 'on'])
    // ⌥Z after a setting change flips from the new value.
    act(() => a.runAction('editor.action.toggleWordWrap'))
    expect(a.options.wordWrap).toBe('off')
  })

  it('S5: Minimap on shows the minimap in every code tab', async () => {
    await openTwo({ codeMinimap: false })
    expect(created.editors.map((e) => e.options.minimap)).toEqual([{ enabled: false }, { enabled: false }])
    twoTabs({ codeMinimap: true })
    await settle()
    expect(created.editors.map((e) => e.options.minimap)).toEqual([{ enabled: true }, { enabled: true }])
  })

  it('the ⌥Z action goes with the tab', async () => {
    await openTwo({})
    const [a] = created.editors
    act(() => root?.render(<></>))
    expect(a.actions.size).toBe(0)
  })
})

describe('folds remembered (YAZ-3451)', () => {
  const FILE = 'import x from "x"\n\nfunction one() {\n  return 1\n}\n\nfunction two() {\n  return 2\n}\n'
  /** Let the folding model answer and the restore run. */
  const restored = settle

  it('S1: fold a function, close the tab, reopen: still folded', async () => {
    await opened(FILE)
    act(() => editor().toggleFold(3))
    await after(399)
    expect(storage.getFolds(ROOT, PATH)).toEqual([])
    await after(1)
    expect(storage.getFolds(ROOT, PATH)).toEqual(['function one() {'])
    expect(setFolds).toHaveBeenLastCalledWith(ROOT, PATH, ['function one() {'])
    act(() => root?.render(<></>))
    await opened(FILE)
    await restored()
    expect([...editor().folded]).toEqual([3])
  })

  it('nothing per keystroke; three fold clicks in a row are one write; the same folds again are no write', async () => {
    await opened(FILE)
    type(FILE.replace('return 1', 'return 11'))
    await after(1000)
    expect(setFolds).not.toHaveBeenCalled()
    act(() => editor().toggleFold(3))
    act(() => editor().toggleFold(7))
    act(() => editor().toggleFold(7))
    await after(400)
    expect(setFolds).toHaveBeenCalledExactlyOnceWith(ROOT, PATH, ['function one() {'])
    act(() => editor().toggleFold(7))
    act(() => editor().toggleFold(7))
    await after(400)
    expect(setFolds).toHaveBeenCalledTimes(1)
  })

  it('a fold not yet written is written when the tab closes', async () => {
    await opened(FILE)
    act(() => editor().toggleFold(7))
    act(() => root?.render(<></>))
    expect(storage.getFolds(ROOT, PATH)).toEqual(['function two() {'])
  })

  it('S2: another app added lines above the folded function: the fold finds it on its new line', async () => {
    storage.setFolds(ROOT, PATH, ['function two() {'])
    await opened(`// one\n// two\n// three\n${FILE}`)
    await restored()
    expect([...editor().folded]).toEqual([10])
    // The stored key was right: nothing to write.
    expect(setFolds).toHaveBeenCalledTimes(1)
  })

  it('S3: another app deleted the folded function: its fold is dropped from the store, the other stays, nothing errors', async () => {
    storage.setFolds(ROOT, PATH, ['function one() {', 'function two() {'])
    setFolds.mockClear()
    await opened(FILE.replace('function one() {\n  return 1\n}\n', ''))
    await restored()
    expect([...editor().folded]).toEqual([4])
    expect(setFolds).toHaveBeenCalledExactlyOnceWith(ROOT, PATH, ['function two() {'])
    expect(container.textContent).not.toContain("can't")
  })

  it('a fold that is folded already is not toggled open by the restore', async () => {
    storage.setFolds(ROOT, PATH, ['function one() {'])
    readFile.mockResolvedValueOnce(disk(FILE))
    act(() => root?.render(<CodeEditor root={ROOT} path={PATH} watch={watch} />))
    await settle()
    expect([...editor().folded]).toEqual([3])
  })
})

describe('text size, scroll and Duplicate tab (YAZ-3451)', () => {
  const FILE = 'a\nfunction b() {\n  c\n}\n'
  const zoomStep = (step: number): CustomEvent => {
    const event = new CustomEvent(ZOOM_EVENT, { detail: step, bubbles: true, cancelable: true })
    act(() => void editor().input.dispatchEvent(event))
    return event
  }

  it("⌘+ / ⌘− / ⌘0 reach the code tab as the note's ZOOM_EVENT: the tab claims them and Monaco's text size follows the note's steps", async () => {
    await opened(FILE)
    expect(editor().options.fontSize).toBe(13)
    expect(zoomStep(1).defaultPrevented).toBe(true)
    expect(editor().options.fontSize).toBe(13 * 1.25)
    expect(container.querySelector('.document-zoom__trigger')?.textContent).toContain('125')
    zoomStep(-1)
    zoomStep(-1)
    expect(editor().options.fontSize).toBeCloseTo(13 * 0.9)
    zoomStep(0)
    expect(editor().options.fontSize).toBe(13)
  })

  it('S5: a copy starts with its source page view: folds, scroll spot, text size; it writes no folds until one changes in it', async () => {
    storage.setFolds(ROOT, PATH, [])
    setFolds.mockClear()
    readFile.mockResolvedValueOnce(disk(FILE))
    act(() => root?.render(<div data-tab="copy"><CodeEditor root={ROOT} path={PATH} watch={watch} startView={{ scrollTop: 240, zoomKey: null, folds: ['function b() {'], magnification: 150 }} /></div>))
    await settle()
    expect([...editor().folded]).toEqual([2])
    expect(editor().getScrollTop()).toBe(240)
    expect(editor().options.fontSize).toBe(13 * 1.5)
    expect(setFolds).not.toHaveBeenCalled()
    // And it answers for itself the same way, live, for the next copy.
    act(() => editor().setScrollTop(300))
    expect(readPageView('copy')).toEqual({ scrollTop: 300, zoomKey: null, folds: ['function b() {'], magnification: 150 })
  })
})

describe('an outside reload keeps the undo history (YAZ-3451)', () => {
  it('⌘Z after an outside reload gives the old text back; the tab is then unsaved and saves it under the reloaded mtime', async () => {
    await opened('a\nb\n')
    readFile.mockResolvedValueOnce(disk('agent line\na\nb\n', 300))
    watcherSaw({ type: 'change', path: PATH, mtime: 300 })
    await settle()
    expect(model().getValue(0, true)).toBe('agent line\na\nb\n')
    expect(model().setValueCalls).toBe(0)
    expect(text()).toContain('Saved')
    act(() => model().undo())
    expect(model().getValue(0, true)).toBe('a\nb\n')
    expect(text()).toContain('Unsaved')
    await after(500)
    expect(writeFile).toHaveBeenLastCalledWith({ path: PATH, content: 'a\nb\n', expectedMtime: 300 })
  })

  it('a reload of the same text is no edit; a CRLF reload keeps CRLF', async () => {
    await opened('a\r\nb\r\n')
    readFile.mockResolvedValueOnce(disk('a\r\nb\r\n', 300))
    watcherSaw({ type: 'change', path: PATH, mtime: 300 })
    await settle()
    expect(model().edits).toEqual([])
    readFile.mockResolvedValueOnce(disk('a\r\nb\r\nc\r\n', 400))
    watcherSaw({ type: 'change', path: PATH, mtime: 400 })
    await settle()
    expect(model().getValue(0, true)).toBe('a\r\nb\r\nc\r\n')
  })

  it('a BOM the disk gained can only come in by setValue (Monaco holds it apart): that one reload clears undo, as before', async () => {
    await opened('a\n')
    readFile.mockResolvedValueOnce(disk('\uFEFFa\n', 300))
    watcherSaw({ type: 'change', path: PATH, mtime: 300 })
    await settle()
    expect(model().setValueCalls).toBe(1)
    expect(model().getValue(0, true)).toBe('\uFEFFa\n')
  })

  it('a read-only tab reloads the same way', async () => {
    readFile.mockResolvedValueOnce(disk('a\n', 100))
    act(() => root?.render(<CodeEditor root={ROOT} path={PATH} watch={watch} codeReadOnly />))
    await settle()
    readFile.mockResolvedValueOnce(disk('a\nb\n', 300))
    watcherSaw({ type: 'change', path: PATH, mtime: 300 })
    await settle()
    expect(model().getValue(0, true)).toBe('a\nb\n')
    expect(model().setValueCalls).toBe(0)
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

  it("S6 (YAZ-3451): ⌘F and ⌘⌥F reach Monaco: its find box, then replace", async () => {
    await opened('a\n')
    press({ key: 'f', code: 'KeyF', metaKey: true })
    press({ key: 'ƒ', code: 'KeyF', metaKey: true, altKey: true })
    expect(editor().keysSeen).toEqual(['f', 'ƒ'])
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

describe('collapse all and expand all (YAZ-3478)', () => {
  const FILE = 'export class Pipeline {\n  step1() {\n    return 1\n  }\n  step2() {\n    return 2\n  }\n}\n'
  const ALL = ['export class Pipeline {', 'step1() {', 'step2() {']
  const press = (init: KeyboardEventInit): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    act(() => void editor().input.dispatchEvent(event))
    return event
  }
  const cmdShiftU = { key: 'U', code: 'KeyU', metaKey: true, shiftKey: true }
  const cmdShiftI = { key: 'I', code: 'KeyI', metaKey: true, shiftKey: true }
  let platform: PropertyDescriptor | undefined
  beforeEach(() => {
    // The keys are the Mac's (⌘); jsdom's platform is empty.
    platform = Object.getOwnPropertyDescriptor(navigator, 'platform')
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' })
  })
  afterEach(() => {
    if (platform === undefined) delete (navigator as unknown as Record<string, unknown>).platform
    else Object.defineProperty(navigator, 'platform', platform)
  })
  /** Opens FILE with the cursor in the code. */
  async function focused(): Promise<void> {
    await opened(FILE)
    act(() => editor().focus())
  }
  /** A fold chevron in the gutter, where Monaco draws it. */
  function chevron(): HTMLElement {
    const gutter = document.createElement('div')
    gutter.className = 'margin-view-overlays'
    const icon = document.createElement('div')
    icon.className = 'cldr codicon codicon-folding-expanded'
    gutter.appendChild(icon)
    editor().mount.appendChild(gutter)
    return icon
  }
  const rightClick = (target: Element): MouseEvent => {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 120 })
    act(() => void target.dispatchEvent(event))
    return event
  }
  const menuItems = () => [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')]

  it('S1: ⌘⇧U folds every block; Monaco does not see the key; close and reopen: still folded', async () => {
    await focused()
    const event = press(cmdShiftU)
    expect(event.defaultPrevented).toBe(true)
    expect(editor().keysSeen).toEqual([])
    expect(editor().triggered).toEqual(['editor.foldAll'])
    expect([...editor().folded].sort((a, b) => a - b)).toEqual([1, 2, 5])
    await after(400)
    expect(storage.getFolds(ROOT, PATH)).toEqual(ALL)
    act(() => root?.render(<></>))
    await opened(FILE)
    await settle()
    expect([...editor().folded].sort((a, b) => a - b)).toEqual([1, 2, 5])
  })

  it('S2: ⌘⇧I opens every block, and the remembered folds are empty again', async () => {
    await focused()
    press(cmdShiftU)
    await after(400)
    press(cmdShiftI)
    expect(editor().triggered).toEqual(['editor.foldAll', 'editor.unfoldAll'])
    expect([...editor().folded]).toEqual([])
    await after(400)
    expect(storage.getFolds(ROOT, PATH)).toEqual([])
  })

  it('S5: ⌘↑ folds the block at the cursor and ⌘↓ unfolds it, as in a note; Monaco never sees them (no top / bottom move)', async () => {
    await focused()
    act(() => editor().setPosition({ lineNumber: 6, column: 5 }))
    const up = press({ key: 'ArrowUp', code: 'ArrowUp', metaKey: true })
    expect(up.defaultPrevented).toBe(true)
    expect([...editor().folded]).toEqual([5])
    expect(editor().position).toEqual({ lineNumber: 6, column: 5 })
    press({ key: 'ArrowDown', code: 'ArrowDown', metaKey: true })
    expect([...editor().folded]).toEqual([])
    expect(editor().triggered).toEqual(['editor.fold', 'editor.unfold'])
    expect(editor().keysSeen).toEqual([])
    await after(400)
    expect(storage.getFolds(ROOT, PATH)).toEqual([])
  })

  it('⌘Home / ⌘End go to the top / bottom on a Mac (⇧ selects); Monaco does not see them', async () => {
    await focused()
    press({ key: 'End', code: 'End', metaKey: true })
    expect(editor().position).toEqual({ lineNumber: 9, column: 1 })
    press({ key: 'Home', code: 'Home', metaKey: true })
    expect(editor().position).toEqual({ lineNumber: 1, column: 1 })
    press({ key: 'End', code: 'End', metaKey: true, shiftKey: true })
    expect(editor().triggered).toEqual(['cursorBottom', 'cursorTop', 'cursorBottomSelect'])
    expect(editor().keysSeen).toEqual([])
  })

  it('a fold key outside the code (the find box, a chip) is not a fold, and goes on to Monaco', async () => {
    await opened(FILE)
    press(cmdShiftU)
    press({ key: 'ArrowUp', code: 'ArrowUp', metaKey: true })
    expect(editor().triggered).toEqual([])
    expect(editor().keysSeen).toEqual(['U', 'ArrowUp'])
  })

  it("S6: the code tab reads the note's own fold keys (FOLD_KEYS) at each press: a changed key works, the old one does not", async () => {
    const keys = FOLD_KEYS as unknown as Record<string, string>
    const before = keys.foldAll
    keys.foldAll = 'Mod-Shift-y'
    try {
      await focused()
      press(cmdShiftU)
      expect(editor().triggered).toEqual([])
      press({ key: 'Y', code: 'KeyY', metaKey: true, shiftKey: true })
      expect(editor().triggered).toEqual(['editor.foldAll'])
    } finally {
      keys.foldAll = before
    }
  })

  it('S3, S4: a right-click on a fold chevron opens the app menu, "Collapse all" and "Expand all" with their keys; each row runs Monaco\'s action', async () => {
    await focused()
    const event = rightClick(chevron())
    expect(event.defaultPrevented).toBe(true)
    expect(menuItems().map((b) => [b.textContent, b.dataset.hint])).toEqual([
      ['Collapse all', '⌘⇧U'],
      ['Expand all', '⌘⇧I'],
    ])
    act(() => menuItems()[0].click())
    expect(menuItems()).toEqual([])
    expect([...editor().folded].sort((a, b) => a - b)).toEqual([1, 2, 5])
    await after(400)
    expect(storage.getFolds(ROOT, PATH)).toEqual(ALL)
    rightClick(chevron())
    act(() => menuItems()[1].click())
    expect(editor().triggered).toEqual(['editor.foldAll', 'editor.unfoldAll'])
    expect([...editor().folded]).toEqual([])
  })

  it('a right-click on the code, not on a chevron, is left to Monaco', async () => {
    await focused()
    const event = rightClick(editor().input)
    expect(event.defaultPrevented).toBe(false)
    expect(menuItems()).toEqual([])
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
