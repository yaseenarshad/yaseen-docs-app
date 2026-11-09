/**
 * The link bridge of a diagram tab (YAZ-4748 D2, D3): the board's `hostLinks` spoken to draw.io's iframe. A fake
 * `hostLinks` records each call; the frame's box is set, so every rect is seen moving into the window.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { PickerEditor } from '../drawings/drawingLinkPicker'
import type { BoardLinks } from '../drawings/useDrawingLinks'
import { setSidebarDrag } from '../sidebar/sidebarDrag'
import { wireLook } from '../drawings/drawingLinks'
import { inWindow, linkOpens, modsKey, useDrawioLinkBridge, type DrawioLinkLive } from './drawioLinkBridge'
import type { DrawioLinkMessage } from './drawioProtocol'

describe('the bridge’s pure parts', () => {
  it('sends a look with its icon as a data URL, null for no icon, and nothing for an icon not drawn yet', () => {
    const image = {} as HTMLCanvasElement
    expect(wireLook({ label: 'Roadmap', icon: { image, url: 'data:image/png;base64,AA' } })).toEqual({ label: 'Roadmap', icon: 'data:image/png;base64,AA' })
    expect(wireLook({ label: 'Plain', icon: null })).toEqual({ label: 'Plain', icon: null })
    expect(wireLook({ label: 'Soon' })).toEqual({ label: 'Soon' })
    expect(wireLook({ label: 'Missing note · YAZ-9', missing: true })).toEqual({ label: 'Missing note · YAZ-9', missing: true })
    expect(wireLook({ label: 'Folder', folder: true })).toEqual({ label: 'Folder', folder: true })
    expect(wireLook(null)).toBeNull()
  })

  it('names the keys that open a link: the default gestures, and the plain click too on a read-only diagram', () => {
    expect(linkOpens(false, undefined).sort()).toEqual(['M', 'MS'])
    expect(linkOpens(true, undefined).sort()).toEqual(['', 'M', 'MS'])
    // A gesture the user moved opens with its new keys only.
    expect(linkOpens(false, { 'links.backgroundTab': 'Alt+Click' }).sort()).toEqual(['A', 'MS'])
    expect(modsKey({ metaKey: true, ctrlKey: true, altKey: true, shiftKey: true })).toBe('MCAS')
  })

  it('moves a rect from the iframe’s view into the window’s', () => {
    expect(inWindow({ left: 10, top: 20, right: 30, bottom: 40 }, { left: 300, top: 100, right: 900, bottom: 700 })).toEqual({ left: 310, top: 120, right: 330, bottom: 140 })
  })
})

describe('useDrawioLinkBridge', () => {
  let root: Root
  let container: HTMLElement
  let posted: Array<Record<string, unknown>>
  let listener: (() => void) | null
  let bridge: ReturnType<typeof useDrawioLinkBridge>
  const hostLinks = {
    resolve: vi.fn((inner: string) => (inner === 'Gone' ? { label: 'Gone', missing: true } : { label: `Page ${inner}`, icon: null })),
    subscribe: vi.fn((next: () => void) => {
      listener = next
      return () => (listener = null)
    }),
    onHover: vi.fn(),
    onPointerDown: vi.fn(() => true),
    onContextMenu: vi.fn(() => true),
    pasteLink: vi.fn((text: string) => (text === '/vault/Plan.md' ? '[[YAZ-7]]' : null)),
    onEditorChange: vi.fn(),
    onEditorKeyDown: vi.fn(() => true),
    dropPaths: vi.fn((paths: readonly string[]) => paths.map((path) => `[[${path}]]`)),
  }
  const links = { hostLinks, openShapeLink: vi.fn() } as unknown as BoardLinks

  function Host({ live, withLinks = true }: { live: DrawioLinkLive; withLinks?: boolean }) {
    const frame = useRef<HTMLIFrameElement>(null)
    bridge = useDrawioLinkBridge(withLinks ? links : undefined, frame, (msg) => posted.push(msg), live)
    return <iframe ref={frame} />
  }
  const render = (live: DrawioLinkLive = { readOnly: false, hotkeys: undefined }, withLinks = true) => act(() => root.render(<Host live={live} withLinks={withLinks} />))
  const send = (msg: DrawioLinkMessage) => act(() => bridge.onMessage(msg))

  beforeEach(() => {
    posted = []
    listener = null
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    vi.spyOn(HTMLIFrameElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 300, top: 100, right: 900, bottom: 700 } as DOMRect)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('answers the looks asked for, and sends the asked ones again when the window’s links change', () => {
    render()
    send({ event: 'yaseenLinkLooks', inners: ['YAZ-1', 'Gone'] })
    expect(posted).toEqual([{ action: 'yaseenLinkLooks', looks: { 'YAZ-1': { label: 'Page YAZ-1', icon: null }, Gone: { label: 'Gone', missing: true } } }])
    send({ event: 'yaseenLinkLooks', inners: ['YAZ-2'] })
    posted = []
    act(() => listener!())
    expect(posted).toEqual([{ action: 'yaseenLinkLooks', looks: { 'YAZ-1': { label: 'Page YAZ-1', icon: null }, Gone: { label: 'Gone', missing: true }, 'YAZ-2': { label: 'Page YAZ-2', icon: null } } }])
  })

  it('tells draw.io which keys open a link once it listens, and again when the diagram turns read only', () => {
    render()
    expect(posted).toEqual([])
    act(() => bridge.ready())
    expect(posted).toEqual([{ action: 'yaseenLinkOpens', opens: expect.arrayContaining(['M', 'MS']) }])
    render({ readOnly: true, hotkeys: undefined })
    expect(posted.at(-1)).toEqual({ action: 'yaseenLinkOpens', opens: expect.arrayContaining(['', 'M', 'MS']) })
  })

  it('a hover, a click and a right-click reach the board’s host, with every box in the window', () => {
    render()
    send({ event: 'yaseenLinkHover', inner: 'YAZ-1', rect: { left: 10, top: 20, right: 60, bottom: 40 } })
    expect(hostLinks.onHover).toHaveBeenLastCalledWith(expect.objectContaining({ inner: 'YAZ-1', rect: { left: 310, top: 120, right: 360, bottom: 140 } }))
    send({ event: 'yaseenLinkHover', inner: null, rect: null })
    expect(hostLinks.onHover).toHaveBeenLastCalledWith(null)

    const mods = { metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }
    send({ event: 'yaseenLinkClick', inner: 'YAZ-1', cellId: 'a', mods })
    expect(hostLinks.onPointerDown).toHaveBeenLastCalledWith(expect.objectContaining({ inner: 'YAZ-1', elementId: 'a' }), expect.objectContaining(mods))

    send({ event: 'yaseenLinkMenu', inner: 'YAZ-1', cellId: 'a', x: 15, y: 25 })
    const [hit, event] = hostLinks.onContextMenu.mock.calls.at(-1) as unknown as [{ replace?: (text: string) => void }, MouseEvent]
    expect(event).toEqual({ clientX: 315, clientY: 125 })
    hit.replace!('[[YAZ-2]]')
    expect(posted.at(-1)).toEqual({ action: 'yaseenLinkReplace', cellId: 'a', inner: 'YAZ-1', text: '[[YAZ-2]]' })
  })

  it('gives no replace on a read-only diagram, nor for a pill with no cell under it', () => {
    render({ readOnly: true, hotkeys: undefined })
    send({ event: 'yaseenLinkMenu', inner: 'YAZ-1', cellId: 'a', x: 0, y: 0 })
    expect((hostLinks.onContextMenu.mock.calls.at(-1) as unknown as [{ replace?: unknown }])[0].replace).toBeUndefined()
    render()
    send({ event: 'yaseenLinkMenu', inner: 'YAZ-1', cellId: null, x: 0, y: 0 })
    expect((hostLinks.onContextMenu.mock.calls.at(-1) as unknown as [{ replace?: unknown }])[0].replace).toBeUndefined()
  })

  it('answers a paste with the link the board makes of it, or null for the text as it is (2A)', () => {
    render()
    send({ event: 'yaseenPaste', id: 3, text: '/vault/Plan.md' })
    send({ event: 'yaseenPaste', id: 4, text: '/elsewhere/x.md' })
    expect(posted).toEqual([
      { action: 'yaseenPasteAnswer', id: 3, link: '[[YAZ-7]]' },
      { action: 'yaseenPasteAnswer', id: 4, link: null },
    ])
  })

  it('gives the board’s picker the label editor: its caret box in the window, and its writes sent back (2A, D5)', () => {
    render()
    send({ event: 'yaseenEditor', state: { text: 'See [[pl', caret: 8, typed: true, cellId: 'a', rect: { left: 1, top: 2, right: 3, bottom: 4 } } })
    const editor = hostLinks.onEditorChange.mock.calls.at(-1)![0] as unknown as PickerEditor
    expect(editor).toMatchObject({ text: 'See [[pl', caret: 8, typed: true })
    expect(editor.caretRect()).toEqual({ left: 301, top: 102, right: 303, bottom: 104 })
    editor.replace(4, 8, '[[YAZ-7]]')
    expect(posted.at(-1)).toEqual({ action: 'yaseenEditorReplace', start: 4, end: 8, text: '[[YAZ-7]]' })
    expect(editor.replaceLink('[[New]]', '[[YAZ-9]]')).toBe(true)
    expect(posted.at(-1)).toEqual({ action: 'yaseenEditorReplaceLink', cellId: 'a', raw: '[[New]]', text: '[[YAZ-9]]' })
    send({ event: 'yaseenEditorKey', key: 'ArrowDown' })
    expect(hostLinks.onEditorKeyDown).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'ArrowDown' }))
    send({ event: 'yaseenEditor', state: null })
    expect(hostLinks.onEditorChange).toHaveBeenLastCalledWith(null)
  })

  it('tells the frame when the sidebar drags pages, and links the drag’s pages on a drop — also after the drag ended (2B, D4)', () => {
    render()
    act(() => setSidebarDrag(['/vault/A.md', '/vault/B.md']))
    expect(posted.at(-1)).toEqual({ action: 'yaseenSidebarDrag', on: true })
    act(() => setSidebarDrag([]))
    expect(posted.at(-1)).toEqual({ action: 'yaseenSidebarDrag', on: false })
    send({ event: 'yaseenDrop', id: 1 })
    expect(posted.at(-1)).toEqual({ action: 'yaseenDropLinks', id: 1, links: ['[[/vault/A.md]]', '[[/vault/B.md]]'] })
  })

  it('opens a shape’s own link as a board’s link icon does, with the keys of its press (D8)', () => {
    render()
    const mods = { metaKey: true, ctrlKey: false, altKey: false, shiftKey: true }
    send({ event: 'yaseenShapeLink', link: '[[YAZ-1]]', mods })
    expect(links.openShapeLink).toHaveBeenCalledWith('[[YAZ-1]]', mods)
  })

  it('with no link source the pills stay text: nothing is answered and no keys are sent', () => {
    render(undefined, false)
    act(() => bridge.ready())
    send({ event: 'yaseenLinkLooks', inners: ['YAZ-1'] })
    expect(posted).toEqual([])
    expect(hostLinks.resolve).not.toHaveBeenCalled()
  })
})
