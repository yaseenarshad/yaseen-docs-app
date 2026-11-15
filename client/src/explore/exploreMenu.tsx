/**
 * The note menu of the explore stack (YAZ-2571 round 1, items 6 and 7; Yaseen's list): a right-click on a search
 * result, on a note layer's head, or in a reading note's text (after the text menu). Its rows are the sidebar's and
 * the tab menu's own, built here from the same doors (`LinkActions`, App's rename), so they stay the same:
 *
 *   Open in new tab · Open in new window · Open in mini window
 *   Show in sidebar · Add to focus › · Copy path
 *   Rename file (the tab menu's path: the file shows in the sidebar, and its own rename starts there)
 *   Add to favorites › · Reveal in Finder · Open in VS Code
 *
 * No display name, no icon, no delete ("we should not allow for delete"). After "Show in sidebar", the three opens
 * and "Rename file" the stack closes, so you see where it went; the others keep it open.
 */
import type { LinkActions } from '../editor/linkMenu'
import { copyText } from '../editor/linkMenu'
import { focusPlaces, scopeGroup, type MenuItem, type MenuSection } from '../sidebar/menuSections'
import { CopyIcon, EyeIcon, HeartIcon } from '../views/view/icons'
import { requestNoteWindow } from '../views/noteWindowRequest'

export interface ExploreMenuDoors {
  /** A new tab (App's `openNewTabPage`). */
  openInTab: (path: string) => void
  /** The sidebar's and the tab menu's doors: Show in sidebar, the lists, Open in new window, Reveal, VS Code. */
  linkActions?: LinkActions
  /** The tab menu's "Rename file" (App's `renameInSidebar`). */
  onRenameFile?: (path: string) => void
  onNotice: (message: string) => void
  /** The stack closes after a pick that goes somewhere else. */
  closeStack: () => void
}

/** Said when no folder page is on screen to hold the mini window. */
export const NO_FOLDER_PAGE_NOTICE = 'Open a folder page first: the mini window is its card.'

/** The note menu's sections for `path`, in Yaseen's order. */
export function exploreNoteSections(path: string, doors: ExploreMenuDoors): MenuSection[] {
  const a = doors.linkActions ?? {}
  const lists = a.listState?.(path) ?? null
  const then = (run: () => void): (() => void) => () => {
    run()
    doors.closeStack()
  }
  /** The flyouts' last group (YAZ-4460 demo): "Workspace" and "Vault", as the tab menu has them. */
  const scopeRows = (kind: 'focus' | 'favorites') => {
    const scopes = lists?.scopes?.[kind]
    const set = lists?.setScope
    return scopes === undefined || set === undefined ? [] : [scopeGroup(kind, scopes, (scope, on) => set(kind, [path], scope, on))]
  }
  const focus: MenuItem[] =
    lists === null || a.toggleFocus === undefined
      ? []
      : [
          {
            id: 'focus',
            label: lists.focus ? 'Remove from focus' : 'Add to focus',
            icon: <EyeIcon />,
            onSelect: () => a.toggleFocus?.([path], lists.focus),
            ...(lists.intoFolder === undefined ? {} : { children: [...focusPlaces(lists.folders ?? [], lists.focus ? (lists.folderId ?? null) : undefined, (to) => lists.intoFolder?.([path], to)), ...scopeRows('focus')] }),
          },
        ]
  const favorite: MenuItem[] =
    lists === null || a.toggleFavorite === undefined
      ? []
      : [
          {
            id: 'toggle-favorite',
            label: lists.favorite ? 'Remove from favorites' : 'Add to favorites',
            icon: <HeartIcon />,
            onSelect: () => a.toggleFavorite?.([path], lists.favorite),
            ...(lists.intoFavoriteFolder === undefined ? {} : { children: [...focusPlaces(lists.favoriteFolders ?? [], lists.favorite ? (lists.favoriteFolderId ?? null) : undefined, (to) => lists.intoFavoriteFolder?.([path], to), 'favorites'), ...scopeRows('favorites')] }),
          },
        ]
  return [
    [
      { id: 'open-tab', label: 'Open in new tab', onSelect: then(() => doors.openInTab(path)) },
      ...(a.openNewWindow === undefined ? [] : [{ id: 'open-window', label: 'Open in new window', onSelect: then(() => a.openNewWindow?.(path)) }]),
      {
        id: 'open-mini-window',
        label: 'Open in mini window',
        onSelect: () => {
          // The stack goes first: the folder page under it takes the card.
          doors.closeStack()
          if (!requestNoteWindow(path)) doors.onNotice(NO_FOLDER_PAGE_NOTICE)
        },
      },
    ],
    [...(a.showInSidebar === undefined ? [] : [{ id: 'show-in-sidebar', label: 'Show in sidebar', onSelect: then(() => a.showInSidebar?.(path)) }]), ...focus, { id: 'copy-path', label: 'Copy path', icon: <CopyIcon />, onSelect: () => void copyText(path, 'path', doors.onNotice) }],
    doors.onRenameFile === undefined ? [] : [{ id: 'rename-file', label: 'Rename file', onSelect: then(() => doors.onRenameFile?.(path)) }],
    [
      ...favorite,
      ...(a.reveal === undefined ? [] : [{ id: 'reveal', label: 'Reveal in Finder', onSelect: () => a.reveal?.(path) }]),
      ...(a.openVsCode === undefined ? [] : [{ id: 'open-vscode', label: 'Open in VS Code', onSelect: () => a.openVsCode?.(path) }]),
    ],
  ]
}
