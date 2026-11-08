/**
 * The folder page's toolbar and cog (YAZ-3746 D35, D36, D37): the note page's chips on a folder page, and the
 * cog's "This folder page" group — "Read only" (`readonly: true`) and "Show folder page file" (`show_page_file`),
 * both in the folder's `.folder.md`. Mounted as `FolderView.page.test.tsx` is: the `api` mock sits under the real
 * `writeProperty` over a tiny in-memory disk.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { resolverFor } from './engine'
import { createWikilinkResolveSource, type MutableWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { createStore } from '../lib/store'
import { click, flush, q, rec, renderFolderView, unmountFolderView } from './testFolderView'
import { FolderToolbar, type FolderChipsState } from './FolderToolbar'
import type { FolderViewProps } from './FolderView'
import { hoverPreviewOf } from '@shared/folderPage'
import { DEFAULT_FOLDER_PAGES } from '@shared/types'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { readFile: vi.fn(), writeFile: vi.fn() },
}))

import { api, BridgeRequestError } from '../api'

const readFile = vi.mocked(api.readFile)
const writeFile = vi.mocked(api.writeFile)

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const STAGES = '/vault/stages'
const SETTINGS_FILE = '/vault/stages/.folder.md'
const LEAD = '/vault/stages/Lead Gen.md'
const VIEWS = `---
folder_settings:
  views:
    - type: table
      name: Pipeline
---
`

let source: MutableWikilinkResolveSource
let disk: Map<string, { content: string; mtime: number }>
let clock = 100

/** The index's snapshot of the disk: the note, and the settings file's record when the file exists. */
function feed(): void {
  const records = [rec(LEAD)]
  const settings = disk.get(SETTINGS_FILE)
  const folders = settings === undefined ? [] : [rec(SETTINGS_FILE, parseFrontmatter(splitFrontmatter(settings.content).frontmatter).properties, settings.mtime)]
  const resolve = resolverFor(records, '/vault')
  act(() => source.update((target) => resolve(target)?.record.path ?? null, records, folders, true))
}

async function mount(extra: Partial<FolderViewProps> = {}): Promise<HTMLElement> {
  const el = renderFolderView({ path: STAGES, source, onOpenFile: () => undefined, ...extra })
  feed()
  await flush()
  return el
}

beforeEach(() => {
  source = createWikilinkResolveSource()
  disk = new Map([[SETTINGS_FILE, { content: VIEWS, mtime: 50 }]])
  readFile.mockImplementation(async (path) => {
    const file = disk.get(path)
    if (file === undefined) throw new BridgeRequestError('NOT_FOUND', 'path does not exist')
    return { path, ...file, size: file.content.length }
  })
  writeFile.mockImplementation(async ({ path, content }) => {
    disk.set(path, { content, mtime: ++clock })
    return { path, mtime: clock, size: content.length }
  })
})

afterEach(() => {
  unmountFolderView()
  vi.resetAllMocks()
})

