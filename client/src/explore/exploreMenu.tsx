/**
 * The page menu of the explore stack (YAZ-2571 round 1, items 6 and 7; Yaseen's list): a right-click on a search
 * result, on a page layer's head, or in a reading page's text (after the text menu). Its rows are the sidebar's and
 * the tab menu's own, built here from the same doors (`LinkActions`, App's rename), so they stay the same:
 *
 *   Open in new tab · Open in new window · Open in mini window
 *   Show in sidebar · Copy path
 *   Rename file (the tab menu's path: the file shows in the sidebar, and its own rename starts there)
 *   Add to focus › · Add to favorites › · Reveal in Finder · Open in VS Code
 *
 * No display name, no icon, no delete ("we should not allow for delete"). After "Show in sidebar", the three opens
 * and "Rename file" the stack closes, so you see where it went; the others keep it open.
 */
import type { LinkActions } from '../editor/linkMenu'
import { copyText } from '../editor/linkMenu'
import { landOnCard, type CardPlace } from '../editor/card/cardOpen'
import { landOnInlineDrawing } from '../editor/drawing/inlineDrawingLand'
import { resolveInlineCopyPath } from '../lib/inlinePath'
import { focusPlaces, scopeGroup, type MenuAction, type MenuItem, type MenuSection } from '../sidebar/menuSections'
import { CopyIcon, EyeIcon, HeartIcon, PencilIcon, ShowInSidebarIcon } from '../views/view/icons'
import { requestPageWindow } from '../views/pageWindowRequest'

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

/** An inline search row or inline board header target for `exploreInlineSections` (YAZ-6470). */
export type ExploreInlineTarget =
  | { kind: 'drawing'; page: string; index: number; name?: string }
  | { kind: 'card'; page: string; id: string | null; index: number; name?: string }

export interface ExploreInlineMenuDoors {
  /** Opens an inline drawing inside Explore as an `ExploreBoard` layer. */
  openInlineDrawing?: (page: string, index: number, title?: string) => void
  /** Opens `page` inside Explore landed on inline drawing `#index`. */
  showDrawingInPage?: (page: string, index: number) => void
  /** Opens `page` inside Explore landed on an inline card. */
  openCardInPage?: (page: string, card: CardPlace) => void
  /** Opens an `ExploreCard` layer for the inline card. */
  openCardWindow?: (page: string, cardId: string | null, index: number) => void
  /** Opens an inline drawing in its own tab (`onOpenInlineDrawingTab`). */
  openInlineDrawingTab?: (page: string, index: number, background: boolean) => void
  /** Opens a page in a new tab (App's `openNewTabPage`). */
  openInTab: (path: string) => void
  linkActions?: LinkActions
  onNotice: (message: string) => void
  closeStack: () => void
  /** Vault unit formatter (defaults to identity). */
  unit?: (text: string) => string
}

/** Said when no folder page is on screen to hold the mini window. */
export const NO_FOLDER_PAGE_NOTICE = 'Open a folder page first: the mini window is its card.'

/** The page menu's sections for `path`, in Yaseen's order. */
export function explorePageSections(path: string, doors: ExploreMenuDoors): MenuSection[] {
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
          if (!requestPageWindow(path)) doors.onNotice(NO_FOLDER_PAGE_NOTICE)
        },
      },
    ],
    [...(a.showInSidebar === undefined ? [] : [{ id: 'show-in-sidebar', label: 'Show in sidebar', icon: <ShowInSidebarIcon />, onSelect: then(() => a.showInSidebar?.(path)) }]), { id: 'copy-path', label: 'Copy path', icon: <CopyIcon />, onSelect: () => void copyText(path, 'path', doors.onNotice) }],
    doors.onRenameFile === undefined ? [] : [{ id: 'rename-file', label: 'Rename file', icon: <PencilIcon />, onSelect: then(() => doors.onRenameFile?.(path)) }],
    [
      ...focus,
      ...favorite,
      ...(a.reveal === undefined ? [] : [{ id: 'reveal', label: 'Reveal in Finder', onSelect: () => a.reveal?.(path) }]),
      ...(a.openVsCode === undefined ? [] : [{ id: 'open-vscode', label: 'Open in VS Code', onSelect: () => a.openVsCode?.(path) }]),
    ],
  ]
}

