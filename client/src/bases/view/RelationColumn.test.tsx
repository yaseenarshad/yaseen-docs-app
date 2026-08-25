/**
 * Relation columns end to end (5E, GRO-2217; contract GRO-2120 comment 73479ea3 §4–§5), after
 * YAZ-836 deleted the type system: the Properties menu's relation editor saves `{kind, target}`
 * through `registry.setProperty` to the VAULT properties — always, whatever the view filters on,
 * and with no type-name suggestions behind the target field; the cell's link picker narrows to
 * the pages of the FOLDER PAGE the target names (`belongsToBasenames`, successor to the deleted
 * type-keyed helper), falling back to all pages when it names none; multi-link is the chips
 * editor with the same constrained suggestions committing a list of `[[…]]` strings — values
 * keep going through `writeProperty`, one direction only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord, RegistryResponse } from '@shared/types'
import { parseBase, type ParsedBase } from '../baseFile'
import { BaseView, type BaseViewProps } from '../BaseView'
import { registryStub, resetRegistryStub } from '../registryStub'

vi.mock('../writeProperty', () => ({ writeProperty: vi.fn() }))
import { writeProperty } from '../writeProperty'

const write = vi.mocked(writeProperty)

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const rec = (path: string, properties: Record<string, unknown>): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return {
    path,
    name,
    basename: name.replace(/\.md$/, ''),
    folder: path.slice(7, path.lastIndexOf('/')),
    ext: 'md',
    size: 0,
    ctime: 0,
    mtime: 0,
    properties,
    aliases: [],
    tags: [],
    links: [],
    embeds: [],
  }
}

const REVENUE = '/vault/KPIs/Revenue.md'
const CHURN = '/vault/KPIs/Churn.md'

/**
 * Two folder pages (`People`, `Funnels`) with members naming them, plus the two KPI rows the
 * table shows. `page_type` rides along as ORDINARY frontmatter — it is what `KPI_BASE` filters
 * on, and nothing in the client reads it as an identity any more (YAZ-836).
 */
const RECORDS: IndexRecord[] = [
  rec(REVENUE, { page_type: 'kpi', owner: '[[Alice]]' }),
  rec(CHURN, { page_type: 'kpi' }),
  rec('/vault/People.md', { folder_page: true }),
  rec('/vault/Funnels.md', { folder_page: true }),
  rec('/vault/Funnels/Signup.md', { folder_pages: ['[[Funnels]]'] }),
  rec('/vault/Funnels/Retention.md', { folder_pages: ['[[Funnels]]'] }),
  rec('/vault/People/Alice.md', { folder_pages: ['[[People]]'] }),
  rec('/vault/People/Bob.md', { folder_pages: ['[[People]]'] }),
]

/** Every basename, in record order — what an unnarrowed picker offers. */
const ALL_NAMES = ['Revenue', 'Churn', 'People', 'Funnels', 'Signup', 'Retention', 'Alice', 'Bob']

const ORDER = '    order:\n      - file.name\n      - note.owner\n      - note.funnels\n'
const KPI_BASE = `filters: page_type == "kpi"\nviews:\n  - type: table\n    name: T\n${ORDER}`
const UNFILTERED_BASE = `views:\n  - type: table\n    name: T\n${ORDER}`

const EMPTY_REG: RegistryResponse = { root: '/vault', version: 0, types: {}, properties: {} }

/**
 * A registry declaring both relations VAULT-WIDE — the only scope left — targeting folder pages.
 * `types` stays empty: a type schema is never read (3A reshapes the response itself).
 */
const REG: RegistryResponse = {
  root: '/vault',
  version: 1,
  types: {},
  properties: {
    owner: { kind: 'link', target: 'People' },
    funnels: { kind: 'multi-link', target: 'Funnels' },
  },
}

let root: Root | null = null
let container: HTMLElement | null = null
let draw: () => void = () => {}

function mount(text: string, props: Partial<BaseViewProps> = {}) {
  let parsed = parseBase(text)
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
          thisFile={null}
          records={RECORDS}
          indexStatus="ready"
          registry={EMPTY_REG}
          onOpenFile={onOpenFile}
          {...props}
        />,
      ),
    )
  draw()
  const el = container
  return { el }
}

