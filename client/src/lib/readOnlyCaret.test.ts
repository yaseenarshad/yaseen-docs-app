/**
 * "A page holds the keys" (YAZ-3140): with the focus nowhere (`<body>`) and the reader's DOM
 * selection anywhere in a visible note page — its title, properties, body, comments, backlinks or
 * reviews — the window's file clipboard and the sidebar's arrows leave the key to the page. A
 * focused control (a sidebar row) keeps its own keys, and a real "nowhere" stays the sidebar's.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { pageHoldsKeys, pageSelectionHolder, readOnlyNoteHoldsKeys } from './readOnlyCaret'

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
})

describe('pageHoldsKeys (YAZ-3140): the page the reader is in holds its keys', () => {
  it('the selection in a read-only TITLE, the focus on <body>: the page holds the keys (the checker’s case)', () => {
    const { host, title } = page(true)
    document.getSelection()!.setBaseAndExtent(title, 0, title, 2)
    expect(pageSelectionHolder()).toBe(host)
    expect(pageHoldsKeys(document.body)).toBe(true)
  })

  it('a caret (a plain click) counts, and so does a selection that only ENDS in the page', () => {
    const { title } = page(true)
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
    document.getSelection()!.collapse(ro.body, 2)
    expect(pageHoldsKeys(document.body)).toBe(true)
    document.body.replaceChildren()
    const open = page(false)
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
    document.getSelection()!.setBaseAndExtent(title, 0, title, 2)
    expect(readOnlyNoteHoldsKeys(document.body)).toBe(false)
    document.getSelection()!.collapse(body, 1)
    expect(readOnlyNoteHoldsKeys(document.body)).toBe(true)
  })
})
