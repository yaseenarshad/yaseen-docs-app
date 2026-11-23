/**
 * The folder page's value history (YAZ-4612 S41) as a list: a toast's Undo moves its step to the redo list exactly as
 * ⌘Z does (YAZ-4637 T9e), and the pages a step writes follow a rename and retire on a delete (T3).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dropAllHistories, dropHistoryPaths, pageRef, renameHistoryPaths, valueHistory } from './valueHistory'

beforeEach(() => dropAllHistories())

describe('undoStep (YAZ-4637 T9e)', () => {
  it('undoes THAT step and moves it to redo, wherever it is in the past; a step already undone is left alone', () => {
    const history = valueHistory('/p')
    const a = { undo: vi.fn(), redo: vi.fn() }
    const b = { undo: vi.fn(), redo: vi.fn() }
    history.push(a)
    history.push(b)
    expect(history.undoStep(a)).toBe(true)
    expect(a.undo).toHaveBeenCalledTimes(1)
    expect(history.undoStep(a)).toBe(false) // not in the past any more
    expect(a.undo).toHaveBeenCalledTimes(1)
    // ⇧⌘Z redoes it, as the latest step; ⌘Z then undoes it again, and the next ⌘Z reaches b.
    expect(history.redo()).toBe(true)
    expect(a.redo).toHaveBeenCalledTimes(1)
    expect(history.undo()).toBe(true)
    expect(a.undo).toHaveBeenCalledTimes(2)
    expect(history.undo()).toBe(true)
    expect(b.undo).toHaveBeenCalledTimes(1)
  })

  it('a step with no redo (New row below) leaves nothing to redo', () => {
    const history = valueHistory('/p')
    const step = { undo: vi.fn() }
    history.push(step)
    expect(history.undoStep(step)).toBe(true)
    expect(history.redo()).toBe(false)
  })
})

describe('the pages of a step follow a rename and retire on a delete (YAZ-4637 T3)', () => {
  it('a file rename moves the exact path; a folder rename moves every path under it; the rest stay', () => {
    const history = valueHistory('/p')
    const [a, b, c] = [pageRef('/v/f/a.md'), pageRef('/v/f/sub/b.md'), pageRef('/v/g/c.md')]
    history.push({ undo: vi.fn(), pages: [a, b] })
    history.push({ undo: vi.fn(), redo: vi.fn(), pages: [c] })
    renameHistoryPaths('/v/f/a.md', '/v/f/Title.md')
    expect(a.path).toBe('/v/f/Title.md')
    renameHistoryPaths('/v/f', '/v/F2')
    expect([a.path, b.path, c.path]).toEqual(['/v/F2/Title.md', '/v/F2/sub/b.md', '/v/g/c.md'])
  })

  it('a delete retires the path (null), in the redo list too, so an Undo or Redo writes nothing there', () => {
    const history = valueHistory('/p')
    const a = pageRef('/v/f/a.md')
    const b = pageRef('/v/f/b.md')
    history.push({ undo: vi.fn(), pages: [a] })
    history.push({ undo: vi.fn(), redo: vi.fn(), pages: [b] })
    history.undo() // b to the redo list; a stays in the past
    dropHistoryPaths('/v/f')
    expect([a.path, b.path]).toEqual([null, null])
  })
})