const onDisk = (): string => disk.get(SETTINGS_FILE)?.content ?? ''
const chips = (el: ParentNode): string[] => [...q(el, '.status-chips').children].map((chip) => chip.className.split(' ')[0])
const openCog = (el: ParentNode): void => click(q(el, '.page-settings__trigger'))
const button = (el: ParentNode, text: string): HTMLButtonElement => {
  const b = [...el.querySelectorAll<HTMLButtonElement>('button')].find((x) => x.textContent?.replace('✓', '').trim() === text)
  if (b === undefined) throw new Error(`no button ${text}`)
  return b
}
const pill = (el: ParentNode, text: string): HTMLButtonElement => button(q(el, '[role="group"][aria-label="Show folder page file"]'), text)
const duplicateView = (el: ParentNode): void => {
  const tab = [...el.querySelectorAll<HTMLElement>('[role="tab"]')].find((x) => x.textContent === 'Pipeline')!
  act(() => void tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
  click([...el.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((x) => x.textContent === 'Duplicate')!)
}

describe('the folder page toolbar (D35)', () => {
  it('renders before the page: the cog, the zoom pill, the sync chip when the vault has one, the save chip', async () => {
    const el = await mount({ sync: { root: '/vault', state: 'synced' }, onSyncNow: () => undefined })
    expect([...el.children].map((c) => c.className)).toEqual(['status-chips', 'editor-host'])
    expect(chips(el)).toEqual(['page-settings', 'document-zoom', 'sync-indicator', 'save-indicator'])
    expect(q(el, '.save-indicator').textContent).toBe('Saved')
  })

  it('has no sync chip in a vault with no sync', async () => {
    const el = await mount()
    expect(chips(el)).toEqual(['page-settings', 'document-zoom', 'save-indicator'])
  })

  // "Show Other files" added by YAZ-4597 (D43): the third row of the group.
  it('the cog holds the "This folder page" group: Read only, Show folder page file, Show Other files, Settings chosen', async () => {
    const el = await mount()
    openCog(el)
    const group = q(el, '.page-settings__menu [role="group"][aria-label="This folder page"]')
    // YAZ-4601 D51 adds "Preview on hover" after "Show folder page file"; YAZ-4597 adds "Show Other files" last.
    expect([...group.children].map((c) => c.textContent)).toEqual(['This folder page', 'Read only', 'Show folder page file:', 'SettingsOnOff', 'Preview on hover:', 'SettingsOnOff', 'Show Other files:', 'SettingsOnOff'])
    expect(pill(el, 'Settings').getAttribute('aria-pressed')).toBe('true')
    // No word counts and no trailing rows: a folder page off its Page tab has only its own group.
    expect(q(el, '.page-settings__menu').textContent).not.toContain('words')
  })

  it('zoom is per tab and never stored: the pill zooms the page and writes nothing', async () => {
    const el = await mount()
    click(q(el, '[aria-label="Zoom in"]'))
    expect(q<HTMLElement>(el, '.editor-host').style.getPropertyValue('--document-zoom')).not.toBe('1')
    expect(Number(q<HTMLElement>(el, '.editor-host').style.getPropertyValue('--document-zoom'))).toBeGreaterThan(1)
    await flush()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('"Saving…" while a settings write is in flight, then "Saved"', async () => {
    let finish: () => void = () => undefined
    writeFile.mockImplementationOnce(({ path, content }) => new Promise((done) => {
      finish = () => {
        disk.set(path, { content, mtime: ++clock })
        done({ path, mtime: clock, size: content.length })
      }
    }))
    const el = await mount()
    duplicateView(el)
    await flush()
    expect(q(el, '.save-indicator').textContent).toBe('Saving…')
    await act(async () => finish())
    await flush()
    expect(q(el, '.save-indicator').textContent).toBe('Saved')
  })
})

describe('Read only (D36)', () => {
  it('the cog writes `readonly: true` into `.folder.md` and the chip shows', async () => {
    const el = await mount()
    openCog(el)
    click(button(el, 'Read only'))
    await flush()
    expect(parseFrontmatter(splitFrontmatter(onDisk()).frontmatter).properties.readonly).toBe(true)
    expect(chips(el)).toEqual(['page-settings', 'document-zoom', 'read-only-chip', 'save-indicator'])
  })

  it('a folder whose `.folder.md` says `readonly: true` shows the chip and refuses a settings write with the notice', async () => {
    disk.set(SETTINGS_FILE, { content: VIEWS.replace('---\n', '---\nreadonly: true\n'), mtime: 50 })
    const el = await mount()
    expect(el.querySelector('.read-only-chip')).not.toBeNull()
    duplicateView(el)
    await flush()
    expect(writeFile).not.toHaveBeenCalled()
    expect(q(el, '.views-pane__error').textContent).toBe('Could not update the folder: This folder page is read only')
    expect([...el.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(['Pipeline'])
  })

  it('"Allow edits" in the chip removes the key, and the settings write goes through again', async () => {
    disk.set(SETTINGS_FILE, { content: VIEWS.replace('---\n', '---\nreadonly: true\n'), mtime: 50 })
    const el = await mount()
    click(q(el, '.read-only-chip__button'))
    click(q(el, '.read-only-chip__allow'))
    await flush()
    expect(onDisk()).toBe(VIEWS)
    expect(el.querySelector('.read-only-chip')).toBeNull()
    feed()
    await flush()
    duplicateView(el)
    await flush()
    expect(writeFile).toHaveBeenCalledTimes(2)
  })
})

describe('Show folder page file (D37)', () => {
  it('writes `show_page_file` in three states: On is true, Off is false, Settings removes the key', async () => {
    const el = await mount()
    openCog(el)
    const value = () => parseFrontmatter(splitFrontmatter(onDisk()).frontmatter).properties.show_page_file
    click(pill(el, 'On'))
    await flush()
    expect(value()).toBe(true)
    expect(pill(el, 'On').getAttribute('aria-pressed')).toBe('true')
    click(pill(el, 'Off'))
    await flush()
    expect(value()).toBe(false)
    expect(pill(el, 'Off').getAttribute('aria-pressed')).toBe('true')
    click(pill(el, 'Settings'))
    await flush()
    expect(value()).toBeUndefined()
    expect(onDisk()).toBe(VIEWS)
    expect(writeFile).toHaveBeenCalledTimes(3)
  })
})

describe('Preview on hover (YAZ-4601 D51)', () => {
  const hoverPill = (el: ParentNode, text: string): HTMLButtonElement => button(q(el, '[role="group"][aria-label="Preview on hover"]'), text)

  it('writes `hover_preview` in three states: On is true, Off is false, Settings removes the key', async () => {
    const el = await mount()
    openCog(el)
    const value = () => parseFrontmatter(splitFrontmatter(onDisk()).frontmatter).properties.hover_preview
    expect(hoverPill(el, 'Settings').getAttribute('aria-pressed')).toBe('true')
    click(hoverPill(el, 'On'))
    await flush()
    expect(value()).toBe(true)
    expect(hoverPill(el, 'On').getAttribute('aria-pressed')).toBe('true')
    click(hoverPill(el, 'Off'))
    await flush()
    expect(value()).toBe(false)
    expect(hoverPill(el, 'Off').getAttribute('aria-pressed')).toBe('true')
    click(hoverPill(el, 'Settings'))
    await flush()
    expect(value()).toBeUndefined()
    expect(onDisk()).toBe(VIEWS)
  })

  it('the page\'s own choice is its key; no key, or any other value, follows Settings', () => {
    expect(hoverPreviewOf({ hover_preview: true })).toBe(true)
    expect(hoverPreviewOf({ hover_preview: false })).toBe(false)
    expect(hoverPreviewOf({})).toBeUndefined()
    expect(hoverPreviewOf({ hover_preview: 'yes' })).toBeUndefined()
  })
})

describe('Show Other files (YAZ-4597 D43)', () => {
  const otherPill = (el: ParentNode, text: string): HTMLButtonElement => button(q(el, '[role="group"][aria-label="Show Other files"]'), text)

  it('writes `show_other_files` in three states, and Off hides the tray; Settings follows Settings › Folder pages', async () => {
    const el = await mount()
    expect(el.querySelector('.other-files')).not.toBeNull() // the default is on
    openCog(el)
    const value = () => parseFrontmatter(splitFrontmatter(onDisk()).frontmatter).properties.show_other_files
    click(otherPill(el, 'Off'))
    await flush()
    expect(value()).toBe(false)
    expect(el.querySelector('.other-files')).toBeNull()
    click(otherPill(el, 'On'))
    await flush()
    expect(value()).toBe(true)
    expect(el.querySelector('.other-files')).not.toBeNull()
    click(otherPill(el, 'Settings'))
    await flush()
    expect(value()).toBeUndefined()
    expect(onDisk()).toBe(VIEWS)
  })

  it('Settings › Folder pages "Show Other files" Off hides the tray of a folder with no choice of its own', async () => {
    const el = await mount({ folderPages: { ...DEFAULT_FOLDER_PAGES, showOtherFiles: false } })
    expect(el.querySelector('.other-files')).toBeNull()
  })
})

describe('the hook for the Page tab (10D): `FolderPageTab` through the toolbar store', () => {
  let root: Root | null = null
  let container: HTMLElement | null = null
  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
  })

  it('the note\'s page switches follow the folder group, and the save chip shows the worse of the two saves', () => {
    const store = createStore<FolderChipsState>({ save: 'saved', page: null, readOnly: false })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const noop = () => undefined
    act(() => root!.render(<FolderToolbar store={store} zoom={100} onZoom={noop} readOnly={false} onToggleReadOnly={noop} asking={false} onAsk={noop} onAllow={noop} onCancel={noop} showPageFile={undefined} onChangeShowPageFile={noop} hoverPreview={undefined} onChangeHoverPreview={noop} showOtherFiles={undefined} onChangeShowOtherFiles={noop} />))
    const onToggleLineNumbers = vi.fn()
    act(() => store.set({ page: { cog: { lineNumbers: true, onToggleLineNumbers, readText: () => 'a b' }, save: 'unsaved' } }))
    expect(q(container, '.save-indicator').textContent).toBe('Unsaved')
    click(q(container, '.page-settings__trigger'))
    const menu = q(container, '.page-settings__menu')
    expect([...menu.children].map((c) => c.textContent)).toEqual([expect.stringContaining('This folder page'), '', 'Line numbers✓', '', '2 words', '3 characters'])
    click(button(menu, 'Line numbers'))
    expect(onToggleLineNumbers).toHaveBeenCalledTimes(1)
    act(() => store.set({ save: 'saving' }))
    expect(q(container, '.save-indicator').textContent).toBe('Saving…')
    act(() => store.set({ page: null }))
    expect(container.querySelector('.page-settings__menu')?.textContent).not.toContain('Line numbers')
  })
})
