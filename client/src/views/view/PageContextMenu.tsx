import { Fragment, useContext, type ReactNode } from 'react'
import { FlyoutParent, MenuFlyout, useFlyout } from '../../components/Flyout'
import { PageActions } from '../../lib/pageActions'
import { CopyIcon, EyeIcon, HeartIcon } from './icons'
import { api, BridgeRequestError } from '../../api'
import { ContextMenuSurface } from '../../components/ContextMenuSurface'
import { rowPage } from '../../links/shortcuts'
import { OtherFilesMove, movesToOtherFiles } from './otherFilesMove'

interface PageContextMenuProps {
  x: number
  y: number
  path: string
  /** The page's title, off the row's own index record (YAZ-2420 🔒 D14): what a notice calls it. */
  title: string
  /** "Open", in the current tab (YAZ-2420 🔒 D26): a table's, whose Name cell no longer opens on a click. */
  onOpen?: (path: string) => void
  onOpenRight?: (path: string) => void
  onOpenBackground?: (path: string) => void
  /** "Open in mini window ⇧↩" (YAZ-4547, D57; the key is YAZ-4605 D56): the card over the folder page. Every folder view passes it when the host has a note editor. */
  onOpenWindow?: (path: string) => void
  onNotice?: (message: string) => void
  onClose: () => void
  /** A surface's own items, each entry a group after the page actions: the folder table's edit groups, then its view groups (YAZ-4608 C8: open, edit, view, destructive). */
  extra?: ReactNode[]
  /** The destructive items, the LAST group (YAZ-4608 C8): the table's "Delete note…". After "Move to Other files". */
  danger?: ReactNode
}

/** Page actions shared by folder views; positioning and dismissal stay action-free. */
export function PageContextMenu({ x, y, path, title, onOpen, onOpenRight, onOpenBackground, onNotice, onClose, extra, danger, onOpenWindow }: PageContextMenuProps) {
  // A folder row's page is its folder (YAZ-4579 D32): Copy path and Reveal name the directory, not its hidden `.folder.md`.
  const page = rowPage(path)
  // "Move to Other files" (YAZ-4597 D46): its own group, after the surface's groups and before the destructive one (C8),
  // on a note row of a folder page whose tray takes moves.
  const moveToTray = useContext(OtherFilesMove)
  const doors = useContext(PageActions)
  const lists = doors?.listState?.(page) ?? null
  const flyout = useFlyout<string>()
  const run = (action: () => void) => () => {
    onClose()
    action()
  }
  /** A main-menu row closes an open flyout as the pointer rests on it; a row INSIDE a flyout must not (YAZ-3746 13BB). */
  const item = (label: ReactNode, action: () => void, hint?: string, inFlyout = false) => (
    <button type="button" className="ctx-menu__item" role="menuitem" data-hint={hint} onMouseEnter={inFlyout ? undefined : () => flyout.hover(null)} onClick={run(action)}>
      {label}
    </button>
  )
  const reveal = (): void => {
    if (doors?.reveal !== undefined) return doors.reveal(page)
    api.shell.reveal({ path: page }).catch((error: unknown) => {
      onNotice?.(
        error instanceof BridgeRequestError && error.code === 'NOT_FOUND'
          ? `Can't reveal "${title}" — it is no longer there`
          : `Can't reveal: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
  }
  const copyPath = (): void =>
    void navigator.clipboard.writeText(page).catch((error: unknown) => {
      onNotice?.(`Can't copy path: ${error instanceof Error ? error.message : String(error)}`)
    })

  // YAZ-3746 13AW, after the sidebar's and the tab's menus: the ways to open first, the rarer ones folded into
  // "Open in ›" (the sidebar's verbs: right panel, new window, VS Code, the default app | Reveal in Finder).
  // Three sections (YAZ-3746 13AZ): in this app (right panel, new window) | in another app (VS Code, the default app) |
  // Reveal in Finder.
  const inApp: ReactNode[] = [
    ...(onOpenRight === undefined ? [] : [item('Right panel', () => onOpenRight(path), undefined, true)]),
    ...(doors?.openNewWindow === undefined ? [] : [item('New window', () => doors.openNewWindow!(page), undefined, true)]),
  ]
  const otherApps: ReactNode[] = [
    ...(doors?.openVsCode === undefined ? [] : [item('VS Code', () => doors.openVsCode!(page), undefined, true)]),
    ...(doors?.openDefault === undefined ? [] : [item('Default app', () => doors.openDefault!(page), undefined, true)]),
  ]
  const actions = (
    <>
      {onOpen !== undefined && item('Open', () => onOpen(path))}
      {onOpenBackground !== undefined && item('Open in new tab', () => onOpenBackground(path))}
      {onOpenWindow !== undefined && item('Open in mini window', () => onOpenWindow(path), '⇧↩')}
      <FlyoutParent label="Open in" open={flyout.open === 'open-in'} onHover={() => flyout.hover('open-in')} onOpen={() => flyout.openNow('open-in')} onCloseFlyout={() => flyout.openNow(null)}>
        {[inApp, otherApps]
          .filter((section) => section.length > 0)
          .map((section, i) => (
            <div key={i} className="ctx-menu__group" role="group">
              {section}
            </div>
          ))}
        <div className="ctx-menu__group" role="group">
          {item('Reveal in Finder', reveal, undefined, true)}
        </div>
      </FlyoutParent>
    </>
  )
  // The page itself (13AW, as the tab menu has them): Favorites, Focus, Copy path, then Move to Other files.
  const pageGroup: ReactNode[] = [
    ...(lists === null || doors?.toggleFavorite === undefined
      ? []
      : [item(<span className="ctx-menu__label"><HeartIcon />{lists.favorite ? 'Remove from favorites' : 'Add to favorites'}</span>, () => doors.toggleFavorite!([page], lists.favorite))]),
    ...(lists === null || doors?.toggleFocus === undefined
      ? []
      : [item(<span className="ctx-menu__label"><EyeIcon />{lists.focus ? 'Remove from focus' : 'Add to focus'}</span>, () => doors.toggleFocus!([page], lists.focus))]),
    item(<span className="ctx-menu__label"><CopyIcon />Copy path</span>, copyPath),
    ...(moveToTray === null || !movesToOtherFiles(path) ? [] : [item('Move to Other files', () => moveToTray(path))]),
  ]
  const groups = [...(extra ?? []), <Fragment key="page">{pageGroup}</Fragment>, ...(danger === undefined || danger === null ? [] : [danger])]

  return (
    <ContextMenuSurface x={x} y={y} onClose={onClose}>
      <MenuFlyout.Provider value={flyout}>
        {/* The groups' line between them is `.ctx-menu__group + .ctx-menu__group` (app.css). */}
        <div className="ctx-menu__group" role="group">
          {actions}
        </div>
        {groups.map((group, i) => (
          <div key={i} className="ctx-menu__group" role="group">
            {group}
          </div>
        ))}
      </MenuFlyout.Provider>
    </ContextMenuSurface>
  )
}
