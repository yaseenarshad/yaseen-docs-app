/**
 * THE FOCUS HANDOFF (YAZ-961): hands focus INTO the open document from sidebar surfaces and restores
 * focus in place after overlays close (`giveFocusBack`, YAZ-4971). jsdom has no layout, so
 * `offsetParent` is stubbed exactly as the tree suites stub it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { focusOpenDocument, giveFocusBack, namingTab } from './focusHandoff'

/** An editor stand-in; `visible` models what `offsetParent` answers in a browser. */
function editor(visible: boolean): HTMLElement {
  const instance = document.createElement('div')
  instance.className = 'editor-instance'
  const pm = document.createElement('div')
  pm.className = 'ProseMirror'
  pm.tabIndex = -1
  Object.defineProperty(pm, 'offsetParent', { value: visible ? instance : null, configurable: true })
  instance.appendChild(pm)
  document.body.appendChild(instance)
  return pm
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('focusOpenDocument: into the text', () => {
  it('focuses the open document and says so', () => {
    const pm = editor(true)
    expect(focusOpenDocument()).toBe(true)
    expect(document.activeElement).toBe(pm)
  })

  it('skips a HIDDEN editor for the visible one — every visited tab keeps its editor mounted (YAZ-936)', () => {
    editor(false) // a hidden tab's editor: mounted, shown to nobody
    const outline = editor(true)
    expect(focusOpenDocument()).toBe(true)
    expect(document.activeElement).toBe(outline)
  })

  it('an editor that cannot take the focus is no page on show: the layer of a tab under the blank tab is hidden by `visibility`, which `offsetParent` does not see — the call declines, so the caller can go to the new tab page', () => {
    // A hidden layer: laid out (`offsetParent` answers), and not focusable, as an element under `visibility: hidden` is in a browser.
    const hidden = editor(true)
    hidden.removeAttribute('tabindex')
    expect(focusOpenDocument()).toBe(false)
    expect(document.activeElement).toBe(document.body)
    // With a page on show after it, that page takes the caret.
    const page = editor(true)
    expect(focusOpenDocument()).toBe(true)
    expect(document.activeElement).toBe(page)
  })

  it('YAZ-2662 R4: the preview panel of the search is no page — its page is skipped for the open document, and with no page open the call declines', () => {
    // The panel renders a page through the hover card's read-only renderer, which wears `.editor-instance`.
    const panel = document.createElement('div')
    panel.className = 'quicklook'
    document.body.appendChild(panel)
    const previewed = editor(true)
    panel.appendChild(previewed.parentElement!)
    expect(focusOpenDocument()).toBe(false)
    expect(document.activeElement).toBe(document.body)
    // The page stands AFTER the panel here: it is found by what it is, not by its place.
    const page = editor(true)
    expect(focusOpenDocument()).toBe(true)
    expect(document.activeElement).toBe(page)
  })

  it('YAZ-3075 C29: the sidebar`s hover preview is no page — the page in `.board-preview` is skipped for the open document', () => {
    const panel = document.createElement('div')
    panel.className = 'board-preview page-preview'
    document.body.appendChild(panel)
    const hovered = editor(true)
    panel.appendChild(hovered.parentElement!)
    expect(focusOpenDocument()).toBe(false)
    expect(document.activeElement).toBe(document.body)
    const page = editor(true)
    expect(focusOpenDocument()).toBe(true)
    expect(document.activeElement).toBe(page)
  })

  it('declines when every document is hidden, and when there is none at all', () => {
    editor(false)
    expect(focusOpenDocument()).toBe(false)
    document.body.replaceChildren()
    expect(focusOpenDocument()).toBe(false)
  })
})

describe('namingTab: a mount keeps out of the tab\'s name field (YAZ-3059)', () => {
  it('is true in the strip\'s name field only', () => {
    const field = document.createElement('input')
    field.className = 'tabbar__rename'
    const other = document.createElement('input')
    expect([namingTab(field), namingTab(other), namingTab(null)]).toEqual([true, false, false])
  })
})

/**
 * YAZ-4971: Esc after Explore jumped the page to its caret. App gave the keyboard back with a plain `focus()`, and a
 * browser scrolls a focused editor to its caret. jsdom never scrolls, so the stand-in focus below does what Chromium
 * does: without `preventScroll` it scrolls the page's scroller to the caret (here: to 900).
 */
describe('giveFocusBack: the keyboard goes back without a scroll (YAZ-4971)', () => {
  function scrolledPage(): { scroller: HTMLElement; pm: HTMLElement } {
    const scroller = document.createElement('div')
    scroller.style.overflowY = 'auto'
    document.body.appendChild(scroller)
    const pm = editor(true)
    scroller.appendChild(pm.parentElement!)
    scroller.scrollTop = 120
    const focus = HTMLElement.prototype.focus
    vi.spyOn(pm, 'focus').mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
      focus.call(this, options)
      if (options?.preventScroll !== true) scroller.scrollTop = 900
    })
    return { scroller, pm }
  }
  afterEach(() => vi.restoreAllMocks())

  it('the element that had the keyboard (the page, its caret at the bottom, scrolled up) takes it back and the page stays where it was scrolled', () => {
    const { scroller, pm } = scrolledPage()
    giveFocusBack(pm)
    expect(document.activeElement).toBe(pm)
    expect(scroller.scrollTop).toBe(120)
  })

  it('with nothing to go back to (that element is gone), the open page takes it, in place too', () => {
    const { scroller, pm } = scrolledPage()
    giveFocusBack(null)
    expect(document.activeElement).toBe(pm)
    expect(scroller.scrollTop).toBe(120)
  })

  it('a scroll the focus makes anyway (a browser that ignores `preventScroll`) is put back', () => {
    const scroller = document.createElement('div')
    document.body.appendChild(scroller)
    const pm = editor(true)
    scroller.appendChild(pm.parentElement!)
    scroller.scrollTop = 40
    vi.spyOn(pm, 'focus').mockImplementation(() => {
      scroller.scrollTop = 700
    })
    giveFocusBack(pm)
    expect(scroller.scrollTop).toBe(40)
  })
})
