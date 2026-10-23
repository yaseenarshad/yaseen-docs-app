import { describe, expect, it, vi } from 'vitest'
import { MAX_WINDOW_ROOTS, type RestoreSessionResult } from '@shared/types'
import { restoreSession, skippedText, type RestoreDeps } from './restoreSession'

/** A window that shows `roots`, and an `addVault` that takes a folder unless it is named in `refuse` or the window is full. */
function deps(answer: RestoreSessionResult, roots: string[], refuse: string[] = []) {
  const window = [...roots]
  const d = {
    restore: vi.fn(async (_id: string) => answer),
    roots: () => window,
    addVault: vi.fn(async (root: string) => {
      if (refuse.includes(root) || window.length >= MAX_WINDOW_ROOTS) return false
      window.push(root)
      return true
    }),
    openStored: vi.fn(),
    notify: vi.fn(),
  } satisfies RestoreDeps
  return { d, window }
}

describe('restoreSession (YAZ-3147 D3)', () => {
  it('S21: a vault the window does not show joins it, and its tabs open with the others in ONE call; all opened → no notice', async () => {
    const tabs = [{ path: '/v/a.md', active: true as const }, { path: '/w/b.md', name: 'Bee' }, { path: '/w/b.md' }]
    const { d, window } = deps({ tabs, roots: ['/v', '/w'], missing: [] }, ['/v'])
    await restoreSession('s1', d)
    expect(d.restore).toHaveBeenCalledExactlyOnceWith('s1')
    expect(d.addVault.mock.calls).toEqual([['/w']])
    expect(window).toEqual(['/v', '/w'])
    expect(d.openStored).toHaveBeenCalledExactlyOnceWith(tabs)
    expect(d.notify).not.toHaveBeenCalled()
  })

  it('S20, S22, S23: a gone file and a vault that cannot join keep their tabs closed, and ONE notice counts them all (a copy counts again)', async () => {
    const { d } = deps({ tabs: [{ path: '/v/a.md' }, { path: '/x/c.md' }, { path: '/x/c.md' }], roots: ['/v', '/x'], missing: ['/v/gone.md', '/y/d.md'] }, ['/v'], ['/x'])
    await restoreSession('s1', d)
    expect(d.addVault.mock.calls).toEqual([['/x']])
    expect(d.openStored).toHaveBeenCalledExactlyOnceWith([{ path: '/v/a.md' }])
    expect(d.notify).toHaveBeenCalledExactlyOnceWith("4 tabs did not open: the file is gone or its vault can't join")
    expect(skippedText(1)).toBe("1 tab did not open: the file is gone or its vault can't join")
  })

  it('S22: a window with 8 vaults takes no ninth; a tab under a vault the window shows needs no join; S24: all gone opens nothing and counts all', async () => {
    const eight = Array.from({ length: MAX_WINDOW_ROOTS }, (_, i) => `/v${i}`)
    const full = deps({ tabs: [{ path: '/v0/a.md' }, { path: '/n/b.md' }], roots: ['/v0', '/n'], missing: [] }, eight)
    await restoreSession('s1', full.d)
    expect(full.d.addVault.mock.calls).toEqual([['/n']])
    expect(full.d.openStored).toHaveBeenCalledExactlyOnceWith([{ path: '/v0/a.md' }])
    expect(full.d.notify).toHaveBeenCalledExactlyOnceWith(skippedText(1))

    // The session's vault is a folder inside the window's vault: the window's vault holds the tab.
    const nested = deps({ tabs: [{ path: '/v/sub/a.md' }], roots: ['/v/sub'], missing: [] }, ['/v'])
    await restoreSession('s1', nested.d)
    expect(nested.d.addVault).not.toHaveBeenCalled()
    expect(nested.d.openStored).toHaveBeenCalledExactlyOnceWith([{ path: '/v/sub/a.md' }])

    // A vault whose tabs are all gone does not join.
    const gone = deps({ tabs: [], roots: ['/w'], missing: ['/w/a.md', '/w/b.md'] }, ['/v'])
    await restoreSession('s1', gone.d)
    expect(gone.d.addVault).not.toHaveBeenCalled()
    expect(gone.d.openStored).toHaveBeenCalledExactlyOnceWith([])
    expect(gone.d.notify).toHaveBeenCalledExactlyOnceWith(skippedText(2))
  })
})
