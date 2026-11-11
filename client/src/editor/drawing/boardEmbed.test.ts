/**
 * Board embeds in the note (YAZ-4827 2A, YAZ-4829 2C, YAZ-4830 2D, YAZ-4831 2E): a real editor (`createCrepe`) and a
 * FAKE window — `loadBoardWindow` is mocked, and each mount records the host it got and every call the host made.
 * Pinned: which embeds get a window, the window's ref and options, the update on a text change, the view write (only
 * the options, outside undo, never in a read-only note), the stable key, destroy, the typing count, selection, caret,
 * find, the plain-text copy, no hover card, the menu, open, fold, the outside-edit merge, and the paste → embed flow.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { undo, undoDepth } from '@milkdown/kit/prose/history'
import { Slice } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { EmbedOptions } from '@shared/embedOptions'
import type { BoardWindowHandle, BoardWindowHost, WindowMenuRow } from '../embed/types'
import { createCrepe, getMarkdownForSave, type CreateCrepeOptions } from '../createCrepe'
import { mergeExternalMarkdown } from '../external/mergeExternal'
import { createFindChannel } from '../find/findChannel'
import { createWikilinkCandidateSource } from '../wikilink/wikilinkPicker'
import { createWikilinkResolveSource, linksAsShown } from '../wikilink/wikilinkPlugin'
import type { ViewOnlyLinkSource } from '../wikilink/viewOnlyLinkSource'
import { clipboardPlainText } from '../clipboardPlainText'
import { BOARD_EMBED_CLASS, BOARD_EMBED_SYNTAX_CLASS, boardEmbedStats } from './boardEmbed'

/** One fake window: the host it was given, and every call made on it since. */
interface Fake {
  host: BoardWindowHost
  dom: HTMLElement
  calls: Array<[string, unknown]>
  destroyed: boolean
}
const fakes = vi.hoisted(() => ({ list: [] as Fake[], rows: [] as WindowMenuRow[] }))

vi.mock('../embed/types', async (original) => ({
  ...(await original<typeof import('../embed/types')>()),
  loadBoardWindow: () =>
    Promise.resolve({
      mountBoardWindow: (host: BoardWindowHost): BoardWindowHandle => {
        const dom = document.createElement('div')
        dom.className = 'fake-window'
        // A name pill drawn like a link pill: the hover card must still skip it (item 23).
        dom.innerHTML = '<span class="wikilink">name</span>'
        const fake: Fake = { host: { ...host }, dom, calls: [], destroyed: false }
        fakes.list.push(fake)
        return {
          dom,
          update: (next) => {
            fake.calls.push(['update', next])
            Object.assign(fake.host, next)
          },
          setSelected: (on) => fake.calls.push(['setSelected', on]),
          // The real window's Shift+1 is its fit (D10); the fake records it as one.
          handleKey: (e) => (e.key === '!' && e.shiftKey ? (fake.calls.push(['fit', null]), true) : false),
          setFolded: (on) => fake.calls.push(['setFolded', on]),
          setFoldable: (on) => fake.calls.push(['setFoldable', on]),
          menuRows: () => fakes.rows,
          fit: () => fake.calls.push(['fit', null]),
          destroy: () => {
            fake.destroyed = true
          },
        }
      },
    }),
}))

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

/** A view-only source (boards are view-only files) that resolves every board to `/v/<name>`. */
function viewOnlyResolving(): ViewOnlyLinkSource & { swap: (resolve: ((t: string) => string | null) | null) => void } {
  let resolve: ((t: string) => string | null) | null = (t) => `/v/${t}`
  const listeners = new Set<() => void>()
  return {
    ready: true,
    catalog: null,
    targets: [],
    get resolve() {
      return resolve
    },
    subscribe: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    swap: (next) => {
      resolve = next
      listeners.forEach((l) => l())
    },
  }
}

