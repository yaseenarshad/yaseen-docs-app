/**
 * Sidebar "New ▸ <type>" + "New type…" (Bible B, GRO-2202; Round 9 Q1–Q3 LOCKED): a vault with
 * an EMPTY registry sees no menu change at all; registered types grow a "New ▸" submenu whose
 * items create a page scaffolded from the registry (registry folder ?? the right-clicked dir,
 * created on demand; ALREADY_EXISTS fails loudly in the inline input); "New type…" is one
 * action — registry entry + starter `All <plural>.base` at the vault root, idempotently.
 * Real Sidebar/Tree/ContextMenu/NewTypeDialog against the jsdom bridge stub (Sidebar.test.tsx pattern).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_SETTINGS, type CreateFileRequest, type RegistryResponse, type TreeNode } from '@shared/types'
import { starterBase } from '../bases/scaffold'
import { Sidebar } from './Sidebar'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const TREE: TreeNode[] = [
  { type: 'dir', name: 'sub', path: '/v/sub', children: [] },
  { type: 'file', name: 'a.md', path: '/v/a.md', size: 1, mtime: 1, kind: 'markdown' },
]

const KPI_TYPES: RegistryResponse['types'] = {
  kpi: { displayName: 'KPI', pluralName: 'KPIs', properties: { unit: { kind: 'text' } } },
  problem: { properties: {} },
}

/** The bridge surface this flow touches; registry types are per-mount. */
function installBridge(types: RegistryResponse['types'] = {}) {
  const bridge = {
    tree: vi.fn(async (root: string) => ({ root, tree: TREE, generatedAt: 1 })),
    readFile: vi.fn(async (): Promise<{ path: string; content: string; mtime: number; size: number }> => {
      throw { code: 'NOT_FOUND', message: 'path does not exist' }
    }),
    createFile: vi.fn(async (req: string | CreateFileRequest) => ({ path: typeof req === 'string' ? req : req.path, mtime: 1, size: 0 })),
    createDir: vi.fn(async (path: string) => ({ path })),
    state: { setFolder: vi.fn(async () => undefined) },
    window: { open: vi.fn(async () => undefined) },
    registry: {
      get: vi.fn(async (root: string): Promise<RegistryResponse> => ({ root, version: 1, types, properties: {} })),
      setType: vi.fn(async () => undefined),
      onChange: vi.fn(() => () => undefined),
    },
  }
  Object.defineProperty(window, 'yaseenDocs', { value: bridge, configurable: true, writable: true })
  return bridge
}

let root: Root | null = null
let container: HTMLElement | null = null

type SidebarProps = Parameters<typeof Sidebar>[0]

async function mount(types: RegistryResponse['types'] = {}, over: Partial<SidebarProps> = {}) {
  const bridge = installBridge(types)
  const el = document.createElement('div')
  document.body.appendChild(el)
  container = el
  root = createRoot(el)
  const props: SidebarProps = {
    root: '/v',
    activeFile: null,
    watch: { subscribe: () => () => undefined },
    onOpenFile: vi.fn(),
    onPickFolder: vi.fn(),
    pickDisabled: false,
    onCollapse: vi.fn(),
    settings: { ...DEFAULT_SETTINGS },
    onChangeSettings: vi.fn(),
    onRootMissing: vi.fn(),
    onFileMissing: vi.fn(),
    ...over,
  }
  await act(async () => root?.render(<StrictMode><Sidebar {...props} /></StrictMode>))
  return { bridge, props, el }
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  delete (window as unknown as Record<string, unknown>).yaseenDocs
  vi.restoreAllMocks()
})

const menuItems = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')]
const itemByLabel = (el: HTMLElement, label: string) => menuItems(el).find((b) => b.textContent?.replace('▸', '').trim() === label)

const openBlankMenu = (el: HTMLElement) => act(() => void el.querySelector('.sidebar__body')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))

async function click(elm: Element | undefined) {
  if (elm === undefined) throw new Error('missing element')
  await act(async () => elm.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

/** React-visible value set for controlled and uncontrolled inputs alike. */
function setValue(input: HTMLInputElement | HTMLSelectElement | null, value: string) {
  if (input === null) throw new Error('missing input')
  const proto = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(input, value)
  act(() => void input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })))
}

