/**
 * "On hover" of the sidebar's level lines (YAZ-3309 D3), as two attributes on `.sidebar__body` that
 * app.css reads. Never `:hover`, `:focus…` or `:has()` on the list: a state change on an ancestor of
 * the rows makes Chromium restyle every row below it (bug YAZ-3329). An attribute is written only when
 * its value changes, so the mouse inside the list and the arrow keys inside the tree write nothing.
 *
 * - `data-mouse-in`: the mouse is over the list. `mouseenter` / `mouseleave`, not the pointer events:
 *   Chromium sends `pointerleave` when a drag starts, and the lines must not hide during a drag (S7).
 * - `data-key-focus`: a tree row has the keyboard focus (`:focus-visible`). A row that a mouse click
 *   focused does not count (S3), so a focus that moves to such a row clears it.
 *
 * Returns the cleanup, which also clears both attributes.
 */
export function levelLinesHover(body: HTMLElement): () => void {
  const set = (name: string, on: boolean) => {
    if (body.hasAttribute(name) === on) return
    if (on) body.setAttribute(name, '')
    else body.removeAttribute(name)
  }
  const enter = () => set('data-mouse-in', true)
  const leave = () => set('data-mouse-in', false)
  const focusIn = (e: FocusEvent) => set('data-key-focus', e.target instanceof Element && e.target.matches('.tree__row:focus-visible'))
  // A walk from row to row moves the focus inside the list: only a focus that leaves it clears the mark.
  const focusOut = (e: FocusEvent) => {
    if (!(e.relatedTarget instanceof Node && body.contains(e.relatedTarget))) set('data-key-focus', false)
  }
  body.addEventListener('mouseenter', enter)
  body.addEventListener('mouseleave', leave)
  body.addEventListener('focusin', focusIn)
  body.addEventListener('focusout', focusOut)
  // The setting can turn to "On hover" while the mouse or the keyboard is already in the list.
  if (body.matches(':hover')) enter()
  if (document.activeElement !== null && body.contains(document.activeElement) && document.activeElement.matches('.tree__row:focus-visible')) set('data-key-focus', true)
  return () => {
    body.removeEventListener('mouseenter', enter)
    body.removeEventListener('mouseleave', leave)
    body.removeEventListener('focusin', focusIn)
    body.removeEventListener('focusout', focusOut)
    set('data-mouse-in', false)
    set('data-key-focus', false)
  }
}
