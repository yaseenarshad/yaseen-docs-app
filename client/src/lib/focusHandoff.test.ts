/**
 * THE FOCUS HANDOFF (YAZ-961): the two directions of the keyboard loop, pinned in one place
 * because two surfaces perform them — the Files rows and the search list hand
 * focus INTO the open document; `createCrepe`'s Escape hands it BACK. jsdom has no layout, so
 * `offsetParent` is stubbed exactly as the tree suites stub it.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { focusOpenDocument, focusSidebar } from './focusHandoff'

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

function treeRow(active: boolean): HTMLElement {
  const row = document.createElement('button')
  row.className = active ? 'tree__row tree__row--active' : 'tree__row'
  document.body.appendChild(row)
  return row
}

function searchInput(query: string): HTMLInputElement {
  const input = document.createElement('input')
  input.className = 'sidebar__search-input'
  input.value = query
  document.body.appendChild(input)
  return input
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

  it('declines when every document is hidden, and when there is none at all', () => {
    editor(false)
    expect(focusOpenDocument()).toBe(false)
    document.body.replaceChildren()
    expect(focusOpenDocument()).toBe(false)
  })
})

describe('focusSidebar: back out of the text', () => {
  it('with no bar on the page — Files, Focus, Favorites — lands on the ACTIVE tree row, falling back to the first row', () => {
    treeRow(false)
    const active = treeRow(true)
    expect(focusSidebar()).toBe(true)
    expect(document.activeElement).toBe(active)

    document.body.replaceChildren()
    const first = treeRow(false)
    treeRow(false)
    expect(focusSidebar()).toBe(true)
    expect(document.activeElement).toBe(first)
  })

  it('returns to the SEARCH BAR whenever the bar is on the page — the Search tab (YAZ-2638 D2), whose tree is driven from it (YAZ-803)', () => {
    // The bar is drawn on the Search tab only; its rows are the search's, and the bar is where the walk lives.
    const input = searchInput('cac')
    treeRow(true)
    expect(focusSidebar()).toBe(true)
    expect(document.activeElement).toBe(input)
  })

  it('returns to the search bar when it stands EMPTY too — the Search tab then draws no row', () => {
    const input = searchInput('')
    expect(focusSidebar()).toBe(true)
    expect(document.activeElement).toBe(input)
    // A row beside an empty bar changes nothing: the bar is on the page, so the bar has it.
    treeRow(true)
    input.blur()
    expect(focusSidebar()).toBe(true)
    expect(document.activeElement).toBe(input)
  })

  it('declines with no sidebar on screen — Esc stays free everywhere else', () => {
    expect(focusSidebar()).toBe(false)
  })
})