const nav = () => ({ root: '/v', createFolder: () => '', openCurrent: vi.fn(), openBackground: vi.fn(), onNotice: vi.fn() })

async function mount(markdown: string, extra: Partial<CreateCrepeOptions> = {}) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const wikilinks = createWikilinkResolveSource()
  wikilinks.update((t) => (t.endsWith('.md') || !t.includes('.') ? `/v/${t}.md` : null))
  const crepe = createCrepe({ root, defaultValue: markdown, wikilinks, boardEmbeds: { root: '/v' }, ...extra })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.ctx.get(editorViewCtx)
  return { crepe, root, view }
}

const windows = (n: number) => vi.waitFor(() => expect(fakes.list.filter((f) => !f.destroyed)).toHaveLength(n))
const hidden = (root: HTMLElement) => Array.from(root.querySelectorAll(`.${BOARD_EMBED_SYNTAX_CLASS}`)).map((el) => el.textContent ?? '').join('')
const md = (crepe: Crepe) => getMarkdownForSave(crepe)
const OPTS: EmbedOptions = { width: 640, height: 360, view: { x: 120, y: -40, zoom: 0.8 }, locked: false, page: null, rest: [] }

/** The first position of `text` in the doc. */
function posOf(view: EditorView, text: string): number {
  let at = -1
  view.state.doc.descendants((node, pos) => {
    if (at === -1 && node.isText && node.text!.includes(text)) at = pos + node.text!.indexOf(text)
  })
  if (at < 0) throw new Error(`no ${text}`)
  return at
}

function key(view: EditorView, init: KeyboardEventInit): boolean {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  return view.someProp('handleKeyDown', (f) => f(view, event)) ?? false
}

beforeEach(() => {
  fakes.list.length = 0
  fakes.rows = []
})

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
  document.querySelectorAll('.ctx-menu, .path-paste-chip').forEach((el) => el.remove())
})

describe('which embeds get a window (2A, 2E)', () => {
  it('a `.drawio` and an old `![[x.excalidraw]]` with no options each mount a window; their text is hidden', async () => {
    const { root } = await mount('![[CloudFront.drawio|640x360 view=120,-40,0.8]]\n\n![[Sketch.excalidraw]]\n')
    await windows(2)
    expect(root.querySelectorAll(`.${BOARD_EMBED_CLASS} .fake-window`)).toHaveLength(2)
    expect(hidden(root)).toBe('![[CloudFront.drawio|640x360 view=120,-40,0.8]]![[Sketch.excalidraw]]')
    const [diagram, drawing] = fakes.list
    expect(diagram!.host.ref).toMatchObject({ root: '/v', path: 'CloudFront.drawio', kind: 'diagram', name: 'CloudFront', vault: null })
    expect(diagram!.host.options).toEqual(OPTS)
    // D7: the old embed is a window at the default size, fitted.
    expect(drawing!.host.ref).toMatchObject({ kind: 'drawing', name: 'Sketch' })
    expect(drawing!.host.options).toBeNull()
  })

  it('every other embed, every link and code stay exactly as they were', async () => {
    const { root } = await mount('![[img.png]]\n\n[[CloudFront.drawio]]\n\n```\n![[x.drawio]]\n```\n\n`![[y.drawio]]`\n')
    await Promise.resolve()
    await Promise.resolve()
    expect(fakes.list).toHaveLength(0)
    expect(root.querySelector(`.${BOARD_EMBED_CLASS}`)).toBeNull()
  })

  it('the path comes from the resolver; a change of the resolver gives the window its new ref, same window', async () => {
    const viewOnly = viewOnlyResolving()
    await mount('![[CloudFront.drawio]]\n', { viewOnlyLinks: viewOnly })
    await windows(1)
    expect(fakes.list[0]!.host.ref.path).toBe('/v/CloudFront.drawio')
    viewOnly.swap((t) => `/v/boards/${t}`)
    expect(fakes.list[0]!.calls).toContainEqual(['update', { ref: expect.objectContaining({ path: '/v/boards/CloudFront.drawio' }) }])
    viewOnly.swap(() => null)
    expect(fakes.list[0]!.host.ref.path).toBeNull()
    expect(fakes.list).toHaveLength(1)
  })
})

