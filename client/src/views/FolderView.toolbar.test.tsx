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
import { FolderView, type FolderViewProps } from './FolderView'
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
/**
 * The cog's open menu (YAZ-4776): a portal on the page, under its cog, so a test finds it by the open cog's
 * `aria-controls`, not inside the folder page. Throws while it is closed.
 */
const cogMenu = (el: ParentNode): HTMLElement => {
  const id = el.querySelector('.page-settings > button[aria-expanded="true"]')?.getAttribute('aria-controls')
  const menu = id == null ? null : document.getElementById(id)
  if (menu === null) throw new Error('missing .page-settings__menu')
  return menu
}
const button = (el: ParentNode, text: string): HTMLButtonElement => {
  const b = [...el.querySelectorAll<HTMLButtonElement>('button')].find((x) => x.textContent?.replace('✓', '').trim() === text)
  if (b === undefined) throw new Error(`no button ${text}`)
  return b
}
// "Show folder page file" is "Page file in the sidebar" under the "Show" heading (YAZ-3746 13BP).
const pill = (el: ParentNode, text: string): HTMLButtonElement => button(q(cogMenu(el), '[role="group"][aria-label="Page file in the sidebar"]'), text)
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

  // YAZ-3746 13BP: the group is named "<folder> (folder page)" (CL6), and its rows stand under three headings — Show,
  // Preview on hover, Safety — one line each with an (i), the heading saying the rest of the old label. "Read only"
  // moved under Safety as an On / Off line (CL7); "New buttons" (13BL) joined Show.
  it('the cog holds the "<folder> (folder page)" group: Show (page file, Other files, New buttons, parent columns, column marks), Preview on hover (Rows, Links), Safety (Read only, Confirm changes), Settings chosen', async () => {
    const el = await mount()
    openCog(el)
    const group = q(cogMenu(el), '[role="group"][aria-label="stages (folder page)"]')
    expect([...group.children].map((c) => c.textContent)).toEqual([
      'stages (folder page)',
      'Show',
      'Page file in the sidebarSettingsOnOff',
      'Other filesSettingsOnOff',
      'New buttonsSettingsOnOff',
      "Parent folders' columnsSettingsOnOff",
      'Where columns come from',
      'SettingsIconIcon and folder nameOff',
      '',
      'Preview on hover',
      'RowsSettingsOnOff',
      'LinksSettingsOnOff',
      '',
      'Safety',
      'Read onlyOnOff',
      'Confirm changesSettingsOnOff',
    ])
    // Each row's (i) is named for its row (13BP CL4).
    expect([...group.querySelectorAll('.page-settings__info')].map((b) => b.getAttribute('aria-label'))).toEqual(['About Page file in the sidebar', 'About Other files', 'About New buttons', "About Parent folders' columns", 'About Where columns come from', 'About Rows', 'About Links', 'About Read only', 'About Confirm changes'])
    expect(pill(el, 'Settings').getAttribute('aria-pressed')).toBe('true')
    // No word counts and no trailing rows: the folder ⚙ has only the folder page's own group (13BM PS2).
    expect(cogMenu(el).textContent).not.toContain('words')
  })

  // YAZ-4810 5G on the folder ⚙ (merge of PR #257): its menu is on `document.body` too, so Tab crosses between the cog and it.
  it('Tab on the open folder ⚙ goes to its menu’s first control; Shift+Tab there goes back; Tab on the last closes it on the cog', async () => {
    const el = await mount()
    const cog = q<HTMLButtonElement>(el, '.page-settings__trigger')
    act(() => cog.focus())
    openCog(el)
    const tab = (target: Element, shiftKey = false) =>
      act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })))
    const items = () => [...cogMenu(el).querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), input:not([disabled])')]
    tab(cog)
    expect(document.activeElement).toBe(items()[0])
    tab(items()[0]!, true)
    expect(document.activeElement).toBe(cog)
    const last = items().at(-1)!
    act(() => last.focus())
    tab(last)
    expect(el.querySelector('.page-settings > button[aria-expanded="true"]')).toBeNull()
    expect(document.activeElement).toBe(cog)
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
    // "Read only" is an On / Off line under Safety (YAZ-3746 13BP CL7): On turns it on at once.
    click(button(q(cogMenu(el), '[role="group"][aria-label="Read only"]'), 'On'))
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

