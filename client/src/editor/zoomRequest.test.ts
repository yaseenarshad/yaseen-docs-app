import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZOOM_EVENT, requestZoom } from './zoomRequest'

/** What App passes for the unclaimed case: the sidebar zoom (YAZ-3389). */
const zoom = vi.fn()

afterEach(() => {
  zoom.mockClear()
  document.body.replaceChildren()
})

describe('requestZoom (YAZ-1710, YAZ-3389)', () => {
  it('lets the note that contains the focus claim the step, and then the sidebar zoom is not called', () => {
    const section = document.createElement('section')
    const input = document.createElement('input')
    section.append(input)
    document.body.append(section)
    input.focus()
    const seen: number[] = []
    section.addEventListener(ZOOM_EVENT, (event) => {
      seen.push((event as CustomEvent<number>).detail)
      event.preventDefault()
    })

    requestZoom(1, zoom)
    expect(seen).toEqual([1])
    expect(zoom).not.toHaveBeenCalled()
  })

  it('hands the step to the unclaimed fallback (the sidebar zoom) when nothing claims it — focus outside every note, or nowhere at all', () => {
    const button = document.createElement('button')
    document.body.append(button)
    button.focus()
    requestZoom(-1, zoom)
    expect(zoom).toHaveBeenCalledExactlyOnceWith(-1)

    button.blur()
    expect(document.activeElement).toBe(document.body)
    requestZoom(0, zoom)
    expect(zoom).toHaveBeenLastCalledWith(0)
  })

  it('YAZ-3125 (D8): with the focus nowhere, the read-only note the reader clicked in claims it — its body takes no focus', () => {
    const section = document.createElement('section')
    const body = document.createElement('div')
    body.className = 'ProseMirror'
    body.setAttribute('contenteditable', 'false')
    const text = document.createTextNode('read-only text')
    body.append(text)
    // The note's page (YAZ-3140), where the reader clicked (YAZ-3145: the last click decides).
    const page = document.createElement('div')
    page.dataset.page = 'note'
    page.append(body)
    section.append(page)
    document.body.append(section)
    ;(document.activeElement as HTMLElement | null)?.blur()
    body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    document.getSelection()!.setBaseAndExtent(text, 2, text, 2)
    const seen: number[] = []
    section.addEventListener(ZOOM_EVENT, (event) => {
      seen.push((event as CustomEvent<number>).detail)
      event.preventDefault()
    })
    requestZoom(1, zoom)
    expect(seen).toEqual([1])
    // A press outside every page (blank sidebar space) ends the claim: the sidebar zooms.
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    requestZoom(1, zoom)
    expect(seen).toEqual([1])
    expect(zoom).toHaveBeenLastCalledWith(1)
    zoom.mockClear()
    expect(zoom).not.toHaveBeenCalled()
    document.getSelection()!.removeAllRanges()
  })

  it('a caret left in an EDITABLE note does not claim it with the focus elsewhere: the sidebar zooms', () => {
    const section = document.createElement('section')
    const body = document.createElement('div')
    body.className = 'ProseMirror'
    body.setAttribute('contenteditable', 'true')
    const text = document.createTextNode('editable text')
    body.append(text)
    section.append(body)
    document.body.append(section)
    document.getSelection()!.setBaseAndExtent(text, 2, text, 2)
    ;(document.activeElement as HTMLElement | null)?.blur()
    section.addEventListener(ZOOM_EVENT, (event) => event.preventDefault())
    requestZoom(1, zoom)
    expect(zoom).toHaveBeenCalledExactlyOnceWith(1)
    document.getSelection()!.removeAllRanges()
  })

  it('YAZ-3128: a read-only note in a HIDDEN tab never claims it, though the DOM selection stayed there after the tab switch', () => {
    const layer = document.createElement('div')
    layer.style.visibility = 'hidden'
    const section = document.createElement('section')
    const body = document.createElement('div')
    body.className = 'ProseMirror'
    body.setAttribute('contenteditable', 'false')
    const text = document.createTextNode('hidden read-only text')
    body.append(text)
    section.append(body)
    layer.append(section)
    document.body.append(layer)
    ;(document.activeElement as HTMLElement | null)?.blur()
    document.getSelection()!.setBaseAndExtent(text, 2, text, 2)
    const seen: number[] = []
    section.addEventListener(ZOOM_EVENT, (event) => {
      seen.push((event as CustomEvent<number>).detail)
      event.preventDefault()
    })
    requestZoom(1, zoom)
    expect(seen).toEqual([])
    expect(zoom).toHaveBeenCalledExactlyOnceWith(1)
    document.getSelection()!.removeAllRanges()
  })
})