describe('the text and the window (2A)', () => {
  it('a text change (an outside edit, an undo) updates the SAME window with the new options', async () => {
    const { view } = await mount('![[CloudFront.drawio|640x360]]\n')
    await windows(1)
    const at = posOf(view, '640x360')
    view.dispatch(view.state.tr.insertText('800x400', at, at + 7))
    expect(fakes.list).toHaveLength(1)
    expect(fakes.list[0]!.calls).toContainEqual(['update', { options: expect.objectContaining({ width: 800, height: 400 }) }])
  })

  it('a view write replaces ONLY the options, is no undo step, and keeps the same window and DOM', async () => {
    const { crepe, view, root } = await mount('Intro\n\n![[CloudFront.drawio|640x360 extra]] tail\n')
    await windows(1)
    view.dispatch(view.state.tr.insertText('!', 1)) // one undo step of typing first
    const depth = undoDepth(view.state)
    const box = root.querySelector(`.${BOARD_EMBED_CLASS}`)
    fakes.list[0]!.host.onOptions!(OPTS)
    expect(md(crepe)).toBe('!Intro\n\n![[CloudFront.drawio|640x360 view=120,-40,0.8]] tail\n')
    expect(undoDepth(view.state)).toBe(depth)
    expect(root.querySelector(`.${BOARD_EMBED_CLASS}`)).toBe(box)
    expect(fakes.list).toHaveLength(1)
    // The same options again: nothing to write.
    const doc = view.state.doc
    fakes.list[0]!.host.onOptions!(OPTS)
    expect(view.state.doc).toBe(doc)
    // ⌘Z undoes the typing, never the view.
    undo(view.state, view.dispatch)
    expect(md(crepe)).toBe('Intro\n\n![[CloudFront.drawio|640x360 view=120,-40,0.8]] tail\n')
  })

  it('an embed with no options gets its `|…` before `]]`', async () => {
    const { crepe } = await mount('![[Sketch.excalidraw]]\n')
    await windows(1)
    fakes.list[0]!.host.onOptions!({ ...OPTS, view: null, locked: true })
    expect(md(crepe)).toBe('![[Sketch.excalidraw|640x360 locked]]\n')
  })

  it('a read-only note writes nothing, and the window hears that it is read-only', async () => {
    const { crepe, view } = await mount('![[CloudFront.drawio]]\n')
    await windows(1)
    view.setProps({ editable: () => false })
    expect(fakes.list[0]!.calls).toContainEqual(['update', { editable: false }])
    fakes.list[0]!.host.onOptions!(OPTS)
    expect(md(crepe)).toBe('![[CloudFront.drawio]]\n')
  })

  it('two embeds of one board are two windows; a view write of the second keeps both', async () => {
    const { crepe } = await mount('![[A.drawio]] and ![[A.drawio]]\n')
    await windows(2)
    fakes.list[1]!.host.onOptions!(OPTS)
    expect(md(crepe)).toBe('![[A.drawio]] and ![[A.drawio|640x360 view=120,-40,0.8]]\n')
    expect(fakes.list).toHaveLength(2)
    expect(fakes.list.every((f) => !f.destroyed)).toBe(true)
  })

  it('deleting the embed destroys its window; a write from a stale window is refused', async () => {
    const { crepe, view } = await mount('Before\n\n![[CloudFront.drawio]]\n')
    await windows(1)
    const at = posOf(view, '![[')
    view.dispatch(view.state.tr.delete(at, at + '![[CloudFront.drawio]]'.length))
    expect(fakes.list[0]!.destroyed).toBe(true)
    fakes.list[0]!.host.onOptions!(OPTS)
    expect(md(crepe)).toBe('Before\n')
  })
})

