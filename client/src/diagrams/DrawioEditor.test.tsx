/**
 * The diagram document's host (YAZ-1802), with draw.io replaced by the one thing the host can see
 * of it: postMessage. The iframe never loads in jsdom, so the test plays draw.io — it posts the
 * protocol's events as that iframe's window from `app://drawio` and reads what the host posts
 * back — and every diagram-side rule (the handshake order, the theme, export, the baseline, the
 * debounce, the reload) runs through the real `Autosave` and the real host. The rules both boards
 * share — echo, conflict, flush, retire — are pinned once, in `documents/useDocumentHost.test.tsx`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DRAWIO_ORIGIN } from '@shared/drawio'
import type { DiagramDarkColors } from '@shared/types'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, api: { ...actual.api, diagram: { load: vi.fn(), save: vi.fn() }, dialog: { saveImage: vi.fn() } } }
})
vi.mock('./renderDiagram', () => ({ renderDiagramImage: vi.fn() }))

import { api, BridgeRequestError } from '../api'
import { BOARD_COMMAND_EVENT } from '../documents/boardCommand'
import { fakeWatch } from '../documents/boardTestKit'
import { _resetRenameContinuity } from '../lib/renameContinuity'
import { BROKEN_DIAGRAM_DOCUMENT, DrawioEditor } from './DrawioEditor'
import { renderDiagramImage } from './renderDiagram'

const load = vi.mocked(api.diagram.load)
const save = vi.mocked(api.diagram.save)
const saveImage = vi.mocked(api.dialog.saveImage)
/** `board:set-read-only` (YAZ-3076), on the bridge itself: `api` reaches it through `window.yaseenDocs`. */
const setBoardReadOnly = vi.fn()
const notice = vi.fn()

const ROOT = '/vault'
const PATH = '/vault/Flow.drawio'
const XML = '<mxfile><diagram id="p" name="Page-1"><mxGraphModel><root/></mxGraphModel></diagram></mxfile>'
const EDITED = XML.replace('Page-1', 'Edited')

const { watch, watcherSaw } = fakeWatch()

let root: Root | null = null
let container: HTMLElement
/** Everything the host posted into the iframe, parsed. */
let posted: Array<Record<string, unknown>> = []
/** How the fake draw.io answers a `yaseenMerge` (YAZ-4279): merged (after its own `autosave`), a clash, or not at all. */
let mergeReply: 'merged' | 'conflict' | 'none' = 'merged'

function render(darkColors: DiagramDarkColors = 'adapt'): void {
  act(() => root?.render(<DrawioEditor root={ROOT} path={PATH} watch={watch} darkColors={darkColors} onNotice={notice} />))
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const frame = (): HTMLIFrameElement | null => container.querySelector('iframe')

/** Capture what the host posts into the iframe (jsdom never loads it). */
function tapFrame(): void {
  const win = frame()?.contentWindow
  if (!win) throw new Error('no iframe')
  Object.defineProperty(win, 'postMessage', {
    configurable: true,
    value: (data: string, origin: string) => {
      const msg = JSON.parse(data) as Record<string, unknown>
      posted.push({ ...msg, _origin: origin })
      if (msg.action !== 'yaseenMerge' || mergeReply === 'none') return
      const reply = mergeReply
      queueMicrotask(() => {
        if (reply === 'conflict') return drawio({ event: 'yaseenMerge', id: msg.id, conflict: true })
        // The overlay says the merge begins; draw.io's model listener posts the page on screen inside it; the answer has the whole file.
        drawio({ event: 'yaseenMerging', id: msg.id })
        drawio({ event: 'autosave', xml: `${String(msg.xml)}<!--merged-->` })
        drawio({ event: 'yaseenMerge', id: msg.id, xml: `${String(msg.xml)}<!--merged--><!--every page-->` })
      })
    },
  })
}

/** draw.io speaking: a JSON string, from the iframe's window, from the drawio origin (unless told otherwise). */
function drawio(msg: Record<string, unknown>, over: { origin?: string; source?: Window | null } = {}): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(msg), origin: over.origin ?? DRAWIO_ORIGIN, source: over.source === undefined ? frame()!.contentWindow : over.source }))
  })
}

