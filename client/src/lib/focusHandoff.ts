/**
 * THE FOCUS HANDOFF (YAZ-961) — the keyboard loop's two half-steps, in ONE place because two
 * surfaces perform them: the Files rows and the search list both hand focus INTO
 * the open document (a second Enter, the "take me in"), and `createCrepe`'s Escape hands it back
 * OUT to whichever sidebar the walk came from. Both answer a boolean so a caller that is a
 * ProseMirror command can decline honestly and let the key fall through.
 *
 * They read the DOM rather than taking a ref: the two ends live in different React trees (the
 * sidebar's and the editor's), and the alternative — threading a focus handle from App through
 * both — would buy nothing a class name does not already say.
 */

/**
 * Focus the document on screen. The VISIBLE one, never the first in the DOM: every visited tab
 * keeps its editor mounted and hidden, and a folder's outline is an editor too. `offsetParent` is
 * the cheap "actually rendered" question — null for a `display: none` subtree.
 */
export function focusOpenDocument(): boolean {
  const doc = Array.from(document.querySelectorAll<HTMLElement>('.editor-instance .ProseMirror')).find(
    (el) => el.offsetParent !== null,
  )
  if (doc === undefined) return false
  doc.focus()
  return true
}

/**
 * Focus whichever sidebar the walk lives in. The search bar has it whenever the bar is on the page
 * — the Search tab (YAZ-2638 D2), with text or with none: the bar drives the search tree, so the
 * input is the walk (YAZ-803). On every other tab there is no bar and the tree's active row wins.
 * Declines when neither is on screen (collapsed sidebar).
 */
export function focusSidebar(): boolean {
  const target =
    document.querySelector<HTMLElement>('.sidebar__search-input') ??
    document.querySelector<HTMLElement>('.tree__row--active') ??
    document.querySelector<HTMLElement>('.tree__row')
  if (target === null) return false
  target.focus()
  return true
}
