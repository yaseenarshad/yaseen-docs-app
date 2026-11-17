import { useCallback, useState } from 'react'
import { ZOOM_MAX, ZOOM_MIN, stepZoom } from '@client/editor/zoomSteps'
import { readReviewZoom, writeReviewZoom } from '../store/reviewZoomPref'

/**
 * THE PHONE REVIEW'S ZOOM (YAZ-5706): the card bigger or smaller, on the Mac's Review zoom steps (`zoomSteps.ts`,
 * 50–400%), kept on this phone (`reviewZoomPref.ts`). The card carries it as `--review-zoom` and its parts scale with CSS
 * zoom (review.css), so they reflow in the card's width: the vault's Card text size is multiplied, never replaced.
 */
export function useReviewZoom(): [number, (next: number) => void] {
  const [zoom, setZoom] = useState(readReviewZoom)
  const change = useCallback((next: number) => {
    setZoom(next)
    writeReviewZoom(next)
  }, [])
  return [zoom, change]
}

/** The card's style for a zoom: none at 100%. */
export const zoomStyle = (zoom: number): Record<string, string> => (zoom === 100 ? {} : { '--review-zoom': String(zoom / 100) })

/**
 * The ⋯ menu's Zoom row: "Zoom   − 100% +", each a touch-sized button. − and + walk the steps and turn off at the
 * walls; a tap on the percent is 100% again. None closes the menu, so several taps in a row work.
 */
export function ZoomRow({ zoom, onZoom }: { zoom: number; onZoom: (next: number) => void }) {
  return (
    <div className="review__menu-row review__zoom" role="group" aria-label="Card zoom">
      <span className="review__zoom-label" aria-hidden="true">
        Zoom
      </span>
      <span className="review__zoom-steps">
        <button type="button" role="menuitem" data-zoom="out" aria-label="Zoom the card out" disabled={zoom <= ZOOM_MIN} onClick={() => onZoom(stepZoom(zoom, -1) ?? zoom)}>
          −
        </button>
        <button type="button" role="menuitem" data-zoom="reset" aria-label={`Card zoom ${zoom}%. Tap for 100%`} onClick={() => onZoom(100)}>
          {`${zoom}%`}
        </button>
        <button type="button" role="menuitem" data-zoom="in" aria-label="Zoom the card in" disabled={zoom >= ZOOM_MAX} onClick={() => onZoom(stepZoom(zoom, 1) ?? zoom)}>
          +
        </button>
      </span>
    </div>
  )
}
