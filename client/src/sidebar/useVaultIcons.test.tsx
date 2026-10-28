/**
 * The window's one-row icon picks (YAZ-3440 D8): each vault's `.yaseendocs/icons.json` read when it joins, read
 * again on `icons:changed` for it, dropped when it leaves; and `pick`, the one writer — optimistic, building on the
 * latest picks, refused past the cap, and on a failed write a toast and a read of what did save.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MAX_ICON_PATHS, type IconRule, type VaultIcons } from '@shared/vaultIcons'
import { loadMaterialIcons } from './materialIcons'
import { useVaultIcons, type VaultIconsHere } from './useVaultIcons'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** The `icons` bridge over `disk`: `get` answers from it, `set` writes it, `onChanged` keeps its listener. */
function installBridge(disk: Record<string, VaultIcons>) {
  let changed: ((change: { root: string }) => void) | null = null
  const icons = {
    get: vi.fn(async (root: string): Promise<VaultIcons> => structuredClone(disk[root] ?? { paths: {} })),
    set: vi.fn(async (root: string, next: VaultIcons): Promise<void> => {
      disk[root] = structuredClone(next)
    }),
    onChanged: vi.fn((listener: (change: { root: string }) => void) => {
      changed = listener
      return () => {
        changed = null
      }
    }),
  }
  Object.defineProperty(window, 'yaseenDocs', { value: { icons }, configurable: true, writable: true })
  return { icons, emit: (root: string) => act(async () => changed?.({ root })) }
}

let root: Root | null = null
let hook: VaultIconsHere | null = null
const onNotice = vi.fn()
const NO_RULES: IconRule[] = []
function Probe({ roots }: { roots: readonly string[] }) {
  hook = useVaultIcons(roots, NO_RULES, true, onNotice)
  return null
}
const here = (): VaultIconsHere => {
  if (hook === null) throw new Error('not mounted')
  return hook
}
async function mount(roots: readonly string[]) {
  root = createRoot(document.createElement('div'))
  await act(async () => root?.render(<Probe roots={roots} />))
  return { rerender: (next: readonly string[]) => act(async () => root?.render(<Probe roots={next} />)) }
}
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve)))

beforeEach(async () => {
  onNotice.mockReset()
  // Picks of ids Material ships only: its tables must be in.
  await loadMaterialIcons()
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  hook = null
})

describe('useVaultIcons (YAZ-3440 D8)', () => {
  it('reads each vault as it joins, again on its `icons:changed`, and drops a vault that leaves', async () => {
    const disk: Record<string, VaultIcons> = { '/a': { paths: { '/a/x.md': 'python' } }, '/b': { paths: { '/b/y.md': 'lua' } } }
    const { icons, emit } = installBridge(disk)
    const { rerender } = await mount(['/a'])
    expect(icons.get.mock.calls).toEqual([['/a']])
    expect(here().rowIcons.paths.get('/a/x.md')).toBe('python')

    await rerender(['/a', '/b'])
    expect(icons.get.mock.calls).toEqual([['/a'], ['/b']])
    expect(here().rowIcons.paths.get('/b/y.md')).toBe('lua')

    // Another window, a sync or a hand edit changed `/a`'s file.
    disk['/a'] = { paths: { '/a/x.md': 'rust' } }
    await emit('/a')
    expect(here().rowIcons.paths.get('/a/x.md')).toBe('rust')
    // A vault the window does not hold is not read.
    await emit('/elsewhere')
    expect(icons.get.mock.calls.map(([r]) => r)).not.toContain('/elsewhere')

    await rerender(['/b'])
    expect(here().rowIcons.paths.has('/a/x.md')).toBe(false)
    expect(here().rowIcons.paths.get('/b/y.md')).toBe('lua')
  })

  it("a pick shows at once and writes the vault's whole file; two picks in one tick both land; a clear removes the pick", async () => {
    const disk: Record<string, VaultIcons> = { '/a': { paths: { '/a/old.md': 'lua' } } }
    const { icons } = installBridge(disk)
    await mount(['/a'])
    act(() => {
      here().pick(['/a/one.md'], 'python')
      here().pick(['/a/two.md'], 'rust')
    })
    expect(here().rowIcons.paths.get('/a/one.md')).toBe('python')
    expect(here().rowIcons.paths.get('/a/two.md')).toBe('rust')
    await settle()
    expect(icons.set.mock.calls.at(-1)).toEqual(['/a', { paths: { '/a/old.md': 'lua', '/a/one.md': 'python', '/a/two.md': 'rust' } }])

    act(() => here().pick(['/a/old.md'], null))
    await settle()
    expect(disk['/a'].paths).toEqual({ '/a/one.md': 'python', '/a/two.md': 'rust' })
    // A vault root itself, or a path in no vault, has no pick.
    act(() => here().pick(['/a', '/nowhere/z.md'], 'python'))
    expect(icons.set).toHaveBeenCalledTimes(3) // one per pick: the two, then the clear
    expect(onNotice).not.toHaveBeenCalled()
  })

  it('a refused write toasts and shows what the file holds; a pick past the cap is refused at once', async () => {
    const disk: Record<string, VaultIcons> = { '/a': { paths: { '/a/kept.md': 'lua' } } }
    const { icons } = installBridge(disk)
    await mount(['/a'])
    icons.set.mockRejectedValueOnce(new Error('icons.json is malformed; fix or delete it'))
    act(() => here().pick(['/a/new.md'], 'python'))
    expect(here().rowIcons.paths.get('/a/new.md')).toBe('python')
    await settle()
    expect(onNotice).toHaveBeenCalledWith("Can't save the icon: icons.json is malformed; fix or delete it", 'error')
    expect(here().rowIcons.paths.has('/a/new.md')).toBe(false)
    expect(here().rowIcons.paths.get('/a/kept.md')).toBe('lua')

    onNotice.mockReset()
    disk['/a'] = { paths: Object.fromEntries(Array.from({ length: MAX_ICON_PATHS }, (_, k) => [`/a/n${k}.md`, 'lua'])) }
    act(() => root?.unmount())
    await mount(['/a'])
    const writes = icons.set.mock.calls.length
    act(() => here().pick(['/a/one-more.md'], 'python'))
    expect(onNotice).toHaveBeenCalledWith(`Can't save the icon: a vault holds ${MAX_ICON_PATHS} icons of its own at most`, 'error')
    expect(here().rowIcons.paths.has('/a/one-more.md')).toBe(false)
    expect(icons.set.mock.calls.length).toBe(writes)
    // A pick that replaces one does not grow the list: it saves.
    act(() => here().pick(['/a/n0.md'], 'python'))
    await settle()
    expect(icons.set.mock.calls.length).toBe(writes + 1)
  })
})
