/**
 * The preview panel of the search (YAZ-2662 D5): what it shows for each kind of file, its two
 * message lines, its ✕, and what it must never do — write, take the focus, or stand in for the open
 * page. `createCrepe`, `api` and the three viewers are stand-ins here; what the REAL Crepe renders
 * read-only is pinned next door in `QuickLook.crepe.test.tsx`, and the keys that show, move and
 * close the panel in `Sidebar.test.tsx`. The S- and R-numbers are the case record on YAZ-2662.
 */
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CrepeFeature } from '../editor/crepe'
import { createWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import type { WatchSource } from '../hooks/useWatch'
import { focusOpenDocument } from '../lib/focusHandoff'
import { QuickLook } from './QuickLook'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

type File = { path: string; content: string; mtime: number; size: number }

const { readFile, crepes, viewers, viewer } = vi.hoisted(() => {
  const viewers: Array<{ kind: string; path: string; watch: unknown }> = []
  return {
    readFile: vi.fn<(path: string) => Promise<File>>(),
    crepes: [] as Array<{ opts: Record<string, unknown> & { root: HTMLElement; defaultValue?: string }; create: Mock; setReadonly: Mock; destroy: Mock }>,
    viewers,
    /** One of the three read-only viewers of a page: the stand-in says which one it is and what it was handed. */
    viewer: (kind: string) => (props: { path: string; watch: unknown }) => {
      viewers.push({ kind, ...props })
      return <div data-viewer={kind} data-path={props.path} />
    },
  }
})

// The whole bridge the panel may touch is ONE read: a write of any kind would throw here (S42).
vi.mock('../api', () => ({ api: { readFile } }))

/** A stand-in Crepe: records its options and draws a document on show, as a browser lays one out. */
vi.mock('../editor/createCrepe', () => ({
  createCrepe: vi.fn((opts: Record<string, unknown> & { root: HTMLElement; defaultValue?: string }) => {
    const inst = { opts, create: vi.fn(async () => {}), setReadonly: vi.fn(), destroy: vi.fn() }
    const pm = document.createElement('div')
    pm.className = 'ProseMirror'
    pm.tabIndex = -1
    pm.textContent = opts.defaultValue ?? ''
    Object.defineProperty(pm, 'offsetParent', { get: () => document.body })
    opts.root.appendChild(pm)
    crepes.push(inst)
    return inst
  }),
}))

vi.mock('../viewers/TextViewer', () => ({ TextViewer: viewer('text') }))
vi.mock('../viewers/ImageViewer', () => ({ ImageViewer: viewer('image') }))
vi.mock('../viewers/PdfViewer', () => ({ PdfViewer: viewer('pdf') }))

const NOTE = '---\ntitle: Plan\n---\n\n# Hello\n\nthe body\n'
const BODY = '\n# Hello\n\nthe body\n'
const file = (path: string, content = NOTE): File => ({ path, content, mtime: 1, size: content.length })

const watch: WatchSource = { subscribe: () => () => undefined }
const wikilinks = createWikilinkResolveSource()

let root: Root | null = null
let container: HTMLElement | null = null

/** The panel as App mounts it: on `path`, named as the tree names the file. A second call shows the next file in the SAME panel. */
async function show(path: string, title = 'Plan', onClose = vi.fn()) {
  if (root === null) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  }
  await act(async () => root?.render(<QuickLook path={path} title={title} watch={watch} wikilinks={wikilinks} onClose={onClose} />))
  return { panel: container!.querySelector<HTMLElement>('.quicklook')!, onClose }
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  document.body.replaceChildren()
  readFile.mockReset()
  crepes.length = 0
  viewers.length = 0
})

