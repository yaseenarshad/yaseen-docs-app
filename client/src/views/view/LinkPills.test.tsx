/**
 * Link pills in folder cells (YAZ-4601, YAZ-4501 D47-D49). A link value is the note editor's wikilink pill: it reads
 * as the linked page's title, a click opens that page (⌘ a background tab) and edits nothing, and a hover shows the
 * LINKED page's card in place of the row's. A text value with an inline `[[link]]` shows text and a pill. The cells'
 * `[[` picker offers notes AND folders, as the note editor's does. These mount the whole `ViewsPane`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord, TreeNode } from '@shared/types'
import { fetchTree } from '../../lib/treeFeed'
import { parseViews, type ParsedViews } from '../viewSchema'
import { ViewsPane, type ViewsPaneProps } from '../ViewsPane'
import { testFolderHost } from '../testFolderHost'
import { propertiesStub, resetPropertiesStub } from '../propertiesStub'
import { createWikilinkResolveSource } from '../../editor/wikilink/wikilinkPlugin'
import { HOVER_PREVIEW_DWELL_MS } from '../../sidebar/HoverPreviewHost'

vi.mock('../../lib/storage', () => ({ storage: { getViewGroups: () => [], setViewGroups: () => undefined, getSettings: () => undefined, getRoots: () => ['/vault'] } }))
vi.mock('../writeProperty', () => ({ writeProperty: vi.fn(async () => ({ mtime: 1 })), writeProperties: vi.fn(async () => ({ mtime: 1 })) }))
vi.mock('../../editor/createCrepe', () => ({
  createCrepe: vi.fn((opts: { root: HTMLElement; defaultValue?: string }) => {
    opts.root.textContent = opts.defaultValue ?? ''
    return { create: vi.fn(async () => {}), setReadonly: vi.fn(), destroy: vi.fn() }
  }),
}))
// The sidebar's note panel: a stand-in that says which note it shows.
vi.mock('../../sidebar/NotePreview', () => ({ default: ({ name }: { name: string }) => <div className="note-preview" aria-label={`Preview of ${name}`} /> }))

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const rec = (path: string, properties: Record<string, unknown> = {}): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return { path, name, basename: name.replace(/\.md$/, ''), title: name.replace(/\.md$/, ''), folder: path.slice(7, path.lastIndexOf('/')), ext: 'md', size: 0, ctime: 0, mtime: 0, properties, aliases: [], tags: [], links: [], embeds: [] }
}

const ALPHA = '/vault/Pills/Alpha.md'
const BOB = '/vault/People/Bob.md'
const CAROL = '/vault/People/Carol.md'
const ROWS = [rec(ALPHA, { owner: '[[Bob]]', team: ['[[Bob]]', '[[Carol]]'], note: 'see [[Bob]] now' })]
const VAULT = [...ROWS, rec(BOB), rec(CAROL)]
const DIRS: TreeNode[] = ['People', 'Pills'].map((name) => ({ type: 'dir', name, path: `/vault/${name}`, children: [] }))

const TABLE = 'views:\n  - type: table\n    name: T\n    order:\n      - file.name\n      - note.owner\n      - note.team\n      - note.note\n'
const CARDS = 'views:\n  - type: cards\n    name: C\n    order:\n      - file.name\n      - note.owner\n'

let root: Root | null = null
let container: HTMLElement | null = null

function mount(text: string, props: Partial<ViewsPaneProps> = {}) {
  let parsed = parseViews(text)
  const onOpenFile = vi.fn()
  const openBackground = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      <ViewsPane
        parsed={parsed}
        onChange={(next: ParsedViews) => void (parsed = next)}
        root="/vault"
        folderPath="/vault/Pills"
        records={ROWS}
        folder={testFolderHost({ vaultRecords: VAULT, openBackground })}
        onOpenFile={onOpenFile}
        {...props}
      />,
    ),
  )
  return { el: container, onOpenFile, openBackground }
}

beforeEach(async () => {
  const tree = async () => ({ root: '/vault', tree: DIRS, generatedAt: 1 })
  Object.defineProperty(window, 'yaseenDocs', { value: { properties: propertiesStub, tree }, configurable: true, writable: true })
  await fetchTree('/vault')
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  resetPropertiesStub()
  delete (window as unknown as Record<string, unknown>).yaseenDocs
})

const cell = (el: ParentNode, column: number): HTMLElement => {
  const td = el.querySelector<HTMLElement>(`td[data-cell="0:${column}"]`)
  if (td === null) throw new Error(`no cell 0:${column}`)
  return td
}
const pills = (el: ParentNode): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('[data-link-path]')]
const click = (el: Element, init: MouseEventInit = {}) => act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init })))
const settle = (ms: number) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)).then(() => undefined))
const over = (el: Element, from?: Element) => act(() => {
  from?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: el }))
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: from ?? null }))
})
const input = (el: HTMLInputElement, value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
const preview = () => document.body.querySelector('.note-preview')?.getAttribute('aria-label') ?? null

describe('D47: a link value is a pill', () => {
  it('reads as the linked title, with the wikilink pill class, in Link and Multi-link cells', () => {
    const { el } = mount(TABLE)
    expect(pills(cell(el, 1)).map((p) => [p.textContent, p.dataset.linkPath, p.classList.contains('wikilink')])).toEqual([['Bob', BOB, true]])
    expect(pills(cell(el, 2)).map((p) => p.dataset.linkPath)).toEqual([BOB, CAROL])
  })

  it('a pill wears its page’s file icon, as a note’s pill does (YAZ-4544 4G)', () => {
    const { el } = mount(TABLE)
    const pill = pills(cell(el, 1))[0]
    expect([pill.classList.contains('file-icon'), pill.classList.contains('file-icon--file'), pill.dataset.kind]).toEqual([true, true, 'markdown'])
    expect(pill.textContent).toBe('Bob')
  })

  it('a click opens the linked page and does not edit; ⌘-click opens a background tab', () => {
    const { el, onOpenFile, openBackground } = mount(TABLE)
    click(pills(cell(el, 1))[0])
    expect(onOpenFile).toHaveBeenCalledWith(BOB)
    expect(el.querySelector('[data-editing]')).toBeNull()
    click(pills(cell(el, 2))[1], { metaKey: true })
    expect(openBackground).toHaveBeenCalledWith(CAROL)
    expect(onOpenFile).toHaveBeenCalledTimes(1)
    expect(el.querySelector('[data-editing]')).toBeNull()
  })

  it('a double-click on the cell still edits it', () => {
    const { el } = mount(TABLE)
    act(() => void cell(el, 1).dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    expect(el.querySelector('[data-editing] input')).not.toBeNull()
  })

  it('on a card: a click on the pill opens, a click on the empty space edits', () => {
    const { el, onOpenFile } = mount(CARDS)
    click(pills(el)[0])
    expect(onOpenFile).toHaveBeenCalledWith(BOB)
    expect(el.querySelector('[data-editing]')).toBeNull()
    click(pills(el)[0].closest('[data-edit]')!)
    expect(el.querySelector('[data-editing] input')).not.toBeNull()
  })

  it('an unresolved link is no pill: nothing to open', () => {
    const { el } = mount(TABLE, { records: [rec(ALPHA, { owner: '[[Nobody]]' })] })
    expect(pills(cell(el, 1))).toEqual([])
    expect(cell(el, 1).textContent).toBe('Nobody')
  })
})

describe('D47: the pill hover shows the linked page', () => {
  const on = { hoverPreview: true, previewScope: () => ({ root: '/vault', wikilinks: createWikilinkResolveSource(), textVars: {} }) }

  it('the pill shows the LINKED card; back on the row, the row card shows again', async () => {
    const { el } = mount(TABLE, on)
    const row = cell(el, 1).closest('tr')!
    over(row)
    const pill = pills(cell(el, 1))[0]
    over(pill, cell(el, 1))
    await settle(HOVER_PREVIEW_DWELL_MS + 50)
    expect(preview()).toBe('Preview of Bob')
    over(cell(el, 1), pill)
    await settle(HOVER_PREVIEW_DWELL_MS + 50)
    expect(preview()).toBe('Preview of Alpha')
  })

  it('with the hover off, the pill shows nothing', async () => {
    const { el } = mount(TABLE, { ...on, hoverPreview: false })
    over(pills(cell(el, 1))[0], cell(el, 1))
    await settle(HOVER_PREVIEW_DWELL_MS + 50)
    expect(preview()).toBeNull()
  })
})

describe('D48: a text value with an inline link', () => {
  it('renders as text and a pill', () => {
    const { el } = mount(TABLE)
    const text = cell(el, 3)
    expect(text.textContent).toBe('see Bob now')
    expect(pills(text).map((p) => [p.textContent, p.dataset.linkPath])).toEqual([['Bob', BOB]])
  })

  it('the text editor completes `[[`', () => {
    const { el } = mount(TABLE)
    act(() => void cell(el, 3).dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    const field = el.querySelector<HTMLInputElement>('[data-editing] input')!
    input(field, 'see [[Car')
    expect([...el.querySelectorAll('[role="option"]')].map((o) => o.textContent)).toEqual(['Carol'])
  })
})

describe('D49: one picker with notes and folders', () => {
  it('the link editor offers the folders too', () => {
    const { el } = mount(TABLE)
    act(() => void cell(el, 1).dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    const field = el.querySelector<HTMLInputElement>('[data-editing] input')!
    input(field, '[[Peo')
    expect([...el.querySelectorAll('[role="option"]')].map((o) => o.textContent)).toEqual(['People (folder)'])
  })
})
