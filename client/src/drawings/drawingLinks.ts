/**
 * PAGE LINKS IN A DRAWING (YAZ-4039 D7, D11). `[[Page]]` in a text box is a pill: the engine draws it with what
 * `resolve` says, and reports the pointer on it. Everything else is the page's own pieces, so a pill on a board works
 * as a pill in a page:
 *  - what it shows: `linkDisplayText` with the ID link's title (YAZ-2293) and the found page's name (YAZ-3778 D2, D3);
 *    a missing page is dim, and a missing ID of this vault says "Missing page · YAS-466" (YAZ-3905 S10),
 *  - a click: the open gestures of Settings › Hotkeys › "Links in pages and drawings" (`linkClickAction`, the #230 keys). A plain
 *    click is the board's (it selects the box); a read-only board keeps "a click opens", as a read-only page does, and
 *    follows the vault's "Clicking a link" (Explore, YAZ-4939) as a page does,
 *  - opening: the editor's one follower (`wikilinkFollower`), which also makes a missing page,
 *  - hover: the page the pill opens, for the host's card (`useCardPreview`),
 *  - right-click: the host opens the one link menu (`linkMenuOf`), with Edit link and Remove link (D15),
 *  - making one (D12): the `[[` picker in the text editor (`drawingLinkPicker.ts`), and a pasted page path or
 *    `yaseendocs://` link as the link the picker writes (`drawingPasteLink`, the page's `pathPaste.ts`).
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
import { openerOf, type LinkFollow, type WikilinkNav } from '../editor/wikilink/wikilinkClick'
import { idLinkTitle, linkDisplayText, linkIsResolved, linkPageId, linkPageName, linkPath, missingId, type WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import type { ViewOnlyLinkSource } from '../editor/wikilink/viewOnlyLinkSource'
import { isFolderPath, pathTitles } from '../lib/pageLabel'
import type { AnchorRect } from '../sidebar/previewPlacement'
import type { VaultLinks } from '../links/vaultLinks'
import type { IconsHere } from '../sidebar/FileIcon'
import { setDiagramLinkLooks, type WireLook } from '../diagrams/diagramLooks'
import { drawingLinkIcon, setDrawingLinkIcons, type PillIcon } from './drawingLinkIcons'
import type { PickerEditor } from './drawingLinkPicker'
import { vaultUnit } from '../vault/unitWord'

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
 * What the pill of `[[inner]]` shows, as the page's pill does, or null: a link with nothing to show (`[[Page|]]`,
 * `[[#]]`) stays raw text (FN12). Before the index loads every link reads as found, by its written name.
 */
