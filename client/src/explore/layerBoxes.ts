/**
 * Layers that move like a cell note (YAZ-2571 round 3): drag a layer's head (a search's top edge) to move it, its
 * 8 grips to resize it, double-click the head to put it back in its stack place. The stack renders no place of
 * its own: every layer's box is written to its style here (`layerBoxes` says where each stands), on mount, on a
 * change of the list or of the window, and on each pointer move of a drag. A pointer move writes `left`, `top`,
 * `width` and `height` and nothing else: nothing renders and no layout is read while the pointer moves (the mini
 * window's rule, `NoteWindow.tsx`). The first layer's box is kept for this window (`saveLayerBox`).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, type MouseEvent as ReactMouseEvent, type RefObject } from 'react'
import { layerBoxes, MIN_BOX_HEIGHT, MIN_BOX_WIDTH, savedLayerBox, saveLayerBox, type ExploreLayer, type LayerBox } from './layers'

/** The eight resize grips: an edge or a corner, and its sides (-1 left or top, 1 right or bottom). */
export const GRIPS: ReadonlyArray<{ name: string; x: -1 | 0 | 1; y: -1 | 0 | 1; cursor: string }> = [
  { name: 'n', x: 0, y: -1, cursor: 'ns-resize' },
  { name: 's', x: 0, y: 1, cursor: 'ns-resize' },
  { name: 'e', x: 1, y: 0, cursor: 'ew-resize' },
  { name: 'w', x: -1, y: 0, cursor: 'ew-resize' },
  { name: 'nw', x: -1, y: -1, cursor: 'nwse-resize' },
  { name: 'se', x: 1, y: 1, cursor: 'nwse-resize' },
  { name: 'ne', x: 1, y: -1, cursor: 'nesw-resize' },
  { name: 'sw', x: -1, y: 1, cursor: 'nesw-resize' },
]
export type Grip = (typeof GRIPS)[number]

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, max))

export interface LayerGestures {
  /** A press on a layer's head (a search's top edge): the layer follows the pointer until the drop. A button in the head is its own. */
  onHeadDown: (id: number, event: ReactMouseEvent) => void
  onGripDown: (id: number, grip: Grip, event: ReactMouseEvent) => void
  /** The double click on the head: back to the layer's stack place and size. */
  reset: (id: number, event: ReactMouseEvent) => void
}

