/**
 * Per-tab sidebar place persistence (YAZ-5701, YAZ-6064, YAZ-6097, YAZ-6104): saves the outgoing tab's sidebar lens,
 * open folders, shut stack folders, scroll, selection, Hide all others, and folded vaults, and restores the incoming
 * tab's place (or resets cleanly for unvisited page tabs and New tabs).
 */
import { useLayoutEffect, useRef, type Dispatch, type MutableRefObject, type RefObject } from 'react'
import { rootOfPath, type SidebarLens, type SidebarTab } from '@shared/types'
import { ancestorDirs, type TreeAction } from '../../lib/treeState'
import { setShutStackFolders, shutStackFolders } from '../FocusFolderList'
import type { SidebarRevealRequest } from '../revealRow'
import { currentVaultEpoch, dropBlankPlace, lastPlace, readCollapsed, readPlace, savePlace, type TabPlace } from '../tabPlace'

export interface UseTabPlaceOptions {
  perTab: boolean
  activeTab: string | null | undefined
  lens: SidebarTab
  expanded: readonly string[]
  filesOnly: string | null
  focusOnly: string | null
  closedVaults: readonly string[]
  revealRequest: SidebarRevealRequest | null
  revealActive: boolean
  loaded: boolean
  roots: readonly string[]
  rootOf: (path: string) => string
  activeRef: MutableRefObject<string | null>
  bodyRef: RefObject<HTMLDivElement | null>
  followed: MutableRefObject<{ path: string | null | undefined; files: boolean; id: number }>
  lastNonSearchLens: MutableRefObject<SidebarLens>
  skipExpandToRef: MutableRefObject<string | null>
  restoredFilesOnly: MutableRefObject<string | null>
  dispatch: Dispatch<TreeAction>
  onLensChange: (lens: SidebarTab) => void
  onRestoreLens?: (lens: SidebarTab) => void
  onFilesOnly?: (dir: string | null) => void
  onFocusOnly?: (id: string | null) => void
  onRestoreClosedVaults?: (closed: readonly string[]) => void
}

