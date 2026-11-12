/**
 * A board in another vault, as the stock image node (YAZ-4828 2B): `![CloudFront|640x360 …](../w/CloudFront.drawio)`
 * mounts the board window instead of an `<img>`. A FAKE window (`loadBoardWindow` mocked) records its host and calls.
 * Pinned: the ref (the other vault's root, path and name), the options from the alt, writes into the alt only and
 * outside undo, none in a read-only note, selection, fold, the gallery skipping boards, the menu, destroy, and a plain
 * image rendering as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { undoDepth } from '@milkdown/kit/prose/history'
import { NodeSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { EmbedOptions } from '@shared/embedOptions'
import type { BoardWindowHandle, BoardWindowHost } from '../embed/types'
import { createCrepe, getMarkdownForSave, type CreateCrepeOptions } from '../createCrepe'
import type { ImageOptions } from './imageOptions'

interface Fake {
  host: BoardWindowHost
  calls: Array<[string, unknown]>
  destroyed: boolean
}
const fakes = vi.hoisted(() => ({ list: [] as Fake[] }))

vi.mock('../embed/types', async (original) => ({
  ...(await original<typeof import('../embed/types')>()),
  loadBoardWindow: () =>
    Promise.resolve({
      mountBoardWindow: (host: BoardWindowHost): BoardWindowHandle => {
        const fake: Fake = { host: { ...host }, calls: [], destroyed: false }
        fakes.list.push(fake)
        return {
          dom: Object.assign(document.createElement('div'), { className: 'fake-window' }),
          update: (next) => {
            fake.calls.push(['update', next])
            Object.assign(fake.host, next)
          },
          setSelected: (on) => fake.calls.push(['setSelected', on]),
          // The real window's ⌘+ zooms (D10); the fake records it as one.
          handleKey: (e) => (e.key === '=' && e.metaKey ? (fake.calls.push(['zoomIn', null]), true) : false),
          setFolded: (on) => fake.calls.push(['setFolded', on]),
          setFoldable: (on) => fake.calls.push(['setFoldable', on]),
          menuRows: () => [{ label: 'Lock view', run: () => {} }],
          flush: () => fake.calls.push(['flush', null]),
          fit: () => {},
          showPage: () => {},
          destroy: () => {
            fake.destroyed = true
          },
        }
      },
    }),
}))

const OPTS: EmbedOptions = { width: 640, height: 360, view: { x: 1, y: 2, zoom: 0.5 }, locked: false, page: null, rest: [] }
const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

function imageOptions(extra: Partial<ImageOptions> = {}): ImageOptions {
  return {
    root: '/v',
    notePath: '/v/n.md',
    boards: {
      place: (src) => (src.startsWith('../w/') ? { root: '/w', path: `/w/${decodeURIComponent(src.slice(5))}`, vault: 'Work' } : null),
      open: vi.fn(),
      linkMenu: (path) => ({ labels: [], open: () => void path }),
    },
    ...extra,
  }
}

async function mount(markdown: string, image = imageOptions(), extra: Partial<CreateCrepeOptions> = {}) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, image, ...extra })
  await crepe.create()
  mounted.push({ crepe, root })
  const view: EditorView = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  return { crepe, root, view }
}

function key(view: EditorView, init: KeyboardEventInit): boolean {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  return view.someProp('handleKeyDown', (f) => f(view, event)) ?? false
}

const windows = (n: number) => vi.waitFor(() => expect(fakes.list.filter((f) => !f.destroyed)).toHaveLength(n))

beforeEach(() => {
  fakes.list.length = 0
})
afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
  document.querySelectorAll('.ctx-menu').forEach((el) => el.remove())
})

describe('a board src (2B)', () => {
  it('mounts the window with the other vault`s ref and the alt`s options; a plain image still renders an <img>', async () => {
    const { root } = await mount('![CloudFront|640x360 view=1,2,0.5](../w/CloudFront.drawio) ![a|300](images/a.png)\n')
    await windows(1)
    expect(fakes.list[0]!.host.ref).toMatchObject({ root: '/w', path: '/w/CloudFront.drawio', kind: 'diagram', name: 'CloudFront', vault: 'Work' })
    expect(fakes.list[0]!.host.options).toEqual(OPTS)
    expect(root.querySelectorAll('.board-embed .fake-window')).toHaveLength(1)
    expect(root.querySelectorAll('.image-view img')).toHaveLength(1)
  })

  it('a view write changes only the alt, outside undo; never in a read-only note', async () => {
    const { crepe, view } = await mount('![CloudFront](../w/CloudFront.drawio)\n')
    await windows(1)
    const depth = undoDepth(view.state)
    fakes.list[0]!.host.onOptions!(OPTS)
    expect(getMarkdownForSave(crepe)).toBe('![CloudFront|640x360 view=1,2,0.5](../w/CloudFront.drawio)\n')
    expect(undoDepth(view.state)).toBe(depth)
    // The text changed: the same window hears it.
    expect(fakes.list).toHaveLength(1)
    expect(fakes.list[0]!.calls).toContainEqual(['update', expect.objectContaining({ options: OPTS })])
    view.setProps({ editable: () => false })
    fakes.list[0]!.host.onOptions!({ ...OPTS, width: 900 })
    expect(getMarkdownForSave(crepe)).toBe('![CloudFront|640x360 view=1,2,0.5](../w/CloudFront.drawio)\n')
  })

  it('a click selects the node and the window; open goes to the host with the board`s path', async () => {
    const image = imageOptions()
    const { view } = await mount('![CloudFront](../w/CloudFront.drawio)\n', image)
    await windows(1)
    fakes.list[0]!.host.onSelect!()
    expect(view.state.selection).toBeInstanceOf(NodeSelection)
    expect(fakes.list[0]!.calls).toContainEqual(['setSelected', true])
    fakes.list[0]!.host.onOpen!('backgroundTab')
    expect(image.boards!.open).toHaveBeenCalledWith('/w/CloudFront.drawio', 'backgroundTab')
  })

  it('on a bullet the window is foldable, and its arrow folds the bullet (2D)', async () => {
    await mount('* ![CloudFront](../w/CloudFront.drawio)\n')
    await windows(1)
    const fake = fakes.list[0]!
    await vi.waitFor(() => expect(fake.calls).toContainEqual(['setFoldable', true]))
    fake.host.onFold!()
    await vi.waitFor(() => expect(fake.calls).toContainEqual(['setFolded', true]))
  })

  it('the gallery skips boards', async () => {
    const onOpenImage = vi.fn()
    const { root } = await mount('![CloudFront](../w/CloudFront.drawio) ![a](images/a.png)\n', imageOptions({ onOpenImage }))
    await windows(1)
    root.querySelector('.image-view img')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(onOpenImage).toHaveBeenCalledWith({ images: [expect.objectContaining({ alt: 'a' })], index: 0 })
  })

  it('the menu: the link`s rows, the window`s, Show as link and Remove embed; deleting destroys the window', async () => {
    const { crepe } = await mount('A ![CloudFront|640x360](../w/CloudFront.drawio) B\n')
    await windows(1)
    fakes.list[0]!.host.onContextMenu!(new MouseEvent('contextmenu'))
    const items = Array.from(document.querySelectorAll<HTMLButtonElement>('.ctx-menu__item'))
    expect(items.map((b) => b.textContent)).toEqual(['Open', 'Lock view', 'Show as link', 'Remove embed'])
    items.find((b) => b.textContent === 'Show as link')!.click()
    expect(getMarkdownForSave(crepe)).toBe('A [CloudFront](../w/CloudFront.drawio) B\n')
    expect(fakes.list[0]!.destroyed).toBe(true)
  })

  it('A1: a view write reaches the SAVE callback, though it is no undo step', async () => {
    const saved = vi.fn()
    await mount('![CloudFront](../w/CloudFront.drawio)\n', imageOptions(), { onMarkdownUpdated: saved })
    await windows(1)
    fakes.list[0]!.host.onOptions!(OPTS)
    await vi.waitFor(() => expect(saved).toHaveBeenCalledTimes(1), { timeout: 2000 })
    expect(saved).toHaveBeenLastCalledWith('![CloudFront|640x360 view=1,2,0.5](../w/CloudFront.drawio)\n')
  })

  it('A2: on a selected board image ⌘+ reaches the window; Escape deselects it, the caret after the node', async () => {
    const { view } = await mount('A ![CloudFront](../w/CloudFront.drawio) B\n')
    await windows(1)
    fakes.list[0]!.host.onSelect!()
    const sel = view.state.selection as NodeSelection
    expect(key(view, { key: '=', metaKey: true })).toBe(true)
    expect(fakes.list[0]!.calls).toContainEqual(['zoomIn', null])
    expect(key(view, { key: 'Escape' })).toBe(true)
    expect(view.state.selection).not.toBeInstanceOf(NodeSelection)
    expect(view.state.selection.empty).toBe(true)
    expect(view.state.selection.from).toBe(sel.to)
  })

  it('A2: Escape on a selected PLAIN image is not the board`s', async () => {
    const { view } = await mount('![a](images/a.png)\n')
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 1)))
    key(view, { key: 'Escape' })
    expect(view.state.selection).toBeInstanceOf(NodeSelection)
  })

  it('A11: a drawing in another vault has Edit in a popup, at its own root and path; a diagram has none', async () => {
    const onEditInPopup = vi.fn()
    const image = imageOptions()
    image.boards!.onEditInPopup = onEditInPopup
    await mount('![Sketch](../w/Sketch.excalidraw) ![Cloud](../w/Cloud.drawio)\n', image)
    await windows(2)
    const labels = (i: number) => {
      document.querySelectorAll('.ctx-menu').forEach((el) => el.remove())
      fakes.list[i]!.host.onContextMenu!(new MouseEvent('contextmenu'))
      return Array.from(document.querySelectorAll<HTMLButtonElement>('.ctx-menu__item'))
    }
    const drawing = labels(0)
    expect(drawing.map((b) => b.textContent)).toEqual(['Open', 'Lock view', 'Edit in a popup', 'Show as link', 'Remove embed'])
    drawing.find((b) => b.textContent === 'Edit in a popup')!.click()
    expect(onEditInPopup).toHaveBeenCalledWith('/w', '/w/Sketch.excalidraw')
    expect(labels(1).map((b) => b.textContent)).not.toContain('Edit in a popup')
  })

  it('an alias in the alt stays: `![CloudFront|My name](…)` writes `|My name|640x360 …`', async () => {
    const { crepe } = await mount('![CloudFront|My name](../w/CloudFront.drawio)\n')
    await windows(1)
    expect(fakes.list[0]!.host.options).toBeNull()
    fakes.list[0]!.host.onOptions!(OPTS)
    expect(getMarkdownForSave(crepe)).toBe('![CloudFront|My name|640x360 view=1,2,0.5](../w/CloudFront.drawio)\n')
    fakes.list[0]!.host.onOptions!({ ...OPTS, locked: true })
    expect(getMarkdownForSave(crepe)).toBe('![CloudFront|My name|640x360 view=1,2,0.5 locked](../w/CloudFront.drawio)\n')
  })

  it('a read-only note tells the window (item 24), and editable again', async () => {
    const { view } = await mount('![CloudFront](../w/CloudFront.drawio)\n')
    await windows(1)
    view.setProps({ editable: () => false })
    expect(fakes.list[0]!.calls).toContainEqual(['update', { editable: false }])
    view.setProps({ editable: () => true })
    expect(fakes.list[0]!.calls).toContainEqual(['update', { editable: true }])
  })

  it('a table cell: the board is its pill line (folded), never a live window', async () => {
    await mount('| a |\n| --- |\n| ![CloudFront](../w/CloudFront.drawio) |\n')
    await windows(1)
    expect(fakes.list[0]!.calls).toContainEqual(['setFolded', true])
    expect(fakes.list[0]!.calls).not.toContainEqual(['setFoldable', true])
  })
})
