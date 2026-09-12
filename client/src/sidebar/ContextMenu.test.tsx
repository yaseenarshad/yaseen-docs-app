/**
 * Context-menu viewport clamping (GRO-2204): the menu renders at the cursor but never spills
 * off screen — right/bottom overflow clamps the position. Sizes come from mocked
 * `getBoundingClientRect` (jsdom has no layout); the jsdom viewport is 1024×768.
 * (The "New ▸" submenu that used to clamp alongside it died with the type system, YAZ-836.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ContextMenu } from './ContextMenu'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

type Box = { width?: number; height?: number; left?: number; top?: number }

/** Per-class mocked boxes; anything unlisted measures 0×0 (the jsdom default). */
let boxes: Record<string, Box> = {}

const asRect = ({ width = 0, height = 0, left = 0, top = 0 }: Box): DOMRect =>
  ({ width, height, left, top, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect

let root: Root | null = null
let container: HTMLElement | null = null

beforeEach(() => {
  boxes = {}
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    for (const [cls, box] of Object.entries(boxes)) if (this.classList.contains(cls)) return asRect(box)
    return asRect({})
  })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  vi.restoreAllMocks()
})

type MenuProps = Parameters<typeof ContextMenu>[0]

function mount(x: number, y: number, over: Partial<MenuProps> = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const props: MenuProps = {
    x,
    y,
    copyPath: null,
    // The multi-select pair (🔒 D5, YAZ-1337): null is the ordinary menu — no selection to act
    // on — which is what every clamping case below is about.
    copyPaths: null,
    openTabPaths: null,
    onOpenInNewTabs: vi.fn(),
    newWindowPath: null,
    onOpenNewWindow: vi.fn(),
    renamePath: null,
    onRename: vi.fn(),
    deletePath: null,
    onDelete: vi.fn(),
    revealPath: null,
    onReveal: vi.fn(),
    folderPagePath: null,
    folderPageIsOn: false,
    onToggleFolderPage: vi.fn(),
    onNewNote: vi.fn(),
    onNewFolderPage: vi.fn(),
    onNewFolder: vi.fn(),
    onClose: vi.fn(),
    ...over,
  }
  act(() => root?.render(<ContextMenu {...props} />))
  return container
}

const menu = (el: HTMLElement): HTMLElement => {
  const m = el.querySelector<HTMLElement>('.ctx-menu')
  if (m === null) throw new Error('missing menu')
  return m
}

describe('menu clamping', () => {
  it('renders at the requested position when it fits', () => {
    boxes = { 'ctx-menu': { width: 160, height: 180 } }
    const el = mount(100, 120)
    expect(menu(el).style.left).toBe('100px')
    expect(menu(el).style.top).toBe('120px')
  })

  it('clamps at the right and bottom viewport edges instead of spilling off screen', () => {
    boxes = { 'ctx-menu': { width: 160, height: 180 } }
    const el = mount(1000, 700)
    expect(menu(el).style.left).toBe('864px') // 1024 - 160
    expect(menu(el).style.top).toBe('588px') // 768 - 180
  })

  it('offers no submenu at all — the menu is one flat list of items (YAZ-836)', () => {
    const el = mount(100, 120)
    expect(el.querySelector('.ctx-submenu')).toBeNull()
    expect(el.querySelector('.ctx-menu__item--sub')).toBeNull()
  })
})

const labelsOf = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')].map((b) => b.textContent)
const itemOf = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')].find((b) => b.textContent === label)

/**
 * The create group (🔒 D4, YAZ-817): "New folder page" is the SECOND item, directly after
 * "New note" — a folder page is a note born with one flag (🔒 D1), so it belongs beside the
 * note it is a kind of, not beside the act-on-this-row toggle further down. Pinned here
 * because the position IS the ruling, not an accident of JSX.
 */
describe('create group (🔒 D4)', () => {
  it('offers New folder page directly after New note, ahead of New folder', () => {
    const el = mount(0, 0)
    expect(labelsOf(el)).toEqual(['New note', 'New folder page', 'New folder'])
  })

  it('is offered on every row type — the group targets a DIRECTORY, never the clicked row', () => {
    const el = mount(0, 0, { copyPath: '/v', revealPath: '/v', renamePath: '/v/a.md', deletePath: '/v/a.md', folderPagePath: '/v/a.md' })
    expect(labelsOf(el)).toContain('New folder page')
  })

  it('hands the click to the caller and leaves the menu alone — the inline input closes it (the New note idiom)', () => {
    const onNewFolderPage = vi.fn()
    const onClose = vi.fn()
    const el = mount(0, 0, { onNewFolderPage, onClose })
    act(() => itemOf(el, 'New folder page')?.click())
    expect(onNewFolderPage).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })
})

/**
 * ONE state-aware item, both directions (🔒 D2, YAZ-817). The label is the flag's; the click
 * hands the handler BOTH the target and the direction, so the caller never has to re-derive
 * which way the toggle was pointing after the menu closed (GRO-2296).
 */
describe('folder-page toggle item (🔒 D2)', () => {
  const labels = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')].map((b) => b.textContent)
  const item = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')].find((b) => b.textContent === label)

  it('reads "Turn into folder page" while the flag is off', () => {
    const el = mount(0, 0, { folderPagePath: '/v/a.md', folderPageIsOn: false })
    expect(labels(el)).toContain('Turn into folder page')
    expect(labels(el)).not.toContain('Turn back into normal page')
  })

  it('reads "Turn back into normal page" while the flag is on', () => {
    const el = mount(0, 0, { folderPagePath: '/v/a.md', folderPageIsOn: true })
    expect(labels(el)).toContain('Turn back into normal page')
    expect(labels(el)).not.toContain('Turn into folder page')
  })

  it('is absent entirely when there is no target', () => {
    const el = mount(0, 0, { folderPagePath: null, folderPageIsOn: false })
    expect(labels(el).some((l) => l?.startsWith('Turn'))).toBe(false)
  })

  it('hands the click its own target AND the direction, then closes', () => {
    const onToggleFolderPage = vi.fn()
    const onClose = vi.fn()
    const el = mount(0, 0, { folderPagePath: '/v/a.md', folderPageIsOn: true, onToggleFolderPage, onClose })
    act(() => item(el, 'Turn back into normal page')?.click())
    expect(onToggleFolderPage).toHaveBeenCalledExactlyOnceWith('/v/a.md', true)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

/**
 * Open in VS Code (YAZ-963): Reveal in Finder's sibling — same availability idiom (a path or
 * nothing), grouped in the same OS-actions cluster, the click handing the caller the path.
 */
describe('Open in VS Code item (YAZ-963)', () => {
  const labels = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')].map((b) => b.textContent)
  const item = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')].find((b) => b.textContent === label)

  it('renders beside Reveal in Finder when a path is offered', () => {
    const el = mount(0, 0, { revealPath: '/v/a.md', openVsCodePath: '/v/a.md' })
    expect(labels(el)).toContain('Reveal in Finder')
    expect(labels(el)).toContain('Open in VS Code')
  })

  it('absent without a path — the same nothing Reveal shows', () => {
    const el = mount(0, 0, {})
    expect(labels(el)).not.toContain('Open in VS Code')
  })

  it('hands the click to the caller with the path', () => {
    const onOpenVsCode = vi.fn()
    const el = mount(0, 0, { openVsCodePath: '/v/Zeta', onOpenVsCode })
    act(() => item(el, 'Open in VS Code')?.click())
    expect(onOpenVsCode).toHaveBeenCalledExactlyOnceWith('/v/Zeta')
  })
})