describe('the preview panel of the search (YAZ-2662 D5)', () => {
  it('S31, S39, S42, S44: a note shows under its title, read from the disk one time and rendered read-only — no frontmatter, no plugin that edits, nothing that saves or stores a fold — and the panel takes no focus', async () => {
    readFile.mockImplementation(async (path) => file(path))
    const bar = document.createElement('input')
    document.body.appendChild(bar)
    bar.focus()
    const { panel } = await show('/v/Plan.md')
    expect(panel.querySelector('.quicklook__title')?.textContent).toBe('Plan')
    expect(readFile).toHaveBeenCalledExactlyOnceWith('/v/Plan.md')
    expect(crepes).toHaveLength(1)
    const { opts, setReadonly } = crepes[0]
    expect(opts.defaultValue).toBe(BODY)
    expect(setReadonly).toHaveBeenCalledExactlyOnceWith(true)
    expect(opts.features).toMatchObject({ [CrepeFeature.BlockEdit]: false, [CrepeFeature.Toolbar]: false })
    // The window's resolve source, so an id link shows its note's title; and no door of the editor that writes.
    expect(Object.keys(opts).sort()).toEqual(['defaultValue', 'features', 'root', 'wikilinks'])
    expect(opts.wikilinks).toBe(wikilinks)
    expect(panel.querySelector('.quicklook__body .ProseMirror')?.textContent).toBe(BODY)
    expect(document.activeElement).toBe(bar)
    expect(viewers).toEqual([])
  })

  it.each([
    ['a text file', '/v/data.JSON', 'text'],
    ['an image', '/v/shot.png', 'image'],
    ['a PDF', '/v/paper.pdf', 'pdf'],
  ])('S39: %s shows in the read-only viewer of its page, on the watcher of its vault — the panel reads nothing itself', async (_name, path, kind) => {
    const { panel } = await show(path, 'the file')
    expect(panel.querySelector(`.quicklook__body > [data-viewer="${kind}"]`)?.getAttribute('data-path')).toBe(path)
    expect(viewers.at(-1)).toEqual({ kind, path, watch })
    expect(readFile).not.toHaveBeenCalled()
    expect(crepes).toEqual([])
  })

  it('S40: a file that the app cannot show gets one line, and nothing is read', async () => {
    const { panel } = await show('/v/archive.zip', 'archive.zip')
    expect(panel.querySelector('.quicklook__title')?.textContent).toBe('archive.zip')
    expect(panel.querySelector('.quicklook__body')?.textContent).toBe('No preview for this file.')
    expect(readFile).not.toHaveBeenCalled()
    expect([crepes, viewers]).toEqual([[], []])
  })

  it('S41: a note that is gone, or that the app cannot read, gets one line that names it as the tree does — and no document', async () => {
    readFile.mockRejectedValue({ code: 'NOT_FOUND', message: 'path does not exist' })
    const { panel } = await show('/v/Plan.md', 'Plan of the year')
    expect(panel.querySelector('.quicklook__body')?.textContent).toBe('Can\'t preview "Plan of the year" — it is no longer there')
    expect(crepes).toEqual([])
  })

  it('a note with no text below its frontmatter says so, as the hover card does — no empty document with the hint of an editor', async () => {
    readFile.mockImplementation(async (path) => file(path, '---\ntitle: Plan\n---\n\n'))
    const { panel } = await show('/v/Plan.md')
    expect(panel.querySelector('.quicklook__body')?.textContent).toBe('Empty page')
    expect(crepes).toEqual([])
  })

  it('S43: the ✕ of the header is the one control; a click asks App to close the panel, and a press on it takes no focus from the search bar', async () => {
    readFile.mockImplementation(async (path) => file(path))
    const { panel, onClose } = await show('/v/Plan.md')
    const buttons = [...panel.querySelectorAll('button')]
    expect(buttons.map((b) => [b.getAttribute('aria-label'), b.textContent])).toEqual([['Close preview', '✕']])
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    act(() => void buttons[0].dispatchEvent(down))
    expect(down.defaultPrevented).toBe(true)
    act(() => buttons[0].click())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('R3: one read for each file the panel is shown; a read that lands after the panel moved on is dropped, and the document of the earlier file is taken down', async () => {
    const pending = new Map<string, (f: File) => void>()
    readFile.mockImplementation((path) => new Promise((resolve) => pending.set(path, resolve)))
    await show('/v/Slow.md', 'Slow')
    const { panel } = await show('/v/Fast.md', 'Fast')
    expect(readFile.mock.calls).toEqual([['/v/Slow.md'], ['/v/Fast.md']])
    await act(async () => pending.get('/v/Fast.md')!(file('/v/Fast.md', 'fast text')))
    await act(async () => pending.get('/v/Slow.md')!(file('/v/Slow.md', 'slow text')))
    expect(crepes.map((c) => c.opts.defaultValue)).toEqual(['fast text'])
    expect([panel.querySelector('.quicklook__title')?.textContent, panel.querySelector('.quicklook__body')?.textContent]).toEqual(['Fast', 'fast text'])
    // The next file: the document of this one is destroyed, and its node leaves the panel.
    await show('/v/archive.zip', 'archive.zip')
    await act(async () => {})
    expect(crepes[0].destroy).toHaveBeenCalledTimes(1)
    expect(panel.querySelector('.ProseMirror')).toBeNull()
  })

  it('R4: the note in the panel is not the open document — `focusOpenDocument` goes past it to the page, and with no page open it moves no caret', async () => {
    readFile.mockImplementation(async (path) => file(path))
    const { panel } = await show('/v/Plan.md')
    const previewed = panel.querySelector<HTMLElement>('.editor-instance .ProseMirror')
    expect(previewed?.offsetParent).not.toBeNull()
    expect(focusOpenDocument()).toBe(false)
    expect(document.activeElement).toBe(document.body)
    const page = document.createElement('div')
    page.className = 'editor-instance'
    page.innerHTML = '<div class="ProseMirror" tabindex="-1"></div>'
    Object.defineProperty(page.firstElementChild, 'offsetParent', { get: () => document.body })
    document.body.appendChild(page)
    expect(focusOpenDocument()).toBe(true)
    expect(document.activeElement).toBe(page.firstElementChild)
  })
})
