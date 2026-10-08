/**
 * The vault right-click menu's items (YAZ-1798 D7), tested pure: which items a vault gets, in
 * which groups, and what each hands its handler. `ContextMenu.test.tsx` owns the drawing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MenuAction, MenuParent, MenuSection } from './menuSections'
import { buildVaultMenuSections, buildVaultSetMenuSections, type VaultMenuHandlers, type VaultMenuTarget } from './vaultMenuSections'

const OTHER = '/v/Émojis 🚀 & spaces'
/** A target as the switcher builds it: the folder name, no display name set. */
const target = (over: Partial<VaultMenuTarget> = {}): VaultMenuTarget => ({ path: OTHER, name: 'Émojis 🚀 & spaces', isCurrent: false, renamed: false, keyed: [], ...over })

function handlers(): VaultMenuHandlers {
  return { onOpenHere: vi.fn(), onAddHere: vi.fn(), onRename: vi.fn(), onResetName: vi.fn(), onSetKey: vi.fn(), onReveal: vi.fn(), onOpenVsCode: vi.fn(), onRemove: vi.fn(), onNotice: vi.fn() }
}

/** The non-empty groups' labels — what `ContextMenu` draws, a hairline between each. */
const groupsOf = (sections: MenuSection[]) => sections.filter((s) => s.length > 0).map((s) => s.map((i) => i.label))
const item = (sections: MenuSection[], id: string) => sections.flat().find((i) => i.id === id) as MenuAction
/** The "Set shortcut" flyout's two groups (YAZ-2555 D2): the nine numbers, then "No shortcut". */
const keyFlyout = (sections: MenuSection[]) => (sections.flat().find((i) => i.id === 'key') as MenuParent).children