beforeEach(() => {
  write.mockReset()
  write.mockResolvedValue({ mtime: 1 })
  // GRO-2201 swapped `registry` to the real bridge; the 5E stub now plays the bridge in tests.
  Object.defineProperty(window, 'yaseenDocs', { value: { registry: registryStub }, configurable: true, writable: true })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  resetRegistryStub()
  delete (window as unknown as Record<string, unknown>).yaseenDocs
})

// ---------- DOM helpers (EditableCell.test.tsx style) ----------

function q<T extends Element>(el: ParentNode, sel: string): T {
  const n = el.querySelector<T>(sel)
  if (n === null) throw new Error(`missing ${sel}`)
  return n
}

const byLabel = <T extends HTMLElement>(el: ParentNode, label: string): T => q<T>(el, `[aria-label="${label}"]`)

function click(el: Element): void {
  act(() => (el as HTMLElement).click())
  draw()
}

function setValue(el: HTMLInputElement, value: string): void {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    set?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  draw()
}

function press(el: Element, key: string): void {
  act(() => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
  draw()
}

async function flush(): Promise<void> {
  await act(async () => {})
  draw()
}

const cell = (el: ParentNode, r: number, c: number) => q<HTMLElement>(el, `[data-cell="${r}:${c}"]`)
const open = (el: ParentNode, r: number, c: number) => click(q(cell(el, r, c), '[data-edit]'))
const options = (el: ParentNode) => [...el.querySelectorAll('[role="option"]')].map((o) => o.textContent)

/** Open the Properties popover and the relation editor for `key`. */
function openRelation(el: ParentNode, key: string) {
  click(byLabel(el, 'Properties'))
  click(byLabel(el, `Relation for ${key}`))
}

// ---------- tests ----------

describe('column menu relation flow', () => {
  it('a filtered view saves to the VAULT properties — the per-type scope is gone (YAZ-836)', async () => {
    const { el } = mount(KPI_BASE)
    openRelation(el, 'owner')
    expect(el.textContent).toContain('Saved to vault properties')
    setValue(byLabel<HTMLInputElement>(el, 'Target type'), 'People')
    click(byLabel(el, 'Save relation'))
    await flush()
    const res = await registryStub.get('/vault')
    expect(res.properties.owner).toEqual({ kind: 'link', target: 'People' })
    expect(res.types).toEqual({})
  })

  it('Multiple → multi-link, saved to vault properties and labelled so', async () => {
    const { el } = mount(UNFILTERED_BASE)
    openRelation(el, 'funnels')
    expect(el.textContent).toContain('Saved to vault properties')
    click(byLabel(el, 'Multiple'))
    setValue(byLabel<HTMLInputElement>(el, 'Target type'), 'Funnels')
    click(byLabel(el, 'Save relation'))
    await flush()
    const res = await registryStub.get('/vault')
    expect(res.properties.funnels).toEqual({ kind: 'multi-link', target: 'Funnels' })
    expect(res.types).toEqual({})
  })

  it('the target is free text with no suggestion list — the type-name datalist died with the types', () => {
    const { el } = mount(KPI_BASE, { registry: REG })
    openRelation(el, 'owner')
    expect(el.querySelector('datalist')).toBeNull()
    expect(byLabel<HTMLInputElement>(el, 'Target type').getAttribute('list')).toBeNull()
  })

  it('an existing declaration pre-fills the toggle and target', () => {
    const { el } = mount(KPI_BASE, { registry: REG })
    openRelation(el, 'funnels') // vault-wide multi-link → the Funnels folder page
    expect(byLabel<HTMLInputElement>(el, 'Multiple').checked).toBe(true)
    expect(byLabel<HTMLInputElement>(el, 'Target type').value).toBe('Funnels')
  })

  it('without a known root there is no relation editor to offer', () => {
    const { el } = mount(KPI_BASE, { root: null })
    click(byLabel(el, 'Properties'))
    expect(el.querySelector('[aria-label="Relation for owner"]')).toBeNull()
  })

  it('file.* rows never offer a relation; note.* rows do', () => {
    const { el } = mount(KPI_BASE)
    click(byLabel(el, 'Properties'))
    expect(el.querySelector('[aria-label^="Relation for file."]')).toBeNull()
    expect(el.querySelector('[aria-label="Relation for owner"]')).not.toBeNull()
  })
})

describe('constrained picker', () => {
  it('the link editor offers the target folder page\'s pages and commits the wiki-link through writeProperty', () => {
    const { el } = mount(KPI_BASE, { registry: REG })
    open(el, 1, 1) // Churn's empty owner cell — typed link by the registry alone
    const input = byLabel<HTMLInputElement>(el, 'Edit owner')
    setValue(input, '[[')
    expect(options(el)).toEqual(['Alice', 'Bob']) // the pages inside [[People]]
    click(q(el, '[role="option"]'))
    press(byLabel(el, 'Edit owner'), 'Enter')
    expect(write).toHaveBeenCalledExactlyOnceWith(CHURN, 'owner', '[[Alice]]')
  })

  it('a target naming no folder page falls back to ALL basenames — never an error', () => {
    // This is also the mid-wave degradation: targets still spelled as old TYPE names name no
    // folder page, so their columns widen to every page until 5.1 re-points them.
    const ghost: RegistryResponse = { ...REG, properties: { owner: { kind: 'link', target: 'person' } } }
    const { el } = mount(KPI_BASE, { registry: ghost })
    open(el, 1, 1)
    setValue(byLabel<HTMLInputElement>(el, 'Edit owner'), '[[')
    expect(options(el)).toEqual(ALL_NAMES)
  })
})

describe('multi-link cells', () => {
  it('the chips editor completes constrained suggestions and commits a LIST of [[…]] strings', () => {
    const { el } = mount(KPI_BASE, { registry: REG })
    open(el, 0, 2) // Revenue's empty funnels cell — multi-link vault-wide
    const input = byLabel<HTMLInputElement>(el, 'Edit funnels')
    setValue(input, '[[')
    expect(options(el)).toEqual(['Retention', 'Signup']) // the pages inside [[Funnels]], path-sorted
    setValue(byLabel<HTMLInputElement>(el, 'Edit funnels'), '[[Sig')
    press(byLabel(el, 'Edit funnels'), 'Enter') // completes to [[Signup]]
    expect(byLabel<HTMLInputElement>(el, 'Edit funnels').value).toBe('[[Signup]]')
    press(byLabel(el, 'Edit funnels'), 'Enter') // adds the chip
    press(byLabel(el, 'Edit funnels'), 'Enter') // empty input commits the list
    expect(write).toHaveBeenCalledExactlyOnceWith(REVENUE, 'funnels', ['[[Signup]]'])
  })

  it('Esc cancels without a write', () => {
    const { el } = mount(KPI_BASE, { registry: REG })
    open(el, 0, 2)
    press(byLabel(el, 'Edit funnels'), 'Escape')
    expect(write).not.toHaveBeenCalled()
  })
})

describe('round trip and degradation', () => {
  it('a relation value renders as a link chip, like any wiki-link property today', () => {
    const { el } = mount(KPI_BASE, { registry: REG })
    const chip = q<HTMLElement>(cell(el, 0, 1), '.base-table__chip--link')
    expect(chip.textContent).toBe('Alice')
  })

  it('a registry error string surfaces as an alert while typing degrades to inference', () => {
    const broken: RegistryResponse = { root: '/vault', version: 0, types: {}, properties: {}, error: 'types.json: bad JSON' }
    const { el } = mount(KPI_BASE, { registry: broken })
    expect([...el.querySelectorAll('[role="alert"]')].some((n) => n.textContent?.includes('types.json: bad JSON'))).toBe(true)
    open(el, 0, 1) // owner: [[Alice]] — value inference still gives the link editor
    expect(byLabel<HTMLInputElement>(el, 'Edit owner').value).toBe('[[Alice]]')
  })
})
