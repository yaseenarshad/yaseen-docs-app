/**
 * The code Outline's feed (YAZ-3486): the symbols are read at once, then 300 ms after the LAST edit
 * (never per keystroke, S12); a stale answer is thrown away; a failed read keeps the last tree; Off
 * reads nothing; a marker change is a new snapshot with no read (S6).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../monaco', () => import('../monacoTestKit'))

import { FakeEditor, FakeModel, resetFakeMonaco, setMarkers } from '../monacoTestKit'
import { attachOutlineFeed, READ_DELAY_MS } from './outlineFeed'
import type { CodeSymbol } from './outlineModel'

const sym = (name: string, line: number): CodeSymbol => ({ name, kind: 11, range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 20 }, selectionRange: { startLineNumber: line, startColumn: 10, endLineNumber: line, endColumn: 14 } })
const uri = { scheme: 'code-tab', authority: 't1', path: '/v/a.ts', fsPath: '/v/a.ts', toString: () => 'code-tab://t1/v/a.ts' }

let model: FakeModel
let editor: FakeEditor
beforeEach(() => {
  vi.useFakeTimers()
  resetFakeMonaco()
  model = new FakeModel('function a() {}\n', uri)
  editor = new FakeEditor(document.createElement('div'), { model })
})
afterEach(() => vi.useRealTimers())

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('attachOutlineFeed', () => {
  it('reads at once, then once 300 ms after the last of many edits', async () => {
    const read = vi.fn(async () => [sym('a', 1)])
    const feed = attachOutlineFeed(editor as never, model as never, read)
    await flush()
    expect(read).toHaveBeenCalledTimes(1)
    expect(feed.getState().tree!.name).toEqual(['a'])
    for (let i = 0; i < 10; i++) {
      model.type(`function a${i}() {}`)
      vi.advanceTimersByTime(100)
    }
    // Ten keystrokes 100 ms apart: no read yet.
    expect(read).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(READ_DELAY_MS)
    await flush()
    expect(read).toHaveBeenCalledTimes(2)
    feed.dispose()
  })

  it('throws away an answer a newer read overtook, and keeps the last tree when a read fails', async () => {
    const answers: ((s: CodeSymbol[] | null) => void)[] = []
    const read = vi.fn(() => new Promise<readonly CodeSymbol[] | null>((resolve) => answers.push(resolve)))
    const feed = attachOutlineFeed(editor as never, model as never, read)
    model.type('x')
    vi.advanceTimersByTime(READ_DELAY_MS)
    answers[1]([sym('new', 1)])
    await flush()
    answers[0]([sym('old', 1)])
    await flush()
    expect(feed.getState().tree!.name).toEqual(['new'])
    model.type('y')
    vi.advanceTimersByTime(READ_DELAY_MS)
    answers[2](null)
    await flush()
    expect(feed.getState().tree!.name).toEqual(['new'])
    // An empty answer: the file has no symbol now, so no Outline.
    model.type('z')
    vi.advanceTimersByTime(READ_DELAY_MS)
    answers[3]([])
    await flush()
    expect(feed.getState().tree).toBeNull()
    feed.dispose()
  })

  it('Off reads nothing; turning it on reads at once', async () => {
    const read = vi.fn(async () => [sym('a', 1)])
    const feed = attachOutlineFeed(editor as never, model as never, read, false)
    model.type('x')
    vi.advanceTimersByTime(READ_DELAY_MS * 3)
    await flush()
    expect(read).not.toHaveBeenCalled()
    feed.setActive(true)
    await flush()
    expect(read).toHaveBeenCalledTimes(1)
    feed.setActive(false)
    model.type('y')
    vi.advanceTimersByTime(READ_DELAY_MS * 3)
    expect(read).toHaveBeenCalledTimes(1)
    feed.dispose()
  })

  it('a change of this model\'s markers is a new snapshot, with no read', async () => {
    const read = vi.fn(async () => [sym('a', 1)])
    const feed = attachOutlineFeed(editor as never, model as never, read)
    await flush()
    const heard = vi.fn()
    feed.subscribe(heard)
    setMarkers(model, [{ severity: 8, startLineNumber: 1, startColumn: 3 }])
    expect(heard).toHaveBeenCalledTimes(1)
    expect(feed.getState().markers).toMatchObject([{ severity: 8, startLineNumber: 1 }])
    expect(read).toHaveBeenCalledTimes(1)
    feed.dispose()
  })
})
