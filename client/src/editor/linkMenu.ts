/**
 * One right-click menu for every link (YAZ-3609 D23): a `[[link]]` of any kind and a Markdown link
 * show the same rows in the same order (YAZ-3740). A row a link cannot do is left out.
 *
 *   AR v2 plan                 labels: the page's name (and its vault, D22), then its ID
 *   YAS-466
 *   ───────────
 *   Open                       as a click does
 *   Open in new tab            as a ⌘-click does: a background tab
 *   Show in sidebar            its row in Files (D5): a page, file or folder that is there
 *   ───────────
 *   Copy name and ID           an ID link: "AR v2 plan (YAS-466)", the hint; other links "Copy name"
 *   Copy ID                    ID links only
 *   Copy path                  the target's path on disk
 *   Copy address               a web link: its href
 *   ───────────
 *   Add to favorites           "Remove from favorites" when it is one; as the tab menu (S5)
 *   Add to focus               "Remove from focus" likewise
 *   Open in ▸                  New window (files) · VS Code · Default app ─ Reveal in Finder (S3, S4)
 *   ───────────
 *   Edit link                  not in a read-only note
 *   Remove link                keeps the text the link shows
 *
 * The place rows (Show in sidebar to Open in) are only for a target that is there. A missing note shows
 * (Missing note) (YAS-466) and Copy ID; an ID of another vault (INL-4) (ID from the … vault) and Copy ID
 * (YAZ-3905). No "Copy link": a selected pill and ⌘C copy a working link. The popup is
 * `blockHandleMenu.ts`'s (`renderMenu`), with its flyout for "Open in ▸" (YAZ-3901).
 */
import { fileKind } from '@shared/fileKind'
import { closeSubmenu, renderMenu, type MenuRow } from './blockHandleMenu'
import type { ListState } from '../lists/useVaultListsHere'

/**
 * What App lets a link menu do with the link's target (YAZ-3740): the tab menu's and the sidebar's doors. Each one
 * absent leaves its row out. The editor reads them when a menu opens.
 */
export interface LinkActions {
  /** "Show in sidebar" (D5): App's `showInSidebar`. */
  showInSidebar?: (path: string) => void
  /** Where the path stands in Focus and Favorites, as the tab menu reads it; null hides both rows. */
  listState?: (path: string) => ListState | null
  toggleFavorite?: (paths: string[], isOn: boolean) => void
  toggleFocus?: (paths: string[], isOn: boolean) => void
  /** "Open in ▸": the sidebar's verbs (`menuSections.ts` `openIn`). */
  openNewWindow?: (path: string) => void
  openVsCode?: (path: string) => void
  openDefault?: (path: string) => void
  reveal?: (path: string) => void
}

/** A copy row: what it copies is its grey hint too. */
export interface CopyRow {
  hint: string
  run: () => void
}

/** A list toggle: its state when the menu opened, and the toggle. */
export interface ListRow {
  on: boolean
  run: () => void
}

export interface LinkMenu {
  /** Rows that only say something: the page's name, then its ID. */
  labels: string[]
  open?: () => void
  openNew?: () => void
  showInSidebar?: () => void
  /** "Copy name and ID" of an ID link that is found (S8's text); else "Copy name". Never both. */
  copyNameAndId?: CopyRow
  copyName?: CopyRow
  copyId?: CopyRow
  copyPath?: () => void
  /** A web link's href. */
  copyAddress?: () => void
  favorite?: ListRow
  focus?: ListRow
  /** "Open in ▸": no child, no row. */
  openIn?: { newWindow?: () => void; vsCode?: () => void; defaultApp?: () => void; reveal?: () => void }
  /** Left out in a read-only note, with `remove`. */
  edit?: () => void
  remove?: () => void
}