describe('the typing path (D1)', () => {
  it('a keystroke scans only the textblocks it touched, never the whole note', async () => {
    const lines = Array.from({ length: 60 }, (_, i) => (i % 3 === 0 ? `![[Board ${i}.drawio|640x360]]` : `Line ${i} with words`))
    const { view } = await mount(`${lines.join('\n\n')}\n`)
    await windows(20)
    const at = posOf(view, 'Line 31') + 4
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)))
    const before = boardEmbedStats.blocksScanned
    for (const ch of 'abc') view.dispatch(view.state.tr.insertText(ch))
    // Three keys: each scans the caret's block and at most its neighbours, never 60 blocks.
    expect(boardEmbedStats.blocksScanned - before).toBeLessThanOrEqual(9)
    expect(fakes.list.filter((f) => f.calls.some(([c]) => c === 'update'))).toHaveLength(0)
  })
})

describe('selection, caret, find, copy, hover (2A)', () => {
  it('a click selects the whole embed: the window is selected; Escape deselects; typing replaces it and ⌘Z brings it back', async () => {
    const { crepe, view } = await mount('A ![[CloudFront.drawio]] B\n')
    await windows(1)
    const fake = fakes.list[0]!
    fake.host.onSelect!()
    const at = posOf(view, '![[')
    expect([view.state.selection.from, view.state.selection.to]).toEqual([at, at + '![[CloudFront.drawio]]'.length])
    expect(fake.calls).toContainEqual(['setSelected', true])
    expect(key(view, { key: '!', shiftKey: true })).toBe(true)
    expect(fake.calls).toContainEqual(['fit', null])
    expect(key(view, { key: 'Escape' })).toBe(true)
    expect(fake.calls.at(-1)).toEqual(['setSelected', false])
    fake.host.onSelect!()
    view.dispatch(view.state.tr.insertText('x'))
    expect(md(crepe)).toBe('A x B\n')
    undo(view.state, view.dispatch)
    expect(md(crepe)).toBe('A ![[CloudFront.drawio]] B\n')
  })

  it('the caret steps over the embed as one unit, and Backspace after it removes it whole (item 21)', async () => {
    const { crepe, view } = await mount('A ![[CloudFront.drawio]] B\n')
    await windows(1)
    const at = posOf(view, '![[')
    const end = at + '![[CloudFront.drawio]]'.length
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at + 4)))
    expect([at, end]).toContain(view.state.selection.head)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)))
    expect(key(view, { key: 'Backspace' })).toBe(true)
    expect(md(crepe)).toBe('A  B\n')
  })

  it('⌘F finds no match in an embed`s hidden text (item 15)', async () => {
    const find = createFindChannel()
    await mount('CloudFront notes\n\n![[CloudFront.drawio|640x360]]\n', { find })
    await windows(1)
    find.open()
    find.setQuery('cloudfront')
    expect(find.getState().total).toBe(1)
    find.setQuery('640x360')
    expect(find.getState().total).toBe(0)
  })

  it('a plain-text copy gives the embed`s name (item 16), as text and as an image node', () => {
    const source = createWikilinkResolveSource()
    expect(linksAsShown('See ![[boards/CloudFront.drawio|640x360 view=1,2,0.5]] and ![[img.png]]', source, undefined, true)).toBe('See CloudFront and ![[img.png]]')
  })

  it('no pill hover card over the window (item 23)', async () => {
    const onHover = vi.fn()
    const { root } = await mount('![[CloudFront.drawio]]\n', { wikilinkHover: { onHover, onLeave: vi.fn() } })
    await windows(1)
    root.querySelector('.fake-window .wikilink')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(onHover).not.toHaveBeenCalled()
  })
})