/**
 * Context-menu sections for an inline drawing or inline card in Explore Search or an inline `ExploreBoard` head (YAZ-6470).
 * Never offers "Rename file" (which would target the parent Markdown page).
 */
export function exploreInlineSections(target: ExploreInlineTarget, doors: ExploreInlineMenuDoors): MenuSection[] {
  const a = doors.linkActions ?? {}
  const unit = doors.unit ?? ((s: string) => s)
  const then = (run: () => void): (() => void) => () => {
    run()
    doors.closeStack()
  }
  const openInGroups: MenuAction[][] = [
    ...(a.openVsCode === undefined ? [] : [[{ id: 'open-vscode', label: 'VS Code', onSelect: () => a.openVsCode?.(target.page) }]]),
    ...(a.reveal === undefined ? [] : [[{ id: 'reveal', label: 'Reveal in Finder', onSelect: () => a.reveal?.(target.page) }]]),
  ]
  const openInSection: MenuSection = openInGroups.length === 0 ? [] : [{ id: 'open-in', label: 'Open in', children: openInGroups }]

  if (target.kind === 'drawing') {
    return [
      [
        ...(doors.openInlineDrawing === undefined ? [] : [{ id: 'open-explore', label: 'Open in Explore', onSelect: () => doors.openInlineDrawing?.(target.page, target.index, target.name) }]),
        ...(doors.showDrawingInPage === undefined ? [] : [{ id: 'show-in-page', label: unit('Show in page'), onSelect: () => doors.showDrawingInPage?.(target.page, target.index) }]),
        {
          id: 'open-tab',
          label: 'Open in new tab',
          onSelect: then(() => {
            if (doors.openInlineDrawingTab !== undefined) doors.openInlineDrawingTab(target.page, target.index, false)
            else {
              landOnInlineDrawing(target.page, target.index)
              doors.openInTab(target.page)
            }
          }),
        },
        ...(a.openNewWindow === undefined ? [] : [{ id: 'open-window', label: 'Open in new window', onSelect: then(() => a.openNewWindow?.(target.page)) }]),
      ],
      [
        {
          id: 'copy-path',
          label: 'Copy path',
          icon: <CopyIcon />,
          onSelect: () => {
            void resolveInlineCopyPath({ kind: 'drawing', page: target.page, index: target.index }).then((p) => copyText(p, 'path', doors.onNotice))
          },
        },
      ],
      openInSection,
    ]
  }

  const cardId = target.id !== null && target.id !== '' ? target.id : null
  return [
    [
      ...(doors.openCardInPage === undefined ? [] : [{ id: 'open-explore', label: 'Open in Explore', onSelect: () => doors.openCardInPage?.(target.page, { id: target.id, index: target.index }) }]),
      ...(doors.openCardWindow === undefined ? [] : [{ id: 'open-card', label: 'Open card', onSelect: () => doors.openCardWindow?.(target.page, target.id, target.index) }]),
      {
        id: 'open-tab',
        label: 'Open in new tab',
        onSelect: then(() => {
          if (cardId !== null) landOnCard(target.page, cardId)
          doors.openInTab(target.page)
        }),
      },
      ...(a.openNewWindow === undefined ? [] : [{ id: 'open-window', label: 'Open in new window', onSelect: then(() => a.openNewWindow?.(target.page)) }]),
    ],
    [
      {
        id: 'copy-path',
        label: 'Copy path',
        icon: <CopyIcon />,
        onSelect: () => {
          void resolveInlineCopyPath({ kind: 'card', page: target.page, id: cardId ?? '' }, target.index).then((p) => copyText(p, 'path', doors.onNotice))
        },
      },
      ...(cardId === null
        ? []
        : [
            { id: 'copy-card-id', label: 'Copy card ID', icon: <CopyIcon />, onSelect: () => void copyText(cardId, 'card ID', doors.onNotice) },
            { id: 'copy-card-link', label: 'Copy card link', icon: <CopyIcon />, onSelect: () => void copyText(`[[${cardId}]]`, 'card link', doors.onNotice) },
          ]),
    ],
    openInSection,
  ]
}
