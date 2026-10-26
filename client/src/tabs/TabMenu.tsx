import { api, BridgeRequestError } from '../api'
import { ContextMenu } from '../sidebar/ContextMenu'
import { EyeIcon, HeartIcon } from '../views/view/icons'
import type { MenuAction, MenuSection } from '../sidebar/menuSections'

/** An open tab menu: where it stands, the tab it is about, and that tab's review state as it was when the menu opened. */
export interface TabMenuAt {
  x: number
  y: number
  /** The tab's own id (YAZ-2940 D1): a copy's menu is about that copy. */
  id: string
  /** The page it shows: every file action of the menu takes this. */
  path: string
  /** Whether the note is in review; null for a path that is no note in the index, which hides the item. */
  review: boolean | null
  /** The tab has a display name (YAZ-2949 D3): offers "Reset to page name". */
  named: boolean
  /**
   * Whether the page is in Focus and in Favorites (YAZ-3264 D2), read when the menu opened (S14).
   * Absent or null hides both items: a page in no vault of the window, or one whose lists are not read yet (S7, S8).
   */
  lists?: { focus: boolean; favorite: boolean } | null
}

/** One other open window that can take this tab (YAZ-3091 D2): its id for main, and its row text (D7). */
export interface MoveTarget {
  id: string
  label: string
}

export interface TabMenuProps {
  menu: TabMenuAt
  /** The tab as the menu's notices name it. */
  label: string
  onClose: () => void
  /** Context-menu equivalent of dragging this tab into the right panel: "Move to ▸ Right panel" (YAZ-3091 D3). */
  onMoveToRight?: (path: string) => void
  /** The other windows that show this page's vault (YAZ-3091 D2), read only while the menu is open: the top of "Move to ▸". */
  moveTargets?: readonly MoveTarget[]
  /** "Move to ▸ <window>" (YAZ-3091 D1): the tab goes to the open window `to` — the page by path, and only this tab (by id) closes here. */
  onMoveToWindow?: (to: string, path: string, id: string) => void
  /** A window row under the pointer or the keyboard lights up that window (YAZ-3091 D8); `null` puts it out. */
  onHighlightWindow?: (to: string | null) => void
  /** "Move to new window" (YAZ-2933): the tab leaves for a window of its own — the page by path, and only this tab (by id) closes here (YAZ-2940 S16). */
  onMoveToNewWindow?: (path: string, id: string) => void
  /** "Duplicate tab" (YAZ-2940 D5): a copy of this tab, by id, opens right after it in this window. */
  onDuplicate?: (id: string) => void
  /** "Set display name" (YAZ-2949 D3, D4): the tab's name turns into a field where it was right-clicked. */
  onRename?: (id: string) => void
  /** "Reset to page name" (YAZ-2949 D3): the tab shows its page's own name again. */
  onResetName?: (id: string) => void
  /** Reveal this exact tab in the sidebar without activating it. */
  onShowInSidebar?: (path: string) => void
  onSetReview?: (path: string, on: boolean) => void
  /** "Add to focus" / "Remove from focus" (YAZ-3264 D2): App's lists (D1), with the state the menu read. No jump to the Focus tab (D3). */
  onToggleFocus?: (paths: string[], isOn: boolean) => void
  /** "Add to favorites" / "Remove from favorites" (YAZ-3264 D2), as `onToggleFocus`. */
  onToggleFavorite?: (paths: string[], isOn: boolean) => void
  /** Where a failed OS action says so (YAZ-963) — App's passive notice. */
  onNotice?: (message: string) => void
  /** Items before the menu's own groups, and after them (YAZ-3343, the tab board's cards: "Go to tab", "Close tab"). */
  leading?: MenuAction[]
  trailing?: MenuAction[]
}

/**
 * A tab's right-click menu, in ONE place (YAZ-2648): the strip's tabs and the board's pages are
 * the same open files, so they offer the same items — the sidebar row's Copy path (YAZ-922) and
 * its OS actions (YAZ-963: Reveal in Finder, Open in VS Code), Show in sidebar, the move to a
 * new window (YAZ-2933), "Duplicate tab" (YAZ-2940) and "Move to ▸" another window or the right panel (YAZ-3091), the tab's
 * display name (YAZ-2949), the review toggle (YAZ-2322), and Focus and Favorites (YAZ-3264). Drawn as data by the sidebar's own
 * `ContextMenu` (YAZ-2949 D6), so its groups have the same lines as every other menu of the app.
 */