export function drawingLinkLook(inner: string, source: WikilinkResolveSource, viewOnly?: ViewOnlyLinkSource): DrawingLink | null {
  const titles = pathTitles(source.records, source.folders)
  const resolved = linkIsResolved(inner, source, viewOnly)
  const label = linkDisplayText(inner, (target) => idLinkTitle(target, source.resolve, titles), () => resolved, source)
  if (label === '') return null
  if (!resolved) {
    // A gone page of this vault says so, with its ID, where its title stood (S10).
    const missing = inner.includes('|') ? undefined : missingId(inner, source)
    return { label: missing === undefined ? label : `Missing page · ${missing}`, missing: true }
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
 * vault says it ("Missing page · YAS-466"), else as the first vault says it.
 */
export interface DrawingVault {
  root: string
  source: WikilinkResolveSource
  viewOnly?: ViewOnlyLinkSource
}

const vaults: Array<DrawingVault & { boards: number; off: () => void }> = []
const windowListeners = new Set<() => void>()
const windowChanged = () => windowListeners.forEach((listener) => listener())

/**
 * What each link last showed (YAZ-4074 6A item 7), oldest first, at most `MAX_SHOWN`. A page's autosave gives the vault
 * a new index, and a board's wake clears its shape cache and measures every text box with `[[`, hidden tabs too. So an
 * index change or a vault that comes or goes wakes the boards only when the look of a link they drew changed.
 */
const shown = new Map<string, DrawingLink | null>()
const MAX_SHOWN = 2000
const sameLook = (a: DrawingLink | null | undefined, b: DrawingLink | null): boolean =>
  a === b || (a != null && b !== null && a.label === b.label && a.missing === b.missing && a.folder === b.folder && a.icon === b.icon)
function remember(inner: string, look: DrawingLink | null): void {
  shown.delete(inner)
  if (shown.size >= MAX_SHOWN) shown.delete(shown.keys().next().value!)
  shown.set(inner, look)
}
function lookChanged(): void {
  let changed = false
  for (const [inner, before] of [...shown]) {
    const now = lookOf(inner)
    if (sameLook(before, now)) continue
    shown.set(inner, now)
    changed = true
  }
  if (changed) windowChanged()
}

/** Icons that finish loading in one frame wake the boards once (6A item 7). */
let iconFrame: number | null = null
function iconReady(): void {
  if (iconFrame !== null) return
  iconFrame = requestAnimationFrame(() => {
    iconFrame = null
    windowChanged()
  })
}

/** A board of `root` is mounted: its vault joins the window's links. Returns the unmount. */
export function mountDrawingVault(root: string, source: WikilinkResolveSource, viewOnly?: ViewOnlyLinkSource): () => void {
  let vault = vaults.find((held) => held.source === source)
  if (vault === undefined) {
    const off = source.subscribe(lookChanged)
    const offViewOnly = viewOnly?.subscribe(lookChanged)
    vault = { root, source, viewOnly, boards: 0, off: () => (off(), offViewOnly?.()) }
    vaults.push(vault)
    vaults.sort((a, b) => (a.root < b.root ? -1 : a.root > b.root ? 1 : 0))
    lookChanged()
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
    lookChanged()
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
  const look = lookOf(inner)
  remember(inner, look)
  return look
}

function lookOf(inner: string): DrawingLink | null {
  const page = linkPageName(inner)
  const found = linkVault(inner)
  const vault = found ?? vaults.find((held) => linkPageId(page, held.source) !== undefined) ?? vaults[0]
  const look = vault === undefined ? null : drawingLinkLook(inner, vault.source, vault.viewOnly)
  const path = found === undefined || look === null ? null : linkPath(inner, found.source, found.viewOnly)
  if (path === null) return look
  const icon = drawingLinkIcon(path, look!.folder === true, iconReady)
  return icon === undefined ? look : { ...look!, icon }
}

/** A pill's look for draw.io's side (YAZ-4748): the icon as its data URL; null, no icon; absent, not drawn yet. */
export function wireLook(look: DrawingLink | null): WireLook | null {
  if (look === null) return null
  const { label, missing, icon } = look
  return { label, ...(missing ? { missing } : {}), ...(icon === undefined ? {} : { icon: icon === null ? null : icon.url }) }
}

// A diagram's previews and Export Image draw its pills with the window's links (YAZ-4748 D9).
setDiagramLinkLooks((inner) => wireLook(windowLinkLook(inner)))

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
 * board's own follower, which makes a missing page in the board's vault, as in a page.
 */
export function windowFollow(source: WikilinkResolveSource, nav: WikilinkNav, follow: LinkFollow): LinkFollow {
  return (inner, where) => {
    const vault = linkVault(inner)
    const path = vault === undefined || vault.source === source ? null : linkPath(inner, vault.source, vault.viewOnly)
    if (path === null) return follow(inner, where)
    openerOf(nav, where)(path)
  }
}

export interface DrawingLinkDeps {
  source: WikilinkResolveSource
  viewOnly?: ViewOnlyLinkSource
  /** The board's open of a link (`windowFollow` over the board's `wikilinkFollower`), shared with its link menu. */
  follow: LinkFollow
  nav: WikilinkNav
  /** The board is read only: a plain click opens, as in a read-only page. */
  readOnly: () => boolean
  /** The pointer rests on a pill of a found page (that page, the pill's box), or left it (null). */
  hover: (at: { path: string; rect: AnchorRect } | null) => void
  /** Right-click on a pill: the host opens the link menu at the pointer. */
  menu: (hit: DrawingLinkHit, event: MouseEvent) => void
  /** The `[[` picker of the text editor (`createDrawingLinkPicker`). */
  picker?: { change: (editor: PickerEditor | null) => void; keyDown: (event: KeyboardEvent) => boolean }
  /** A pasted text as a link, or null (`drawingPasteLink`). */
  pasteLink?: (text: string) => string | null
  /** Files dropped on the board as their links, or null (`drawingDropLinks`). */
  dropLinks?: (files: readonly File[]) => string[] | null
  /** The same by the files' paths: a diagram's frame drops pages it has no paths for (YAZ-4748 D4). */
  dropPaths?: (paths: readonly string[]) => string[] | null
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
      // A plain click on an editable board is the board's (it selects the box). On a read-only board it follows the
      // vault's "Clicking a link" (YAZ-4939): a page pill opens in Explore while the vault says so, as in a page.
      const explore = (): boolean => {
        if (!now.readOnly() || now.nav.exploreClick?.() !== true) return false
        const vault = linkVault(hit.inner) ?? { source: now.source, viewOnly: now.viewOnly }
        return fileKind(linkPath(hit.inner, vault.source, vault.viewOnly) ?? '') === 'markdown'
      }
      const where = linkClickAction({ editable: !now.readOnly() }, event, now.nav.hotkeys?.(), explore)
      if (where === null) return false
      now.follow(hit.inner, where)
      return true
    },
    onContextMenu: (hit: DrawingLinkHit, event: MouseEvent) => {
      deps().menu(hit, event)
      return true
    },
    pasteLink: (text: string) => deps().pasteLink?.(text) ?? null,
    dropLinks: (files: readonly File[]) => deps().dropLinks?.(files) ?? null,
    dropPaths: (paths: readonly string[]) => deps().dropPaths?.(paths) ?? null,
    onEditorChange: (editor: PickerEditor | null) => deps().picker?.change(editor),
    onEditorKeyDown: (event: KeyboardEvent) => deps().picker?.keyDown(event) ?? false,
  }
}

/**
 * A pasted page path or `yaseendocs://` link as the link the `[[` picker writes for that page (YAZ-4039 D12; the page's
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
  const link = other === null ? linkFor(path, { root, pagePath: boardPath, candidates }) : linkFor(path, { root: otherRoot!, pagePath: boardPath, candidates: other })
  return link?.startsWith('[[') === true ? link : null
}

/**
 * Files dropped on the board (YAZ-3943 4D: a drag from the sidebar), by their paths, as the links a paste of each path
 * makes (`linkOf`, `drawingPasteLink`): one for each page — a page, a board, a code file — in the order dropped. A folder
 * gives none, and so does a file that is no page. Null when a path is in no vault of the window (a drop from Finder): the
 * engine goes on as before.
 */
export function drawingDropLinks(paths: readonly string[], roots: readonly string[], linkOf: (path: string) => string | null): string[] | null {
  if (paths.length === 0 || paths.some((path) => rootOfPath(roots, path) === null)) return null
  return paths.flatMap((path) => (isFolderPath(rootOfPath(roots, path), path) ? [] : (linkOf(path) ?? [])))
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
    nav.onNotice(vaultUnit(nav.root)(`Can't open "${text}": it is not a page of this vault`))
    return true
  }
  openerOf(nav, where)(path)
  return true
}
