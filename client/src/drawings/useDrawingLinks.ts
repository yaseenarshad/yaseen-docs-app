/**
 * A board's page links (YAZ-4039 D7, D11, D12, D15; `drawingLinks.ts`), for both hosts of the canvas: a drawing tab
 * (`DrawingEditor`) and the note embed's popup (`DrawingModal`). The board's vault joins the window's links while it is
 * mounted; the pills' follower, the hover card beside a pill, the one link menu with Edit link and Remove link, the `[[`
 * picker and the paste are made once, and every live value is read through a ref at the event.
 */
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fileKind } from '@shared/fileKind'
import type { GestureAction } from '@shared/keys'
import type { HotkeyOverrides } from '@shared/hotkeyBindings'
import type { DiagramDarkColors } from '@shared/types'
import { api } from '../api'
import { linkOpenHint } from '../editor/linkGesture'
import { linkMenuRows, openMenuAt, type LinkActions } from '../editor/linkMenu'
import { wikilinkFollower, type WikilinkNav } from '../editor/wikilink/wikilinkClick'
import { linkMenuOf } from '../editor/wikilink/wikilinkMenu'
import type { WikilinkCandidateSource } from '../editor/wikilink/wikilinkPicker'
import type { WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import type { ViewOnlyLinkSource } from '../editor/wikilink/viewOnlyLinkSource'
import { pageLabel, pathTitles } from '../lib/pageLabel'
import { VaultLinksContext } from '../links/vaultLinks'
import { VaultReadOnly } from '../vault/readOnlyVault'
import { IconsContext, fileIconDecoration } from '../sidebar/FileIcon'
import type { AnchorRect } from '../sidebar/previewPlacement'
import { useCardPreview, type PreviewScope } from '../tabs/cardPreview'
import { createDrawingLinkPicker, createLinkedPage } from './drawingLinkPicker'
import { drawingDropLinks, drawingHostLinks, drawingPasteLink, drawingVaultOf, linkVault, mountDrawingVault, openShapeLink, redrawWindowLinks, setWindowLinkIcons, windowFollow, type DrawingLinkDeps } from './drawingLinks'
import { openEditLinkBox } from './editLinkBox'
import type { DrawingSurfaceLinks } from './ExcalidrawSurface'

/** What a board's host passes for its links: the props a note's editor gets for its `[[links]]`. */
export interface DrawingLinkProps {
  /** The window's resolve source of the board's vault. Wired only with `onOpenLinkBackground` too, as in a note; absent → `[[links]]` stay text. */
  wikilinks?: WikilinkResolveSource
  viewOnlyLinks?: ViewOnlyLinkSource
  /** The `[[` picker's rows (YAZ-4039 D12), the note's: also what a pasted path becomes. */
  wikilinkCandidates?: WikilinkCandidateSource
  /** An open gesture on a pill: this tab or a new tab in front (YAZ-3936). */
  onOpenLink?: (path: string, where?: GestureAction) => void
  /** ⌘-click on a pill: a background tab. */
  onOpenLinkBackground?: (path: string) => void
  /** "Open in Explore" on a note pill (YAZ-4936, on a board since YAZ-4939): a reading layer. Absent → no row. */
  onOpenExplore?: (path: string) => void
  /** This vault's "Clicking a link" (YAZ-4936), read at each click: on a read-only board a plain click on a note pill opens it in Explore (YAZ-4939). */
  exploreOnClick?: () => boolean
  /** The link menu's place rows (YAZ-3740). */
  linkActions?: LinkActions
  /** Where a missing page of a bare link is made (C2-, GRO-2240). */
  newNoteFolderFor?: (sourcePath: string) => string
  /** Settings › Preview on hover › Links in notes (YAZ-3403): a pill shows the page's card too. */
  hoverLinks?: boolean
  previewScope?: (path: string) => PreviewScope
  diagramDarkColors?: DiagramDarkColors
}

export interface DrawingLinkHost {
  root: string
  /** The app's theme: a pill's file icon has a light and a dark look. */
  theme: 'light' | 'dark'
  /** The board's file: where its missing pages are made, and the `from` of a pasted path. */
  path: string
  readOnly: boolean
  hotkeys: HotkeyOverrides | undefined
  onNotice: ((message: string) => void) | undefined
  /** Where the menu, the Edit link box and the picker are put. */
  hostRef: { current: HTMLElement | null }
  /** The `[[` picker opened or closed (a diagram's frame sends its keys up only while it is open, YAZ-4748). */
  onPickerShow?: (open: boolean) => void
  props: DrawingLinkProps
}

/**
 * The links of one board, for the canvas (`DrawingSurfaceLinks`) and for a diagram's frame (YAZ-4748), which also asks
 * by paths (`dropPaths`).
 */
export interface BoardLinks extends DrawingSurfaceLinks {
  hostLinks: ReturnType<typeof drawingHostLinks>
}

export function useDrawingLinks(host: DrawingLinkHost) {
  const live = useRef(host)
  live.current = host
  // The pill the pointer rests on (YAZ-3403's link card): its page and box; the dwell lives in the card's own store.
  const linkAt = useRef<{ path: string; rect: AnchorRect } | null>(null)
  const linkPreview = useCardPreview(host.props.hoverLinks ?? false, (page) => (linkAt.current?.path === page ? linkAt.current.rect : null))
  const closeMenu = useRef<() => void>(() => undefined)
  const closePicker = useRef<() => void>(() => undefined)
  useEffect(
    () => () => {
      closeMenu.current()
      closePicker.current()
    },
    [],
  )
  const { root, props } = host
  // The window's icons (the vaults' picks and rules): the pills' and the picker's file icons, as a note's.
  const iconsHere = useContext(IconsContext)
  const icons = useRef(iconsHere)
  icons.current = iconsHere
  // The window's vaults: a pasted path of another of them is that vault's link.
  // The vault's read-only door, read at the click (YAZ-4985).
  const fileDoorHere = useContext(VaultReadOnly).allowFileAction
  const fileDoor = useRef(fileDoorHere)
  fileDoor.current = fileDoorHere
  const vaultLinksHere = useContext(VaultLinksContext)
  const vaultLinks = useRef(vaultLinksHere)
  vaultLinks.current = vaultLinksHere
  useLayoutEffect(() => setWindowLinkIcons(iconsHere), [iconsHere])
  // A new theme gives the icons their other look.
  const firstTheme = useRef(host.theme)
  useEffect(() => {
    if (host.theme !== firstTheme.current) redrawWindowLinks()
  }, [host.theme])
  // The vault joins the window's links before the canvas lays out its text (YAZ-4039 D7).
  useLayoutEffect(() => (props.wikilinks === undefined ? undefined : mountDrawingVault(root, props.wikilinks, props.viewOnlyLinks)), [root, props.wikilinks, props.viewOnlyLinks])
  const [links] = useState<BoardLinks | undefined>(() => {
    const { wikilinks, viewOnlyLinks, onOpenLinkBackground } = props
    if (wikilinks === undefined || onOpenLinkBackground === undefined) return undefined
    const nav: WikilinkNav = {
      ...props.linkActions,
      root,
      createFolder: () => live.current.props.newNoteFolderFor?.(live.current.path) ?? '',
      openCurrent: (page) => live.current.props.onOpenLink?.(page, 'thisTab'),
      openNewTab: (page) => live.current.props.onOpenLink?.(page, 'newTab'),
      openBackground: (page) => live.current.props.onOpenLinkBackground?.(page),
      // "Open in Explore" and the vault's "Clicking a link" (YAZ-4936, YAZ-4939), as a note's pills have them.
      ...(props.onOpenExplore === undefined ? {} : { openExplore: (page: string) => live.current.props.onOpenExplore?.(page) }),
      exploreClick: () => live.current.props.exploreOnClick?.() === true,
      hotkeys: () => live.current.hotkeys,
      onNotice: (message) => live.current.onNotice?.(message),
      // A link to a missing page asks the vault's read-only door before the page is made (YAZ-4985).
      allowFileAction: (vault) => fileDoor.current(vault),
    }
    const follow = windowFollow(wikilinks, nav, wikilinkFollower(wikilinks, nav, viewOnlyLinks))
    const picker = createDrawingLinkPicker(
      () => live.current.hostRef.current,
      () => live.current.props.wikilinkCandidates?.candidates ?? [],
      (editor, name) => void createLinkedPage(editor, name, wikilinks, nav),
      { icon: (target, folder) => fileIconDecoration(icons.current, target, folder) },
      (open) => live.current.onPickerShow?.(open),
    )
    closePicker.current = picker.close
    const pasteLink = (text: string): string | null => {
      const candidates = live.current.props.wikilinkCandidates
      return candidates === undefined ? null : drawingPasteLink(text, root, live.current.path, candidates, vaultLinks.current)
    }
    const deps = (): DrawingLinkDeps => ({
      source: wikilinks,
      viewOnly: viewOnlyLinks,
      follow,
      nav,
      readOnly: () => live.current.readOnly,
      hover: (at) => {
        if (at === null) {
          if (linkAt.current !== null) linkPreview.leaveCard(linkAt.current.path)
          linkAt.current = null
          return
        }
        linkAt.current = at
        linkPreview.hoverCard(at.path, at.path)
      },
      // The one link menu (YAZ-3740), at the pointer, of the vault whose page the link opens. Edit link opens a box with
      // the link's text, Remove link leaves the name the pill shows (D15); a read-only board has neither.
      menu: (hit, event) => {
        closeMenu.current()
        const parent = live.current.hostRef.current
        const replace = live.current.readOnly ? undefined : hit.replace
        if (parent === null) return
        const owner = linkVault(hit.inner) ?? { source: wikilinks, viewOnly: viewOnlyLinks }
        const edit = replace === undefined ? undefined : () => (closeMenu.current = openEditLinkBox(parent, event.clientX, event.clientY, hit.inner, (next) => replace(`[[${next}]]`)))
        closeMenu.current = openMenuAt(parent, event.clientX, event.clientY, linkMenuRows(linkMenuOf(hit.inner, owner.source, nav, follow, owner.viewOnly, undefined, edit, replace)))
      },
      picker,
      pasteLink,
      // A drag from the sidebar (YAZ-3943 4D): each page a pill box, as a paste of its path. A diagram's frame knows no
      // file paths, so it asks by the paths themselves (YAZ-4748 D4).
      dropPaths: (paths) => drawingDropLinks(paths, vaultLinks.current?.roots ?? [root], pasteLink),
      dropLinks: (files) => drawingDropLinks(files.map((file) => api.file.pathFor(file)), vaultLinks.current?.roots ?? [root], pasteLink),
    })
    return { hostLinks: drawingHostLinks(deps), openShapeLink: (link, event) => openShapeLink(link, event, deps()) }
  })
  // The card says how to open the link (YAZ-3879 point 9): "⌘-click to open in a background tab"; on a read-only board
  // with the vault's "Clicking a link" at Explore, "Click to open in Explore" for a note (YAZ-4939).
  const linkCard = (_: string, page: string): { root: string | null; name: string; hint?: string } | null => {
    const source = drawingVaultOf(page)?.source ?? live.current.props.wikilinks
    const { readOnly, hotkeys } = live.current
    const explore = readOnly && live.current.props.exploreOnClick?.() === true && fileKind(page) === 'markdown'
    return source === undefined ? null : { root: null, name: pageLabel(page, false, pathTitles(source.records, source.folders)), hint: linkOpenHint(hotkeys, !readOnly, explore) }
  }
  return { links, linkPreview, linkCard }
}
