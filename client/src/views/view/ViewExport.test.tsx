/**
 * "Export as CSV…" and "Copy as table" in the view tab's right-click (YAZ-4594 S30): ViewsPane mounted in jsdom over
 * `TEST_RECORDS`. The text is the tab's shown rows (filters, sort, then the search box) × its shown columns, Name first.
 * The CSV goes out through a download link (Electron's save sheet); the table through the app's clipboard helper.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { type ParsedViews, parseViews } from '../viewSchema'
import { ViewsPane } from '../ViewsPane'
import { testFolderHost } from '../testFolderHost'
import { TEST_RECORDS } from '../testRecords'

vi.mock('../../lib/storage', () => ({ storage: { getViewGroups: () => [], setViewGroups: () => undefined } }))

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const VIEWS = `views:
  - type: table
    name: Ideas
    order:
      - note.priority
      - file.name
      - note.related
    filters:
      and:
        - note.pillar == "Agentic Agency"
    sort:
      - property: note.priority
        direction: DESC
  - type: board
    name: Board
    order:
      - file.name
      - note.status
    filters:
      and:
        - note.pillar == "Creator Economy"
  - type: page
    name: Page
`

let root: Root | null = null
let container: HTMLElement | null = null
let draw: () => void = () => {}
const writeText = vi.fn(async (_text: string) => undefined)
let blobs: Blob[] = []
let downloads: string[] = []

beforeEach(() => {
  writeText.mockClear()
  blobs = []
  downloads = []
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  URL.createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob)
    return 'blob:csv'
  })
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download)
  })
})

function mount() {
  let parsed = parseViews(VIEWS)
  const onChange = vi.fn((next: ParsedViews) => {
    parsed = next
    draw()
  })
  const onNotice = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const folder = testFolderHost({ onNotice })
  draw = () => act(() => root?.render(<ViewsPane parsed={parsed} onChange={onChange} root="/vault" folderPath="/vault/Content Pillars" records={TEST_RECORDS} folder={folder} onOpenFile={vi.fn()} />))
  draw()
  return { el: container, onChange, onNotice }
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  vi.restoreAllMocks()
})

const click = (el: Element) => act(() => (el as HTMLElement).click())
const openOn = (el: ParentNode, name: string) => {
  const tab = [...el.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === name)!.closest('.view-tab')!
  act(() => void tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
}
const item = (el: ParentNode, text: string): HTMLButtonElement => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')].find((b) => b.textContent === text)!
const flush = () => act(async () => await Promise.resolve())

describe('the view tab exports (YAZ-4594 S30)', () => {
  it('"Copy as table": tab-separated, Name first, the filtered and sorted rows, links by title; it says so', async () => {
    const { el, onNotice, onChange } = mount()
    openOn(el, 'Ideas')
    click(item(el, 'Copy as table'))
    await flush()
    expect(writeText).toHaveBeenCalledWith('Name\tPriority\tRelated\nAgentic Agency\t2\t\nThe Levels of an Agency\t1\tAgentic Agency')
    expect(onNotice).toHaveBeenCalledWith('Copied table')
    expect(el.querySelector('.ctx-menu')).toBeNull()
    expect(onChange).not.toHaveBeenCalled() // an export writes nothing
  })

  it('"Export as CSV…": a CSV file named for the folder and the view, through the download (save) sheet', async () => {
    const { el } = mount()
    openOn(el, 'Ideas')
    click(item(el, 'Export as CSV…'))
    expect(downloads).toEqual(['Content Pillars - Ideas.csv'])
    expect(blobs[0].type).toBe('text/csv;charset=utf-8')
    expect(await blobs[0].text()).toBe('Name,Priority,Related\r\nAgentic Agency,2,\r\nThe Levels of an Agency,1,Agentic Agency\r\n')
  })

  it('another tab exports its own rows and columns, without becoming active', async () => {
    const { el } = mount()
    openOn(el, 'Board')
    click(item(el, 'Copy as table'))
    await flush()
    expect(writeText.mock.lastCall?.[0].split('\n').sort()).toEqual(['Creator Economy\tpublished', 'Name\tStatus', 'The Gold In Your Archive\tidea'])
    expect(el.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Ideas')
  })

  it('the search box narrows what is exported, as it narrows the view', async () => {
    const { el } = mount()
    click(el.querySelector('[aria-label="Search"]')!)
    const input = el.querySelector<HTMLInputElement>('[aria-label="Search rows"]')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'levels')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    openOn(el, 'Ideas')
    click(item(el, 'Copy as table'))
    await flush()
    expect(writeText).toHaveBeenCalledWith('Name\tPriority\tRelated\nThe Levels of an Agency\t1\tAgentic Agency')
  })

  it('a Page tab has no rows: both items are there, disabled', () => {
    const { el } = mount()
    openOn(el, 'Page')
    expect(item(el, 'Export as CSV…').disabled).toBe(true)
    expect(item(el, 'Copy as table').disabled).toBe(true)
  })
})
