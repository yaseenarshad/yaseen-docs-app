/**
 * THE TOUR'S DOOR INTO THE APP (YAZ-5123, issue 6E): the one small part of the guided tour that the window loads at
 * start. Everything else of the tour is in the lazy course chunk.
 *
 * - `tourEvent(name, detail?)`: the real components call it at the moment of a real action (one line each). With no
 *   tour running, it does nothing: there is no listener.
 * - `tourPlaces()`: the places the tour needs a mark on (the Course Cards folder, its Course page), so the sidebar can
 *   put `data-tour` on their rows. Null outside a tour.
 * - `showTourPlace(place)`: "Show me". App brings the place into view with its own navigation (`onTourShow`).
 */

/** The app events a tour step can wait for (`TourStep.done.event` in `script.ts`). */
export const TOUR_EVENTS = [
  'folder-menu-open',
  'card-file-created',
  'card-file-open',
  'card-edit-open',
  'card-text-changed',
  'card-word-hidden',
  'card-side-added',
  'card-edit-done',
  'link-picker-open',
  'card-link-added',
  'inbox-step-shown',
  'inbox-answered',
  'card-embedded',
  'tour-next',
] as const
type TourEventName = (typeof TOUR_EVENTS)[number]

type EventListener = (name: TourEventName, detail?: string) => void
let listener: EventListener | null = null

/** A real action happened. `detail`: the path it concerns, when there is one (a folder, a card file). */
export function tourEvent(name: TourEventName, detail?: string): void {
  listener?.(name, detail)
}

/** The running tour listens (one at a time). Returns the way to stop. */
export function listenTour(fn: EventListener): () => void {
  listener = fn
  return () => {
    if (listener === fn) listener = null
  }
}

/** The places of the running tour: absolute paths. */
export interface TourPlaces {
  folder: string | null
  page: string | null
}
const NO_PLACES: TourPlaces = { folder: null, page: null }
let places: TourPlaces = NO_PLACES
const placeWatchers = new Set<() => void>()

export const tourPlaces = (): TourPlaces => places
export function subscribeTourPlaces(fn: () => void): () => void {
  placeWatchers.add(fn)
  return () => placeWatchers.delete(fn)
}
export function setTourPlaces(next: TourPlaces | null): void {
  const value = next ?? NO_PLACES
  if (value.folder === places.folder && value.page === places.page) return
  places = value
  placeWatchers.forEach((fn) => fn())
}

/** Where "Show me" takes the person. */
export type TourPlace =
  | { kind: 'sidebar' }
  | { kind: 'folder'; path: string }
  | { kind: 'file'; path: string }
  | { kind: 'review-folder'; path: string }
  | { kind: 'inbox'; path: string }
  | { kind: 'settings'; page?: 'cards' }

let shower: ((place: TourPlace) => void) | null = null
/** App's navigation. Returns the way to stop. */
export function onTourShow(fn: (place: TourPlace) => void): () => void {
  shower = fn
  return () => {
    if (shower === fn) shower = null
  }
}
export function showTourPlace(place: TourPlace): void {
  shower?.(place)
}
