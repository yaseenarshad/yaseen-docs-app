/**
 * The sidebar's folder page row opens the folder page on its Page tab (YAZ-4587, D37): `askPageTab`, then the
 * "Open folder page" door. Mounted through the real host (`FolderView` → `ViewsPane`), `OutlineEditor` stubbed as
 * `OutlineView.test.tsx` does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { resolverFor } from './engine'
import { createWikilinkResolveSource, type MutableWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { flush, rec, renderFolderView, unmountFolderView } from './testFolderView'
import { askPageTab, takePageTab } from './pageTabRequest'

vi.mock('./writeProperty', () => ({ writeProperty: vi.fn(), writeProperties: vi.fn() }))
vi.mock('./view/OutlineEditor', () => ({ OutlineEditor: () => <div className="outline-doc" /> }))

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const STAGES = '/vault/stages'
const TABLE = { type: 'table', name: 'Table', order: ['file.name'] }
const BOARD = { type: 'board', name: 'Board' }
const PAGE = { type: 'outline', name: 'Page' }

let source: MutableWikilinkResolveSource

async function mount(settings: unknown, tabId: string | null = 'tab-1'): Promise<HTMLElement> {
  const el = renderFolderView({ path: STAGES, source, onOpenFile: vi.fn(), ...(tabId === null ? {} : { tabId }) })
  const records = [rec('/vault/stages/Lead Gen.md')]
  const resolve = resolverFor(records, '/vault')
  act(() => source.update((target) => resolve(target)?.record.path ?? null, records, [rec('/vault/stages/.folder.md', { folder_settings: settings })]))
  await flush()
  return el
}

const activeTab = (el: ParentNode) => el.querySelector('[role="tab"][aria-selected="true"]')?.textContent

beforeEach(() => {
  source = createWikilinkResolveSource()
})

afterEach(() => {
  unmountFolderView()
  takePageTab(STAGES) // no ask outlives its test
  vi.resetAllMocks()
})

describe('a click on the folder page row shows the Page tab (YAZ-4587, D37)', () => {
  it('asked before the page mounts: the page opens on its Page tab, and the ask is taken', async () => {
    askPageTab(STAGES)
    const el = await mount({ views: [TABLE, PAGE] })
    expect(activeTab(el)).toBe('Page')
    expect(takePageTab(STAGES)).toBe(false)
  })

  it('asked while the page shows another view: it moves to the Page tab', async () => {
    const el = await mount({ views: [TABLE, PAGE] })
    expect(activeTab(el)).toBe('Table')
    act(() => askPageTab(STAGES))
    expect(activeTab(el)).toBe('Page')
  })

  it('a folder with no Page tab opens on its start view', async () => {
    const el = await mount({ views: [TABLE, BOARD], defaultView: 'Board' })
    act(() => [...el.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === 'Table')!.click())
    act(() => askPageTab(STAGES))
    expect(activeTab(el)).toBe('Board')
  })

  it('an ask for another folder, and a folder page with no app tab (the right panel), leave the view as it is', async () => {
    askPageTab('/vault/other')
    const el = await mount({ views: [TABLE, PAGE] })
    expect(activeTab(el)).toBe('Table')
    unmountFolderView()
    askPageTab(STAGES)
    expect(activeTab(await mount({ views: [TABLE, PAGE] }, null))).toBe('Table')
    expect(takePageTab(STAGES)).toBe(true) // still waiting for the app tab's page
  })
})
