/**
 * Jump by meaning in the code tab (YAZ-3454 4B, YAZ-3455 4C) with a fake Monaco (`monacoTestKit.ts`)
 * and a fake `lsp` door: the tab opens its file with the helper and closes it; edits reach the helper
 * debounced, and at once before a request; the providers turn the helper's places into Monaco's (the
 * tab's own file is its own model, another file gets a read-only preview model); `null` falls back to
 * Monaco's one-file worker; a jump opens the file through the tab's `onOpenFile` and shows the place.
 * THE SWITCH (YAZ-3500): Settings › Code › "Jump across files", off by default — every test but the
 * switch's own turns it on first.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { LspLocation } from '@shared/lsp'
import type { FileResponse } from '@shared/types'

vi.mock('./monaco', () => import('./monacoTestKit'))

import { fakeWatch } from '../documents/boardTestKit'
import { _resetRenameContinuity } from '../lib/renameContinuity'
import { CodeEditor } from './CodeEditor'
import { MAX_PREVIEWS, SYNC_DEBOUNCE_MS } from './languageClient'
import { setLanguageHelpers } from './languageHelpers'
import type { CodeSymbol } from './outline/outlineModel'
import { readSymbols } from './outline/symbolSource'
import { created, monaco, registered, resetFakeMonaco, type FakeEditor, type FakeModel, type FakeUri } from './monacoTestKit'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const ROOT = '/vault'
const A = '/vault/src/a.ts'
const MATH = '/vault/src/math.ts'
const A_TEXT = "import { add } from './math'\n\nexport const three = add(1, 2)\n"

const files: Record<string, string> = { [A]: A_TEXT, [MATH]: 'export function add(a: number, b: number) {\n  return a + b\n}\n', '/vault/src/b.ts': 'add(3, 4)\n' }
const readFile = vi.fn(async (path: string): Promise<FileResponse> => {
  if (!(path in files)) throw { code: 'NOT_FOUND', message: 'gone' }
  return { path, content: files[path], mtime: 100, size: files[path].length }
})
const lsp = {
  open: vi.fn(async (req: { path: string }) => ({ handle: `h:${req.path}`, language: 'typescript', projectRoot: '/vault' })),
  change: vi.fn(async () => undefined),
  close: vi.fn(async () => undefined),
  definition: vi.fn<(req: unknown) => Promise<LspLocation[] | null>>(async () => []),
  references: vi.fn<(req: unknown) => Promise<LspLocation[] | null>>(async () => []),
  hover: vi.fn(async () => null),
}
const onOpenFile = vi.fn()
const { watch } = fakeWatch()

let root: Root | null = null
let container: HTMLElement

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
  })
}

async function opened(path = A, el = container): Promise<{ editor: FakeEditor; model: FakeModel; root: Root }> {
  const r = el === container ? root! : createRoot(el)
  act(() => r.render(<CodeEditor root={ROOT} path={path} watch={watch} sync={{ root: ROOT, state: 'synced' }} onSyncNow={() => undefined} onOpenFile={onOpenFile} />))
  await settle()
  return { editor: created.editors.at(-1)!, model: created.models.filter((m) => m.uri.scheme === 'code-tab').at(-1)!, root: r }
}

const place = (path: string, line: number, character: number, length = 3): LspLocation => ({ path, range: { start: { line, character }, end: { line, character: character + length } } })
type Provider = { provideDefinition?: (m: unknown, p: unknown) => Promise<{ uri: FakeUri; range: unknown }[]>; provideReferences?: (m: unknown, p: unknown) => Promise<{ uri: FakeUri; range: unknown }[]> }
const definitionOf = (language = 'typescript') => registered.definition.get(language) as Required<Pick<Provider, 'provideDefinition'>>
const referencesOf = (language = 'typescript') => registered.references.get(language) as Required<Pick<Provider, 'provideReferences'>>
const opener = () => registered.openers[0] as { openCodeEditor: (source: unknown, resource: FakeUri, sel?: unknown) => boolean }

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  resetFakeMonaco()
  Object.defineProperty(window, 'yaseenDocs', { configurable: true, writable: true, value: { readFile, lsp, window: { onFlush: () => () => undefined } } })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  setLanguageHelpers(true)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container.remove()
  _resetRenameContinuity()
  vi.useRealTimers()
  vi.clearAllMocks()
  setLanguageHelpers(false)
})

describe('the switch: "Jump across files", off by default (YAZ-3500)', () => {
  const offByDefault = (): void => {
    setLanguageHelpers(false)
  }

  it('S1: off, a code tab never opens its file with a helper, and a Cmd+click on an imported name opens no other file', async () => {
    offByDefault()
    const { model } = await opened()
    expect(lsp.open).not.toHaveBeenCalled()
    // Monaco's one-file worker answers: the import's own line, never math.ts.
    const worker = { getDefinitionAtPosition: vi.fn(async (fileName: string) => [{ fileName, textSpan: { start: 9, length: 3 } }, { fileName: 'file:///vault/src/math.ts', textSpan: { start: 16, length: 3 } }]) }
    Object.assign(monaco, { typescript: { getTypeScriptWorker: async () => async () => worker } })
    Object.assign(model, { getOffsetAt: () => 40, getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }) })
    const answer = await definitionOf().provideDefinition(model, { lineNumber: 3, column: 22 })
    expect(answer).toEqual([{ uri: model.uri, range: new monaco.Range(1, 10, 1, 13) }])
    expect(lsp.definition).not.toHaveBeenCalled()
    expect(readFile).toHaveBeenCalledTimes(1) // the tab's own file only: no preview of math.ts
    delete (monaco as Record<string, unknown>).typescript
  })

  it('S2: off, Cmd+click on a name defined in the same file jumps inside it (Monaco\'s one-file help)', async () => {
    offByDefault()
    const { model } = await opened()
    const worker = { getReferencesAtPosition: vi.fn(async (fileName: string) => [{ fileName, textSpan: { start: 0, length: 5 } }, { fileName, textSpan: { start: 30, length: 5 } }]) }
    Object.assign(monaco, { typescript: { getTypeScriptWorker: async () => async () => worker } })
    Object.assign(model, { getOffsetAt: () => 30, getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }) })
    const answer = await referencesOf().provideReferences(model, { lineNumber: 1, column: 31 })
    expect(answer.map((l) => l.uri)).toEqual([model.uri, model.uri])
    expect(lsp.references).not.toHaveBeenCalled()
    delete (monaco as Record<string, unknown>).typescript
  })

  it('S3/S4: turned on, every open code tab opens its file; turned off, every tab closes it at once', async () => {
    offByDefault()
    files['/vault/app.py'] = 'print(1)\n'
    await opened()
    const second = document.createElement('div')
    document.body.appendChild(second)
    const other = await opened('/vault/app.py', second)
    expect(lsp.open).not.toHaveBeenCalled()
    act(() => setLanguageHelpers(true))
    await settle()
    expect(lsp.open.mock.calls.map(([req]) => req.path).sort()).toEqual(['/vault/app.py', A])
    act(() => setLanguageHelpers(false))
    await settle()
    expect((lsp.close.mock.calls as unknown as [string][]).map(([h]) => h).sort()).toEqual([`h:/vault/app.py`, `h:${A}`])
    // Off again: a request asks no helper.
    await definitionOf().provideDefinition(created.models.find((m) => m.uri.path === A && m.uri.scheme === 'code-tab')!, { lineNumber: 1, column: 1 })
    expect(lsp.definition).not.toHaveBeenCalled()
    act(() => other.root.unmount())
    second.remove()
  })

  it('a tab that closes while the switch is off sends nothing; the text it had is what a later switch-on sends', async () => {
    offByDefault()
    const { model } = await opened()
    act(() => model.type('edited while off'))
    act(() => setLanguageHelpers(true))
    await settle()
    expect(lsp.open).toHaveBeenCalledWith({ root: ROOT, path: A, text: 'edited while off' })
  })

  it('S5: off, a .py tab has its Outline from the text, and no helper', async () => {
    offByDefault()
    files['/vault/shapes.py'] = 'class Shape:\n    def area(self):\n        return 0\n\n\ndef make():\n    return Shape()\n'
    const { editor, model } = await opened('/vault/shapes.py')
    const symbols = await readSymbols(editor as never, model as never)
    // Python answers symbols, never a packed TS tree (YAZ-3501).
    if (!Array.isArray(symbols)) throw new Error('expected Python symbols')
    expect((symbols as readonly CodeSymbol[]).map((s) => [s.name, s.children?.map((c) => c.name) ?? []])).toEqual([
      ['Shape', ['area']],
      ['make', []],
    ])
    expect(lsp.open).not.toHaveBeenCalled()
  })
})

describe('the tab and its helper', () => {
  it('opens the file with its text when the tab mounts, and closes it when the tab closes', async () => {
    await opened()
    expect(lsp.open).toHaveBeenCalledWith({ root: ROOT, path: A, text: A_TEXT })
    act(() => root?.unmount())
    root = null
    await settle()
    expect(lsp.close).toHaveBeenCalledWith(`h:${A}`)
  })

  it('a file no helper takes is never opened there', async () => {
    files['/vault/data.json'] = '{}'
    await opened('/vault/data.json')
    expect(lsp.open).not.toHaveBeenCalled()
  })

  it(`sends the whole text ${SYNC_DEBOUNCE_MS} ms after the last edit, not on each keystroke`, async () => {
    const { model } = await opened()
    act(() => model.type('a'))
    act(() => model.type('ab'))
    await act(async () => void vi.advanceTimersByTime(SYNC_DEBOUNCE_MS - 50))
    act(() => model.type('abc'))
    await act(async () => void vi.advanceTimersByTime(SYNC_DEBOUNCE_MS - 50))
    expect(lsp.change).not.toHaveBeenCalled()
    await act(async () => void vi.advanceTimersByTime(60))
    await settle()
    expect(lsp.change).toHaveBeenCalledTimes(1)
    expect(lsp.change).toHaveBeenCalledWith(`h:${A}`, 'abc')
  })

  it('a request sends a pending edit first', async () => {
    const { model } = await opened()
    act(() => model.type('edited'))
    await definitionOf().provideDefinition(model, { lineNumber: 1, column: 1 })
    expect(lsp.change).toHaveBeenCalledWith(`h:${A}`, 'edited')
    expect(lsp.change.mock.invocationCallOrder[0]).toBeLessThan(lsp.definition.mock.invocationCallOrder[0])
  })
})

describe('definition and references', () => {
  it('asks the helper at the LSP position, and answers the tab\'s own model for its own file and a preview model for another', async () => {
    const { model } = await opened()
    lsp.definition.mockResolvedValueOnce([place(MATH, 0, 16), place(A, 0, 9)])
    const answer = await definitionOf().provideDefinition(model, { lineNumber: 3, column: 22 })
    expect(lsp.definition).toHaveBeenCalledWith({ handle: `h:${A}`, position: { line: 2, character: 21 } })
    expect(answer.map((l) => [l.uri.toString(), l.range])).toEqual([
      ['file://' + MATH, new monaco.Range(1, 17, 1, 20)],
      [model.uri.toString(), new monaco.Range(1, 10, 1, 13)],
    ])
    const preview = created.models.find((m) => m.uri.scheme === 'file')!
    expect(preview.getValue()).toBe(files[MATH])
  })

  it('references keep the places whose file has a preview; a file that cannot be read has no row', async () => {
    const { model } = await opened()
    lsp.references.mockResolvedValueOnce([place(A, 2, 21), place('/vault/src/b.ts', 0, 0), place('/vault/src/gone.ts', 0, 0)])
    const answer = await referencesOf().provideReferences(model, { lineNumber: 3, column: 22 })
    expect(answer.map((l) => l.uri.toString())).toEqual([model.uri.toString(), 'file:///vault/src/b.ts'])
  })

  it('null from the helper (down, no project) falls back to Monaco\'s worker, in this file only', async () => {
    const { model } = await opened()
    const worker = {
      getDefinitionAtPosition: vi.fn(async (fileName: string) => [
        { fileName, textSpan: { start: 0, length: 3 } },
        { fileName: 'file:///lib.d.ts', textSpan: { start: 0, length: 3 } },
      ]),
    }
    Object.assign(monaco, { typescript: { getTypeScriptWorker: async () => async () => worker } })
    Object.assign(model, { getOffsetAt: () => 40, getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }) })
    lsp.definition.mockResolvedValueOnce(null)
    const answer = await definitionOf().provideDefinition(model, { lineNumber: 3, column: 22 })
    expect(worker.getDefinitionAtPosition).toHaveBeenCalledWith(model.uri.toString(), 40)
    expect(answer).toEqual([{ uri: model.uri, range: new monaco.Range(1, 1, 1, 4) }])
    delete (monaco as Record<string, unknown>).typescript
  })

  it(`keeps at most ${MAX_PREVIEWS} preview models, and drops them all with the last tab`, async () => {
    const { model } = await opened()
    const many = Array.from({ length: MAX_PREVIEWS + 5 }, (_, i) => `/vault/gen/f${i}.ts`)
    for (const p of many) files[p] = `// ${p}\n`
    lsp.references.mockResolvedValueOnce(many.slice(0, 10).map((p) => place(p, 0, 0)))
    await referencesOf().provideReferences(model, { lineNumber: 1, column: 1 })
    lsp.references.mockResolvedValueOnce(many.slice(10).map((p) => place(p, 0, 0)))
    await referencesOf().provideReferences(model, { lineNumber: 1, column: 1 })
    const live = () => created.models.filter((m) => m.uri.scheme === 'file' && !m.isDisposed())
    expect(live()).toHaveLength(MAX_PREVIEWS)
    // The oldest went first: the second call's files are all there.
    expect(live().map((m) => m.uri.path)).toEqual(expect.arrayContaining(many.slice(10)))
    act(() => root?.unmount())
    root = null
    expect(live()).toHaveLength(0)
  })
})

describe('the jump opens the file in this tab (D10)', () => {
  it('Cmd+click on a place in another file opens it through onOpenFile, and the new tab shows the place', async () => {
    const { editor } = await opened()
    expect(opener().openCodeEditor(editor, monaco.Uri.file(MATH), { startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 6 })).toBe(true)
    expect(onOpenFile).toHaveBeenCalledWith(MATH)
    // The app's navigate replaces this tab's file: the new code tab mounts and takes the place.
    act(() => root?.unmount())
    root = createRoot(container)
    const next = await opened(MATH)
    expect(next.editor.position).toEqual({ lineNumber: 2, column: 3 })
    expect(next.editor.revealed).toEqual([{ lineNumber: 2, column: 3 }])
  })

  it('a tab already open on the file shows the place at once', async () => {
    const { editor } = await opened()
    const other = document.createElement('div')
    document.body.appendChild(other)
    const mathTab = await opened(MATH, other)
    expect(opener().openCodeEditor(editor, monaco.Uri.file(MATH), { lineNumber: 1, column: 17 })).toBe(true)
    expect(mathTab.editor.position).toEqual({ lineNumber: 1, column: 17 })
    act(() => mathTab.root.unmount())
    other.remove()
  })

  it('the place is used once: a tab already on the file takes it, so a later new tab on that file opens at its start', async () => {
    const { editor } = await opened()
    const other = document.createElement('div')
    const later = document.createElement('div')
    document.body.append(other, later)
    const mathTab = await opened(MATH, other)
    expect(opener().openCodeEditor(editor, monaco.Uri.file(MATH), { lineNumber: 1, column: 17 })).toBe(true)
    await act(async () => void vi.advanceTimersByTime(10))
    const next = await opened(MATH, later)
    expect(next.editor.position).toBeNull()
    act(() => mathTab.root.unmount())
    act(() => next.root.unmount())
    other.remove()
    later.remove()
  })

  it('a tab on the file that closes as the jump lands (the file moves from the right panel to this tab) leaves the place for the new tab', async () => {
    const { editor } = await opened()
    const other = document.createElement('div')
    const moved = document.createElement('div')
    document.body.append(other, moved)
    const right = await opened(MATH, other)
    expect(opener().openCodeEditor(editor, monaco.Uri.file(MATH), { lineNumber: 2, column: 3 })).toBe(true)
    act(() => right.root.unmount())
    await act(async () => void vi.advanceTimersByTime(10))
    const next = await opened(MATH, moved)
    expect(next.editor.position).toEqual({ lineNumber: 2, column: 3 })
    act(() => next.root.unmount())
    other.remove()
    moved.remove()
  })

  it('the peek box\'s own editor opens through the tab last focused; a stub or a non-file target does not open', async () => {
    const { editor } = await opened()
    act(() => editor.focus())
    expect(opener().openCodeEditor({ peek: true }, monaco.Uri.file('/vault/src/b.ts'))).toBe(true)
    expect(onOpenFile).toHaveBeenCalledWith('/vault/src/b.ts')
    onOpenFile.mockClear()
    expect(opener().openCodeEditor(editor, monaco.Uri.file('/vault/.venv/lib/x.pyi'))).toBe(true)
    expect(opener().openCodeEditor(editor, monaco.Uri.from({ scheme: 'inmemory', authority: '', path: '/x.ts' }))).toBe(false)
    expect(onOpenFile).not.toHaveBeenCalled()
  })
})

describe('Python (YAZ-3455)', () => {
  it('the helper gives the hover of a Python file', async () => {
    files['/vault/app.py'] = 'print(1)\n'
    const { model } = await opened('/vault/app.py')
    lsp.hover.mockResolvedValueOnce({ contents: '```python\ndef print()\n```', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } } } as never)
    const hover = await (registered.hover.get('python') as { provideHover: (m: unknown, p: unknown) => Promise<unknown> }).provideHover(model, { lineNumber: 1, column: 2 })
    expect(hover).toEqual({ contents: [{ value: '```python\ndef print()\n```' }], range: new monaco.Range(1, 1, 1, 6) })
  })
})
