import { ZOOM_STEPS } from '@client/editor/zoomSteps'

/**
 * THE REVIEW ZOOM KEPT ON THIS PHONE (YAZ-5706): the ⋯ menu's Zoom, one percent for every vault, in `localStorage`.
 * Not the vault's data (the Mac keeps its Inbox zoom on the Mac, `inbox:zoom`): never written into a file, never
 * synced. Only one of the Mac's zoom steps (`ZOOM_STEPS`); anything else reads as 100. 100 is never written. Every read
 * and write is in try/catch: Private Browsing or a full phone keeps the zoom while the app is open.
 */
export const REVIEW_ZOOM_KEY = 'notecard.reviewZoom'

export type ZoomStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const local = (): ZoomStorage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function readReviewZoom(storage: ZoomStorage | null = local()): number {
  try {
    const raw = storage?.getItem(REVIEW_ZOOM_KEY)
    const n = raw == null || raw === '' ? NaN : Number(raw)
    return (ZOOM_STEPS as readonly number[]).includes(n) ? n : 100
  } catch {
    return 100
  }
}

export function writeReviewZoom(zoom: number, storage: ZoomStorage | null = local()): void {
  try {
    if (zoom === 100) storage?.removeItem(REVIEW_ZOOM_KEY)
    else storage?.setItem(REVIEW_ZOOM_KEY, String(zoom))
  } catch {
    // No storage here: the zoom lasts while the app is open.
  }
}