/** Mount, and walk draw.io through the handshake to a loaded, clean document. */
async function opened(): Promise<void> {
  render()
  await settle()
  tapFrame()
  drawio({ event: 'yaseenReady' })
  drawio({ event: 'configure' })
  drawio({ event: 'init' })
  drawio({ event: 'load', xml: XML })
}

const text = (): string => container.textContent ?? ''

/** App flips `<html data-theme>`; the host reads it back through a MutationObserver. */
async function appTheme(theme: 'light' | 'dark'): Promise<void> {
  document.documentElement.dataset.theme = theme
  await settle()
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  posted = []
  mergeReply = 'merged'
  Object.defineProperty(window, 'yaseenDocs', {
    configurable: true,
    writable: true,
    value: {
      setBoardReadOnly,
      window: {
        onFlush: () => () => {},
      },
    },
  })
  load.mockResolvedValue({ path: PATH, xml: XML, mtime: 100, size: XML.length })
  vi.mocked(renderDiagramImage).mockImplementation(async (_xml, format) => (format === 'png' ? 'data:image/png;base64,UE5H' : 'data:image/svg+xml;base64,U1ZH'))
  saveImage.mockResolvedValue({ path: '/Users/y/Desktop/Flow.png' })
  save.mockResolvedValue({ path: PATH, mtime: 200, size: 50 })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container.remove()
  delete document.documentElement.dataset.theme
  _resetRenameContinuity()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('opening', () => {
  it('a file main refuses is the error pane with its reason — and draw.io is never mounted on it', async () => {
    load.mockRejectedValue(new BridgeRequestError('IO_ERROR', 'the file is empty'))
    render()
    await settle()
    expect(text()).toContain(`${BROKEN_DIAGRAM_DOCUMENT}: the file is empty.`)
    expect(frame()).toBeNull()
    expect(save).not.toHaveBeenCalled()
  })

  it('mounts draw.io on its own origin with the app theme and the offline flags', async () => {
    render()
    await settle()
    const src = new URL(frame()!.src)
    expect(`${src.protocol}//${src.host}`).toBe(DRAWIO_ORIGIN)
    expect(src.searchParams.get('offline')).toBe('1')
    expect(src.searchParams.get('configure')).toBe('1')
  })
})

describe('the handshake (drawioProtocol.ts)', () => {
  it('configures only once our PostConfig said it is ready, then loads the XML with autosave on', async () => {
    render()
    await settle()
    tapFrame()
    drawio({ event: 'configure' })
    expect(posted).toEqual([])
    drawio({ event: 'yaseenReady' })
    expect(posted[0]).toMatchObject({ action: 'configure', _origin: DRAWIO_ORIGIN })
    expect((posted[0].config as Record<string, unknown>).compressXml).toBe(false)
    drawio({ event: 'init' })
    // The tab's first load is draw.io's own: the first page, fitted (YAZ-3420 D2 K6).
    expect(posted[1]).toMatchObject({ action: 'load', xml: XML, autosave: 1, title: 'Flow', yaseenKeepView: false })
  })

  it('configures anyway after a while when the overlay never answers — the document must still open', async () => {
    render()
    await settle()
    tapFrame()
    drawio({ event: 'configure' })
    await act(async () => {
      vi.advanceTimersByTime(3100)
    })
    expect(posted[0]).toMatchObject({ action: 'configure' })
  })

  it('ignores the same events from another window or another origin', async () => {
    render()
    await settle()
    tapFrame()
    drawio({ event: 'yaseenReady' }, { origin: 'https://app.diagrams.net' })
    drawio({ event: 'configure' }, { source: window })
    drawio({ event: 'yaseenReady' })
    expect(posted).toEqual([])
  })

})

describe('the theme (🔒 YAZ-1802 D12)', () => {
  it('a flip is draw.io’s own darkMode / lightMode action — the frame is never reloaded', async () => {
    await opened()
    const src = frame()!.src
    await appTheme('dark')
    expect(posted.at(-1)).toEqual({ action: 'invokeAction', actionName: 'darkMode', _origin: DRAWIO_ORIGIN })
    await appTheme('light')
    expect(posted.at(-1)).toMatchObject({ action: 'invokeAction', actionName: 'lightMode' })
    expect(frame()!.src).toBe(src)
  })

  it('a flip before draw.io listens is sent the moment it does, ahead of the document', async () => {
    render()
    await settle()
    tapFrame()
    drawio({ event: 'yaseenReady' })
    drawio({ event: 'configure' })
    await appTheme('dark')
    expect(posted.map((m) => m.action)).toEqual(['configure'])
    drawio({ event: 'init' })
    expect(posted.map((m) => m.action)).toEqual(['configure', 'invokeAction', 'load'])
    expect(posted[1]).toMatchObject({ actionName: 'darkMode' })
  })
})

describe('the dark-mode colour setting (🔒 YAZ-1802 D16)', () => {
  it('rides the configure reply as draw.io’s defaultAdaptiveColors', async () => {
    render('keep')
    await settle()
    tapFrame()
    drawio({ event: 'yaseenReady' })
    drawio({ event: 'configure' })
    expect((posted[0].config as Record<string, unknown>).defaultAdaptiveColors).toBe('none')
  })

  it('a change is ONE message to our PostConfig — no reload, nothing saved', async () => {
    await opened()
    const src = frame()!.src
    posted = []
    render('keep')
    await settle()
    expect(posted).toEqual([{ action: 'yaseenAdaptiveColors', value: 'none', _origin: DRAWIO_ORIGIN }])
    render('keep')
    await settle()
    expect(posted).toHaveLength(1)
    expect(frame()!.src).toBe(src)
    expect(save).not.toHaveBeenCalled()
  })

  it('a change before draw.io listens is sent the moment it does', async () => {
    render()
    await settle()
    tapFrame()
    drawio({ event: 'yaseenReady' })
    drawio({ event: 'configure' })
    render('keep')
    await settle()
    expect(posted.map((m) => m.action)).toEqual(['configure'])
    drawio({ event: 'init' })
    expect(posted.map((m) => m.action)).toEqual(['configure', 'yaseenAdaptiveColors', 'load'])
  })
})

describe('File › Export Image… (🔒 YAZ-1802 D9)', () => {
  const exportImage = async (): Promise<void> => {
    container.querySelector('.editor--diagram')!.dispatchEvent(new CustomEvent(BOARD_COMMAND_EVENT, { detail: { kind: 'export-image' } }))
    await settle()
    await settle()
  }

  it('draws what is on screen — unsaved edits too — as PNG and SVG, and main’s sheet writes the one picked', async () => {
    await opened()
    drawio({ event: 'autosave', xml: EDITED })
    await exportImage()
    expect(vi.mocked(renderDiagramImage).mock.calls).toEqual([
      [EDITED, 'png'],
      [EDITED, 'svg'],
    ])
    expect(saveImage).toHaveBeenCalledExactlyOnceWith({ defaultName: 'Flow.png', png: 'data:image/png;base64,UE5H', svg: 'data:image/svg+xml;base64,U1ZH' })
    expect(notice).toHaveBeenCalledWith('Exported to Flow.png')
    expect(save).not.toHaveBeenCalled()
  })

  it('an empty diagram says so and opens no sheet; a failure says why', async () => {
    await opened()
    vi.mocked(renderDiagramImage).mockResolvedValue('')
    await exportImage()
    expect(saveImage).not.toHaveBeenCalled()
    expect(notice).toHaveBeenLastCalledWith('This draw.io diagram is empty, so there is no image to export.')
    vi.mocked(renderDiagramImage).mockRejectedValue(new Error('timed out'))
    await exportImage()
    expect(notice).toHaveBeenLastCalledWith("The draw.io diagram couldn't be exported.", 'error')
  })
})

describe('saving', () => {
  it('opening and not touching writes nothing; an edit saves the latest XML 500 ms later under the loaded mtime', async () => {
    await opened()
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(save).not.toHaveBeenCalled()
    drawio({ event: 'autosave', xml: EDITED })
    expect(text()).toContain('Unsaved')
    await act(async () => {
      vi.advanceTimersByTime(600)
    })
    await settle()
    expect(save).toHaveBeenCalledExactlyOnceWith({ root: ROOT, path: PATH, xml: EDITED, expectedMtime: 100 })
    expect(text()).toContain('Saved')
  })

  it('⌘S (draw.io’s own save event) writes at once', async () => {
    await opened()
    drawio({ event: 'save', xml: EDITED })
    await settle()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ xml: EDITED }))
  })
})

