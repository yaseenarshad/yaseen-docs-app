import { errorText, type MenuAction, type MenuSection } from './menuSections'

/**
 * The vault right-click menu AS DATA (YAZ-1798 D2/D7): GitHub Desktop's repository menu, kept to
 * what means something for a vault. Drawn by the sidebar's own `ContextMenu`, which skips empty
 * groups — so the CURRENT vault simply returns three of the five. Five groups, in this order:
 *
 *   Open in this window · Set display name, Reset to folder name, Set shortcut ▸ · Copy vault name,
 *   Copy path · Reveal in Finder, Open in VS Code · Remove from recent vaults
 *
 * The current vault (the header's name, or its own row) gets neither "Open in this window" (you
 * are there) nor "Remove" (it is recents[0] and would come straight back, D3). "Reset to folder
 * name" shows only while a display name is set (YAZ-1974 D5) — never "Rename": that word renames
 * on disk in the file menu. Nothing is `danger`: Remove only forgets an MRU entry, the folder is untouched.
 *
 * "Set shortcut" (YAZ-2555 D2) is a parent: its flyout lists ⌘1–⌘9, each with the name of the vault
 * that has the number or "free", and a check mark on this vault's own. A number that a different
 * vault has is offered like a free one — picking it moves it here, no confirm. "No shortcut", in
 * its own group, shows only while this vault has a number.
 */
export interface VaultMenuTarget {
  path: string
  /** The vault's display name, else its folder name (YAZ-1974 D4) — what "Copy vault name" copies. */
  name: string
  isCurrent: boolean
  /** A display name is set (YAZ-1974 D5): offers "Reset to folder name". */
  renamed: boolean
  /** Every vault that has a number (YAZ-2555 D2), this one included — who the "Set shortcut" flyout names beside each number. */
  keyed: readonly { key: number; path: string; name: string }[]
}

export interface VaultMenuHandlers {
  /** Switch THIS window to the vault in place (D8, D11) — the one deliberate overwrite; every plain gesture opens beside. */
  onOpenHere: (path: string) => void
  /** Turn the vault's name into an inline field where it stands (YAZ-1974 D5). */
  onRename: (path: string) => void
  /** Drop the display name — back to the folder name (D5). */
  onResetName: (path: string) => void
  /** Give the vault a number, 1–9, or `null` for none (YAZ-2555 D2); the store takes it from the vault that had it. */
  onSetKey: (path: string, key: number | null) => void
  onReveal: (path: string) => void
  onOpenVsCode: (path: string) => void
  /** Forget the MRU entry (D3): no confirm, the folder on disk is untouched. */
  onRemove: (path: string) => void
  /** The sidebar's passive notice — every copy confirms or reports, the `menuSections` idiom (D9). */
  onNotice: (message: string) => void
}

/** A clipboard copy that says what it did — or why it could not. */
const copyItem = (id: string, what: string, text: string, h: VaultMenuHandlers): MenuAction => ({
  id,
  label: `Copy ${what}`,
  onSelect: () => {
    void navigator.clipboard.writeText(text).then(
      () => h.onNotice(`Copied ${what}`),
      (error: unknown) => h.onNotice(`Can't copy ${what}: ${errorText(error)}`),
    )
  },
})

export function buildVaultMenuSections({ path, name, isCurrent, renamed, keyed }: VaultMenuTarget, h: VaultMenuHandlers): MenuSection[] {
  /** What stands beside a number: its vault's name — checked when it is this vault — or "free". */
  const holder = (n: number): string => {
    const vault = keyed.find((v) => v.key === n)
    return vault === undefined ? 'free' : vault.path === path ? `✓ ${vault.name}` : vault.name
  }
  return [
    isCurrent ? [] : [{ id: 'open-here', label: 'Open in this window', hint: '⇧⏎', onSelect: () => h.onOpenHere(path) }],
    [
      { id: 'rename', label: 'Set display name', onSelect: () => h.onRename(path) },
      ...(renamed ? [{ id: 'reset-name', label: 'Reset to folder name', onSelect: () => h.onResetName(path) }] : []),
      {
        id: 'key',
        label: 'Set shortcut',
        children: [
          [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ id: `key-${n}`, label: `⌘${n}`, hint: holder(n), onSelect: () => h.onSetKey(path, n) })),
          keyed.some((v) => v.path === path) ? [{ id: 'key-none', label: 'No shortcut', onSelect: () => h.onSetKey(path, null) }] : [],
        ],
      },
    ],
    [copyItem('copy-name', 'vault name', name, h), copyItem('copy-path', 'path', path, h)],
    [
      { id: 'reveal', label: 'Reveal in Finder', onSelect: () => h.onReveal(path) },
      { id: 'open-vscode', label: 'Open in VS Code', onSelect: () => h.onOpenVsCode(path) },
    ],
    isCurrent ? [] : [{ id: 'remove', label: 'Remove from recent vaults', onSelect: () => h.onRemove(path) }],
  ]
}
