/**
 * PAGE LINKS IN A DRAWING (YAZ-4039 D7, D11). `[[Page]]` in a text box is a pill: the engine draws it with what
 * `resolve` says, and reports the pointer on it. Everything else is the note's own pieces, so a pill on a board works
 * as a pill in a note:
 *  - what it shows: `linkDisplayText` with the ID link's title (YAZ-2293) and the found page's name (YAZ-3778 D2, D3);
 *    a missing page is dim, and a missing ID of this vault says "Missing note · YAS-466" (YAZ-3905 S10),
 *  - a click: the open gestures of Settings › Hotkeys › "Links in a note" (`linkClickAction`, the #230 keys). A plain
 *    click is the board's (it selects the box); a read-only board keeps "a click opens", as a read-only note does,
 *  - opening: the editor's one follower (`wikilinkFollower`), which also makes a missing page,
 *  - hover: the page the pill opens, for the host's card (`useCardPreview`),
 *  - right-click: the host opens the one link menu (`linkMenuOf`), with Edit link and Remove link (D15),
 *  - making one (D12): the `[[` picker in the text editor (`drawingLinkPicker.ts`), and a pasted page path or
 *    `yaseendocs://` link as the link the picker writes (`drawingPasteLink`, the note's `pathPaste.ts`).
 *
 * A shape's own `link` (the engine's link icon) opens through the same follower when it is a `[[link]]` or a path of
 * this vault (`openShapeLink`). Every board of the window draws with one resolver over the window's vaults
 * (`windowLinkLook`).
 */
