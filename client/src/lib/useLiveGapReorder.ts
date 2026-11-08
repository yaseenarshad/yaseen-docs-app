import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { dropIndex, slotAt, type Axis } from './dragSlot'
import { edgeScroller } from './edgeScroll'
import { drawnPlaces, glide, motionOff, partGap, partShift, partTransform, roomOf, useEndSlides } from './liveGap'
import './liveGap.css'

/** The attribute that names a reorderable item by its key (YAZ-4606): the slot, the room and the glide find items by it. */
export const LIVE_ITEM = 'data-live-item'
const ITEM = `[${LIVE_ITEM}]`
/** The grabbed item, once it has left the list: it stood nowhere, so it does not glide. */
const LIFTED = 'data-live-lifted'

/** A drag in flight: the grabbed item's index, the slot (0…items) under the pointer, its room, whether it has left the list, and the list it began in. */
interface LiveDrag {
  from: number
  over: number | null
  room: number
  lifted: boolean
  list: string
}

export interface LiveGapOptions {
  axis: Axis
  /** Each item's identity, in order: a drag holds only while the list stays the same, and a new order of the same items glides. */
  keys: readonly string[]
  /** The drop: the item at `from` lands at final index `to`. Never called for a drop that moves nothing: ONE write per move. */
  onMove: (from: number, to: number) => void
  /** The slot at a client coordinate on the axis, from layout places. Default: each item's midpoint in the container (`slotAt`). */
  slotAt?: (at: number) => number
  /** The room the item at `i` leaves, in px, where the layout already knows it (a table's fixed widths). Default: read from the item when the drag starts. */
  roomOf?: (i: number) => number
  /** What scrolls at the ends while a drag is held there. Default: the container's nearest scroller, found when the drag starts. */
  scroller?: () => HTMLElement | null
  /** The elements that move with each item, the item first (a table column's cells), for the glide and the slide cancel. Default: the items. */
  cells?: () => Iterable<HTMLElement>
  /** The key of one of `cells`. Default: its `data-live-item`. */
  keyOfCell?: (el: HTMLElement) => string
}

/** The nearest element at or above `el` that scrolls along the axis: read once, when a drag starts. */
function scrollParent(el: HTMLElement | null, axis: Axis): HTMLElement | null {
  for (let at = el; at !== null; at = at.parentElement) {
    const style = getComputedStyle(at)
    const overflow = axis === 'x' ? style.overflowX : style.overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && (axis === 'x' ? at.scrollWidth > at.clientWidth : at.scrollHeight > at.clientHeight)) return at
  }
  return null
}

const keyOfItem = (el: HTMLElement): string => el.getAttribute(LIVE_ITEM) ?? ''

/**
 * ONE smooth drag for a list (YAZ-4606 D58), modeled on the tab bar (YAZ-3808): HTML5 drag with the browser's picture
 * of the item; one frame later the item leaves the list (opacity 0), and the others part live with a transform to keep
 * an empty place where the drop would land. There is no drop line: the gap is the marker. The slot comes from layout
 * places, which the transforms do not move, so the gap cannot flicker. The list scrolls at its ends; Esc and a drag's
 * end cancel; a reorder glides each item from where it was drawn to its new place. Only transforms run during a drag.
 *
 * The container takes `ref` and `onDragOver`/`onDrop` (`over`, `drop`); each item takes `itemProps(i)`; the drag source
 * (the item or its grip) calls `start` and `end`, and writes its own payload type.
 */