describe('open and the menu (2C)', () => {
  it('a double-click opens the board as its pill does; a ⌘ double-click in a background tab', async () => {
    const wikilinkNav = nav()
    await mount('![[CloudFront.drawio]]\n', { wikilinkNav, viewOnlyLinks: viewOnlyResolving() })
    await windows(1)
    fakes.list[0]!.host.onOpen!('thisTab')
    fakes.list[0]!.host.onOpen!('backgroundTab')
    expect(wikilinkNav.openCurrent).toHaveBeenCalledWith('/v/CloudFront.drawio')
    expect(wikilinkNav.openBackground).toHaveBeenCalledWith('/v/CloudFront.drawio')
  })

  it('the menu: the pill rows, the window`s rows, then Edit in a popup, Show as link, Edit link, Remove embed', async () => {
    const onEditInPopup = vi.fn()
    fakes.rows = [{ label: 'Fit drawing to frame', run: vi.fn() }, { label: 'Page', run: () => {}, children: [{ label: 'One', run: vi.fn(), checked: true } as WindowMenuRow] }]
    const { crepe, root } = await mount('![[Sketch.excalidraw|640x360]]\n', { wikilinkNav: nav(), viewOnlyLinks: viewOnlyResolving(), boardEmbeds: { root: '/v', onEditInPopup } })
    await windows(1)
    fakes.list[0]!.host.onContextMenu!(new MouseEvent('contextmenu', { clientX: 5, clientY: 5 }))
    const labels = Array.from(document.querySelectorAll('.ctx-menu > .ctx-menu__item, .ctx-menu > .ctx-menu__parent > .ctx-menu__item')).map((b) => b.textContent)
    expect(labels.slice(0, 2)).toEqual(['Open', 'Open in new tab'])
    expect(labels.slice(-6)).toEqual(['Fit drawing to frame', 'Page', 'Edit in a popup', 'Show as link', 'Edit link', 'Remove embed'])
    const click = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')).find((b) => b.textContent === label)!.click()
    click('Edit in a popup')
    expect(onEditInPopup).toHaveBeenCalledWith('Sketch.excalidraw')
    void root
    fakes.list[0]!.host.onContextMenu!(new MouseEvent('contextmenu', { clientX: 5, clientY: 5 }))
    click('Show as link')
    expect(md(crepe)).toBe('[[Sketch.excalidraw]]\n')
  })

  it('a diagram`s menu has no Edit in a popup; Remove embed removes it whole', async () => {
    const { crepe } = await mount('A ![[CloudFront.drawio]] B\n', { wikilinkNav: nav(), boardEmbeds: { root: '/v', onEditInPopup: vi.fn() } })
    await windows(1)
    fakes.list[0]!.host.onContextMenu!(new MouseEvent('contextmenu'))
    const items = Array.from(document.querySelectorAll<HTMLButtonElement>('.ctx-menu__item'))
    expect(items.map((b) => b.textContent)).not.toContain('Edit in a popup')
    items.find((b) => b.textContent === 'Remove embed')!.click()
    expect(md(crepe)).toBe('A  B\n')
  })

  it('"Show as embed" on a board pill; none on a note pill (D8)', async () => {
    const { crepe, view, root } = await mount('[[CloudFront.drawio|Net]] and [[Plan]]\n', { wikilinkNav: nav() })
    const pill = (text: string) => Array.from(root.querySelectorAll<HTMLElement>('.wikilink')).find((el) => el.textContent === text)!
    const rowsAfter = (text: string) => {
      document.querySelectorAll('.ctx-menu').forEach((el) => el.remove())
      pill(text).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
      return Array.from(document.querySelectorAll<HTMLButtonElement>('.ctx-menu__item'))
    }
    expect(rowsAfter('Plan').map((b) => b.textContent)).not.toContain('Show as embed')
    rowsAfter('Net').find((b) => b.textContent === 'Show as embed')!.click()
    expect(md(crepe)).toBe('![[CloudFront.drawio]] and [[Plan]]\n')
    void view
    await windows(1)
  })

  it('⌥Enter in the `[[` picker puts a board in as its embed; Enter as a link (item 8)', async () => {
    const candidates = createWikilinkCandidateSource()
    candidates.update([{ name: 'CloudFront.drawio', insert: 'CloudFront.drawio', label: 'CloudFront', path: '/v/CloudFront.drawio' }])
    const { crepe, view } = await mount('x\n', { wikilinkCandidates: candidates })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)).insertText('[[Cloud'))
    expect(key(view, { key: 'Enter', altKey: true })).toBe(true)
    expect(md(crepe)).toBe('x![[CloudFront.drawio]]\n')
    view.dispatch(view.state.tr.insertText(' [[Cloud'))
    expect(key(view, { key: 'Enter' })).toBe(true)
    expect(md(crepe)).toBe('x![[CloudFront.drawio]] [[CloudFront.drawio]]\n')
  })
})

