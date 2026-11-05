/**
 * THE HOVER ZOOM (YAZ-4447, D34; the sidebar's hover preview, YAZ-3028 D11, is the model). The pointer rests on a
 * picture tile for `TILE_ZOOM_DWELL_MS`; then ONE floating copy of its picture shows beside it, bigger. Leaving the
 * tile closes it, or stops the wait.
 *
 * CHEAP BY DESIGN ("i wouldnt want to add it if it would cause any bloat"):
 *  - a few listeners on the list (delegation) and two on the window, none on a tile, and none on `pointermove`;
 *  - one element, made at the first zoom and reused, outside React: a hover renders nothing;
 *  - the picture is the one the tile already shows (a copy of its `<img>` dataURL or its shape `<svg>`), so it opens at
 *    once; a tile with no picture yet has no zoom;
 *  - a Pixabay picture (the card's `data-zoom`, its id) then turns sharp (demo round 2: "the cost of a bigger photo"):
 *    ONE `media:preview` asks its `webformatURL` at the width that fits the box (`zoomWidthFor`), and the picture swaps
 *    in when it has loaded, in the same box. The last `ZOOM_CACHE_LIMIT` stay (`zoomCache`), so a second hover asks
 *    nothing. An icon, a shape or a drawing has no `data-zoom`: it is an SVG or a local picture, and asks nothing. A
 *    failed ask (offline) keeps the small picture and says nothing. A pointer that leaves first gets no swap; the
 *    answer still goes in the cache (an IPC call cannot be stopped half way; the bytes are already here);
 *  - the background is the tile's own computed one, so the auto light or dark tile (YAZ-4443) comes with it.
 *
 * Nothing opens while the list scrolls (a scroll stops the wait and closes the zoom), with a mouse button down (a
 * drag), from keyboard focus (only the pointer is heard), or for a touch. A press or a key closes it; the same tile
 * opens it again only after the pointer leaves it and comes back.
 */

import { MEDIA_ZOOM_WIDTHS, type MediaHoverZoomSize, type MediaZoomWidth } from '@shared/types'

/** How long the pointer rests on a tile before its zoom opens: a little quicker than the sidebar's 400 ms. */
export const TILE_ZOOM_DWELL_MS = 350
/**
 * The sizes (demo round 2, Filter › Hover size): the zoom is `scale` times the tile, and at most `max` px. Small is the
 * first version, Medium the "even bigger" one of round 2 (the default), Large bigger again.
 */
export const TILE_ZOOM_SIZES: Record<MediaHoverZoomSize, { scale: number; max: number }> = {
  small: { scale: 3, max: 240 },
  medium: { scale: 8, max: 640 },
  large: { scale: 12, max: 960 },
}
/** The sharp pictures the zoom keeps, the last used last; past it the oldest goes (its dataURL with it). */
export const ZOOM_CACHE_LIMIT = 40
/** The room between the zoom and its tile, and between the zoom and the window's edges. */
const GAP = 8

export interface ZoomBox {
  left: number
  top: number
  size: number
}

/**
 * Where the zoom of a tile at `tile` stands in a `width` × `height` window: beside the tile on the side with more room,
 * centred on it, and moved inside the window.
 */
export function zoomPlacement(tile: { left: number; top: number; right: number; bottom: number }, width: number, height: number, zoomSize: MediaHoverZoomSize = 'medium'): ZoomBox {
  const { scale, max } = TILE_ZOOM_SIZES[zoomSize]
  const size = Math.min(max, Math.round((tile.right - tile.left) * scale), width - 2 * GAP, height - 2 * GAP)
  const left = tile.left >= width - tile.right ? tile.left - GAP - size : tile.right + GAP
  const top = (tile.top + tile.bottom) / 2 - size / 2
  const clamp = (value: number, max: number) => Math.max(GAP, Math.min(value, max - GAP - size))
  return { left: clamp(left, width), top: clamp(top, height), size }
}

/** The Pixabay width for a `size` px box on this screen: the smallest that covers it, else the largest. */
export function zoomWidthFor(size: number, pixelRatio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1): MediaZoomWidth {
  const want = size * Math.min(pixelRatio, 2)
  return MEDIA_ZOOM_WIDTHS.find((w) => w >= want) ?? MEDIA_ZOOM_WIDTHS[MEDIA_ZOOM_WIDTHS.length - 1]
}

/** Asks main for a Pixabay item's picture at `width`; answers its dataURL. */
export type ZoomLoader = (id: string, width: MediaZoomWidth) => Promise<string>

/** The sharp pictures, keyed `<id>@<width>`, oldest first (a `Map` keeps insertion order). Module scope: a reopened panel keeps them. */
const zoomCache = new Map<string, string>()
/** The asks on their way, so a second hover of the same picture waits for the first. */
const zoomAsks = new Map<string, Promise<string | null>>()
export const clearZoomCache = () => {
  zoomCache.clear()
  zoomAsks.clear()
}
/** How many sharp pictures are kept now (tests). */
export const zoomCacheSize = () => zoomCache.size

function cached(key: string): string | undefined {
  const hit = zoomCache.get(key)
  if (hit !== undefined) {
    zoomCache.delete(key)
    zoomCache.set(key, hit)
  }
  return hit
}

