/**
 * THE CARD PREVIEW (YAZ-3343 D18): the sidebar's
 * own hover panel (`PreviewPanel`: a note's top, a board's picture, nothing for anything else) beside a card of the
 * tab board. Resting the pointer on a card for the sidebar's dwell opens it, while Settings › Preview on hover is on;
 * holding Space opens it at once for the highlighted card, whatever the setting — it is an explicit key.
 * The new tab page uses it too, beside a row (YAZ-3403): a row is its "card", with no Space of its own here. So do
 * the tab strip (below a tab), the linked mentions, a note's [[links]] and the folder views (YAZ-3403).
 *
 * Isolated as the sidebar's is: the card lives in a tiny store the board writes and only the panel reads, so a
 * pointer crossing cards re-renders the panel and nothing else — never the board or a card.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { isBoard, isMarkdown } from '@shared/fileKind'
import type { DiagramDarkColors } from '@shared/types'
import type { WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import type { WatchSource } from '../hooks/useWatch'
import { createStore, type Store } from '../lib/store'
import { HOVER_PREVIEW_DWELL_MS, loadNotePreview, PreviewPanel } from '../sidebar/HoverPreviewHost'
import type { AnchorRect, PreviewSide } from '../sidebar/previewPlacement'

/** The card the pointer rests on, or Space holds — pending until the dwell ends, then shown beside `rect`. */
export interface CardPreviewState {
  id: string | null
  path: string | null
  shown: boolean
  /** The card's box on screen when the panel opened: a pan or a zoom closes the panel, so it never goes stale. */
  rect: AnchorRect | null
  by: 'hover' | 'space' | null
}

const NONE: CardPreviewState = { id: null, path: null, shown: false, rect: null, by: null }
const previews = (path: string): boolean => isBoard(path) || isMarkdown(path)

/**
 * App's Space panel shows (the search's or the new tab page's): no hover dwell starts, in any place (YAZ-3403). App
 * writes it, and a dwell reads it live, so the Space panel opening draws no editor, tab or row.
 */
export const spacePanel = { shown: false }

/** `box` holds the middle of `rect`: a scroll of that box moves what `rect` marks. */
const holds = (box: AnchorRect, rect: AnchorRect): boolean => {
  const x = (rect.left + rect.right) / 2
  const y = (rect.top + rect.bottom) / 2
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
}

/**
 * The board's half: the store, the dwell, and every close. `find` gives a card's element by card id, or the box the
 * panel sits beside where no one element is it (a linked mention's row, a [[link]] in a note — YAZ-3403).
 */
export function useCardPreview(hoverOn: boolean, find: (id: string) => HTMLElement | AnchorRect | null) {
  const [store] = useState(() => createStore<CardPreviewState>({ ...NONE }))
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const request = useRef(0)
  const live = useRef({ hoverOn, find })
  live.current = { hoverOn, find }
  const rectOf = (id: string): AnchorRect | null => {
    const at = live.current.find(id)
    if (at === null || !(at instanceof Element)) return at
    const box = at.getBoundingClientRect()
    return { left: box.left, top: box.top, right: box.right, bottom: box.bottom }
  }
  const close = useCallback(() => {
    request.current++
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    store.set({ ...NONE })
  }, [store])
  /** The pointer is on a card: the same card keeps its dwell or its panel; another starts its own dwell. */
  const hoverCard = useCallback(
    (id: string, path: string) => {
      const now = store.getState()
      if (now.by === 'space' || (now.id === id && now.by === 'hover')) return
      close()
      if (!live.current.hoverOn || spacePanel.shown || !previews(path)) return
      const ask = request.current
      store.set({ id, path, shown: false, rect: null, by: 'hover' })
      // A note's chunk starts loading with the dwell, as in the sidebar.
      if (isMarkdown(path)) loadNotePreview().catch(() => undefined)
      timer.current = setTimeout(() => {
        timer.current = null
        if (ask === request.current) store.set({ shown: true, rect: rectOf(id) })
      }, HOVER_PREVIEW_DWELL_MS)
    },
    [store, close],
  )
  /** The pointer left a card: its pending or shown hover panel goes. */
  const leaveCard = useCallback(
    (id: string) => {
      const now = store.getState()
      if (now.by === 'hover' && now.id === id) close()
    },
    [store, close],
  )
  /** Space on the highlighted card: its panel at once, whatever the setting. */
  const showNow = useCallback(
    (id: string, path: string) => {
      close()
      if (!previews(path)) return
      store.set({ id, path, shown: true, rect: rectOf(id), by: 'space' })
    },
    [store, close],
  )
  /** Space let go: only Space's panel goes. */
  const endSpace = useCallback(() => {
    if (store.getState().by === 'space') close()
  }, [store, close])
  // The setting turned off closes a hover panel; the board going closes everything, and no dwell outlives it.
  useEffect(() => {
    if (!hoverOn && store.getState().by === 'hover') close()
  }, [hoverOn, store, close])
  useEffect(() => close, [close])
  // A key, a click or the wheel ends the glance (YAZ-3403): the reader is doing something else. A scroll ends it when it
  // moves the item: the page's, or a box's that holds the item (an element, or a box over the item's spot). Listened
  // to only while a hover dwell or panel is live, off the store, so the owner never re-renders for it; Space holds its
  // own panel.
  useEffect(() => {
    const onScroll = ({ target }: Event) => {
      const { id } = store.getState()
      const at = id === null ? null : live.current.find(id)
      if (at === null || !(target instanceof Element) || (at instanceof Element ? target.contains(at) : holds(target.getBoundingClientRect(), at))) close()
    }
    const events = [['scroll', onScroll], ['keydown', close], ['mousedown', close], ['wheel', close]] as const
    let on = false
    const follow = () => {
      const want = store.getState().by === 'hover'
      if (want === on) return
      on = want
      for (const [type, listener] of events) {
        if (want) window.addEventListener(type, listener, true)
        else window.removeEventListener(type, listener, true)
      }
    }
    const unsubscribe = store.subscribe(follow)
    return () => {
      unsubscribe()
      if (on) for (const [type, listener] of events) window.removeEventListener(type, listener, true)
    }
  }, [store, close])
  return { store, hoverCard, leaveCard, showNow, endSpace, close }
}

/** What the panel needs of a card's vault, from App: its links, its text formatting, its watch feed. */
export interface PreviewScope {
  root: string | null
  wikilinks: WikilinkResolveSource
  textVars: CSSProperties
  watch?: WatchSource
}

/** The panel's half: it alone reads the store. `side` puts the panel under the card (a tab of the strip) or at the window's right edge (a linked mention), not beside it. */
export function CardPreviewHost({ store, cardOf, scopeOf, diagramDarkColors, side }: { store: Store<CardPreviewState>; cardOf: (id: string, path: string) => { root: string | null; name: string } | null; scopeOf?: (path: string) => PreviewScope; diagramDarkColors: DiagramDarkColors; side?: PreviewSide }) {
  const { id, path, shown, rect } = useSyncExternalStore(store.subscribe, store.getState)
  if (!shown || id === null || path === null || rect === null || scopeOf === undefined) return null
  const card = cardOf(id, path)
  if (card === null) return null
  const scope = scopeOf(path)
  // A card of another window may be of a vault this window does not show: its own window's vault names it.
  const root = card.root ?? scope.root
  if (root === null) return null
  return <PreviewPanel key={`${id}\n${path}`} path={path} root={root} name={card.name} wikilinks={scope.wikilinks} textVars={scope.textVars} watch={scope.watch} diagramDarkColors={diagramDarkColors} anchor={{ rect, side }} />
}
