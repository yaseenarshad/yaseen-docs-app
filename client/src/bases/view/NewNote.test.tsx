/**
 * "New" button (5D, GRO-2144): BaseView mounted with react-dom in jsdom over `TEST_RECORDS`,
 * `createNewNote` mocked (derivation runs for real). The toolbar's New creates `Untitled.md`
 * in the view's folder with the filter-derived seed and opens it; the per-group "+" on a
 * grouped table section / board column also seeds the group's value (acceptance: filter
 * `status == "idea"` grouped by `pillar`, create in "Agentic Agency" → BOTH keys, and the
 * note lands in that group once the index delivers it). A failed create shows an inline
 * error and opens nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord, RegistryResponse } from '@shared/types'
import { parseBase, type ParsedBase } from '../baseFile'
import { BaseView, type BaseViewProps } from '../BaseView'
import { TEST_RECORDS } from '../testRecords'

vi.mock('../newNote', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../newNote')>()),
  createNewNote: vi.fn(),
}))
import { createNewNote } from '../newNote'

const create = vi.mocked(createNewNote)

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const IDEA_TABLE = `views:
  - type: table
    name: T
    order:
      - file.name
    filters:
      and:
        - status == "idea"
`

const ACCEPTANCE_TABLE = `${IDEA_TABLE}    groupBy:
      property: note.pillar
`

const FOLDER_TABLE = `views:
  - type: table
    name: T
    order:
      - file.name
    filters:
      and:
        - file.inFolder("Content Pillars/1. Agentic Agency")
`

const PRIORITY_BOARD = `views:
  - type: board
    name: B
    order:
      - file.name
    groupBy:
      property: note.priority
`

const BASE_FILE = '/vault/Bases/Content.base'

/** The created note as the next index refetch would deliver it. */
const created = (path: string, properties: Record<string, unknown>): IndexRecord => ({
  path,
  name: path.split('/').pop()!,
  basename: path.split('/').pop()!.replace(/\.md$/, ''),
  folder: path.slice('/vault/'.length, path.lastIndexOf('/')),
  ext: 'md',
  size: 0,
  ctime: 0,
  mtime: 0,
  properties,
  tags: [],
  links: [],
  embeds: [],
})

let root: Root | null = null
let container: HTMLElement | null = null
let draw: () => void = () => {}

