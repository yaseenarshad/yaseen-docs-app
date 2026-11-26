import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { undoDepth } from '@milkdown/kit/prose/history'
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { EmbedOptions } from '@shared/embedOptions'
import { EMPTY_INLINE_SCENE_JSON } from '@shared/inlineDrawing'
import type { BoardWindowHandle, BoardWindowHost, WindowMenuRow } from '../embed/types'
import { createCrepe, getMarkdownForSave, type CreateCrepeOptions } from '../createCrepe'
import { INLINE_DRAWING_CLASS, INLINE_MOVE_META } from './inlineDrawingView'
import * as inlineDrawingLand from './inlineDrawingLand'
import { inlineDrawingPathAtLine } from './useInlineDrawing'
import { READ_ONLY_EDIT, type ReadOnlyEditEvent } from '../readOnlyEdit'
import { drawingMenu } from '../drawingMenu'
import { applyMenuIcons, resetMenuIconsForTest } from '../../views/view/menuIconsStore'

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
        const fake: Fake = { host: { ...host }, dom, calls: [], destroyed: false }
        fakes.list.push(fake)
        return {
          dom,
          update: (next) => {
            fake.calls.push(['update', next])
            Object.assign(fake.host, next)
          },
          setSelected: (on) => fake.calls.push(['setSelected', on]),
          handleKey: (e) => (e.key === '!' && e.shiftKey ? (fake.calls.push(['fit', null]), true) : false),
          setFolded: (on) => fake.calls.push(['setFolded', on]),
          setFoldable: (on) => fake.calls.push(['setFoldable', on]),
          menuRows: () => fakes.rows,
          flush: () => fake.calls.push(['flush', null]),
          fit: () => fake.calls.push(['fit', null]),
          showPage: () => undefined,
          destroy: () => {
            fake.destroyed = true
          },
        }
      },
    }),
}))

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string, extra: Partial<CreateCrepeOptions> = {}) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, ...extra })
  await crepe.create()
  await Promise.resolve()
  await Promise.resolve()
  mounted.push({ crepe, root })
  const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  return { crepe, view, root }
}

const flushMicrotasks = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

const SAMPLE_MD = `Before\n\n\`\`\`excalidraw\n${EMPTY_INLINE_SCENE_JSON}\n\`\`\`\n<!-- drawing: 640x360 locked -->\n\nAfter\n`

beforeEach(() => {
  fakes.list.length = 0
  fakes.rows = [{ label: 'Fit whole drawing', run: vi.fn() }]
})

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
  document.body.innerHTML = ''
})