function ask(key: string, load: () => Promise<string>): Promise<string | null> {
  const going = zoomAsks.get(key)
  if (going !== undefined) return going
  const asked = load().then(
    (dataURL) => {
      zoomCache.set(key, dataURL)
      // Dropping the oldest entry drops the only reference to its dataURL, so its memory can go.
      while (zoomCache.size > ZOOM_CACHE_LIMIT) zoomCache.delete(zoomCache.keys().next().value as string)
      return dataURL
    },
    () => null,
  )
  zoomAsks.set(key, asked)
  void asked.finally(() => zoomAsks.delete(key))
  return asked
}

/** `src` once it is decoded, so the swap shows it whole; null for a picture that does not decode. */
function decoded(src: string): Promise<string | null> {
  const image = new Image()
  image.src = src
  return typeof image.decode === 'function' ? image.decode().then(() => src, () => null) : Promise.resolve(src)
}

export interface TileHoverZoomOptions {
  /** Filter › Hover size; default Medium. */
  size?: MediaHoverZoomSize
  /** The sharp picture of a card with `data-zoom`; absent = the tile's picture only. */
  load?: ZoomLoader
}

/** Starts the hover zoom on the tiles in `list`. Returns its stop. */
export function attachTileHoverZoom(list: HTMLElement, { size: zoomSize = 'medium', load }: TileHoverZoomOptions = {}): () => void {
  /** The card under the pointer: waiting, zoomed, or quiet after a press. */
  let card: HTMLElement | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let zoom: HTMLDivElement | null = null
  /** Counts the zooms opened and closed: a sharp picture that comes back after its zoom closed is not shown. */
  let shown = 0

  /** Stops the wait and hides the zoom; the card stays, so the pointer moving inside it does not start again. */
  const quiet = () => {
    shown++
    if (timer !== null) clearTimeout(timer)
    timer = null
    // Read first: a key anywhere comes here, and a hidden zoom must cost the keystroke no DOM write.
    if (zoom !== null && !zoom.hidden) zoom.hidden = true
  }

  const show = (target: HTMLElement) => {
    const tile = target.querySelector<HTMLElement>('.image-studio__preview')
    const picture = tile?.querySelector('img, svg')
    if (!target.isConnected || tile == null || picture == null) return
    const rect = tile.getBoundingClientRect()
    if (rect.width === 0) return
    if (zoom === null) {
      zoom = document.createElement('div')
      zoom.className = 'image-studio__zoom'
      zoom.setAttribute('aria-hidden', 'true')
      document.body.append(zoom)
    }
    const { left, top, size } = zoomPlacement(rect, window.innerWidth, window.innerHeight, zoomSize)
    const look = getComputedStyle(tile)
    const copy = picture.cloneNode(true) as HTMLElement | SVGElement
    copy.removeAttribute('loading')
    // A shape's outline follows the panel's text colour, which the body does not have.
    if (copy instanceof SVGElement) copy.style.color = getComputedStyle(picture).color
    Object.assign(zoom.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${size}px`,
      height: `${size}px`,
      backgroundColor: look.backgroundColor,
      backgroundImage: look.backgroundImage,
      backgroundPosition: look.backgroundPosition,
      backgroundSize: look.backgroundSize,
    })
    const id = target.dataset.zoom
    const key = id === undefined || load === undefined || !(copy instanceof HTMLImageElement) ? null : `${id}@${zoomWidthFor(size)}`
    // A kept sharp picture shows at once: no small one first.
    const sharp = key === null ? undefined : cached(key)
    if (sharp !== undefined) (copy as HTMLImageElement).src = sharp
    zoom.replaceChildren(copy)
    zoom.hidden = false
    if (key === null || sharp !== undefined || id === undefined || load === undefined) return
    const now = ++shown
    void ask(key, () => load(id, zoomWidthFor(size)))
      .then((dataURL) => (dataURL === null ? null : decoded(dataURL)))
      .then((dataURL) => {
        // Gone, or another zoom since: no swap. Else the same <img> takes the decoded source: no flash, the box stays.
        if (dataURL !== null && now === shown && copy.isConnected) (copy as HTMLImageElement).src = dataURL
      })
  }

  const over = (event: PointerEvent) => {
    const next = (event.target as Element).closest<HTMLElement>('.image-studio__card')
    if (next === card) return
    quiet()
    card = next
    if (next === null || event.buttons !== 0 || event.pointerType === 'touch') return
    timer = setTimeout(() => {
      timer = null
      if (card === next) show(next)
    }, TILE_ZOOM_DWELL_MS)
  }
  const out = (event: PointerEvent) => {
    if (card === null || card.contains(event.relatedTarget as Node | null)) return
    quiet()
    card = null
  }

  list.addEventListener('pointerover', over)
  list.addEventListener('pointerout', out)
  list.addEventListener('pointerdown', quiet)
  // A key anywhere (a search typed while the pointer rests on a tile changes the tiles), or the window losing focus.
  window.addEventListener('keydown', quiet, true)
  window.addEventListener('blur', quiet)
  // A scroll does not bubble; the capture phase hears the list's and the pack page's alike.
  list.addEventListener('scroll', quiet, true)
  return () => {
    quiet()
    list.removeEventListener('pointerover', over)
    list.removeEventListener('pointerout', out)
    list.removeEventListener('pointerdown', quiet)
    window.removeEventListener('keydown', quiet, true)
    window.removeEventListener('blur', quiet)
    list.removeEventListener('scroll', quiet, true)
    zoom?.remove()
  }
}