function mount(text: string, props: Partial<BaseViewProps> = {}) {
  let parsed = parseBase(text)
  let records: IndexRecord[] = TEST_RECORDS
  const onOpenFile = vi.fn()
  const onChange = vi.fn((next: ParsedBase) => {
    parsed = next
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  draw = () =>
    act(() =>
      root?.render(
        <BaseView
          parsed={parsed}
          onChange={onChange}
          root="/vault"
          thisFile={BASE_FILE}
          records={records}
          indexStatus="ready"
          onOpenFile={onOpenFile}
          {...props}
        />,
      ),
    )
  draw()
  const el = container
  return {
    el,
    onOpenFile,
    /** Simulates the watcher-driven index refetch: a fresh records array re-rendered in. */
    setRecords: (next: IndexRecord[]) => {
      records = next
      draw()
    },
  }
}

beforeEach(() => {
  create.mockReset()
  create.mockResolvedValue(undefined)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

// ---------- DOM helpers ----------

function q<T extends Element>(el: ParentNode, sel: string): T {
  const n = el.querySelector<T>(sel)
  if (n === null) throw new Error(`missing ${sel}`)
  return n
}

const byLabel = <T extends HTMLElement>(el: ParentNode, label: string): T => q<T>(el, `[aria-label="${label}"]`)

function click(el: Element): void {
  act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  draw()
}

/** Settle the createNewNote promise so open/error state lands. */
async function flush(): Promise<void> {
  await act(async () => {})
  draw()
}

/** Grouped table as `{ 'group label': [row names] }`, in document order. */
function tableSections(el: ParentNode): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  let current = ''
  for (const tr of el.querySelectorAll('tbody tr')) {
    if (tr.classList.contains('base-table__group')) {
      current = q(tr, '.base-group__value').textContent ?? ''
      out[current] = []
    } else if (!tr.classList.contains('base-table__spacer')) {
      out[current]?.push(q(tr, '.base-table__link').textContent ?? '')
    }
  }
  return out
}

// ---------- tests ----------

describe('toolbar New', () => {
  it('creates Untitled.md in the base folder with the filter-derived seed, then opens it', async () => {
    const { el, onOpenFile } = mount(IDEA_TABLE)

    click(byLabel(el, 'New note'))
    await flush()

    expect(create).toHaveBeenCalledWith('/vault/Bases/Untitled.md', { status: 'idea' })
    expect(onOpenFile).toHaveBeenCalledWith('/vault/Bases/Untitled.md')
  })

  it('a single file.inFolder filter names the folder; taken names bump to Untitled 2', async () => {
    const dir = '/vault/Content Pillars/1. Agentic Agency'
    const { el } = mount(FOLDER_TABLE, { records: [...TEST_RECORDS, created(`${dir}/Untitled.md`, {})] })

    click(byLabel(el, 'New note'))

    expect(create).toHaveBeenCalledWith(`${dir}/Untitled 2.md`, {})
  })

  it('a failed create shows an inline error and opens nothing', async () => {
    create.mockRejectedValue(new Error('disk full'))
    const { el, onOpenFile } = mount(IDEA_TABLE)

    click(byLabel(el, 'New note'))
    await flush()

    expect(q(el, '[role="alert"]').textContent).toContain('disk full')
    expect(onOpenFile).not.toHaveBeenCalled()
  })
})

describe('registry scaffold upgrade (Bible B, GRO-2202)', () => {
  const KPI_TABLE = `filters:
  and:
    - page_type == "kpi"
views:
  - type: table
    name: T
    order:
      - file.name
`

  const REGISTRY: RegistryResponse = {
    root: '/vault',
    version: 1,
    properties: {},
    types: {
      kpi: {
        displayName: 'KPI',
        pluralName: 'KPIs',
        properties: {
          funnel_stages: { kind: 'multi-link', target: 'funnel-stage' },
          kpi_category: { kind: 'text' },
          unit: { kind: 'text' },
        },
      },
    },
  }

  /** The template read rides the real `api.readFile`; stub just that bridge surface. */
  function installReadFile(template: string | null) {
    const readFile = vi.fn(async (path: string) => {
      if (template === null) throw { code: 'NOT_FOUND', message: 'path does not exist' }
      return { path, content: template, mtime: 1, size: template.length }
    })
    Object.defineProperty(window, 'yaseenDocs', { value: { readFile }, configurable: true, writable: true })
    return readFile
  }

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).yaseenDocs
  })

  it('a view pinned to a REGISTERED type creates the full registry scaffold (page_type + declared properties, empty)', async () => {
    const readFile = installReadFile(null)
    const { el, onOpenFile } = mount(KPI_TABLE, { registry: REGISTRY })

    click(byLabel(el, 'New note'))
    await flush()

    expect(readFile).toHaveBeenCalledWith('/vault/.yaseendocs/templates/kpi.md')
    expect(create).toHaveBeenCalledWith('/vault/Bases/Untitled.md', { page_type: 'kpi', funnel_stages: [], kpi_category: null, unit: null }, '')
    expect(onOpenFile).toHaveBeenCalledWith('/vault/Bases/Untitled.md')
  })

  it('a template overrides scaffold values key-by-key and contributes the body', async () => {
    installReadFile('---\nkpi_category: leading\n---\nStart here.\n')
    const { el } = mount(KPI_TABLE, { registry: REGISTRY })

    click(byLabel(el, 'New note'))
    await flush()

    expect(create).toHaveBeenCalledWith(
      '/vault/Bases/Untitled.md',
      { page_type: 'kpi', funnel_stages: [], kpi_category: 'leading', unit: null },
      'Start here.\n',
    )
  })

  it('a pinned but UNREGISTERED type keeps the plain filter-derived seed', async () => {
    const readFile = installReadFile(null)
    const { el } = mount(KPI_TABLE, { registry: { ...REGISTRY, types: {} } })

    click(byLabel(el, 'New note'))
    await flush()

    expect(readFile).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledWith('/vault/Bases/Untitled.md', { page_type: 'kpi' })
  })
})

describe('New inside a group', () => {
  it('acceptance: status == "idea" grouped by pillar, create in "Agentic Agency" → both keys, lands in the group', async () => {
    const { el, onOpenFile, setRecords } = mount(ACCEPTANCE_TABLE)

    click(byLabel(el, 'New note in group Agentic Agency'))
    await flush()

    expect(create).toHaveBeenCalledWith('/vault/Bases/Untitled.md', { status: 'idea', pillar: 'Agentic Agency' })
    expect(onOpenFile).toHaveBeenCalledWith('/vault/Bases/Untitled.md')

    setRecords([...TEST_RECORDS, created('/vault/Bases/Untitled.md', { status: 'idea', pillar: 'Agentic Agency' })])
    expect(tableSections(el)['Agentic Agency']).toContain('Untitled.md')
  })

  it('a board column seeds the group value with its YAML type preserved', () => {
    const { el } = mount(PRIORITY_BOARD)

    click(byLabel(el, 'New note in group 2'))

    expect(create).toHaveBeenCalledWith('/vault/Bases/Untitled.md', { priority: 2 })
  })

  it('the "No value" group seeds nothing for the groupBy key', () => {
    const { el } = mount(PRIORITY_BOARD)

    click(byLabel(el, 'New note in group No value'))

    expect(create).toHaveBeenCalledWith('/vault/Bases/Untitled.md', {})
  })
})