export function TabMenu({ menu, label, onClose, onMoveToRight, moveTargets = [], onMoveToWindow, onHighlightWindow, onMoveToNewWindow, onDuplicate, onRename, onResetName, onShowInSidebar, onSetReview, onToggleFocus, onToggleFavorite, onNotice, leading = [], trailing = [] }: TabMenuProps) {
  /**
   * The menu's OS actions (YAZ-963), the sidebar's `reveal` idiom on a tab: read-only, so there is
   * nothing to confirm or repair — but a STALE tab (deleted or moved externally) rejects `NOT_FOUND`,
   * and without the notice the item would just look broken. Both messages are the caller's, because
   * "reveal" and "open … in VS Code" name the gesture differently in each half.
   */
  const osAction = (call: Promise<unknown>, stale: string, failed: string): void => {
    call.catch((err: unknown) => {
      onNotice?.(err instanceof BridgeRequestError && err.code === 'NOT_FOUND' ? stale : `${failed}: ${err instanceof Error ? err.message : String(err)}`)
    })
  }
  // "Move to ▸" (YAZ-3091 D3): the other windows, a line, then "Right panel". An empty group is left out, and with no group there is no item.
  const moveTo: MenuAction[][] = [
    onMoveToWindow === undefined ? [] : moveTargets.map((t) => ({ id: `move-window:${t.id}`, label: t.label, onSelect: () => onMoveToWindow(t.id, menu.path, menu.id), onPreview: (on: boolean) => onHighlightWindow?.(on ? t.id : null) })),
    onMoveToRight === undefined ? [] : [{ id: 'move-right', label: 'Right panel', onSelect: () => onMoveToRight(menu.path) }],
  ].filter((group) => group.length > 0)
  // Four groups (YAZ-2949 D6), in this order: the tab's place · find the file · this tab
  // and its note · outside the app. `ContextMenu` skips an empty group and closes the menu after each item.
  // The two list toggles (YAZ-3264 D2) stand where the sidebar's file menu has them: focus right after
  // "Show in sidebar", favorites first in the last group, each with its sidebar tab's glyph (D6). Each acts on the state the menu read (S14).
  const lists = menu.lists ?? null
  const sections: MenuSection[] = [
    leading,
    [
      ...(onMoveToNewWindow === undefined ? [] : [{ id: 'new-window', label: 'Move to new window', onSelect: () => onMoveToNewWindow(menu.path, menu.id) }]),
      // Right after "Move to new window" (YAZ-2940 D5).
      ...(onDuplicate === undefined ? [] : [{ id: 'duplicate', label: 'Duplicate tab', onSelect: () => onDuplicate(menu.id) }]),
      ...(moveTo.length === 0 ? [] : [{ id: 'move-to', label: 'Move to', children: moveTo }]),
    ],
    [
      { id: 'show-in-sidebar', label: 'Show in sidebar', onSelect: () => onShowInSidebar?.(menu.path) },
      ...(lists === null || onToggleFocus === undefined ? [] : [{ id: 'focus', label: lists.focus ? 'Remove from focus' : 'Add to focus', icon: <EyeIcon />, onSelect: () => onToggleFocus([menu.path], lists.focus) }]),
      { id: 'copy-path', label: 'Copy path', onSelect: () => void navigator.clipboard.writeText(menu.path) },
    ],
    [
      // Never "Rename": that word renames on disk in the file menu (YAZ-2949 D3, the vault menu's words).
      ...(onRename === undefined ? [] : [{ id: 'rename', label: 'Set display name', onSelect: () => onRename(menu.id) }]),
      ...(menu.named && onResetName !== undefined ? [{ id: 'reset-name', label: 'Reset to page name', onSelect: () => onResetName(menu.id) }] : []),
      // The review toggle (YAZ-2322): a tab that is not a note — or any tab while upkeep is off — has no state and no item.
      ...(menu.review === null ? [] : [{ id: 'review', label: menu.review ? 'Turn review off' : 'Turn review on', onSelect: () => onSetReview?.(menu.path, !menu.review) }]),
    ],
    [
      ...(lists === null || onToggleFavorite === undefined ? [] : [{ id: 'toggle-favorite', label: lists.favorite ? 'Remove from favorites' : 'Add to favorites', icon: <HeartIcon />, onSelect: () => onToggleFavorite([menu.path], lists.favorite) }]),
      { id: 'reveal', label: 'Reveal in Finder', onSelect: () => osAction(api.shell.reveal({ path: menu.path }), `Can't reveal "${label}" — it is no longer there`, "Can't reveal") },
      { id: 'open-vscode', label: 'Open in VS Code', onSelect: () => osAction(api.shell.openVsCode({ path: menu.path }), `Can't open "${label}" in VS Code — it is no longer there`, "Can't open in VS Code") },
    ],
  ]
  return <ContextMenu x={menu.x} y={menu.y} sections={[...sections, trailing]} onClose={onClose} />
}
