/**
 * WHERE A READ-ONLY NOTE'S KEYS GO (YAZ-3076 D8; YAZ-3127, YAZ-3128): the one rule the window-level
 * listeners ask, so a read-only note keeps the keys a normal note keeps.
 *
 * A read-only note editor takes the focus itself (`tabindex="-1"` while it is not editable,
 * `editor/readOnlyKeys.ts`), so most keys start INSIDE it. When the focus is on `<body>` all the
 * same — a click on the page's margin, a tab switch — the reader's DOM selection says which note
 * they are in, but only in a VISIBLE one: the shell keeps a switched-away tab mounted under
 * `visibility: hidden`, and the DOM selection stays there after the switch.
 */

/** A ProseMirror root that is not editable: a read-only note's body (or a preview of one). */
const READ_ONLY_BODY = '.ProseMirror[contenteditable="false"]'

/** Whether `el` is drawn: not inside a `visibility: hidden` tab layer. */
export function isShown(el: Element): boolean {
  return el.ownerDocument.defaultView?.getComputedStyle(el).visibility !== 'hidden'
}

/** The visible read-only body that holds the reader's DOM selection, or null. */
export function readOnlySelectionHolder(doc: Document = document): Element | null {
  const node = doc.getSelection()?.anchorNode ?? null
  const el = node === null ? null : node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  const body = el?.closest(READ_ONLY_BODY) ?? null
  return body !== null && isShown(body) ? body : null
}

/**
 * Whether a key at `target` belongs to a read-only note: the target is inside one, or the focus is
 * nowhere (`<body>`) and the reader's selection is in a visible one. The window's file clipboard
 * (⌘C / ⌘X / ⌘V), the sidebar's arrows "from nowhere" and the like then leave the key to the note.
 */
export function readOnlyNoteHoldsKeys(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest(READ_ONLY_BODY) !== null) return true
  const doc = target.ownerDocument
  return (target === doc.body || target === doc.documentElement) && readOnlySelectionHolder(doc) !== null
}
