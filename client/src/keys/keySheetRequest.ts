import type { KeyScope } from '@shared/keys'

/**
 * "Show the keys of this tab" from inside an editor (YAZ-3564 K11): ? on a drawing asks for the sheet App draws,
 * without a prop through every layer between them. One listener per window (App's); the event carries nothing.
 */
const requests = new EventTarget()

/** A place open OVER the tab (a drawing over a note): the sheet lists its keys, not the tab's. */
let overTab: KeyScope | null = null

export function setPlaceOverTab(place: KeyScope | null): void {
  overTab = place
}

export function placeOverTab(): KeyScope | null {
  return overTab
}

export function requestKeySheet(): void {
  requests.dispatchEvent(new Event('open'))
}

export function onKeySheetRequest(listener: () => void): () => void {
  requests.addEventListener('open', listener)
  return () => requests.removeEventListener('open', listener)
}
