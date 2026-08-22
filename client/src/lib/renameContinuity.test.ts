import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  _resetRenameContinuity,
  carryEditorAcrossRename,
  flushRenamedPath,
  registerRenameContinuity,
  takeRenameBuffer,
  type RenameContinuityHandle,
} from './renameContinuity'

afterEach(() => _resetRenameContinuity())

const handle = (over: Partial<RenameContinuityHandle> = {}): RenameContinuityHandle => ({
  flush: vi.fn(async () => undefined),
  capture: vi.fn(() => null),
  retire: vi.fn(),
  ...over,
})

describe('renameContinuity (Links E1, GRO-2194)', () => {
  it('flushRenamedPath flushes the registered handle and resolves without one', async () => {
    const h = handle()
    registerRenameContinuity('/v/a.md', h)
    await flushRenamedPath('/v/a.md')
    expect(h.flush).toHaveBeenCalledTimes(1)
    await expect(flushRenamedPath('/v/other.md')).resolves.toBeUndefined()
  })

  it('carryEditorAcrossRename stashes a DIRTY buffer under the NEW path and retires the old handle', () => {
    const h = handle({ capture: vi.fn(() => ({ frontmatter: '---\nk: 1\n---\n', body: 'dirty body' })) })
    registerRenameContinuity('/v/old.md', h)
    carryEditorAcrossRename('/v/old.md', '/v/new.md')
    expect(h.retire).toHaveBeenCalledTimes(1)
    expect(takeRenameBuffer('/v/new.md')).toEqual({ frontmatter: '---\nk: 1\n---\n', body: 'dirty body' })
    expect(takeRenameBuffer('/v/new.md')).toBeNull() // consumed exactly once
  })

  it('a CLEAN editor is retired without stashing anything (nothing to carry, nothing to resurrect)', () => {
    const h = handle()
    registerRenameContinuity('/v/old.md', h)
    carryEditorAcrossRename('/v/old.md', '/v/new.md')
    expect(h.retire).toHaveBeenCalledTimes(1)
    expect(takeRenameBuffer('/v/new.md')).toBeNull()
  })

  it('no editor at the old path is a no-op; unregister removes only its own handle', () => {
    carryEditorAcrossRename('/v/old.md', '/v/new.md') // must not throw
    const first = handle()
    const off = registerRenameContinuity('/v/a.md', first)
    const second = handle()
    registerRenameContinuity('/v/a.md', second) // remount replaced the handle
    off() // stale unregister must not drop the replacement
    carryEditorAcrossRename('/v/a.md', '/v/b.md')
    expect(second.retire).toHaveBeenCalledTimes(1)
    expect(first.retire).not.toHaveBeenCalled()
  })
})