export function useLayerBoxes(rootRef: RefObject<HTMLDivElement | null>, layers: readonly ExploreLayer[], W: number, H: number): LayerGestures {
  const layersRef = useRef(layers)
  layersRef.current = layers
  const size = useRef({ W, H })
  size.current = { W, H }
  /** The layers moved or resized by hand, by id: each stands in its own box (`layerBoxes`). */
  const moved = useRef(new Map<number, LayerBox>())
  /** Where each layer stands now, as last written: what a drag starts from, so a press reads no layout. */
  const boxes = useRef(new Map<number, LayerBox>())
  const seeded = useRef(false)

  const layerEl = useCallback((id: number): HTMLElement | null => rootRef.current?.querySelector<HTMLElement>(`[data-layer="${id}"]`) ?? null, [rootRef])

  /** Every layer's box to its style: ≤ 12 style writes, no read. */
  const placeAll = useCallback(() => {
    const list = layersRef.current
    const all = layerBoxes(list, moved.current, size.current.W, size.current.H)
    boxes.current.clear()
    list.forEach((layer, i) => {
      const box = all[i]
      boxes.current.set(layer.id, box)
      const el = layerEl(layer.id)
      if (el === null) return
      el.style.left = `${box.x}px`
      el.style.top = `${box.y}px`
      el.style.width = `${box.width}px`
      if (box.height === null) {
        el.style.height = ''
        el.style.maxHeight = ''
        delete el.dataset.sized
      } else {
        el.style.height = `${box.height}px`
        el.style.maxHeight = 'none'
        el.dataset.sized = ''
      }
    })
  }, [layerEl])

  useLayoutEffect(() => {
    // The first layer opens where the last first layer of its kind was left (kept in this window's localStorage).
    const first = layersRef.current[0]
    if (first !== undefined && !seeded.current) {
      seeded.current = true
      const kept = savedLayerBox(first.kind)
      if (kept !== null) moved.current.set(first.id, kept)
    }
    // A layer that left takes its box with it: the map holds the layers on screen only.
    const ids = new Set(layersRef.current.map((l) => l.id))
    for (const id of [...moved.current.keys()]) if (!ids.has(id)) moved.current.delete(id)
    placeAll()
  }, [layers, W, H, placeAll])

  /**
   * Before a layer behind moves (round 6: every layer you see takes the pointer): the layers over it in the list that
   * were never moved stay where they stand now, so they do not follow it. "Next to the layer under it" places a NEW layer.
   */
  const pinAbove = useCallback((id: number) => {
    const list = layersRef.current
    for (const layer of list.slice(list.findIndex((l) => l.id === id) + 1)) {
      const box = boxes.current.get(layer.id)
      if (box !== undefined && !moved.current.has(layer.id)) moved.current.set(layer.id, box)
    }
  }, [])

  /** After a drag, a resize or a reset of the FIRST layer: its box is kept for the next stack of this window. */
  const keep = useCallback((id: number) => {
    const first = layersRef.current[0]
    if (first === undefined || first.id !== id) return
    saveLayerBox(first.kind, moved.current.get(id) ?? null)
  }, [])

  /** The drag on its way, if any: its listeners go at the drop, and with the stack. */
  const stop = useRef<(() => void) | null>(null)
  useEffect(() => () => stop.current?.(), [])

  /** A pointer drag: `move` on each move, the cursor on the whole stack until the drop. */
  const track = useCallback(
    (id: number, cursor: string, start: ReactMouseEvent, move: (dx: number, dy: number) => void) => {
      stop.current?.()
      const root = rootRef.current
      root?.style.setProperty('--explore-cursor', cursor)
      root?.classList.add('explore--tracking')
      const onMove = (event: MouseEvent) => move(event.clientX - start.clientX, event.clientY - start.clientY)
      const onUp = () => {
        stop.current?.()
        keep(id)
      }
      stop.current = () => {
        window.removeEventListener('mousemove', onMove, true)
        window.removeEventListener('mouseup', onUp, true)
        root?.classList.remove('explore--tracking')
        stop.current = null
      }
      window.addEventListener('mousemove', onMove, true)
      window.addEventListener('mouseup', onUp, true)
    },
    [rootRef, keep],
  )

  const onHeadDown = useCallback(
    (id: number, event: ReactMouseEvent) => {
      if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button, input') !== null)) return
      const from = boxes.current.get(id)
      if (from === undefined) return
      // The keyboard stays where it is (the reading body, the editor): the press takes no focus.
      event.preventDefault()
      pinAbove(id)
      track(id, 'grabbing', event, (dx, dy) => {
        moved.current.set(id, { ...from, x: from.x + dx, y: from.y + dy })
        placeAll()
      })
    },
    [track, placeAll, pinAbove],
  )

  const onGripDown = useCallback(
    (id: number, grip: Grip, event: ReactMouseEvent) => {
      if (event.button !== 0) return
      const box = boxes.current.get(id)
      const el = layerEl(id)
      if (box === undefined || el === null) return
      event.preventDefault()
      event.stopPropagation()
      // The height of a layer never resized is the CSS's: read once, at the press.
      const from = { ...box, height: box.height ?? el.offsetHeight }
      const { W, H } = size.current
      const right = from.x + from.width
      const bottom = from.y + from.height
      pinAbove(id)
      track(id, grip.cursor, event, (dx, dy) => {
        let { x, y, width, height } = from
        if (grip.x === 1) width = clamp(from.width + dx, MIN_BOX_WIDTH, Math.max(MIN_BOX_WIDTH, W - x))
        if (grip.x === -1) {
          width = clamp(from.width - dx, MIN_BOX_WIDTH, Math.max(MIN_BOX_WIDTH, right))
          x = right - width
        }
        if (grip.y === 1) height = clamp(from.height + dy, MIN_BOX_HEIGHT, Math.max(MIN_BOX_HEIGHT, H - y))
        if (grip.y === -1) {
          height = clamp(from.height - dy, MIN_BOX_HEIGHT, Math.max(MIN_BOX_HEIGHT, bottom))
          y = bottom - height
        }
        moved.current.set(id, { x, y, width, height })
        placeAll()
      })
    },
    [layerEl, track, placeAll, pinAbove],
  )

  const reset = useCallback(
    (id: number, event: ReactMouseEvent) => {
      if (event.target instanceof Element && event.target.closest('button, input') !== null) return
      pinAbove(id)
      moved.current.delete(id)
      placeAll()
      keep(id)
    },
    [placeAll, keep, pinAbove],
  )

  return { onHeadDown, onGripDown, reset }
}