describe('fold on a bullet (2D)', () => {
  it('an embed makes its bullet foldable; the arrow folds and unfolds; a view write keeps the fold key', async () => {
    const keys: string[][] = []
    const { crepe } = await mount('* ![[CloudFront.drawio|640x360]]\n* plain\n', { folding: { onCollapsedKeysChange: (k) => keys.push([...k]) } })
    await windows(1)
    const fake = fakes.list[0]!
    await vi.waitFor(() => expect(fake.calls).toContainEqual(['setFoldable', true]))
    fake.host.onFold!()
    expect(fake.calls.at(-1)).toEqual(['setFolded', true])
    const folded = keys.at(-1)!
    expect(folded).toHaveLength(1)
    fake.host.onOptions!(OPTS)
    expect(md(crepe)).toBe('* ![[CloudFront.drawio|640x360 view=120,-40,0.8]]\n* plain\n')
    // The key counts the embed as its name: the write changed no key, so the fold stays.
    expect(keys.at(-1)).toEqual(folded)
    fake.host.onFold!()
    expect(fake.calls.at(-1)).toEqual(['setFolded', false])
  })

  it('an embed outside a bullet has no fold arrow', async () => {
    await mount('![[CloudFront.drawio]]\n')
    await windows(1)
    expect(fakes.list[0]!.calls).not.toContainEqual(['setFoldable', true])
  })
})

describe('an outside edit during a view write (item 19)', () => {
  it('the view write is merged with an edit of another line: no conflict bar', async () => {
    const base = 'Top line\n\n![[CloudFront.drawio|640x360]]\n\nEnd\n'
    const { crepe } = await mount(base)
    await windows(1)
    fakes.list[0]!.host.onOptions!(OPTS)
    const theirs = 'Top line, edited by the AI\n\n![[CloudFront.drawio|640x360]]\n\nEnd\n'
    expect(mergeExternalMarkdown(crepe, base, theirs)).toBe('merged')
    expect(md(crepe)).toBe('Top line, edited by the AI\n\n![[CloudFront.drawio|640x360 view=120,-40,0.8]]\n\nEnd\n')
    expect(fakes.list).toHaveLength(1)
  })

  it('the view write is merged with an edit of the SAME line: a pan is not typing (D2 exempts it)', async () => {
    const base = 'Diagram: ![[CloudFront.drawio|640x360]]\n\nEnd\n'
    const { crepe } = await mount(base)
    await windows(1)
    fakes.list[0]!.host.onOptions!(OPTS)
    const theirs = 'Diagram (edited): ![[CloudFront.drawio|640x360]]\n\nEnd\n'
    expect(mergeExternalMarkdown(crepe, base, theirs)).toBe('merged')
    expect(md(crepe)).toBe('Diagram (edited): ![[CloudFront.drawio|640x360 view=120,-40,0.8]]\n\nEnd\n')
  })

  it('a view write and an outside resize of the same embed both land: the size is theirs, the view is yours', async () => {
    const base = 'Diagram: ![[CloudFront.drawio|640x360]]\n'
    const { crepe } = await mount(base)
    await windows(1)
    fakes.list[0]!.host.onOptions!(OPTS)
    expect(mergeExternalMarkdown(crepe, base, 'Diagram: ![[CloudFront.drawio|500x200]]\n')).toBe('merged')
    expect(md(crepe)).toBe('Diagram: ![[CloudFront.drawio|500x200 view=120,-40,0.8]]\n')
  })

  it('typing on the embed line still conflicts with an outside edit of that line', async () => {
    const base = 'Diagram: ![[CloudFront.drawio|640x360]]\n'
    const { crepe, view } = await mount(base)
    await windows(1)
    view.dispatch(view.state.tr.insertText('My ', 1))
    expect(mergeExternalMarkdown(crepe, base, 'Diagram (AI): ![[CloudFront.drawio|640x360]]\n')).toBe('conflict')
  })
})