describe('changes on disk', () => {
  it('YAZ-4279 item 1: a CLEAN tab MERGES the disk (draw.io keeps undo, the selection and the view); draw.io\'s autosave of it is the baseline, not an edit', async () => {
    await opened()
    load.mockResolvedValue({ path: PATH, xml: EDITED, mtime: 300, size: 1 })
    watcherSaw({ type: 'change', path: PATH, mtime: 300 })
    await settle()
    await settle()
    expect(posted.filter((m) => m.action === 'yaseenMerge')).toEqual([{ action: 'yaseenMerge', id: 1, base: XML, xml: EDITED, glow: 'until-checked', _origin: DRAWIO_ORIGIN }])
    expect(posted.some((m) => m.action === 'load' && m.xml === EDITED)).toBe(false)
    await act(async () => {
      vi.advanceTimersByTime(600)
    })
    expect(save).not.toHaveBeenCalled()
    drawio({ event: 'autosave', xml: `${EDITED} ` })
    await act(async () => {
      vi.advanceTimersByTime(600)
    })
    await settle()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ expectedMtime: 300 }))
  })

  it('a clean merge draw.io refuses falls back to the load that keeps the page and the view (YAZ-3420 D2)', async () => {
    await opened()
    mergeReply = 'conflict'
    load.mockResolvedValue({ path: PATH, xml: EDITED, mtime: 300, size: 1 })
    watcherSaw({ type: 'change', path: PATH, mtime: 300 })
    await settle()
    await settle()
    expect(posted.at(-1)).toMatchObject({ action: 'load', xml: EDITED, yaseenKeepView: true })
  })

  it('YAZ-4279 D2: unsaved edits meet a newer file: merged in draw.io, no bar, and the merge saves against the new mtime', async () => {
    await opened()
    drawio({ event: 'autosave', xml: EDITED })
    load.mockResolvedValue({ path: PATH, xml: `${XML}<!--ai-->`, mtime: 300, size: 1 })
    watcherSaw({ type: 'change', path: PATH, mtime: 300 })
    await settle()
    await settle()
    expect(posted.filter((m) => m.action === 'yaseenMerge')).toEqual([{ action: 'yaseenMerge', id: 1, base: XML, xml: `${XML}<!--ai-->`, glow: 'until-checked', _origin: DRAWIO_ORIGIN }])
    expect(text()).not.toContain('File changed on disk.')
    await act(async () => {
      vi.advanceTimersByTime(600)
    })
    await settle()
    // 4A-3: the save writes the whole merged file the answer carried, not only draw.io's page on screen.
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ expectedMtime: 300, xml: `${XML}<!--ai--><!--merged--><!--every page-->` }))
  })

  it('YAZ-4279 D4: a clash in draw.io is the bar; Reload from the bar puts the disk back with a load, never a merge', async () => {
    await opened()
    mergeReply = 'conflict'
    drawio({ event: 'autosave', xml: EDITED })
    load.mockResolvedValue({ path: PATH, xml: `${XML}<!--ai-->`, mtime: 300, size: 1 })
    watcherSaw({ type: 'change', path: PATH, mtime: 300 })
    await settle()
    await settle()
    expect(text()).toContain('File changed on disk.')
    const merges = posted.filter((m) => m.action === 'yaseenMerge').length
    await act(async () => [...container.querySelectorAll('button')].find((b) => b.textContent === 'Reload')!.click())
    await settle()
    expect(posted.filter((m) => m.action === 'yaseenMerge')).toHaveLength(merges)
    expect(posted.at(-1)).toMatchObject({ action: 'load', xml: `${XML}<!--ai-->` })
  })

  it('4A-1: a label typed while draw.io waits to merge (a clean tab then) is kept: it saves with the merge', async () => {
    await opened()
    mergeReply = 'none'
    load.mockResolvedValue({ path: PATH, xml: `${XML}<!--ai-->`, mtime: 300, size: 1 })
    watcherSaw({ type: 'change', path: PATH, mtime: 300 })
    await settle()
    await settle()
    const ask = posted.filter((m) => m.action === 'yaseenMerge').at(-1)!
    // The label ends: draw.io posts it, then the overlay begins the merge.
    drawio({ event: 'autosave', xml: `${XML}<!--label-->` })
    drawio({ event: 'yaseenMerging', id: ask.id })
    drawio({ event: 'autosave', xml: `${XML}<!--label--><!--ai-->` })
    drawio({ event: 'yaseenMerge', id: ask.id, xml: `${XML}<!--label--><!--ai-->` })
    await settle()
    await act(async () => {
      vi.advanceTimersByTime(600)
    })
    await settle()
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ expectedMtime: 300, xml: `${XML}<!--label--><!--ai-->` }))
  })

  it('4A-2: an answer to another request is not this one\'s; a burst asks one at a time, then once more for the latest', async () => {
    await opened()
    mergeReply = 'none'
    load.mockResolvedValue({ path: PATH, xml: `${XML}<!--1-->`, mtime: 300, size: 1 })
    watcherSaw({ type: 'change', path: PATH, mtime: 300 })
    await settle()
    await settle()
    load.mockResolvedValue({ path: PATH, xml: `${XML}<!--2-->`, mtime: 310, size: 1 })
    watcherSaw({ type: 'change', path: PATH, mtime: 310 })
    watcherSaw({ type: 'change', path: PATH, mtime: 320 })
    await settle()
    expect(posted.filter((m) => m.action === 'yaseenMerge')).toHaveLength(1)
    drawio({ event: 'yaseenMerge', id: 99, conflict: true }) // not this request's
    await settle()
    expect(text()).not.toContain('File changed on disk.')
    drawio({ event: 'yaseenMerging', id: 1 })
    drawio({ event: 'yaseenMerge', id: 1, xml: `${XML}<!--1-->` })
    await settle()
    await settle()
    expect(posted.filter((m) => m.action === 'yaseenMerge').map((m) => m.xml)).toEqual([`${XML}<!--1-->`, `${XML}<!--2-->`])
  })

  it('item 10: a clash keeps the bar; a later outside save that merges takes it down', async () => {
    await opened()
    mergeReply = 'conflict'
    drawio({ event: 'autosave', xml: EDITED })
    load.mockResolvedValue({ path: PATH, xml: `${XML}<!--ai-->`, mtime: 300, size: 1 })
    watcherSaw({ type: 'change', path: PATH, mtime: 300 })
    await settle()
    await settle()
    expect(text()).toContain('File changed on disk.')
    mergeReply = 'merged'
    load.mockResolvedValue({ path: PATH, xml: `${XML}<!--ai2-->`, mtime: 400, size: 1 })
    watcherSaw({ type: 'change', path: PATH, mtime: 400 })
    await settle()
    await settle()
    expect(text()).not.toContain('File changed on disk.')
  })

  it('after a save, the merge\'s base is what the save wrote', async () => {
    await opened()
    drawio({ event: 'autosave', xml: EDITED })
    await act(async () => {
      vi.advanceTimersByTime(600)
    })
    await settle()
    drawio({ event: 'autosave', xml: `${EDITED}<!--more-->` })
    load.mockResolvedValue({ path: PATH, xml: XML, mtime: 400, size: 1 })
    watcherSaw({ type: 'change', path: PATH, mtime: 400 })
    await settle()
    await settle()
    expect(posted.filter((m) => m.action === 'yaseenMerge').at(-1)).toMatchObject({ base: EDITED })
  })
})