import { fileKind } from '@shared/fileKind'
import { gestureAction, type MouseMods } from '@shared/keys'
import { basename, rootOfPath } from '@shared/types'
import { linkFor, pastedPath } from '../editor/pathPaste'
import type { WikilinkCandidateSource } from '../editor/wikilink/wikilinkPicker'
import { linkClickAction } from '../editor/linkGesture'
import type { LinkFollow, WikilinkNav } from '../editor/wikilink/wikilinkClick'
import { idLinkTitle, linkDisplayText, linkIsResolved, linkNoteId, linkPageName, linkPath, missingId, type WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import type { ViewOnlyLinkSource } from '../editor/wikilink/viewOnlyLinkSource'
import { pathTitles } from '../lib/pageLabel'
import type { AnchorRect } from '../sidebar/previewPlacement'
import type { VaultLinks } from '../links/vaultLinks'
import type { IconsHere } from '../sidebar/FileIcon'
import { drawingLinkIcon, setDrawingLinkIcons, type PillIcon } from './drawingLinkIcons'
import type { PickerEditor } from './drawingLinkPicker'

/** What a pill shows: the engine's `HostLink`. */
export interface DrawingLink {
  label: string
  missing?: boolean
  folder?: boolean
  /** The page's file icon (`drawingLinkIcon`); null: none; absent: the outline until it is drawn. */
  icon?: PillIcon | null
}

/** A pill under the pointer: the engine's `HostLinkHit`. */
export interface DrawingLinkHit {
  elementId: string
  inner: string
  start: number
  end: number
  rect: AnchorRect
  /** Puts text in place of the raw `[[inner]]` (Edit link, Remove link); absent on a read-only board. */
  replace?: (text: string) => void
}

/**
 * What the pill of `[[inner]]` shows, as the note's pill does, or null: a link with nothing to show (`[[Note|]]`,
 * `[[#]]`) stays raw text (FN12). Before the index loads every link reads as found, by its written name.
 */
export function drawingLinkLook(inner: string, source: WikilinkResolveSource, viewOnly?: ViewOnlyLinkSource): DrawingLink | null {
  const titles = pathTitles(source.records, source.folders)
  const resolved = linkIsResolved(inner, source, viewOnly)
  const label = linkDisplayText(inner, (target) => idLinkTitle(target, source.resolve, titles), () => resolved)
  if (label === '') return null
  if (!resolved) {
    // A gone note of this vault says so, with its ID, where its title stood (S10).
    const missing = inner.includes('|') ? undefined : missingId(inner, source)
    return { label: missing === undefined ? label : `Missing note · ${missing}`, missing: true }
  }
  // A folder resolves to its directory: no file kind, the folder icon (YAZ-2290 D10).
  const path = linkPath(inner, source, viewOnly)
  return path !== null && fileKind(basename(path)) === null ? { label, folder: true } : { label }
}

/**
 * THE WINDOW'S VAULTS (YAZ-4039 D7). The engine lays out text in places that know no board (`refreshTextDimensions`,
 * the SVG export), so it draws every board of the window with ONE resolver, `windowLinkLook`. That resolver knows every
 * vault with a mounted board: a window can show several vaults (`tabs/board.ts`). Each mounted board adds its vault
 * (`mountDrawingVault`); a vault leaves with the last board of it.
 *
 * A link is the page of the first vault that finds it, in the order of the vaults' roots: an ID is unique, so only its
 * own vault finds it; a name found in two vaults is the first one's. A link no vault finds is dim, said as its ID's
 * vault says it ("Missing note · YAS-466"), else as the first vault says it.
 */
export interface DrawingVault {
  root: string
  source: WikilinkResolveSource
  viewOnly?: ViewOnlyLinkSource
}

const vaults: Array<DrawingVault & { boards: number; off: () => void }> = []
const windowListeners = new Set<() => void>()
const windowChanged = () => windowListeners.forEach((listener) => listener())

/** A board of `root` is mounted: its vault joins the window's links. Returns the unmount. */
export function mountDrawingVault(root: string, source: WikilinkResolveSource, viewOnly?: ViewOnlyLinkSource): () => void {
  let vault = vaults.find((held) => held.source === source)
  if (vault === undefined) {
    const off = source.subscribe(windowChanged)
    const offViewOnly = viewOnly?.subscribe(windowChanged)
    vault = { root, source, viewOnly, boards: 0, off: () => (off(), offViewOnly?.()) }
    vaults.push(vault)
    vaults.sort((a, b) => (a.root < b.root ? -1 : a.root > b.root ? 1 : 0))
    windowChanged()
  }
  const held = vault
  held.boards++
  let mounted = true
  return () => {
    if (!mounted) return
    mounted = false
    if (--held.boards > 0) return
    held.off()
    vaults.splice(vaults.indexOf(held), 1)
    windowChanged()
  }
}

/** The vault of the window that holds `path`, or undefined. */
export function drawingVaultOf(path: string): DrawingVault | undefined {
  return vaults.find((vault) => path.startsWith(`${vault.root.replace(/\/+$/, '')}/`))
}

/** The vault of the window that finds the page `[[inner]]` opens, or undefined. */
export function linkVault(inner: string): DrawingVault | undefined {
  return vaults.find((vault) => linkPath(inner, vault.source, vault.viewOnly) !== null)
}

/** The engine's one resolver for the window: what the pill of `[[inner]]` shows, with the page's file icon. */
export function windowLinkLook(inner: string): DrawingLink | null {
  const page = linkPageName(inner)
  const found = linkVault(inner)
  const vault = found ?? vaults.find((held) => linkNoteId(page, held.source) !== undefined) ?? vaults[0]
  const look = vault === undefined ? null : drawingLinkLook(inner, vault.source, vault.viewOnly)
  const path = found === undefined || look === null ? null : linkPath(inner, found.source, found.viewOnly)
  if (path === null) return look
  const icon = drawingLinkIcon(path, look!.folder === true, windowChanged)
  return icon === undefined ? look : { ...look!, icon }
}

/** The pills draw again with what the window says now (a theme change: the icons' other look). */
export function redrawWindowLinks(): void {
  windowChanged()
}

/** The window's icons changed (`IconsContext`): the pills draw their icons again. */
export function setWindowLinkIcons(icons: IconsHere | null): void {
  if (setDrawingLinkIcons(icons)) windowChanged()
}

/**
 * A board's open of `[[inner]]`: a page of another vault of the window opens as it is, and anything else goes to the
 * board's own follower, which makes a missing page in the board's vault, as in a note.
 */
export function windowFollow(source: WikilinkResolveSource, nav: WikilinkNav, follow: LinkFollow): LinkFollow {
  return (inner, where) => {
    const vault = linkVault(inner)
    const path = vault === undefined || vault.source === source ? null : linkPath(inner, vault.source, vault.viewOnly)
    if (path === null) return follow(inner, where)
    const open = where === 'backgroundTab' ? nav.openBackground : where === 'newTab' ? (nav.openNewTab ?? nav.openCurrent) : nav.openCurrent
    open(path)
  }
}

export interface DrawingLinkDeps {
  source: WikilinkResolveSource
  viewOnly?: ViewOnlyLinkSource
  /** The board's open of a link (`windowFollow` over the board's `wikilinkFollower`), shared with its link menu. */
  follow: LinkFollow
  nav: WikilinkNav
  /** The board is read only: a plain click opens, as in a read-only note. */
  readOnly: () => boolean
  /** The pointer rests on a pill of a found page (that page, the pill's box), or left it (null). */
  hover: (at: { path: string; rect: AnchorRect } | null) => void
  /** Right-click on a pill: the host opens the link menu at the pointer. */
  menu: (hit: DrawingLinkHit, event: MouseEvent) => void
  /** The `[[` picker of the text editor (`createDrawingLinkPicker`). */
  picker?: { change: (editor: PickerEditor | null) => void; keyDown: (event: KeyboardEvent) => boolean }
  /** A pasted text as a link, or null (`drawingPasteLink`). */
  pasteLink?: (text: string) => string | null
}

/** The engine's `hostLinks` for one board. `deps` is read at each event, so the host can keep it in a ref. */
export function drawingHostLinks(deps: () => DrawingLinkDeps) {
  return {
    resolve: windowLinkLook,
    subscribe: (listener: () => void) => {
      windowListeners.add(listener)
      return () => {
        windowListeners.delete(listener)
      }
    },
    onHover: (hit: DrawingLinkHit | null) => {
      const vault = hit === null ? undefined : linkVault(hit.inner)
      const path = hit === null || vault === undefined ? null : linkPath(hit.inner, vault.source, vault.viewOnly)
      deps().hover(hit === null || path === null ? null : { path, rect: hit.rect })
    },
    onPointerDown: (hit: DrawingLinkHit, event: PointerEvent) => {
      const now = deps()
      const where = linkClickAction({ editable: !now.readOnly() }, event, now.nav.hotkeys?.())
      if (where === null) return false
      now.follow(hit.inner, where)
      return true
    },
    onContextMenu: (hit: DrawingLinkHit, event: MouseEvent) => {
      deps().menu(hit, event)
      return true
    },
    pasteLink: (text: string) => deps().pasteLink?.(text) ?? null,
    onEditorChange: (editor: PickerEditor | null) => deps().picker?.change(editor),
    onEditorKeyDown: (event: KeyboardEvent) => deps().picker?.keyDown(event) ?? false,
  }
}

/**
 * A pasted page path or `yaseendocs://` link as the link the `[[` picker writes for that page (YAZ-4039 D12; the note's
 * `pastedPath` and `linkFor`): `[[ID]]`, or its name where it has none. A page of another vault of the window gets that
 * vault's link (`vaultLinks`): the window's resolver finds an ID in any of its vaults. Null for anything else, which
 * pastes as text: a copied `[[link]]` is text that is already a pill, and a file no tab shows has no pill.
 */
export function drawingPasteLink(text: string, root: string, boardPath: string, candidates: WikilinkCandidateSource, vaultLinks?: Pick<VaultLinks, 'roots' | 'candidatesOf'> | null): string | null {
  if (text.includes('\n')) return null
  const path = pastedPath(text)
  if (path === null) return null
  const otherRoot = vaultLinks == null ? null : rootOfPath(vaultLinks.roots, path)
  const other = otherRoot === null || otherRoot === root ? null : vaultLinks!.candidatesOf(path)
  const link = other === null ? linkFor(path, { root, notePath: boardPath, candidates }) : linkFor(path, { root: otherRoot!, notePath: boardPath, candidates: other })
  return link?.startsWith('[[') === true ? link : null
}

const WHOLE_LINK = /^\[\[([^[\]]+)\]\]$/

/**
 * A click on a shape's link icon (YAZ-4039 D7). A `[[link]]` follows as a pill does; a path of this vault, or a page's
 * name or vault path, opens in a tab. The click is the open, so no gesture opens in this tab; ⌘ and ⌘⇧ as on a pill. A
 * web link is the engine's (false: main opens it in the browser). Any other link does nothing here: a `/` path must
 * never move the app window. True when the engine must not open it.
 */
export function openShapeLink(link: string, event: MouseMods, deps: Pick<DrawingLinkDeps, 'source' | 'follow' | 'nav'>): boolean {
  const text = link.trim()
  if (/^(https?|mailto):/i.test(text)) return false
  const { source, nav, follow } = deps
  const where = gestureAction('links', event, nav.hotkeys?.()) ?? 'thisTab'
  const whole = WHOLE_LINK.exec(text)
  if (whole !== null) {
    follow(whole[1]!, where)
    return true
  }
  const absolute = pastedPath(text)
  const path = absolute !== null ? (absolute.startsWith(`${nav.root.replace(/\/+$/, '')}/`) ? absolute : null) : /^[a-z][a-z\d+.-]*:/i.test(text) ? null : (source.resolve?.(text) ?? null)
  if (path === null) {
    nav.onNotice(`Can't open "${text}": it is not a page of this vault`)
    return true
  }
  const open = where === 'backgroundTab' ? nav.openBackground : where === 'newTab' ? (nav.openNewTab ?? nav.openCurrent) : nav.openCurrent
  open(path)
  return true
}
