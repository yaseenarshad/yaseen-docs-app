/**
 * The React half of a base embed (6A, GRO-2145): mounted with react-dom in jsdom, `api` mocked
 * (tree for resolution, readFile for the `.base`, index for the records). The embed renders the
 * SAME rows as opening the base directly (parity with `runView`), `#View` picks the initial view,
 * `this` = the embedding note, chrome is read-only (view switcher only), and a missing target
 * shows the inline "base not found" affordance.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { WatchListener, WatchSource } from '../../hooks/useWatch'
import { parseBase } from '../../bases/baseFile'
import { runView } from '../../bases/engine'
import { render } from '../../bases/expr'
import { TEST_RECORDS } from '../../bases/testRecords'
import { BaseEmbed } from './BaseEmbed'

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  api: { tree: vi.fn(), readFile: vi.fn(), index: vi.fn() },
}))

import { api } from '../../api'

const tree = vi.mocked(api.tree)
const readFile = vi.mocked(api.readFile)
const indexFn = vi.mocked(api.index)

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const ROOT = '/vault'
const BASE_PATH = '/vault/Bases/Topics.base'
/** The embedding note; `List of Topics` and `The Levels of an Agency` link to it (testRecords). */
const NOTE = '/vault/Content Pillars/1. Agentic Agency/Agentic Agency.md'

const BASE = `views:
  - type: table
    name: All
    order:
      - file.name
      - note.status
  - type: table
    name: Linked
    filters: file.hasLink(this)
    order:
      - file.name
`

let root: Root | null = null
let container: HTMLElement | null = null
let listeners: WatchListener[] = []

const watch: WatchSource = {
  subscribe: (l) => {
    listeners.push(l)
    return () => {
      listeners = listeners.filter((x) => x !== l)
    }
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  listeners = []
  tree.mockResolvedValue({
    root: ROOT,
    generatedAt: 0,
    tree: [
      {
        type: 'dir',
        name: 'Bases',
        path: '/vault/Bases',
        children: [{ type: 'file', name: 'Topics.base', path: BASE_PATH, size: 1, mtime: 1, kind: 'base' }],
      },
    ],
  })
  readFile.mockResolvedValue({ path: BASE_PATH, content: BASE, mtime: 1, size: BASE.length })
  indexFn.mockResolvedValue({ root: ROOT, records: TEST_RECORDS, generatedAt: 0 })
})

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = null
  container = null
})

async function mount(props: Partial<Parameters<typeof BaseEmbed>[0]> = {}): Promise<HTMLElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      <BaseEmbed root={ROOT} watch={watch} thisFile={NOTE} target="Topics.base" viewName={null} onOpenFile={vi.fn()} {...props} />,
    )
  })
  // let resolution (tree → readFile) and the index fetch settle
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
  return container
}

const rowNames = (el: HTMLElement): string[] => [...el.querySelectorAll('.base-table__link')].map((b) => b.textContent ?? '')

describe('BaseEmbed', () => {
  it('renders the same rows as opening the base directly', async () => {
    const el = await mount()
    const { def } = parseBase(BASE)
    const direct = runView(def, def.views[0], TEST_RECORDS, { thisFile: NOTE }).rows.map((r) => render(r.values['file.name']))
    expect(direct.length).toBe(TEST_RECORDS.length)
    expect(rowNames(el)).toEqual(direct)
  })

  it('#View picks the named view, and `this` is the embedding note', async () => {
    const el = await mount({ viewName: 'Linked' })
    const linked = el.querySelector('[role="tab"][aria-selected="true"]')
    expect(linked?.textContent).toContain('Linked')
    // file.hasLink(this) with this = the embedding note: exactly its two backlinks
    expect(rowNames(el)).toEqual(['The Levels of an Agency.md', 'List of Topics.md'])
  })

  it('a missing target shows the inline "base not found" affordance', async () => {
    const el = await mount({ target: 'Missing.base' })
    expect(el.textContent).toMatch(/base not found/i)
    expect(el.querySelector('.base-table__link')).toBeNull()
    expect(readFile).not.toHaveBeenCalled()
  })

  it('chrome is read-only: view switcher only, no edit affordances', async () => {
    const el = await mount()
    // the view switcher is there and works
    const tabs = [...el.querySelectorAll('[role="tab"]')]
    expect(tabs.map((t) => t.textContent)).toEqual(['All', 'Linked'])
    await act(async () => {
      ;(tabs[1] as HTMLElement).click()
    })
    expect(rowNames(container as HTMLElement)).toEqual(['The Levels of an Agency.md', 'List of Topics.md'])
    // no New / Filter / Sort / Properties / Search, no add-view, no view menu, no cell editing
    expect(el.querySelector('.base-toolbar__new')).toBeNull()
    expect(el.querySelector('[aria-label="Filter"]')).toBeNull()
    expect(el.querySelector('[aria-label="Sort"]')).toBeNull()
    expect(el.querySelector('[aria-label="Properties"]')).toBeNull()
    expect(el.querySelector('[aria-label="Search"]')).toBeNull()
    expect(el.querySelector('[aria-label="Add view"]')).toBeNull()
    expect(el.querySelector('[aria-label="View menu"]')).toBeNull()
    expect(el.querySelector('[data-edit]')).toBeNull()
    expect(el.querySelector('.base-table__resize')).toBeNull()
  })
})