describe('read only (YAZ-3076 D2)', () => {
  const LOCKED = XML.replace('<mxfile>', '<mxfile yaseendraw-readonly="1">')

  it('an editable file says nothing to draw.io: the graph is on by default', async () => {
    await opened()
    expect(posted.some((m) => m.action === 'yaseenReadOnly')).toBe(false)
  })

  it('a read-only file turns the graph off as draw.io starts listening, ahead of the document', async () => {
    load.mockResolvedValue({ path: PATH, xml: LOCKED, mtime: 100, size: 1 })
    await opened()
    expect(posted.map((m) => m.action)).toEqual(['configure', 'yaseenReadOnly', 'load'])
    expect(posted[1]).toMatchObject({ value: true })
  })

  it('S29: whatever draw.io reports while read only is never saved; at "Allow edits" the canvas goes back to the disk', async () => {
    load.mockResolvedValue({ path: PATH, xml: LOCKED, mtime: 100, size: 1 })
    await opened()
    drawio({ event: 'autosave', xml: EDITED })
    drawio({ event: 'save', xml: EDITED })
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    await settle()
    expect(save).not.toHaveBeenCalled()
    expect(text()).toContain('Saved')
    // An agent removes the switch on disk (S15): the tab reloads, the graph turns on, and the canvas is the disk's.
    load.mockResolvedValue({ path: PATH, xml: XML, mtime: 300, size: 1 })
    posted = []
    watcherSaw({ type: 'change', path: PATH, mtime: 300 })
    await settle()
    await settle()
    expect(posted.filter((m) => m.action === 'yaseenReadOnly')).toEqual([{ action: 'yaseenReadOnly', value: false, _origin: DRAWIO_ORIGIN }])
    expect(posted.filter((m) => m.action === 'load').at(-1)).toMatchObject({ xml: XML })
  })

  it('S15: an agent sets the switch on disk — the open tab turns the graph off at once', async () => {
    await opened()
    load.mockResolvedValue({ path: PATH, xml: LOCKED, mtime: 300, size: 1 })
    watcherSaw({ type: 'change', path: PATH, mtime: 300 })
    await settle()
    expect(posted).toContainEqual({ action: 'yaseenReadOnly', value: true, _origin: DRAWIO_ORIGIN })
  })
})

