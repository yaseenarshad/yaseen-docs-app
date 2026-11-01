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
 *  - right-click: the host opens the one link menu (`linkMenuOf`).
 *
 * A shape's own `link` (the engine's link icon) opens through the same follower when it is a `[[link]]` or a path of
 * this vault (`openShapeLink`).
 */
import { fileKind } from '@shared/fileKind'
import { gestureAction, type MouseMods } from '@shared/keys'
import type { HotkeyOverrides } from '@shared/hotkeyBindings'
import { basename } from '@shared/types'
import { pastedPath } from '../editor/pathPaste'
import { linkClickAction } from '../editor/linkGesture'
import type { LinkFollow, WikilinkNav } from '../editor/wikilink/wikilinkClick'
import { idLinkTitle, linkDisplayText, linkIsResolved, linkPageName, linkPath, missingId, type WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import type { ViewOnlyLinkSource } from '../editor/wikilink/viewOnlyLinkSource'
import { pathTitles } from '../lib/pageLabel'
import type { AnchorRect } from '../sidebar/previewPlacement'

/** What a pill shows: the engine's `HostLink`. */
export interface DrawingLink {
  label: string
  missing?: boolean
  folder?: boolean
}

/** A pill under the pointer: the engine's `HostLinkHit`. */
export interface DrawingLinkHit {
  elementId: string
  inner: string
  start: number
  end: number
  rect: AnchorRect
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

const resolvers = new WeakMap<WikilinkResolveSource, (inner: string) => DrawingLink | null>()

/** ONE resolver for each vault: the engine draws with the last mounted board's, and the boards of a vault share it. */
export function drawingLinkResolver(source: WikilinkResolveSource, viewOnly?: ViewOnlyLinkSource): (inner: string) => DrawingLink | null {
  let resolve = resolvers.get(source)
  if (resolve === undefined) {
    resolve = (inner) => drawingLinkLook(inner, source, viewOnly)
    resolvers.set(source, resolve)
  }
  return resolve
}

export interface DrawingLinkDeps {
  source: WikilinkResolveSource
  viewOnly?: ViewOnlyLinkSource
  /** The board's one follower (`wikilinkFollower`), shared with its link menu. */
  follow: LinkFollow
  nav: WikilinkNav
  /** The board is read only: a plain click opens, as in a read-only note. */
  readOnly: () => boolean
  /** The pointer rests on a pill of a found page (that page, the pill's box), or left it (null). */
  hover: (at: { path: string; rect: AnchorRect } | null) => void
  /** Right-click on a pill: the host opens the link menu at the pointer. */
  menu: (hit: DrawingLinkHit, event: MouseEvent) => void
}

/**
 * The engine's `hostLinks` for one board. `deps` is read at each event, so the host can keep it in a ref; the resolver
 * and the subscription are of the first `source`, which a board keeps for its life.
 */
export function drawingHostLinks(deps: () => DrawingLinkDeps) {
  const { source, viewOnly } = deps()
  return {
    resolve: drawingLinkResolver(source, viewOnly),
    subscribe: (listener: () => void) => {
      const off = source.subscribe(listener)
      const offViewOnly = viewOnly?.subscribe(listener)
      return () => {
        off()
        offViewOnly?.()
      }
    },
    onHover: (hit: DrawingLinkHit | null) => {
      const now = deps()
      const path = hit === null || !linkIsResolved(hit.inner, now.source, now.viewOnly) || linkPageName(hit.inner) === '' ? null : linkPath(hit.inner, now.source, now.viewOnly)
      now.hover(hit === null || path === null ? null : { path, rect: hit.rect })
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
  }
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