function installClipboard(fail?: Error) {
  const writeText = vi.fn(async () => {
    if (fail !== undefined) throw fail
  })
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return writeText
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('buildVaultMenuSections (YAZ-1798 D7)', () => {
  it('another vault: Add to this window, Open in this window · Set display name, Set shortcut · the two copies · Reveal and VS Code · Remove — five groups in that order', () => {
    expect(groupsOf(buildVaultMenuSections(target(), handlers()))).toEqual([
      ['Add to this window', 'Open in this window'],
      ['Set display name', 'Set shortcut'],
      ['Copy vault name', 'Copy path'],
      ['Reveal in Finder', 'Open in VS Code'],
      ['Remove from recent vaults'],
    ])
  })

  it('Open in this window names its hotkey, ⇧⏎ (YAZ-1974 D8)', () => {
    expect(item(buildVaultMenuSections(target(), handlers()), 'open-here').hint).toBe('⇧⏎')
  })

  it('a renamed vault also offers Reset to folder name, beside Set display name (YAZ-1974 D5) — Set shortcut stays below both (YAZ-2555 S13)', () => {
    expect(groupsOf(buildVaultMenuSections(target({ name: 'Launch', renamed: true }), handlers()))).toEqual([
      ['Add to this window', 'Open in this window'],
      ['Set display name', 'Reset to folder name', 'Set shortcut'],
      ['Copy vault name', 'Copy path'],
      ['Reveal in Finder', 'Open in VS Code'],
      ['Remove from recent vaults'],
    ])
  })

  it('the current vault: no Open in this window (you are there) and no Remove (it would come straight back, D3) — the display name items and Set shortcut stay', () => {
    expect(groupsOf(buildVaultMenuSections(target({ isCurrent: true }), handlers()))).toEqual([
      ['Set display name', 'Set shortcut'],
      ['Copy vault name', 'Copy path'],
      ['Reveal in Finder', 'Open in VS Code'],
    ])
    expect(groupsOf(buildVaultMenuSections(target({ isCurrent: true, renamed: true }), handlers()))).toEqual([
      ['Set display name', 'Reset to folder name', 'Set shortcut'],
      ['Copy vault name', 'Copy path'],
      ['Reveal in Finder', 'Open in VS Code'],
    ])
  })

  it('nothing is danger-styled and nothing is disabled — Remove only forgets an MRU entry', () => {
    const all = buildVaultMenuSections(target({ renamed: true }), handlers()).flat()
    expect(all.some((i) => i.danger === true || (i as MenuAction).disabled === true)).toBe(false)
  })

  it('each verb hands its handler the vault path', () => {
    const h = handlers()
    const sections = buildVaultMenuSections(target({ renamed: true }), h)
    for (const [id, fn] of [
      ['open-here', h.onOpenHere],
      ['rename', h.onRename],
      ['reset-name', h.onResetName],
      ['reveal', h.onReveal],
      ['open-vscode', h.onOpenVsCode],
      ['remove', h.onRemove],
    ] as const) {
      item(sections, id).onSelect()
      expect(fn).toHaveBeenCalledWith(OTHER)
    }
  })

  it('Set shortcut (YAZ-2555 D2, S13–S17): ⌘1–⌘9, each with the vault that has the number or "free", a check mark on this vault\'s own; No shortcut only while it has one', () => {
    const keyed = [
      { key: 1, path: '/v/Main', name: 'Main vault' },
      { key: 5, path: OTHER, name: 'Launch' },
    ]
    const h = handlers()
    const [numbers, none] = keyFlyout(buildVaultMenuSections(target({ name: 'Launch', renamed: true, keyed }), h))
    expect(numbers.map((i) => `${i.label} ${i.hint}`)).toEqual(['⌘1 Main vault', '⌘2 free', '⌘3 free', '⌘4 free', '⌘5 ✓ Launch', '⌘6 free', '⌘7 free', '⌘8 free', '⌘9 free'])
    expect(none.map((i) => i.label)).toEqual(['No shortcut'])
    numbers[0].onSelect() // S15: a number that a different vault has is offered like a free one — no confirm
    expect(h.onSetKey).toHaveBeenLastCalledWith(OTHER, 1)
    none[0].onSelect()
    expect(h.onSetKey).toHaveBeenLastCalledWith(OTHER, null)
    // A vault with no number: no check mark anywhere, and nothing to clear.
    const [bare, noNone] = keyFlyout(buildVaultMenuSections(target({ keyed: [keyed[0]] }), h))
    expect(bare.map((i) => i.hint)).toEqual(['Main vault', 'free', 'free', 'free', 'free', 'free', 'free', 'free', 'free'])
    expect(noNone).toEqual([])
  })

  it('Copy vault name writes the display name verbatim and confirms (YAZ-1974 D4)', async () => {
    const writeText = installClipboard()
    const h = handlers()
    item(buildVaultMenuSections(target({ name: '🚀 Launch', renamed: true }), h), 'copy-name').onSelect()
    await vi.waitFor(() => expect(h.onNotice).toHaveBeenCalledWith('Copied vault name'))
    expect(writeText).toHaveBeenCalledWith('🚀 Launch')
  })

  it('Copy path writes the absolute path and confirms', async () => {
    const writeText = installClipboard()
    const h = handlers()
    item(buildVaultMenuSections(target({ isCurrent: true, name: 'Launch', renamed: true }), h), 'copy-path').onSelect()
    await vi.waitFor(() => expect(h.onNotice).toHaveBeenCalledWith('Copied path'))
    expect(writeText).toHaveBeenCalledWith(OTHER)
  })

  it('a clipboard the OS refused is reported, never silent', async () => {
    installClipboard(new Error('denied'))
    const h = handlers()
    item(buildVaultMenuSections(target(), h), 'copy-path').onSelect()
    await vi.waitFor(() => expect(h.onNotice).toHaveBeenCalledWith("Can't copy path: denied"))
  })
})

/** "Add to this window" (YAZ-2602 D2, S8): above "Open in this window", on a vault that is not in the window. */
describe('Add to this window (YAZ-2602 S8)', () => {
  it('a vault that is not in this window: "Add to this window" stands above "Open in this window", and hands its path over', () => {
    const h = handlers()
    const sections = buildVaultMenuSections(target(), h)
    expect(groupsOf(sections)[0]).toEqual(['Add to this window', 'Open in this window'])
    item(sections, 'add-here').onSelect()
    expect(h.onAddHere).toHaveBeenCalledExactlyOnceWith(OTHER)
    expect(h.onOpenHere).not.toHaveBeenCalled()
  })

  it('a vault that is in this window has neither item, and no Remove', () => {
    const labels = groupsOf(buildVaultMenuSections(target({ isCurrent: true }), handlers())).flat()
    expect(labels).toEqual(['Set display name', 'Set shortcut', 'Copy vault name', 'Copy path', 'Reveal in Finder', 'Open in VS Code'])
  })
})

/** A saved workspace's menu (YAZ-2602 D8, S67): the row of the ⌘O list's "Workspaces" group. */
describe('buildVaultSetMenuSections (YAZ-2602 S67)', () => {
  it('"Rename", then "Remove from workspaces": one group, nothing danger-styled, and each hands its handler the workspace\'s id', () => {
    const h = { onRename: vi.fn(), onRemove: vi.fn() }
    const sections = buildVaultSetMenuSections('set-1', h)
    expect(groupsOf(sections)).toEqual([['Rename', 'Remove from workspaces']])
    expect(sections.flat().some((i) => i.danger === true || (i as MenuAction).disabled === true)).toBe(false)
    item(sections, 'rename-set').onSelect()
    expect(h.onRename).toHaveBeenCalledExactlyOnceWith('set-1')
    expect(h.onRemove).not.toHaveBeenCalled()
    item(sections, 'remove-set').onSelect()
    expect(h.onRemove).toHaveBeenCalledExactlyOnceWith('set-1')
  })
})
