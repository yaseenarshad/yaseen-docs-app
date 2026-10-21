/**
 * THE FOCUS HANDOFF (YAZ-961) — the keyboard loop's two half-steps, in ONE place because two
 * surfaces perform them: the Files rows and the search list both hand focus INTO
 * the open document (a second Enter, the "take me in"; Esc in the search bar, YAZ-2662 D9), and
 * `createCrepe`'s Escape hands it back OUT to whichever sidebar the walk came from. Both answer a
 * boolean so a caller that is a ProseMirror command can decline honestly and let the key fall through.
 *
 * They read the DOM rather than taking a ref: the two ends live in different React trees (the
 * sidebar's and the editor's), and the alternative — threading a focus handle from App through
 * both — would buy nothing a class name does not already say.
 */

/**
 * Focus the document on screen. The VISIBLE one, never the first in the DOM: every visited tab
 * keeps its editor mounted and hidden, and a folder's outline is an editor too. `offsetParent` is
 * the cheap "actually rendered" question — null for a `display: none` subtree. The note in the
 * preview panel of the search is no page (YAZ-2662 R4), and nor is the note in the sidebar's hover
 * preview (YAZ-3075 C29): each wears the editor's class for its stylesheets, and the caret never
 * goes into it. `within` is where to look: the new tab page asks for the tab stack alone
 * (YAZ-2663), so the caret does not go into a note of the right panel.
 */
export function focusOpenDocument(within: ParentNode = document): boolean {
  const docs = Array.from(within.querySelectorAll<HTMLElement>('.editor-instance .ProseMirror')).filter(
    (el) => el.offsetParent !== null && el.closest('.quicklook, .board-preview') === null,
  )
  // The layer of a tab under the blank tab is hidden by `visibility`, which `offsetParent` does not
  // see. It cannot take the focus, so the answer is what the focus did: the caller of the search
  // bar's Esc then goes to the new tab page and not to nothing.
  for (const doc of docs) {
    doc.focus()
    if (doc.ownerDocument.activeElement === doc) return true
  }
  return false
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

/**
 * May a board canvas that just became visible take the keyboard (Draw's 🔒 YAZ-1812, ported by YAZ-3028)?
 * The canvas focuses itself only at MOUNT, so a revealed tab hands it over — GATED: yes when NOTHING
 * holds it (`document.activeElement` is null or the body), or when what holds it is inside the tab
 * layer (the tab being left, or this one). No otherwise: chrome outside the layer (the sidebar's
 * search bar, the vault switcher, a dialog, the tab strip) keeps what it has.
 */
export function mayTakeFocus(active: Element | null, layer: Element | null): boolean {
  if (active === null || active === active.ownerDocument.body) return true
  return layer !== null && layer.contains(active)
}

/**
 * Is the keyboard in a tab's name field on the strip (YAZ-3059)? A double click's first click
 * activates the tab, and a page that was never shown mounts then; the second click opens the field.
 * A mount that ends after it must not take the caret, or the typed name lands in the page.
 */
export function namingTab(active: Element | null): boolean {
  return active !== null && active.closest('.tabbar__rename') !== null
}
