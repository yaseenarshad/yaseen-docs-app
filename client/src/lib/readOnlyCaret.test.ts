/**
 * "A page holds the keys" (YAZ-3140): with the focus nowhere (`<body>`) and the reader's DOM
 * selection anywhere in a visible note page — its title, properties, body, comments, backlinks or
 * reviews — the window's file clipboard and the sidebar's arrows leave the key to the page. A
 * focused control (a sidebar row) keeps its own keys, and a real "nowhere" stays the sidebar's.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { claimPage, pageHoldsKeys, pageSelectionHolder, readOnlyNoteHoldsKeys } from './readOnlyCaret'

/** A note page as `Editor.tsx` draws it: the title block, then the body, then the backlinks. */
function page(readOnly: boolean, parent: HTMLElement = document.body) {
  const host = document.createElement('div')
  host.className = 'editor-host'
  host.dataset.page = 'note'
  if (readOnly) host.dataset.readOnly = 'true'
  const title = document.createElement('div')
  title.className = 'page-title'
  title.textContent = 'RO doc'
  const body = document.createElement('div')
  body.className = 'ProseMirror'
  body.setAttribute('contenteditable', readOnly ? 'false' : 'true')
  body.textContent = 'body text'
  const backlinks = document.createElement('section')
  backlinks.textContent = 'Linked mentions'
  host.append(title, body, backlinks)
  parent.append(host)
  return { host, title: title.firstChild as Text, body: body.firstChild as Text, backlinks: backlinks.firstChild as Text }
}

afterEach(() => {
  document.getSelection()?.removeAllRanges()
  document.body.replaceChildren()
  claimPage(null)
})

describe('pageHoldsKeys (YAZ-3140): the page the reader is in holds its keys', () => {
  it('the selection in a read-only TITLE, the focus on <body>: the page holds the keys (the checker’s case)', () => {
    const { host, title } = page(true)
    pointAt(title.parentElement!)
    document.getSelection()!.setBaseAndExtent(title, 0, title, 2)
    expect(pageSelectionHolder()).toBe(host)
    expect(pageHoldsKeys(document.body)).toBe(true)
  })

  it('a caret (a plain click) counts, and so does a selection that only ENDS in the page', () => {
    const { title } = page(true)
    pointAt(title.parentElement!)
    document.getSelection()!.collapse(title, 1)
    expect(pageHoldsKeys(document.body)).toBe(true)
    const outside = document.createElement('p')
    outside.textContent = 'chrome'
    document.body.prepend(outside)
    document.getSelection()!.setBaseAndExtent(outside.firstChild!, 0, title, 2)
    expect(pageHoldsKeys(document.body)).toBe(true)
  })

  it('every part of the page: the read-only body and the backlinks of an editable page too', () => {
    const ro = page(true)
    pointAt(ro.body.parentElement!)
    document.getSelection()!.collapse(ro.body, 2)
    expect(pageHoldsKeys(document.body)).toBe(true)
    document.body.replaceChildren()
    const open = page(false)
    pointAt(open.backlinks.parentElement!)
    document.getSelection()!.setBaseAndExtent(open.backlinks, 0, open.backlinks, 6)
    expect(pageHoldsKeys(document.body)).toBe(true)
  })

  it('a focused control keeps its keys: a sidebar row copies its file even with page text selected', () => {
    const { title } = page(true)
    document.getSelection()!.setBaseAndExtent(title, 0, title, 2)
    const row = document.createElement('button')
    row.className = 'tree__row'
    document.body.append(row)
    expect(pageHoldsKeys(row)).toBe(false)
  })

  it('a real "nowhere" (no selection, or one in the chrome) holds nothing, as on main', () => {
    page(true)
    expect(pageHoldsKeys(document.body)).toBe(false)
    const chrome = document.createElement('p')
    chrome.textContent = 'sidebar label'
    document.body.append(chrome)
    document.getSelection()!.setBaseAndExtent(chrome.firstChild!, 0, chrome.firstChild!, 4)
    expect(pageHoldsKeys(document.body)).toBe(false)
  })

  it('a page in a HIDDEN tab holds nothing: the switched-away tab keeps its DOM selection', () => {
    const layer = document.createElement('div')
    layer.style.visibility = 'hidden'
    document.body.append(layer)
    const { title } = page(true, layer)
    document.getSelection()!.setBaseAndExtent(title, 0, title, 2)
    expect(pageSelectionHolder()).toBeNull()
    expect(pageHoldsKeys(document.body)).toBe(false)
  })

  it('the narrower rule of the other window chords (⌘B, ⌘⇧C) stays the read-only BODY only', () => {
    const { title, body } = page(true)
    pointAt(title.parentElement!)
    document.getSelection()!.setBaseAndExtent(title, 0, title, 2)
    expect(readOnlyNoteHoldsKeys(document.body)).toBe(false)
    document.getSelection()!.collapse(body, 1)
    expect(readOnlyNoteHoldsKeys(document.body)).toBe(true)
  })
})

/** A press of the pointer, as the window's capture listener hears it. */
function pointAt(el: Element): void {
  el.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }))
}

describe('the last click decides (YAZ-3145, option 1): a press outside every page ends the page’s claim', () => {
  function sidebar(): HTMLElement {
    const side = document.createElement('nav')
    side.className = 'sidebar'
    const blank = document.createElement('div')
    blank.className = 'sidebar__body'
    side.append(blank)
    document.body.append(side)
    return blank
  }

  it('a caret in an EDITABLE body, then a press on blank sidebar space: the window and the sidebar have the keys again, as on main', () => {
    const { body } = page(false)
    pointAt(body.parentElement!)
    document.getSelection()!.collapse(body, 2)
    pointAt(sidebar())
    expect(pageHoldsKeys(document.body)).toBe(false)
  })

  it('a caret in a READ-ONLY body or title, then a press on blank sidebar space: the same', () => {
    const { body, title } = page(true)
    pointAt(body.parentElement!)
    document.getSelection()!.collapse(body, 2)
    const blank = sidebar()
    pointAt(blank)
    expect(readOnlyNoteHoldsKeys(document.body)).toBe(false)
    expect(pageHoldsKeys(document.body)).toBe(false)
    pointAt(title.parentElement!)
    document.getSelection()!.collapse(title, 1)
    pointAt(blank)
    expect(pageHoldsKeys(document.body)).toBe(false)
  })

  it('a press back in the page gives the page the keys again', () => {
    const { title } = page(true)
    pointAt(sidebar())
    document.getSelection()!.collapse(title, 1)
    expect(pageHoldsKeys(document.body)).toBe(false)
    pointAt(title.parentElement!)
    expect(pageHoldsKeys(document.body)).toBe(true)
  })

  it('a route with no click (first launch, a wikilink open, ⌘F / ⌘J then Esc) claims the page it focuses', () => {
    const { host, body } = page(true)
    pointAt(sidebar())
    const pm = body.parentElement!
    pm.tabIndex = -1
    pm.focus()
    pm.blur()
    document.getSelection()!.collapse(body, 1)
    expect(pageHoldsKeys(document.body)).toBe(true)
    claimPage(null)
    expect(pageHoldsKeys(document.body)).toBe(false)
    claimPage(host)
    expect(pageHoldsKeys(document.body)).toBe(true)
  })

  it('a focus move OUT of the pages (a keyboard route to a control) ends the claim too', () => {
    const { title } = page(true)
    pointAt(title.parentElement!)
    document.getSelection()!.collapse(title, 1)
    const button = document.createElement('button')
    document.body.append(button)
    button.focus()
    button.blur()
    expect(pageHoldsKeys(document.body)).toBe(false)
  })
})