describe('the flow (2C → 2A)', () => {
  it('paste a board path → Embed → the window moves → the text has the view → a new editor gives the window the same view', async () => {
    const candidates = createWikilinkCandidateSource()
    candidates.update([{ name: 'CloudFront.drawio', insert: 'CloudFront.drawio', label: 'CloudFront', path: '/v/CloudFront.drawio' }])
    const { crepe, view } = await mount('Next:\n', { pathPaste: { root: '/v', notePath: '/v/a/today.md', candidates } })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.content.size - 1)))
    const event = { clipboardData: { getData: (type: string) => (type === 'text/plain' ? '/v/CloudFront.drawio' : '') }, preventDefault() {} } as unknown as ClipboardEvent
    view.pasteText('/v/CloudFront.drawio', event)
    expect(md(crepe)).toBe('Next:[[CloudFront.drawio]]\n')
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.path-paste-chip button'))
    expect(buttons.map((b) => b.textContent)).toEqual(['Keep as path', 'Embed'])
    buttons[1]!.click()
    expect(md(crepe)).toBe('Next:![[CloudFront.drawio]]\n')
    // One undo gives the pill back.
    undo(view.state, view.dispatch)
    expect(md(crepe)).toBe('Next:[[CloudFront.drawio]]\n')
    view.dispatch(view.state.tr.insertText('!', posOf(view, '[[')))
    await windows(1)
    fakes.list[0]!.host.onOptions!(OPTS)
    const written = md(crepe)
    expect(written).toBe('Next:![[CloudFront.drawio|640x360 view=120,-40,0.8]]\n')
    fakes.list.length = 0
    await mount(written)
    await windows(1)
    expect(fakes.list[0]!.host.options).toEqual(OPTS)
  })

  it('a pasted note path gets no Embed button', async () => {
    const candidates = createWikilinkCandidateSource()
    candidates.update([{ name: 'Plan', insert: 'Plan', label: 'Plan', path: '/v/Plan.md' }])
    const { view } = await mount('Next:\n', { pathPaste: { root: '/v', notePath: '/v/a/today.md', candidates } })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.content.size - 1)))
    view.pasteText('/v/Plan.md', { clipboardData: { getData: () => '/v/Plan.md' }, preventDefault() {} } as unknown as ClipboardEvent)
    expect(Array.from(document.querySelectorAll('.path-paste-chip button')).map((b) => b.textContent)).toEqual(['Keep as path'])
  })
})

describe('plain text of a board image node (2B, item 16)', () => {
  it('copies as its name, never the options', async () => {
    const { view } = await mount('![CloudFront|640x360 view=1,2,0.5](../w/CloudFront.drawio) and ![a|300](x.png)\n')
    const text = clipboardPlainText(new Slice(view.state.doc.content, 0, 0))
    expect(text).toBe('CloudFront and a')
  })
})