describe('Preview on hover (YAZ-4601 D51; two switches since demo 13D)', () => {
  // "Preview rows on hover" is "Rows" under the "Preview on hover" heading (YAZ-3746 13BP).
  const hoverPill = (el: ParentNode, text: string): HTMLButtonElement => button(q(cogMenu(el), '[role="group"][aria-label="Rows"]'), text)

  it('"Preview rows on hover" writes `hover_rows` in three states: On is true, Off is false, Settings removes the key', async () => {
    const el = await mount()
    openCog(el)
    const value = () => parseFrontmatter(splitFrontmatter(onDisk()).frontmatter).properties.hover_rows
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
  // "Show Other files" is "Other files" under the "Show" heading (YAZ-3746 13BP).
  const otherPill = (el: ParentNode, text: string): HTMLButtonElement => button(q(cogMenu(el), '[role="group"][aria-label="Other files"]'), text)

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

  // YAZ-3746 13BM PS2: the folder ⚙ holds the folder page's own group only. The Page tab's text switches, handed through
  // the same store, are on the Page's own settings button in its view toolbar (PS1; `Editor.test.tsx`, the folder Page tab).
  it('the note\'s page switches stay out of the folder ⚙, and the save chip shows the worse of the two saves', () => {
    const store = createStore<FolderChipsState>({ save: 'saved', page: null, readOnly: false })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const noop = () => undefined
    act(() => root!.render(<FolderToolbar store={store} name="Projects" zoom={100} onZoom={noop} readOnly={false} onToggleReadOnly={noop} asking={false} onAsk={noop} onAllow={noop} onCancel={noop} showPageFile={undefined} onChangeShowPageFile={noop} hoverRows={undefined} onChangeHoverRows={noop} hoverLinks={undefined} onChangeHoverLinks={noop} showOtherFiles={undefined} onChangeShowOtherFiles={noop} inheritColumns={undefined} onChangeInheritColumns={noop} />))
    const onToggleLineNumbers = vi.fn()
    act(() => store.set({ page: { cog: { lineNumbers: true, onToggleLineNumbers, readText: () => 'a b' }, save: 'unsaved', foldAll: null } }))
    expect(q(container, '.save-indicator').textContent).toBe('Unsaved')
    click(q(container, '.page-settings__trigger'))
    const menu = cogMenu(container)
    expect([...menu.children].map((c) => c.textContent)).toEqual([expect.stringContaining('Projects (folder page)'), ''])
    expect(menu.textContent).not.toContain('Line numbers')
    expect(menu.textContent).not.toContain('words')
    expect(onToggleLineNumbers).not.toHaveBeenCalled()
    act(() => store.set({ save: 'saving' }))
    expect(q(container, '.save-indicator').textContent).toBe('Saving…')
    act(() => store.set({ page: null }))
    expect(q(container, '.save-indicator').textContent).toBe('Saving…')
  })
})

describe('two folder pages on one `.folder.md` (YAZ-4596 S38)', () => {
  it('two tabs write different settings at once, after the echo, and before it: each write rebases on the disk, and only the same key takes the later write', async () => {
    // The main process's guard: a write against an older mtime is a CONFLICT that names the disk's.
    let conflicts = 0
    writeFile.mockImplementation(async ({ path, content, expectedMtime }) => {
      const now = disk.get(path)
      if (now !== undefined && expectedMtime !== now.mtime) {
        conflicts += 1
        throw new BridgeRequestError('CONFLICT', 'file changed on disk since last read', now.mtime)
      }
      disk.set(path, { content, mtime: ++clock })
      return { path, mtime: clock, size: content.length }
    })
    const a = await mount()
    const b = document.createElement('div')
    document.body.append(b)
    const rootB: Root = createRoot(b)
    const noop = () => undefined
    try {
      act(() => rootB.render(<FolderView root="/vault" path={STAGES} source={source} onOpenFile={noop} onRetitle={noop} commentsOrder="oldest" onChangeCommentsOrder={noop} />))
      await flush()
      const onDiskNow = () => parseFrontmatter(splitFrontmatter(onDisk()).frontmatter).properties as { show_page_file?: boolean; hover_rows?: boolean; folder_settings: { views: { name: string }[] } }

      // At once: B duplicates a view (the whole `folder_settings` block) and A's cog sets "Show folder page file".
      // Both read the same bytes; the later write is refused, reads again and lands on top.
      openCog(a)
      duplicateView(b)
      click(pill(a, 'On'))
      await flush()
      await flush()
      expect(conflicts).toBe(1)
      expect(onDiskNow().show_page_file).toBe(true)
      expect(onDiskNow().folder_settings.views).toHaveLength(2)

      // The watcher speaks to both tabs. Then at once: A duplicates a view, B's cog turns "Preview rows on hover" off.
      feed()
      await flush()
      openCog(b)
      duplicateView(a)
      click(button(q(cogMenu(b), '[role="group"][aria-label="Rows"]'), 'Off'))
      await flush()
      await flush()
      expect(conflicts).toBe(2)
      const end = onDiskNow()
      expect(end.show_page_file).toBe(true)
      expect(end.hover_rows).toBe(false)
      expect(end.folder_settings.views).toHaveLength(3) // B's copy and A's copy: A wrote on the settings it heard from B
      expect(end.folder_settings.views[0].name).toBe('Pipeline')
      expect(writeFile).toHaveBeenCalledTimes(6) // four writes, two of them refused once

      // Both block writes now, and the watcher speaks to neither: each tab writes from a block that is behind the disk.
      // Different keys, at once: A makes Pipeline the start view, B duplicates it. The refused one rebases on the other.
      feed()
      await flush()
      const tabMenu = (el: ParentNode, name: string, item: string): void => {
        const t = [...el.querySelectorAll<HTMLElement>('[role="tab"]')].find((x) => x.textContent === name)!
        act(() => void t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
        click([...el.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find((x) => x.textContent?.replace('✓', '').trim() === item)!)
      }
      tabMenu(a, 'Pipeline', 'Make default view')
      duplicateView(b)
      await flush()
      await flush()
      expect(conflicts).toBe(3)
      const both = onDiskNow() as ReturnType<typeof onDiskNow> & { folder_settings: { defaultView?: string } }
      expect(both.folder_settings.defaultView).toBe('Pipeline')
      expect(both.folder_settings.views).toHaveLength(4)
      // The same key, one after the other, still unheard: A, then B, choose a start view. The later one wins; nothing
      // else goes — A's list does not hold B's new copy yet, and the copy stays.
      expect(both.folder_settings.views.map((v) => v.name)).toEqual(['Pipeline', 'Pipeline copy 3', 'Pipeline copy 2', 'Pipeline copy'])
      expect([...a.querySelectorAll('[role="tab"]')].map((x) => x.textContent)).not.toContain('Pipeline copy 3')
      tabMenu(a, 'Pipeline copy', 'Make default view')
      await flush()
      expect((onDiskNow() as typeof both).folder_settings.defaultView).toBe('Pipeline copy')
      tabMenu(b, 'Pipeline copy 2', 'Make default view')
      await flush()
      const last = onDiskNow() as typeof both
      expect(last.folder_settings.defaultView).toBe('Pipeline copy 2')
      expect(last.folder_settings.views.map((v) => v.name)).toEqual(both.folder_settings.views.map((v) => v.name))
      expect(last.show_page_file).toBe(true)
      expect(last.hover_rows).toBe(false)
    } finally {
      act(() => rootB.unmount())
      b.remove()
    }
  })
})