export function useLiveGapReorder<T extends HTMLElement = HTMLElement>({ axis, keys, onMove, slotAt: measure, roomOf: knownRoom, scroller, cells, keyOfCell = keyOfItem }: LiveGapOptions) {
  const ref = useRef<T | null>(null)
  const list = keys.join('\n')
  const [state, setState] = useState<LiveDrag | null>(null)
  // A drag holds only while the list is the one it began in: a list replaced under it (another window) drops it.
  const drag = state !== null && state.list === list ? state : null
  const scrolls = useRef<HTMLElement | null>(null)
  const [edge] = useState(() => edgeScroller(() => scrolls.current, undefined, axis))
  useEffect(() => () => edge.stop(), [edge])

  const end = (): void => {
    edge.stop()
    setState(null)
  }
  // Esc cancels: a real drag fires `dragend`; jsdom, and any missed `dragend`, go through this (`useGroupDrag`'s idiom).
  // Subscribed once per drag, not once per slot the pointer crosses.
  const dragging = drag !== null
  useEffect(() => {
    if (!dragging) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      edge.stop()
      setState(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [dragging, edge])

  const pointOf = (e: DragEvent): number => (axis === 'x' ? e.clientX : e.clientY)
  /** The slot under the pointer: the ONE layout read of a `dragover`. */
  const slotOf = (e: DragEvent): number => {
    const at = pointOf(e)
    if (measure !== undefined) return measure(at)
    return ref.current === null ? keys.length : slotAt(ref.current, at, axis, ITEM)
  }

  /** The drag starts at item `i`: the room it leaves is read now, and it leaves the list one frame later, once the Mac has its picture. */
  const start = (e: DragEvent<HTMLElement>, i: number): void => {
    const item = e.currentTarget.closest<HTMLElement>(ITEM)
    scrolls.current = scroller?.() ?? scrollParent(ref.current, axis)
    const room = knownRoom?.(i) ?? (item === null ? 0 : roomOf(item, ref.current, axis))
    setState({ from: i, over: null, room, lifted: false, list })
    requestAnimationFrame(() => setState((now) => (now === null || now.from !== i ? now : { ...now, lifted: true })))
  }
  /** A `dragover` (and `dragenter`) on the list: true when this list's drag took it. */
  const over = (e: DragEvent<HTMLElement>): boolean => {
    if (drag === null) return false
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    edge.at(pointOf(e))
    const at = slotOf(e)
    if (drag.over !== at) setState({ ...drag, over: at })
    return true
  }
  const drop = (e: DragEvent<HTMLElement>): boolean => {
    if (drag === null) return false
    e.preventDefault()
    const to = dropIndex(drag.from, slotOf(e))
    end()
    if (to !== drag.from) onMove(drag.from, to)
    return true
  }

  const gap = drag === null ? null : partGap(drag.over, drag.from)
  const shiftOf = (i: number): number => (drag === null ? 0 : partShift(i, drag.from, gap, drag.room))
  const parting = drag !== null
  const lifted = (i: number): boolean => drag !== null && drag.lifted && drag.from === i
  /** An item's attributes: its key, whether it has left the list, and its slide in the gap. */
  const itemProps = (i: number): { [LIVE_ITEM]: string; [LIFTED]?: ''; style?: CSSProperties } => {
    const shift = shiftOf(i)
    return { [LIVE_ITEM]: keys[i], ...(lifted(i) ? { [LIFTED]: '' } : {}), ...(shift === 0 ? {} : { style: { transform: partTransform(shift, axis) } }) }
  }

  // THE GLIDE (YAZ-3808 D6): a new order of the same items — a drop, the arrow keys, another window — slides each item
  // from where it was drawn to where it stands now. The places before are read in the render that brings the new order,
  // while the list still shows the old one; the places after, as it commits. No reads on any other render.
  const order = useRef(keys)
  const glideFrom = useRef<Map<string, number> | null>(null)
  const items = (): HTMLElement[] => [...(ref.current?.querySelectorAll<HTMLElement>(ITEM) ?? [])]
  const reordered = keys.length === order.current.length && keys.some((k, i) => k !== order.current[i]) && keys.every((k) => order.current.includes(k))
  if (reordered && glideFrom.current === null && !motionOff()) glideFrom.current = drawnPlaces(ref.current, items().filter((el) => !el.hasAttribute(LIFTED)), keyOfItem, axis)
  useLayoutEffect(() => {
    order.current = keys
    const from = glideFrom.current
    glideFrom.current = null
    if (from === null) return
    glide(cells?.() ?? items(), keyOfCell, from, axis, drawnPlaces(ref.current, items(), keyOfItem, axis))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the order is what a glide follows
  }, [list])
  useEndSlides(parting, () => cells?.() ?? items())

  /** The list's own attributes: the container of the items, which takes the drag over it and the drop. */
  const listProps = { ref, 'data-live-list': '', 'data-live-parting': parting ? '' : undefined, onDragEnter: over, onDragOver: over, onDrop: drop }

  return { ref, drag, gap, parting, shiftOf, lifted, itemProps, listProps, start, over, drop, end }
}
