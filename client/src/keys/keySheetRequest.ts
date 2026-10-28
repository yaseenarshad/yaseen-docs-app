/**
 * "Show the keys of this tab" from inside an editor (YAZ-3564 K11): ? on a drawing asks for the sheet App draws,
 * without a prop through every layer between them. One listener per window (App's); the event carries nothing.
 */
const requests = new EventTarget()

export function requestKeySheet(): void {
  requests.dispatchEvent(new Event('open'))
}

export function onKeySheetRequest(listener: () => void): () => void {
  requests.addEventListener('open', listener)
  return () => requests.removeEventListener('open', listener)
}
