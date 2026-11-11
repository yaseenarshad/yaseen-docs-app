import { Fragment, useContext, useState, type ReactNode } from 'react'
import { FlyoutParent, MenuFlyout, useFlyout } from '../../components/Flyout'
import { PageActions } from '../../lib/pageActions'
import { CopyIcon, EyeIcon, HeartIcon } from './icons'
import { FileIcon } from '../../sidebar/FileIcon'
import { api, BridgeRequestError } from '../../api'
import { ContextMenuSurface } from '../../components/ContextMenuSurface'
import { rowPage } from '../../links/shortcuts'
import { OtherFilesFolderMove, OtherFilesMove, movesToOtherFiles } from './otherFilesMove'
import { ShortcutActions } from './shortcutDoors'

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
  // A whole subfolder (YAZ-4747 OF1): the one directly under the page that holds this row.
  const folderTray = useContext(OtherFilesFolderMove)
  const subfolder = folderTray?.folderOf(path) ?? null
  const doors = useContext(PageActions)
  const lists = doors?.listState?.(page) ?? null
  const flyout = useFlyout<string>()
  // YAZ-4797 demo: a note row's shortcut items, on a folder page of a vault with IDs; a folder row has none (only notes are shortcuts).
  const shortcuts = useContext(ShortcutActions)
  const noteRow = movesToOtherFiles(path) && shortcuts !== null && !shortcuts.locked(path)
  const home = noteRow ? shortcuts.homeOf(path) : null
  const [folderQuery, setFolderQuery] = useState('')
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
  // "Open in ›" (the sidebar's verbs: right panel, VS Code, the default app | Reveal in Finder). "Open in new window" is out of it,
  // after "Open in new tab" (YAZ-4778: used often enough), as the sidebar's file menu has it.
  // Three sections (YAZ-3746 13AZ): in this app (right panel, new window) | in another app (VS Code, the default app) |
  // Reveal in Finder.
  const inApp: ReactNode[] = [
    ...(onOpenRight === undefined ? [] : [item('Right panel', () => onOpenRight(path), undefined, true)]),
  ]
  const otherApps: ReactNode[] = [
    ...(doors?.openVsCode === undefined ? [] : [item('VS Code', () => doors.openVsCode!(page), undefined, true)]),
    ...(doors?.openDefault === undefined ? [] : [item('Default app', () => doors.openDefault!(page), undefined, true)]),
  ]
  const actions = (
    <>
      {onOpen !== undefined && item('Open', () => onOpen(path))}
      {onOpenBackground !== undefined && item('Open in new tab', () => onOpenBackground(path))}
      {doors?.openNewWindow !== undefined && item('Open in new window', () => doors.openNewWindow!(page))}
      {onOpenWindow !== undefined && item('Open in mini window', () => onOpenWindow(path), '⇧↩')}
      <FlyoutParent label="Open in" open={flyout.open === 'open-in'} onHover={() => flyout.hover('open-in')} onOpen={() => flyout.openNow('open-in')} onCloseFlyout={() => flyout.openNow(null)}>
        {[inApp, otherApps]
          .filter((section) => section.length > 0)
          .map((section, i) => (
            <div key={i} className="ctx-menu__group" role="group">
              {section.map((n, k) => <Fragment key={k}>{n}</Fragment>)}
            </div>
          ))}
        <div className="ctx-menu__group" role="group">
          {item('Reveal in Finder', reveal, undefined, true)}
        </div>
      </FlyoutParent>
    </>
  )
  /**
   * "Move to Other files" (D46; YAZ-4747 OF1): a note of the page itself moves at a click. A note in a subfolder gets the
   * sidebar's "New note ›" kind of parent: a click still moves the note; its flyout names the note and the folder. A
   * folder row moves its folder (its own row IS the folder, so the words need no name).
   */
  const trayItems = (): ReactNode[] => {
    if (!movesToOtherFiles(path)) return folderTray !== null && subfolder !== null && subfolder.dir === page ? [item('Move to Other files', () => folderTray.move(subfolder.dir))] : []
    if (moveToTray === null) return []
    if (folderTray === null || subfolder === null) return [item('Move to Other files', () => moveToTray(path))]
    return [
      <FlyoutParent
        key="to-tray"
        label="Move to Other files"
        open={flyout.open === 'to-tray'}
        onHover={() => flyout.hover('to-tray')}
        onOpen={() => flyout.openNow('to-tray')}
        onCloseFlyout={() => flyout.openNow(null)}
        onChoose={run(() => moveToTray(path))}
      >
        <div className="ctx-menu__group" role="group">
          {item(<span className="ctx-menu__label"><FileIcon path={path} />{title} (note)</span>, () => moveToTray(path), undefined, true)}
          {item(<span className="ctx-menu__label"><FileIcon path={subfolder.dir} folder />{subfolder.name} (folder)</span>, () => folderTray.move(subfolder.dir), undefined, true)}
        </div>
      </FlyoutParent>,
    ]
  }
  /**
   * The shortcut items (YAZ-4797 demo): on a shortcut row, "Go to where it lives" and "Remove shortcut from <page>" (the
   * note stays where it lives); on every note row, "Add shortcut to ›", the vault's folders with a search box, less the
   * folder it lives in and this page.
   */
  const shortcutItems = (): ReactNode[] => {
    if (!noteRow || shortcuts === null) return []
    const needle = folderQuery.trim().toLowerCase()
    const held = shortcuts.holders(path)
    const choices = shortcuts
      .folders()
      // Every folder that shows the note already: where it lives, and each one it is a shortcut in, this page too (checker 8A).
      .filter((f) => !held.has(f.dir))
      .filter((f) => needle === '' || f.name.toLowerCase().includes(needle) || f.path.toLowerCase().includes(needle))
    return [
      ...(home === null
        ? []
        : [
            item(<span className="ctx-menu__label"><FileIcon path={home.dir} folder />Go to where it lives ({home.name})</span>, () => shortcuts.goHome(home.dir)),
            item(`Remove shortcut from ${shortcuts.pageName}`, () => shortcuts.remove(path)),
          ]),
      <FlyoutParent key="add-shortcut" label="Add shortcut to" open={flyout.open === 'add-shortcut'} onHover={() => flyout.hover('add-shortcut')} onOpen={() => flyout.openNow('add-shortcut')} onCloseFlyout={() => flyout.openNow(null)}>
        <div className="ctx-menu__group" role="group">
          <input
            className="view-input ctx-menu__search"
            type="search"
            placeholder="Search folders"
            aria-label="Search folders"
            value={folderQuery}
            // The keyboard goes to the box as the flyout opens (a mount), so typing filters at once.
            ref={(el) => {
              if (el !== null && el.dataset.focused === undefined) {
                el.dataset.focused = ''
                requestAnimationFrame(() => el.focus({ preventScroll: true }))
              }
            }}
            onChange={(e) => setFolderQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter' && choices[0] !== undefined) {
                onClose()
                shortcuts.add(path, choices[0].dir)
              }
            }}
          />
        </div>
        <div className="ctx-menu__group ctx-menu__group--scroll" role="group">
          {choices.slice(0, 50).map((f) => (
            <Fragment key={f.dir}>{item(<span className="ctx-menu__label"><FileIcon path={f.dir} folder />{f.name}</span>, () => shortcuts.add(path, f.dir), undefined, true)}</Fragment>
          ))}
          {choices.length === 0 && <span className="ctx-menu__empty">No folder matches</span>}
        </div>
      </FlyoutParent>,
    ]
  }
  // The page itself (13AW, as the tab menu has them): Favorites, Focus, Copy path, then Move to Other files.
  const pageGroup: ReactNode[] = [
    ...(lists === null || doors?.toggleFavorite === undefined
      ? []
      : [item(<span className="ctx-menu__label"><HeartIcon />{lists.favorite ? 'Remove from favorites' : 'Add to favorites'}</span>, () => doors.toggleFavorite!([page], lists.favorite))]),
    ...(lists === null || doors?.toggleFocus === undefined
      ? []
      : [item(<span className="ctx-menu__label"><EyeIcon />{lists.focus ? 'Remove from focus' : 'Add to focus'}</span>, () => doors.toggleFocus!([page], lists.focus))]),
    item(<span className="ctx-menu__label"><CopyIcon />Copy path</span>, copyPath),
    ...shortcutItems(),
    ...trayItems(),
  ]
  // Keys for the rows of each list (the open items and the shortcut items): React warned on the arrays (YAZ-4797 test).
  const groups = [...(extra ?? []), <Fragment key="page">{pageGroup.map((n, k) => <Fragment key={k}>{n}</Fragment>)}</Fragment>, ...(danger === undefined || danger === null ? [] : [danger])]

  return (
    <ContextMenuSurface x={x} y={y} onClose={onClose}>
      <MenuFlyout.Provider value={flyout}>
        {/* The groups' line between them is `.ctx-menu__group + .ctx-menu__group` (app.css). */}
        <div className="ctx-menu__group" role="group">
          {actions}
        </div>
        {groups.map((group, i) => (
          <div key={i} className="ctx-menu__group" role="group">
            {Array.isArray(group) ? group.map((n, k) => <Fragment key={k}>{n}</Fragment>) : group}
          </div>
        ))}
      </MenuFlyout.Provider>
    </ContextMenuSurface>
  )
}