export function linkMenuRows(menu: LinkMenu): MenuRow[] {
  const rows: MenuRow[] = menu.labels.map((label) => ({ label, disabled: true, run: () => {} }))
  const group = (list: Array<MenuRow | null>) => {
    const kept = list.filter((row): row is MenuRow => row !== null)
    if (kept.length > 0) rows.push({ ...kept[0]!, divider: true }, ...kept.slice(1))
  }
  const row = (label: string, run: (() => void) | undefined, danger?: true): MenuRow | null => (run === undefined ? null : { label, run, danger })
  const copy = (label: string, copied: CopyRow | undefined): MenuRow | null => (copied === undefined ? null : { label, run: copied.run, hint: copied.hint })
  // The flyout's groups, an empty one kept: `renderMenu` leaves it out.
  const children = [
    [row('New window', menu.openIn?.newWindow), row('VS Code', menu.openIn?.vsCode), row('Default app', menu.openIn?.defaultApp)],
    [row('Reveal in Finder', menu.openIn?.reveal)],
  ].map((list) => list.filter((child): child is MenuRow => child !== null))
  group([row('Open', menu.open), row('Open in new tab', menu.openNew), row('Show in sidebar', menu.showInSidebar)])
  group([copy('Copy name and ID', menu.copyNameAndId), copy('Copy name', menu.copyName), copy('Copy ID', menu.copyId), row('Copy path', menu.copyPath), row('Copy address', menu.copyAddress)])
  group([
    menu.favorite === undefined ? null : { label: menu.favorite.on ? 'Remove from favorites' : 'Add to favorites', run: menu.favorite.run },
    menu.focus === undefined ? null : { label: menu.focus.on ? 'Remove from focus' : 'Add to focus', run: menu.focus.run },
    children.every((list) => list.length === 0) ? null : { label: 'Open in', run: () => {}, children },
  ])
  group([row('Edit link', menu.edit), row('Remove link', menu.remove, true)])
  return rows
}

/**
 * The place rows of a link whose target is there (YAZ-3740): `path` and the App doors it has. A folder (no file kind)
 * has no "New window", as in the sidebar. Every one absent leaves its row out.
 */
export function placeRows(path: string, actions: LinkActions | undefined, onNotice: (message: string) => void, copy?: (text: string) => Promise<void> | void): Pick<LinkMenu, 'showInSidebar' | 'copyPath' | 'favorite' | 'focus' | 'openIn'> {
  const a = actions ?? {}
  const file = fileKind(path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)) !== null
  const lists = a.listState?.(path) ?? null
  const bind = (run: ((path: string) => void) | undefined) => (run === undefined ? undefined : () => run(path))
  return {
    showInSidebar: bind(a.showInSidebar),
    copyPath: () => copyText(path, 'path', onNotice, copy),
    favorite: lists === null || a.toggleFavorite === undefined ? undefined : { on: lists.favorite, run: () => a.toggleFavorite?.([path], lists.favorite) },
    focus: lists === null || a.toggleFocus === undefined ? undefined : { on: lists.focus, run: () => a.toggleFocus?.([path], lists.focus) },
    openIn: { newWindow: file ? bind(a.openNewWindow) : undefined, vsCode: bind(a.openVsCode), defaultApp: bind(a.openDefault), reveal: bind(a.reveal) },
  }
}

/**
 * Opens `rows` in `parent` at the pointer, clamped to the viewport. Closes on a row click, an
 * outside mousedown, a scroll, Escape and window blur; returns the close for the caller's own reasons.
 * One at a time is the caller's to keep.
 */
export function openMenuAt(parent: HTMLElement, x: number, y: number, rows: MenuRow[]): () => void {
  const close = () => {
    closeSubmenu(popup) // its wait for the pointer goes with it
    document.removeEventListener('mousedown', onMouseDown, true)
    document.removeEventListener('scroll', close, true)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('blur', close)
    popup.remove()
  }
  const onMouseDown = (event: MouseEvent) => {
    if (!(event.target instanceof Node && popup.contains(event.target))) close()
  }
  // Escape's first press closes an open flyout alone, as in the sidebar's menu (YAZ-3901); the next closes the menu.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !closeSubmenu(popup)) close()
  }
  const popup = renderMenu(parent, rows, close)
  const rect = popup.getBoundingClientRect()
  popup.style.left = `${Math.max(0, Math.min(x, window.innerWidth - rect.width))}px`
  popup.style.top = `${Math.max(0, Math.min(y, window.innerHeight - rect.height))}px`
  document.addEventListener('mousedown', onMouseDown, true)
  document.addEventListener('scroll', close, true)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('blur', close)
  return close
}

/** Copies `text` and says so through `onNotice` either way, as "Copy ID" does: "Copied path", "Can't copy path: …". */
export function copyText(text: string, what: string, onNotice: (message: string) => void, copy: (text: string) => Promise<void> | void = (t) => navigator.clipboard.writeText(t)): void {
  const failed = (error: unknown) => onNotice(`Can't copy ${what}: ${error instanceof Error ? error.message : String(error)}`)
  try {
    void Promise.resolve(copy(text)).then(() => onNotice(`Copied ${what}`), failed)
  } catch (error) {
    failed(error)
  }
}
