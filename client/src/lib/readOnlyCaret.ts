/**
 * WHERE A READ-ONLY PAGE'S KEYS GO (YAZ-3076 D8; YAZ-3127, YAZ-3128): the one rule the window-level
 * listeners ask, so a read-only page keeps the keys a normal page keeps.
 *
 * A read-only page editor takes the focus itself (`tabindex="-1"` while it is not editable,
 * `editor/readOnlyKeys.ts`), so most keys start INSIDE it. When the focus is on `<body>` all the
 * same — a click on the page's margin, a tab switch — the reader's DOM selection says which page
 * they are in, but only in a VISIBLE one: the shell keeps a switched-away tab mounted under
 * `visibility: hidden`, and the DOM selection stays there after the switch.
 */

/**
 * A ProseMirror root that is not editable: a read-only preview's body, or a read-only page editor's body, which keeps
 * its caret as `contenteditable="true"` and says it is locked with `data-read-only` (YAZ-4433, `editor/readOnlyKeys.ts`).
 */
const READ_ONLY_BODY = '.ProseMirror[contenteditable="false"], .ProseMirror[data-read-only]'

/**
 * A page PAGE: the scroller `Editor.tsx` draws for a page, in a tab or the right panel — its title,
 * properties, body, comments, backlinks and reviews (YAZ-3140).
 */
export const PAGE_SURFACE = '[data-page="page"]'

const elementOf = (node: Node | null): Element | null => (node === null ? null : node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement)

/**
 * THE LAST CLICK DECIDES (YAZ-3145, option 1): the page the reader last pressed in, or last moved the
 * focus into; null after a press or a focus move outside every page (blank sidebar space, the tab
 * strip, a sidebar row, the title bar). A caret left in a page does not keep the keys once the reader
 * has clicked away, so the window's file clipboard and the sidebar's arrows run as before. Routes
 * with no click — first launch, a wikilink open, ⌘F / ⌘J then Esc — focus the page, and
 * `focusEditor` / `focusReadOnlyBody` claim it outright (a focus that stays where it was fires no
 * `focusin`). One capture listener pair per window, set once: no work on render.
 */
let claimed: Element | null = null

/** Claims the page `el` is in for the keys; ends the claim when `el` is null or outside every page. */
export function claimPage(el: Element | null): void {
  claimed = el?.closest(PAGE_SURFACE) ?? null
}

const pressedOrFocused = (event: Event): void => claimPage(event.target instanceof Element ? event.target : null)
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', pressedOrFocused, true)
  document.addEventListener('focusin', pressedOrFocused, true)
}

/** Whether `el` is in the page the reader last clicked in or was sent to. */
const claims = (el: Element): boolean => claimed !== null && claimed.contains(el)

/** Whether `el` is drawn: not inside a `visibility: hidden` tab layer. */
export function isShown(el: Element): boolean {
  return el.ownerDocument.defaultView?.getComputedStyle(el).visibility !== 'hidden'
}

/** The visible read-only body that holds the reader's DOM selection, in the page they last clicked in (YAZ-3145), or null. */
export function readOnlySelectionHolder(doc: Document = document): Element | null {
  const body = elementOf(doc.getSelection()?.anchorNode ?? null)?.closest(READ_ONLY_BODY) ?? null
  return body !== null && isShown(body) && claims(body) ? body : null
}

/**
 * Whether a key at `target` belongs to a read-only page: the target is inside one, or the focus is
 * nowhere (`<body>`) and the reader's selection is in a visible one. The window's file clipboard
 * (⌘C / ⌘X / ⌘V), the sidebar's arrows "from nowhere" and the like then leave the key to the page.
 */
export function readOnlyPageHoldsKeys(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest(READ_ONLY_BODY) !== null) return true
  const doc = target.ownerDocument
  return (target === doc.body || target === doc.documentElement) && readOnlySelectionHolder(doc) !== null
}

/** The visible page page that holds either end of the reader's DOM selection (a caret counts), when it is the page they last clicked in (YAZ-3145); null otherwise. */
export function pageSelectionHolder(doc: Document = document): Element | null {
  const sel = doc.getSelection()
  for (const node of [sel?.anchorNode ?? null, sel?.focusNode ?? null]) {
    const page = elementOf(node)?.closest(PAGE_SURFACE) ?? null
    if (page !== null && isShown(page) && claims(page)) return page
  }
  return null
}

/**
 * A PAGE HOLDS THE KEYS (YAZ-3140): the rule of the window's file clipboard (⌘C / ⌘X / ⌘V) and the
 * sidebar's arrows "from nowhere". A key belongs to the page when the target is a read-only body
 * (`readOnlyPageHoldsKeys`), or the focus is nowhere (`<body>`) and the reader's selection is
 * anywhere in a visible page page — the title of a read-only page takes no focus, and neither does
 * the text of its properties, comments, backlinks or reviews. Only while that page has the reader's
 * last click (YAZ-3145): a press outside every page ends it. A focused control (a sidebar row)
 * keeps its own keys, and a real "nowhere" (no claimed selection in a page) stays the sidebar's.
 */
export function pageHoldsKeys(target: EventTarget | null): boolean {
  if (readOnlyPageHoldsKeys(target)) return true
  if (!(target instanceof Element)) return false
  const doc = target.ownerDocument
  return (target === doc.body || target === doc.documentElement) && pageSelectionHolder(doc) !== null
}