export function useTabPlace({
  perTab,
  activeTab,
  lens,
  expanded,
  filesOnly,
  focusOnly,
  closedVaults,
  revealRequest,
  revealActive,
  loaded,
  roots,
  rootOf,
  activeRef,
  bodyRef,
  followed,
  lastNonSearchLens,
  skipExpandToRef,
  restoredFilesOnly,
  dispatch,
  onLensChange,
  onRestoreLens,
  onFilesOnly,
  onFocusOnly,
  onRestoreClosedVaults,
}: UseTabPlaceOptions) {
  const rootsNow = useRef(roots)
  rootsNow.current = roots
  const mountEpoch = useRef(currentVaultEpoch())
  useLayoutEffect(() => {
    mountEpoch.current = currentVaultEpoch()
  }, [roots])
  const placeNow = useRef({ lens, expanded, perTab, filesOnly, focusOnly, closedVaults, revealRequest, revealActive })
  placeNow.current = { lens, expanded, perTab, filesOnly, focusOnly, closedVaults, revealRequest, revealActive }
  /** The tab whose place is on screen; `undefined` until the first effect. */
  const placeTab = useRef<string | null | undefined>(undefined)
  /** The scroll to put back once the place's folders are drawn (the layout effect below). */
  const placeScroll = useRef<number | null>(null)
  /** Skip the automatic `sidebarRevealActive` quiet reveal right after restoring a saved tab place (YAZ-6064 D4). */
  const skipQuietReveal = useRef(false)
  /**
   * The selected rows on screen (YAZ-5769), kept current below `useSelection`. Saved as they are, also when the switch
   * shows Search: a blank tab opens on Search in the same commit, and Search has no selection of its own to save.
   */
  const placeSelected = useRef<ReadonlySet<string>>(new Set())
  /** The rows to select again once the place's sidebar tab shows (the effect after `useSelection`, which clears on a tab change). */
  const placeSelection = useRef<{ lens: SidebarTab; paths: readonly string[] } | null>(null)
  const placeHere = (body: HTMLElement | null): TabPlace => {
    const now = placeNow.current
    return {
      lens: now.lens === 'search' ? lastNonSearchLens.current : now.lens,
      expanded: now.expanded,
      shut: { focus: shutStackFolders('focus'), favorites: shutStackFolders('favorites') },
      scrollTop: body?.scrollTop ?? 0,
      selected: [...placeSelected.current],
      filesOnly: now.filesOnly,
      focusOnly: now.focusOnly,
      closedVaults: now.closedVaults,
    }
  }
  const restoreLens = onRestoreLens ?? onLensChange
  /** `folders` false at the mount: the tree started from the place's folders. */
  const putBack = (place: TabPlace, folders: boolean): void => {
    if (folders) dispatch({ type: 'setAll', dirs: [...place.expanded] })
    setShutStackFolders('focus', place.shut.focus)
    setShutStackFolders('favorites', place.shut.favorites)
    const keepMountLens = !folders && (placeNow.current.lens === 'search' || placeNow.current.revealRequest !== null)
    if (keepMountLens) lastNonSearchLens.current = place.lens
    else if (place.lens !== placeNow.current.lens) restoreLens(place.lens)
    const nextFilesOnly = place.filesOnly !== null && rootOfPath(rootsNow.current, place.filesOnly) !== null ? place.filesOnly : null
    if (nextFilesOnly !== null && (!folders || nextFilesOnly !== placeNow.current.filesOnly)) restoredFilesOnly.current = nextFilesOnly
    if (nextFilesOnly !== placeNow.current.filesOnly) onFilesOnly?.(nextFilesOnly)
    if (place.focusOnly !== placeNow.current.focusOnly) onFocusOnly?.(place.focusOnly)
    if (onRestoreClosedVaults !== undefined) {
      const nextClosed = place.closedVaults.filter((v) => rootsNow.current.includes(v))
      const curClosed = placeNow.current.closedVaults
      if (nextClosed.length !== curClosed.length || nextClosed.some((v, i) => v !== curClosed[i])) onRestoreClosedVaults(nextClosed)
    }
    placeScroll.current = place.scrollTop
    placeSelection.current = { lens: place.lens, paths: place.selected ?? [] }
  }
  useLayoutEffect(() => {
    const from = placeTab.current
    const to = activeTab ?? null
    if (!perTab || from === to) {
      placeTab.current = to
      return
    }
    // The first run is the mount: its folders came from the tab's place already (`folderShare.start`).
    // A New tab's place is for its Hide and Show sidebar only (YAZ-5757): it goes with the tab, and the next New tab keeps the screen.
    if (from === null) dropBlankPlace()
    else if (from !== undefined) savePlace(from, placeHere(bodyRef.current))
    // If App is about to collapse the sidebar for `to` in the same commit (YAZ-6064 D2), stop here and clear
    // `placeTab.current` so the imminent unmount cleanup does not overwrite `to`'s saved place with `from`'s DOM.
    if (from !== undefined && readCollapsed(to) === true) {
      placeTab.current = undefined
      return
    }
    placeTab.current = to
    const place = to === null && from !== undefined ? undefined : readPlace(to)
    if (place !== undefined) {
      if (from !== undefined && activeRef.current !== null) skipExpandToRef.current = activeRef.current
      if (
        placeNow.current.revealActive &&
        place.lens === 'files' &&
        activeRef.current !== null &&
        (from === undefined || activeRef.current !== followed.current.path || placeNow.current.lens !== 'files')
      ) {
        skipQuietReveal.current = true
      }
      putBack(place, from !== undefined)
    } else if (from !== undefined || lastPlace() !== undefined) {
      // Unvisited tab or New tab (YAZ-6064 D1/D3, YAZ-6097, YAZ-6104): never leak the previous tab's Hide all others,
      // folded vaults, or folders — both on tab switch (`from !== undefined`) and on remount after a collapsed tab
      // (`from === undefined && lastPlace() !== undefined`).
      if (placeNow.current.filesOnly !== null) {
        restoredFilesOnly.current = placeNow.current.filesOnly
        onFilesOnly?.(null)
      }
      if (placeNow.current.focusOnly !== null) onFocusOnly?.(null)
      if (to !== null && (from !== null || from === undefined)) {
        if (from !== undefined) {
          const file = activeRef.current
          const dirs = file !== null && rootOfPath(rootsNow.current, file) !== null ? ancestorDirs(rootOf(file), file) : []
          dispatch({ type: 'setAll', dirs })
        }
        setShutStackFolders('focus', new Set())
        setShutStackFolders('favorites', new Set())
        if (placeNow.current.closedVaults.length > 0) onRestoreClosedVaults?.([])
        const keepMountLens = from === undefined && (placeNow.current.lens === 'search' || placeNow.current.revealRequest !== null)
        if (!keepMountLens && placeNow.current.lens !== 'files') restoreLens('files')
        placeScroll.current = 0
        placeSelection.current = { lens: 'files', paths: [] }
      } else if (to === null && from !== null) {
        // New tab from a page tab or remounted after a collapsed tab (YAZ-6097, YAZ-6104): collapse all folders and
        // reset scroll/selection without changing lens so Cmd+T's Search stays open and switching to Files starts clean.
        if (from !== undefined) dispatch({ type: 'setAll', dirs: [] })
        setShutStackFolders('focus', new Set())
        setShutStackFolders('favorites', new Set())
        if (placeNow.current.closedVaults.length > 0) onRestoreClosedVaults?.([])
        placeScroll.current = 0
        placeSelection.current = { lens: placeNow.current.lens, paths: [] }
      }
    }
  }, [perTab, activeTab])
  // Only once every vault's tree has landed (YAZ-5749): a mount reads its trees again, and a scroll written over no rows
  // is clamped to 0. The commit that lands them draws the rows, so this writes once, then holds nothing.
  useLayoutEffect(() => {
    if (placeScroll.current === null || !loaded || bodyRef.current === null) return
    bodyRef.current.scrollTop = placeScroll.current
    placeScroll.current = null
  })
  // The sidebar goes (hidden, or a vault switch): the tab on show keeps the place it showed, a New tab too (YAZ-5757). Before the DOM goes, for the scroll.
  useLayoutEffect(() => {
    const body = bodyRef.current
    return () => {
      const tab = placeTab.current
      if (placeNow.current.perTab && tab !== undefined) savePlace(tab, placeHere(body), mountEpoch.current)
    }
  }, [])

  return { skipQuietReveal, placeSelected, placeSelection }
}
