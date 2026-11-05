/**
 * THE HOVER ZOOM (YAZ-4447, D34; the sidebar's hover preview, YAZ-3028 D11, is the model). The pointer rests on a
 * picture tile for `TILE_ZOOM_DWELL_MS`; then ONE floating copy of its picture shows beside it, bigger. Leaving the
 * tile closes it, or stops the wait.
 *
 * CHEAP BY DESIGN ("i wouldnt want to add it if it would cause any bloat"):
 *  - a few listeners on the list (delegation) and two on the window, none on a tile, and none on `pointermove`;
 *  - one element, made at the first zoom and reused, outside React: a hover renders nothing;
 *  - the picture is the one the tile already shows (a copy of its `<img>` dataURL or its shape `<svg>`), so a hover asks
 *    no network; a tile with no picture yet has no zoom;
 *  - the background is the tile's own computed one, so the auto light or dark tile (YAZ-4443) comes with it.
 *
 * Nothing opens while the list scrolls (a scroll stops the wait and closes the zoom), with a mouse button down (a
 * drag), from keyboard focus (only the pointer is heard), or for a touch. A press or a key closes it; the same tile
 * opens it again only after the pointer leaves it and comes back.
 */

/** How long the pointer rests on a tile before its zoom opens: a little quicker than the sidebar's 400 ms. */
export const TILE_ZOOM_DWELL_MS = 350
/** The zoom is this many times the tile, and at most `TILE_ZOOM_MAX` px. */
export const TILE_ZOOM_SCALE = 3
export const TILE_ZOOM_MAX = 240
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
export function zoomPlacement(tile: { left: number; top: number; right: number; bottom: number }, width: number, height: number): ZoomBox {
  const size = Math.min(TILE_ZOOM_MAX, Math.round((tile.right - tile.left) * TILE_ZOOM_SCALE), width - 2 * GAP, height - 2 * GAP)
  const left = tile.left >= width - tile.right ? tile.left - GAP - size : tile.right + GAP
  const top = (tile.top + tile.bottom) / 2 - size / 2
  const clamp = (value: number, max: number) => Math.max(GAP, Math.min(value, max - GAP - size))
  return { left: clamp(left, width), top: clamp(top, height), size }
}

/** Starts the hover zoom on the tiles in `list`. Returns its stop. */
export function attachTileHoverZoom(list: HTMLElement): () => void {
  /** The card under the pointer: waiting, zoomed, or quiet after a press. */
  let card: HTMLElement | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let zoom: HTMLDivElement | null = null

  /** Stops the wait and hides the zoom; the card stays, so the pointer moving inside it does not start again. */
  const quiet = () => {
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
    const { left, top, size } = zoomPlacement(rect, window.innerWidth, window.innerHeight)
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
    zoom.replaceChildren(copy)
    zoom.hidden = false
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