describe('InlineDrawingView + inlineDrawingPlugins', () => {
  it('mounts a lazy BoardWindow for ```excalidraw and chains other code blocks', async () => {
    const md = `${SAMPLE_MD}\n\`\`\`js\nconst x = 1\n\`\`\`\n`
    const { root } = await mount(md, { inlineDrawing: { root: '/vault' } })
    await flushMicrotasks()

    expect(fakes.list).toHaveLength(1)
    const fake = fakes.list[0]!
    expect(fake.host.menuButton).toBe(false)
    expect(fake.host.ref).toEqual({
      root: '/vault',
      path: null,
      kind: 'drawing',
      name: 'Untitled drawing',
      vault: null,
      inlineJson: EMPTY_INLINE_SCENE_JSON,
    })
    expect(fake.host.options).toEqual({
      width: 640,
      height: 360,
      view: null,
      locked: true,
      page: null,
      align: null,
      rest: [],
    })
    expect(root.querySelector(`.${INLINE_DRAWING_CLASS}`)).not.toBeNull()
    expect(root.querySelector('.inline-drawing__head')).not.toBeNull()
    expect(root.querySelector('.inline-drawing__kind')?.textContent).toBe('In page')
    expect(root.querySelector('.inline-drawing__more')?.textContent).toBe('⋯')
    // The JS code block still renders via CodeMirror, not as an inline drawing.
    expect(root.querySelectorAll(`.${INLINE_DRAWING_CLASS}`)).toHaveLength(1)
    expect(root.querySelector('.milkdown-code-block')).not.toBeNull()
  })

  it('edits inline drawing title via header input and preserves it across onOptions writes', async () => {
    const { crepe, root } = await mount(SAMPLE_MD, { inlineDrawing: { root: '/vault' } })
    await flushMicrotasks()
    const input = root.querySelector<HTMLInputElement>('.inline-drawing__title')!
    expect(input).not.toBeNull()
    expect(input.value).toBe('')

    input.value = 'Auth Flow'
    input.dispatchEvent(new Event('blur'))
    expect(getMarkdownForSave(crepe)).toContain('<!-- drawing: title "Auth Flow", 640x360 locked -->')

    // Subsequent onOptions write keeps the title!
    const fake = fakes.list[0]!
    expect(fake.host.ref.name).toBe('Auth Flow')
    fake.host.onOptions?.({ width: 500, height: 300, view: null, locked: false, page: null, rest: [] })
    expect(getMarkdownForSave(crepe)).toContain('<!-- drawing: title "Auth Flow", 500x300 -->')
  })

  it('writes drawingLine outside undo on onOptions and round-trips markdown', async () => {
    const { crepe, view } = await mount(SAMPLE_MD, { inlineDrawing: { root: '/vault' } })
    await flushMicrotasks()
    const fake = fakes.list[0]!
    const depthBefore = undoDepth(view.state)

    const nextOpts: EmbedOptions = { width: 500, height: 300, view: { x: 10, y: 20, zoom: 1.5 }, locked: false, page: null, rest: [] }
    fake.host.onOptions?.(nextOpts)

    expect(undoDepth(view.state)).toBe(depthBefore)
    const saved = getMarkdownForSave(crepe)
    expect(saved).toContain('<!-- drawing: 500x300 view=10,20,1.5 -->')
    expect(saved).toContain(EMPTY_INLINE_SCENE_JSON)
  })

  it('calls onEdit on onOpen / Enter and onOpenInTab on Cmd+Enter when selected', async () => {
    const onEdit = vi.fn()
    const onOpenInTab = vi.fn()
    const { view } = await mount(SAMPLE_MD, { inlineDrawing: { root: '/vault', onEdit, onOpenInTab } })
    await flushMicrotasks()
    const fake = fakes.list[0]!

    fake.host.onOpen?.('thisTab')
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit).toHaveBeenLastCalledWith(expect.any(Number), EMPTY_INLINE_SCENE_JSON)

    // Select via onSelect and press Enter -> popup; Cmd+Enter -> tab.
    fake.host.onSelect?.()
    expect(view.state.selection).toBeInstanceOf(NodeSelection)
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(onEdit).toHaveBeenCalledTimes(2)
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }))
    expect(onOpenInTab).toHaveBeenCalledWith(0, false)
  })

  it('promotes TextSelection inside an inline drawing to NodeSelection and forwards BoardWindow keys + Escape', async () => {
    const { view } = await mount(SAMPLE_MD, { inlineDrawing: { root: '/vault' } })
    await flushMicrotasks()
    const fake = fakes.list[0]!

    // Find the inline drawing code_block position.
    let blockPos = -1
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'code_block' && node.attrs.language === 'excalidraw') blockPos = pos
    })
    expect(blockPos).toBeGreaterThanOrEqual(0)

    // Attempt to place a TextSelection inside the code_block -> caret guard converts to NodeSelection.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, blockPos + 1)))
    expect(view.state.selection).toBeInstanceOf(NodeSelection)
    expect(view.state.selection.from).toBe(blockPos)

    // Shift+1 forwards to BoardWindow.handleKey.
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: '!', shiftKey: true, bubbles: true, cancelable: true }))
    expect(fake.calls.some(([name]) => name === 'fit')).toBe(true)

    // Escape deselects the inline drawing.
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(view.state.selection).not.toBeInstanceOf(NodeSelection)
  })

  it('opens context menu with Edit, Rename, Open in new tab, Open in Explore, Move (with ask), Copy path, window rows, and Delete (via onDelete)', async () => {
    const onEdit = vi.fn()
    const onMoveToFile = vi.fn()
    const onDelete = vi.fn()
    const onOpenInTab = vi.fn()
    const onOpenExplore = vi.fn()
    const onCopyPath = vi.fn()
    const { view, root } = await mount(SAMPLE_MD, { inlineDrawing: { root: '/vault', onEdit, onMoveToFile, onDelete, onOpenInTab, onOpenExplore, onCopyPath } })
    await flushMicrotasks()
    const fake = fakes.list[0]!

    // Header "Edit drawing" button: plain click opens popup; Cmd+click opens background tab; Cmd+Shift+click opens foreground tab.
    const editBtn = root.querySelector<HTMLButtonElement>('.inline-drawing__edit')!
    expect(editBtn.title).toBe('Edit drawing (⌘-click: new tab)')
    editBtn.click()
    expect(onEdit).toHaveBeenCalledTimes(1)
    editBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }))
    expect(onOpenInTab).toHaveBeenLastCalledWith(0, true)
    editBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true, shiftKey: true }))
    expect(onOpenInTab).toHaveBeenLastCalledWith(0, false)
    expect(onEdit).toHaveBeenCalledTimes(1)

    // Header "⋯" button opens the menu.
    root.querySelector<HTMLButtonElement>('.inline-drawing__more')?.click()
    const labels = [...document.querySelectorAll('.ctx-menu__item')].map((el) => el.textContent?.trim())
    expect(labels).toEqual(['Edit drawing', 'Rename', 'Open in new tab', 'Open in Explore', 'Move to its own file', 'Copy path', 'Fit whole drawing', 'Position', 'Delete drawing'])

    // Right-clicking the header bar opens the drawing menu (and does not bubble to PageMenu).
    const parentCtx = vi.fn()
    root.addEventListener('contextmenu', parentCtx)
    root.querySelector<HTMLElement>('.inline-drawing__head')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }))
    expect(parentCtx).not.toHaveBeenCalled()
    expect(document.querySelectorAll('.ctx-menu__item').length).toBe(9)
    root.removeEventListener('contextmenu', parentCtx)

    // Click "Open in Explore" -> calls onOpenExplore(0, undefined).
    const exploreBtn = [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')].find((el) => el.textContent?.includes('Open in Explore'))
    exploreBtn?.click()
    expect(onOpenExplore).toHaveBeenCalledExactlyOnceWith(0, undefined)

    // Reopen menu and click "Rename" -> focuses the title input.
    fake.host.onContextMenu?.(new MouseEvent('contextmenu', { clientX: 50, clientY: 50, cancelable: true }))
    const renameBtn = [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')].find((el) => el.textContent?.includes('Rename'))
    renameBtn?.click()
    expect(document.activeElement).toBe(root.querySelector('.inline-drawing__title'))

    // Reopen menu and click "Copy path" -> calls onCopyPath(0).
    fake.host.onContextMenu?.(new MouseEvent('contextmenu', { clientX: 50, clientY: 50, cancelable: true }))
    const copyBtn = [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')].find((el) => el.textContent?.includes('Copy path'))
    copyBtn?.click()
    expect(onCopyPath).toHaveBeenCalledWith(0)

    // Reopen menu and click "Move to its own file" -> asks in place instead of running immediately.
    fake.host.onContextMenu?.(new MouseEvent('contextmenu', { clientX: 50, clientY: 50, cancelable: true }))
    const moveBtn = [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')].find((el) => el.textContent?.includes('Move to its own file'))
    moveBtn?.click()
    await vi.waitFor(() => expect(moveBtn?.isConnected).toBe(false))
    expect(onMoveToFile).not.toHaveBeenCalled()

    // Reopen menu and click "Open in new tab" -> calls onOpenInTab(0, false).
    fake.host.onContextMenu?.(new MouseEvent('contextmenu', { clientX: 50, clientY: 50, cancelable: true }))
    const openTabBtn = [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')].find((el) => el.textContent?.includes('Open in new tab'))
    openTabBtn?.click()
    expect(onOpenInTab).toHaveBeenCalledWith(0, false)

    // Cmd+click (backgroundTab) on pill calls onOpenInTab(0, true).
    fake.host.onOpen?.('backgroundTab')
    expect(onOpenInTab).toHaveBeenCalledWith(0, true)

    // Click "Delete drawing" -> delegates to onDelete (ConfirmSheet) rather than deleting immediately.
    fake.host.onContextMenu?.(new MouseEvent('contextmenu', { clientX: 50, clientY: 50, cancelable: true }))
    const deleteBtn = [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')].find((el) => el.textContent?.includes('Delete drawing'))
    deleteBtn?.click()
    expect(onDelete).toHaveBeenCalledTimes(1)
    let hasDrawing = false
    view.state.doc.descendants((node) => {
      if (node.type.name === 'code_block' && node.attrs.language === 'excalidraw') hasDrawing = true
    })
    expect(hasDrawing).toBe(true)
  })

  it('guards a selected inline drawing against accidental type-over and paste while allowing INLINE_MOVE_META and pure delete', async () => {
    const { view } = await mount(SAMPLE_MD, { inlineDrawing: { root: '/vault' } })
    await flushMicrotasks()
    const fake = fakes.list[0]!
    fake.host.onSelect?.()
    expect(view.state.selection).toBeInstanceOf(NodeSelection)
    const { from, to } = view.state.selection

    // Typing text over the selected drawing is refused by filterTransaction.
    view.dispatch(view.state.tr.insertText('x', from, to))
    expect(view.state.doc.nodeAt(from)?.attrs.language).toBe('excalidraw')

    // Paste event on selected drawing is prevented.
    const pasteEv = new Event('paste', { bubbles: true, cancelable: true })
    view.dom.dispatchEvent(pasteEv)
    expect(pasteEv.defaultPrevented).toBe(true)

    // INLINE_MOVE_META is allowed to replace the selected drawing with a paragraph.
    const para = view.state.schema.nodes.paragraph!.create(null, view.state.schema.text('![[Sketch.excalidraw|locked]]'))
    view.dispatch(view.state.tr.replaceWith(from, to, para).setMeta(INLINE_MOVE_META, true))
    expect(view.state.doc.textContent).toContain('![[Sketch.excalidraw|locked]]')
  })

  it('dispatches tellReadOnlyEdit with unlock-and-resume when editing on a read-only page', async () => {
    const onEdit = vi.fn()
    const { crepe, root } = await mount(SAMPLE_MD, { inlineDrawing: { root: '/vault', onEdit } })
    await flushMicrotasks()
    crepe.setReadonly(true)
    const fake = fakes.list[0]!

    let captured: ReadOnlyEditEvent | null = null
    root.addEventListener(READ_ONLY_EDIT, (e) => {
      captured = e as ReadOnlyEditEvent
    })

    // Header "Edit drawing" button stays unhidden on read-only page so clicking it triggers unlock-and-resume.
    const editBtn = root.querySelector<HTMLButtonElement>('.inline-drawing__edit')!
    expect(editBtn.hidden).toBe(false)
    editBtn.click()
    expect(onEdit).not.toHaveBeenCalled()
    expect(captured).not.toBeNull()
    expect(captured!.detail).toBe('drawing')

    // Unlock and invoke resume -> opens edit!
    crepe.setReadonly(false)
    captured!.resume?.()
    expect(onEdit).toHaveBeenCalledTimes(1)

    // Clicking title input when read-only also triggers tellReadOnlyEdit.
    crepe.setReadonly(true)
    captured = null
    root.querySelector<HTMLInputElement>('.inline-drawing__title')!.click()
    expect(captured).not.toBeNull()
    expect(captured!.detail).toBe('drawing')

    // YAZ-6548: Right-click menu on a read-only page keeps Edit drawing and routes it through tellReadOnlyEdit.
    captured = null
    onEdit.mockClear()
    fake.host.onContextMenu?.(new MouseEvent('contextmenu', { clientX: 50, clientY: 50, cancelable: true }))
    const roLabels = [...document.querySelectorAll('.ctx-menu__item')].map((el) => el.textContent?.trim())
    expect(roLabels).toContain('Edit drawing')
    expect(roLabels).not.toContain('Rename')
    expect(roLabels).not.toContain('Delete drawing')
    const menuEditBtn = [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')].find((el) => el.textContent?.trim() === 'Edit drawing')!
    menuEditBtn.click()
    expect(onEdit).not.toHaveBeenCalled()
    expect(captured).not.toBeNull()
    expect(captured!.detail).toBe('drawing')
    crepe.setReadonly(false)
    captured!.resume?.()
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('updates BoardWindow when inline JSON changes and destroys on unmount', async () => {
    const { crepe, view } = await mount(SAMPLE_MD, { inlineDrawing: { root: '/vault' } })
    await flushMicrotasks()
    const fake = fakes.list[0]!

    let blockPos = -1
    let blockSize = 0
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'code_block' && node.attrs.language === 'excalidraw') {
        blockPos = pos
        blockSize = node.nodeSize
      }
    })
    const updatedJson = '{"type":"excalidraw","version":2,"elements":[{"id":"1"}],"appState":{},"files":{}}'
    view.dispatch(view.state.tr.replaceWith(blockPos + 1, blockPos + blockSize - 1, view.state.schema.text(updatedJson)))

    const updateCalls = fake.calls.filter(([name]) => name === 'update')
    expect(updateCalls.length).toBeGreaterThan(0)
    expect(fake.host.ref.inlineJson).toBe(updatedJson)

    await crepe.destroy()
    expect(fake.destroyed).toBe(true)
  })
})

describe('drawingMenu createInline', () => {
  it('calls createInline instead of create("drawing") when provided', () => {
    const create = vi.fn(() => Promise.resolve('Board.excalidraw'))
    const createInline = vi.fn()
    const items = new Map<string, { onRun?: (ctx: unknown) => void }>()
    const builder = {
      getGroup: () => ({
        addItem: (key: string, item: { label: string; icon: string; onRun?: (ctx: unknown) => void }) => {
          items.set(key, item)
        },
      }),
    }
    drawingMenu({ create, createInline })(builder as never)

    const fakeView = {} as EditorView
    const fakeCtx = {
      get: (key: unknown) => (key === editorViewCtx ? fakeView : { call: vi.fn() }),
    }
    items.get('drawing')?.onRun?.(fakeCtx)
    expect(createInline).toHaveBeenCalledWith(fakeView)
    expect(create).not.toHaveBeenCalled()

    items.get('diagram')?.onRun?.(fakeCtx)
    expect(create).toHaveBeenCalledWith('diagram')
  })
})

describe('inlineDrawingPathAtLine', () => {
  it('computes 1-based line number of the opening fence with and without frontmatter', () => {
    const noFm = `Before\n\n\`\`\`excalidraw\n${EMPTY_INLINE_SCENE_JSON}\n\`\`\`\n`
    expect(inlineDrawingPathAtLine('/vault/Note.md', noFm, 0)).toBe('/vault/Note.md:3')

    const withFm = `---\ntitle: Demo\ntags: [a]\n---\n\nIntro\n\n\`\`\`excalidraw\n${EMPTY_INLINE_SCENE_JSON}\n\`\`\`\n\nMiddle\n\`\`\`excalidraw\n${EMPTY_INLINE_SCENE_JSON}\n\`\`\`\n`
    expect(inlineDrawingPathAtLine('/vault/Note.md', withFm, 0)).toBe('/vault/Note.md:8')
    expect(inlineDrawingPathAtLine('/vault/Note.md', withFm, 1)).toBe('/vault/Note.md:13')
    // Fallback when unsaved / index out of range:
    expect(inlineDrawingPathAtLine('/vault/Note.md', withFm, 2)).toBe('/vault/Note.md')
  })
})

describe('landOnInlineDrawing (Show in page)', () => {
  it('triggers landWhenShown for both newly-mounted and already-mounted inline drawings and cleans up on destroy', async () => {
    const landSpy = vi.spyOn(inlineDrawingLand, 'landWhenShown').mockImplementation(() => () => {})
    try {
      // Case 1: scheduled before the page mounts (newly-mounted view consumes via takeInlineDrawingLanding).
      inlineDrawingLand.landOnInlineDrawing('/vault/Note.md', 0)
      const { crepe, root } = await mount(SAMPLE_MD, { inlineDrawing: { root: '/vault', pagePath: '/vault/Note.md' } })
      await flushMicrotasks()
      const dom = root.querySelector(`.${INLINE_DRAWING_CLASS}`)
      expect(landSpy).toHaveBeenCalledTimes(1)
      expect(landSpy.mock.calls[0]?.[0]).toBe(dom)

      // Case 2: scheduled while the page is already open (watchInlineDrawingLanding takes it immediately).
      inlineDrawingLand.landOnInlineDrawing('/vault/Note.md', 0)
      expect(landSpy).toHaveBeenCalledTimes(2)
      expect(landSpy.mock.calls[1]?.[0]).toBe(dom)

      // Different index or different path does not trigger landing.
      inlineDrawingLand.landOnInlineDrawing('/vault/Note.md', 1)
      inlineDrawingLand.landOnInlineDrawing('/vault/Other.md', 0)
      expect(landSpy).toHaveBeenCalledTimes(2)

      // After destroy, watcher is cleaned up.
      await crepe.destroy()
      inlineDrawingLand.landOnInlineDrawing('/vault/Note.md', 0)
      expect(landSpy).toHaveBeenCalledTimes(2)
      // Consume queued pending landing from the post-destroy call so state stays clean.
      expect(inlineDrawingLand.takeInlineDrawingLanding('/vault/Note.md', 0)).toBe(true)
    } finally {
      landSpy.mockRestore()
    }
  })

  it('survives StrictMode double-mount / destroy-before-landing when a closed page opens fresh', async () => {
    // Pass 1: detached root (simulates StrictMode cleanup removing Mount #1 wrapper before crepe.create finishes).
    inlineDrawingLand.landOnInlineDrawing('/vault/Fresh.md', 0)
    const detachedRoot = document.createElement('div')
    const detachedCrepe = createCrepe({ root: detachedRoot, defaultValue: SAMPLE_MD, inlineDrawing: { root: '/vault', pagePath: '/vault/Fresh.md' } })
    await detachedCrepe.create()
    await detachedCrepe.destroy()
    // Detached mount must NOT have stolen the pending landing.
    expect(inlineDrawingLand.takeInlineDrawingLanding('/vault/Fresh.md', 0)).toBe(true)

    // Pass 2: connected mount destroyed before ResizeObserver/rAF lands re-queues for the surviving mount.
    inlineDrawingLand.landOnInlineDrawing('/vault/Fresh.md', 0)
    const first = await mount(SAMPLE_MD, { inlineDrawing: { root: '/vault', pagePath: '/vault/Fresh.md' } })
    await first.crepe.destroy()
    const landSpy = vi.spyOn(inlineDrawingLand, 'landWhenShown').mockImplementation(() => () => {})
    try {
      const second = await mount(SAMPLE_MD, { inlineDrawing: { root: '/vault', pagePath: '/vault/Fresh.md' } })
      await flushMicrotasks()
      expect(landSpy).toHaveBeenCalledTimes(1)
      expect(landSpy.mock.calls[0]?.[0]).toBe(second.root.querySelector(`.${INLINE_DRAWING_CLASS}`))
    } finally {
      landSpy.mockRestore()
    }
  })

  it('YAZ-6354: syncs data-align and updates alignment via the Position flyout menu', async () => {
    const md = `\`\`\`excalidraw\n${EMPTY_INLINE_SCENE_JSON}\n\`\`\`\n<!-- drawing: 640x360 locked align=center -->\n`
    const { crepe, root } = await mount(md, { inlineDrawing: { root: '/vault' } })
    await flushMicrotasks()

    const dom = root.querySelector<HTMLElement>(`.${INLINE_DRAWING_CLASS}`)!
    expect(dom.dataset.align).toBe('center')

    // Open menu -> open Position flyout -> verify active checkmark on Center.
    root.querySelector<HTMLButtonElement>('.inline-drawing__more')!.click()
    const posBtn = [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu__item--parent')].find((b) => b.textContent === 'Position')!
    expect(posBtn).toBeDefined()
    posBtn.click()
    const subItems = [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu__sub .ctx-menu__item')]
    expect(subItems.map((b) => [b.textContent, b.dataset.hint])).toEqual([
      ['App default', undefined],
      ['Left', undefined],
      ['Center', '✓'],
      ['Right', undefined],
    ])

    // Pick Right -> updates data-align and drawingLine.
    subItems.find((b) => b.textContent === 'Right')!.click()
    expect(dom.dataset.align).toBe('right')
    expect(getMarkdownForSave(crepe)).toContain('<!-- drawing: 640x360 locked align=right -->')

    // Pick App default -> removes data-align and omits align from drawingLine.
    root.querySelector<HTMLButtonElement>('.inline-drawing__more')!.click()
    ;[...document.querySelectorAll<HTMLButtonElement>('.ctx-menu__item--parent')].find((b) => b.textContent === 'Position')!.click()
    ;[...document.querySelectorAll<HTMLButtonElement>('.ctx-menu__sub .ctx-menu__item')].find((b) => b.textContent === 'App default')!.click()
    expect(dom.dataset.align).toBeUndefined()
    expect(getMarkdownForSave(crepe)).toContain('<!-- drawing: 640x360 locked -->')
  })

  it('YAZ-6567: Open in new tab glyph follows menuIconsStore variants, none, and off', async () => {
    const { root } = await mount(SAMPLE_MD, { inlineDrawing: { root: '/vault', onOpenInTab: vi.fn() } })
    await flushMicrotasks()
    const openMenu = () => {
      root.querySelector<HTMLButtonElement>('.inline-drawing__more')!.click()
      return [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')].find((b) => b.textContent === 'Open in new tab')!
    }

    try {
      const defaultRow = openMenu()
      const defaultSvg = defaultRow.querySelector('svg')
      expect(defaultSvg?.getAttribute('viewBox')).toBe('0 0 16 16')
      const defaultHtml = defaultSvg?.innerHTML
      expect(defaultHtml).toBeTruthy()

      applyMenuIcons({ openNewTab: 'raised-tab' })
      expect(openMenu().querySelector('svg')?.innerHTML).not.toBe(defaultHtml)

      applyMenuIcons({ openNewTab: 'none' })
      const noneRow = openMenu()
      expect(noneRow.querySelector('svg')).toBeNull()
      expect(noneRow.querySelector('.ctx-menu__label')).toBeNull()

      applyMenuIcons('off')
      expect(openMenu().querySelector('svg')).toBeNull()
    } finally {
      resetMenuIconsForTest()
    }
  })
})