async function submitInline(el: HTMLElement, name: string) {
  const input = el.querySelector<HTMLInputElement>('.create-inline__input')
  if (input === null) throw new Error('missing inline input')
  input.value = name
  await act(async () => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
}

describe('New ▸ submenu (Round 9 Q1)', () => {
  it('an EMPTY registry changes the context menu not at all', async () => {
    const { el } = await mount({})
    openBlankMenu(el)
    expect(menuItems(el).map((b) => b.textContent)).toEqual(['New note', 'New base', 'New folder'])
  })

  it('registered types grow "New ▸": one item per type (displayName ?? key) + "New type…" at the bottom', async () => {
    const { el } = await mount(KPI_TYPES)
    openBlankMenu(el)
    await click(itemByLabel(el, 'New'))
    const sub = [...(el.querySelector('.ctx-submenu')?.querySelectorAll('.ctx-menu__item') ?? [])].map((b) => b.textContent)
    expect(sub).toEqual(['New KPI', 'New problem', 'New type…'])
  })
})

describe('New <type> (scaffolded page)', () => {
  it('creates the registry scaffold at the click target in one content-at-create call, then opens it', async () => {
    const { bridge, props, el } = await mount(KPI_TYPES)
    openBlankMenu(el)
    await click(itemByLabel(el, 'New'))
    await click(itemByLabel(el, 'New KPI'))

    const input = el.querySelector<HTMLInputElement>('.create-inline__input')
    expect(input?.placeholder).toBe('New KPI')

    await submitInline(el, 'CAC')

    expect(bridge.createFile).toHaveBeenCalledWith({ path: '/v/CAC.md', content: '---\npage_type: kpi\nunit:\n---\n' })
    expect(props.onOpenFile).toHaveBeenCalledWith('/v/CAC.md')
  })

  it('a declared registry folder aims the page and is created on demand', async () => {
    const types: RegistryResponse['types'] = { kpi: { ...KPI_TYPES.kpi, folder: 'kpis' } }
    const { bridge, el } = await mount(types)
    openBlankMenu(el)
    await click(itemByLabel(el, 'New'))
    await click(itemByLabel(el, 'New KPI'))
    await submitInline(el, 'CAC')

    expect(bridge.createDir).toHaveBeenCalledWith('/v/kpis')
    expect(bridge.createFile).toHaveBeenCalledWith({ path: '/v/kpis/CAC.md', content: '---\npage_type: kpi\nunit:\n---\n' })
  })

  it('a template body and defaults ride the scaffold', async () => {
    const { bridge, el } = await mount(KPI_TYPES)
    bridge.readFile.mockResolvedValue({ path: '/v/.yaseendocs/templates/kpi.md', content: '---\nunit: "%"\n---\nHow to measure.\n', mtime: 1, size: 1 })
    openBlankMenu(el)
    await click(itemByLabel(el, 'New'))
    await click(itemByLabel(el, 'New KPI'))
    await submitInline(el, 'Win rate')

    expect(bridge.readFile).toHaveBeenCalledWith('/v/.yaseendocs/templates/kpi.md')
    expect(bridge.createFile).toHaveBeenCalledWith({ path: '/v/Win rate.md', content: '---\npage_type: kpi\nunit: "%"\n---\nHow to measure.\n' })
  })

  it('ALREADY_EXISTS fails loudly in the inline input — nothing is overwritten, nothing opens', async () => {
    const { bridge, props, el } = await mount(KPI_TYPES)
    bridge.createFile.mockRejectedValue({ code: 'ALREADY_EXISTS', message: 'path already exists' })
    openBlankMenu(el)
    await click(itemByLabel(el, 'New'))
    await click(itemByLabel(el, 'New KPI'))
    await submitInline(el, 'CAC')

    expect(el.querySelector('.create-inline__error')?.textContent).toContain('already exists')
    expect(props.onOpenFile).not.toHaveBeenCalled()
  })
})

describe('New type… (Round 9 Q2/Q3)', () => {
  const dialog = (el: HTMLElement) => el.querySelector<HTMLElement>('.type-dialog')
  const dialogInput = (el: HTMLElement, label: string) => {
    const input = el.querySelector<HTMLInputElement>(`.type-dialog [aria-label="${label}"]`)
    if (input === null) throw new Error(`missing dialog input ${label}`)
    return input
  }
  const dialogButton = (el: HTMLElement, label: string) => {
    const btn = [...el.querySelectorAll<HTMLButtonElement>('.type-dialog button')].find((b) => b.textContent === label)
    if (btn === undefined) throw new Error(`missing dialog button ${label}`)
    return btn
  }

  async function createFunnelStage(el: HTMLElement) {
    openBlankMenu(el)
    await click(itemByLabel(el, 'New'))
    await click(itemByLabel(el, 'New type…'))
    expect(dialog(el)).not.toBeNull()
    setValue(dialogInput(el, 'Type name'), 'funnel-stage')
    await click(dialogButton(el, 'Add property'))
    setValue(dialogInput(el, 'Property 1 name'), 'order')
    setValue(el.querySelector<HTMLSelectElement>('.type-dialog select'), 'number')
    await click(dialogButton(el, 'Create'))
  }

  it('one action: registry entry (derived display/plural names) + starter base at the vault root', async () => {
    const { bridge, el } = await mount(KPI_TYPES)
    await createFunnelStage(el)

    expect(bridge.registry.setType).toHaveBeenCalledWith('/v', 'funnel-stage', {
      displayName: 'Funnel Stage',
      pluralName: 'Funnel Stages',
      properties: { order: { kind: 'number' } },
    })
    expect(bridge.createFile).toHaveBeenCalledWith({
      path: '/v/All Funnel Stages.base',
      content: starterBase('funnel-stage', { properties: { order: { kind: 'number' } } }),
    })
    expect(dialog(el)).toBeNull()
  })

  it('an existing starter base skips silently (idempotent, never overwrites)', async () => {
    const { bridge, el } = await mount(KPI_TYPES)
    bridge.createFile.mockRejectedValue({ code: 'ALREADY_EXISTS', message: 'path already exists' })
    await createFunnelStage(el)

    expect(bridge.registry.setType).toHaveBeenCalled()
    expect(dialog(el)).toBeNull()
  })

  it('a name outside the type grammar is rejected in the dialog, nothing written', async () => {
    const { bridge, el } = await mount(KPI_TYPES)
    openBlankMenu(el)
    await click(itemByLabel(el, 'New'))
    await click(itemByLabel(el, 'New type…'))
    setValue(dialogInput(el, 'Type name'), 'Funnel Stage')
    await click(dialogButton(el, 'Create'))

    expect(el.querySelector('.type-dialog [role="alert"]')?.textContent).toContain('kebab-case')
    expect(bridge.registry.setType).not.toHaveBeenCalled()
    expect(bridge.createFile).not.toHaveBeenCalled()
  })

  it('a failing registry write (e.g. INVALID_CONFIG) surfaces in the dialog, which stays open with Create re-enabled', async () => {
    const { bridge, el } = await mount(KPI_TYPES)
    bridge.registry.setType.mockRejectedValue({ code: 'INVALID_CONFIG', message: 'types.json is unreadable and will not be overwritten' })
    await createFunnelStage(el)

    expect(dialog(el)).not.toBeNull()
    expect(el.querySelector('.type-dialog [role="alert"]')?.textContent).toContain('unreadable')
    expect(dialogButton(el, 'Create').disabled).toBe(false)
    expect(bridge.createFile).not.toHaveBeenCalled()
  })

  it('Enter in a dialog field submits (CreateInline parity)', async () => {
    const { bridge, el } = await mount(KPI_TYPES)
    openBlankMenu(el)
    await click(itemByLabel(el, 'New'))
    await click(itemByLabel(el, 'New type…'))
    setValue(dialogInput(el, 'Type name'), 'role')
    await act(async () => void dialogInput(el, 'Type name').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))

    expect(bridge.registry.setType).toHaveBeenCalledWith('/v', 'role', { displayName: 'Role', pluralName: 'Roles', properties: {} })
    expect(dialog(el)).toBeNull()
  })
})
