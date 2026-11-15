/**
 * YAZ-5526: A FINGER HELD ON A ROW SELECTS NOTHING. On the iPhone a long press starts the phone's own text selection
 * (over the whole screen when the finger is on no text: the hold menu opens under it) and its Copy, Look Up, Translate
 * bar. The CSS turns selection off on the rows and the chrome (`styles.css`); this also stops the phone's
 * `selectstart` and `contextmenu` from the press until the finger lifts, wherever the hold has moved them (the menu).
 * Returns the guard's end; it ends by itself at the lift.
 */
export function blockSelectionUntilLift(doc: Document = document): () => void {
  const lifts = ['pointerup', 'pointercancel', 'touchend', 'touchcancel'] as const
  const block = (e: Event) => e.preventDefault()
  const end = () => {
    doc.removeEventListener('selectstart', block, true)
    doc.removeEventListener('contextmenu', block, true)
    for (const type of lifts) doc.removeEventListener(type, onLift, true)
  }
  // The lift's own selection (iOS can start it as the finger lifts): the guard ends just after.
  const onLift = () => void setTimeout(end, 0)
  doc.addEventListener('selectstart', block, true)
  doc.addEventListener('contextmenu', block, true)
  for (const type of lifts) doc.addEventListener(type, onLift, true)
  return end
}