describe("the cog on a diagram (YAZ-3943 D13: the drawing's rows are a drawing's only)", () => {
  it('has only "Read only": no pictures row, no export rows', async () => {
    await opened()
    act(() => container.querySelector<HTMLButtonElement>('.page-settings__trigger')!.click())
    expect([...container.querySelectorAll('.page-settings__menu > *')].map((r) => r.textContent)).toEqual(['Read only'])
  })
})

describe('read only: a change draw.io queued before the switch landed (YAZ-3116 A3)', () => {
  it('an autosave that arrives while the switch is being written saves WITH the switch: draw.io\u2019s XML has no attribute of ours', async () => {
    await opened()
    let answer!: (res: { path: string; mtime: number; size: number }) => void
    setBoardReadOnly.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    act(() => container.querySelector<HTMLButtonElement>('.page-settings__trigger')!.click())
    const row = [...container.querySelectorAll<HTMLButtonElement>('.page-settings__menu > button')].find((b) => b.textContent?.startsWith('Read only'))!
    await act(async () => {
      row.click()
      await Promise.resolve()
    })
    expect(setBoardReadOnly).toHaveBeenCalledWith({ root: ROOT, path: PATH, on: true, expectedMtime: 100 })
    // draw.io reports a change made just before the click, while the switch is on its way to disk.
    drawio({ event: 'autosave', xml: EDITED })
    await act(async () => answer({ path: PATH, mtime: 300, size: 1 }))
    await settle()
    await act(async () => {
      vi.advanceTimersByTime(600)
    })
    await settle()
    expect(save).toHaveBeenCalledTimes(1)
    const written = save.mock.calls[0]![0]
    expect(written.expectedMtime).toBe(300)
    expect(written.xml).toBe(EDITED.replace('<mxfile>', '<mxfile yaseendraw-readonly="1">'))
  })
})
