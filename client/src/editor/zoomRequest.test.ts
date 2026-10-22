import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZOOM_EVENT, requestZoom } from './zoomRequest'

const zoom = vi.fn(async () => undefined)
Object.defineProperty(window, 'yaseenDocs', { value: { window: { zoom } }, configurable: true, writable: true })

afterEach(() => {
  zoom.mockClear()
  document.body.replaceChildren()
})

describe('requestZoom (YAZ-1710)', () => {
  it('lets the note that contains the focus claim the step and then leaves the app alone', () => {
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

    requestZoom(1)
    expect(seen).toEqual([1])
    expect(zoom).not.toHaveBeenCalled()
  })

  it('zooms the whole app when nothing claims it — focus outside every note, or nowhere at all', () => {
    const button = document.createElement('button')
    document.body.append(button)
    button.focus()
    requestZoom(-1)
    expect(zoom).toHaveBeenCalledExactlyOnceWith(-1)

    button.blur()
    expect(document.activeElement).toBe(document.body)
    requestZoom(0)
    expect(zoom).toHaveBeenLastCalledWith(0)
  })

  it('YAZ-3125 (D8): with the focus nowhere, the read-only note the reader clicked in claims it — its body takes no focus', () => {
    const section = document.createElement('section')
    const body = document.createElement('div')
    body.className = 'ProseMirror'
    body.setAttribute('contenteditable', 'false')
    const text = document.createTextNode('read-only text')
    body.append(text)
    section.append(body)
    document.body.append(section)
    ;(document.activeElement as HTMLElement | null)?.blur()
    document.getSelection()!.setBaseAndExtent(text, 2, text, 2)
    const seen: number[] = []
    section.addEventListener(ZOOM_EVENT, (event) => {
      seen.push((event as CustomEvent<number>).detail)
      event.preventDefault()
    })
    requestZoom(1)
    expect(seen).toEqual([1])
    expect(zoom).not.toHaveBeenCalled()
    document.getSelection()!.removeAllRanges()
  })

  it('a caret left in an EDITABLE note does not claim it with the focus elsewhere: the app zooms, as before', () => {
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
    requestZoom(1)
    expect(zoom).toHaveBeenCalledExactlyOnceWith(1)
    document.getSelection()!.removeAllRanges()
  })
})
