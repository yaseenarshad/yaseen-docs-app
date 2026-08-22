/**
 * The React half of a `base` code block (6B, GRO-2146): mounted with react-dom in jsdom,
 * `api` mocked (index for the records; the YAML arrives as a prop — no resolution). The
 * rendered block shows the SAME rows as an equivalent `.base` file (parity with `runView`),
 * `this` = the containing note, the toggle flips to a raw-YAML editing surface whose edits
 * commit through `onCommit`, toggling back re-parses and re-renders, and invalid YAML shows
 * the inline error with the toggle (and the raw text) still reachable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { WatchSource } from '../../hooks/useWatch'
import { parseBase } from '../../bases/baseFile'
import { runView } from '../../bases/engine'
import { render } from '../../bases/expr'
import { TEST_RECORDS } from '../../bases/testRecords'
import { BaseCodeBlock } from './BaseCodeBlock'

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  api: { index: vi.fn() },
}))

import { api } from '../../api'

const indexFn = vi.mocked(api.index)

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const ROOT = '/vault'
/** The containing note; `List of Topics` and `The Levels of an Agency` link to it (testRecords). */
const NOTE = '/vault/Content Pillars/1. Agentic Agency/Agentic Agency.md'

const YAML = `views:
  - type: table
    name: All
    order:
      - file.name
      - note.status
  - type: table
    name: Linked
    filters: file.hasLink(this)
    order:
      - file.name`

let root: Root | null = null
let container: HTMLElement | null = null

const watch: WatchSource = { subscribe: () => () => {} }

beforeEach(() => {
  vi.clearAllMocks()
  indexFn.mockResolvedValue({ root: ROOT, records: TEST_RECORDS, generatedAt: 0 })
})

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = null
  container = null
})

const commits: string[] = []

/** Mirrors CrepeHost's wiring: the committed text feeds back in as the `text` prop. */
function Harness({ initial }: { initial: string }) {
  const [text, setText] = useState(initial)
  return (
    <BaseCodeBlock
      root={ROOT}
      watch={watch}
      thisFile={NOTE}
      text={text}
      onCommit={(t) => {
        commits.push(t)
        setText(t)
      }}
      onOpenFile={vi.fn()}
    />
  )
}

async function mount(text: string): Promise<HTMLElement> {
  commits.length = 0
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<Harness initial={text} />)
  })
  // let the index fetch settle
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
  return container
}

const rowNames = (el: HTMLElement): string[] => [...el.querySelectorAll('.base-table__link')].map((b) => b.textContent ?? '')

function toggle(el: HTMLElement): HTMLButtonElement {
  const btn = el.querySelector('.base-code-block__toggle')
  expect(btn).not.toBeNull()
  return btn as HTMLButtonElement
}

function editSource(ta: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(ta, value)
  ta.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('BaseCodeBlock', () => {
  it('renders the same rows as an equivalent .base file', async () => {
    const el = await mount(YAML)
    const { def } = parseBase(YAML)
    const direct = runView(def, def.views[0], TEST_RECORDS, { thisFile: NOTE }).rows.map((r) => render(r.values['file.name']))
    expect(direct.length).toBe(TEST_RECORDS.length)
    expect(rowNames(el)).toEqual(direct)
  })

  it('`this` is the containing note: file.hasLink(this) filters from it', async () => {
    const el = await mount(YAML)
    const tabs = [...el.querySelectorAll('[role="tab"]')]
    expect(tabs.map((t) => t.textContent)).toEqual(['All', 'Linked'])
    await act(async () => {
      ;(tabs[1] as HTMLElement).click()
    })
    expect(rowNames(el)).toEqual(['The Levels of an Agency.md', 'List of Topics.md'])
  })

  it('chrome is read-only: view switcher only, no edit affordances', async () => {
    const el = await mount(YAML)
    expect(el.querySelector('.base-toolbar__new')).toBeNull()
    expect(el.querySelector('[aria-label="Filter"]')).toBeNull()
    expect(el.querySelector('[aria-label="Add view"]')).toBeNull()
    expect(el.querySelector('[data-edit]')).toBeNull()
  })

  it('the toggle shows the raw YAML; an edit commits and toggle-back re-renders with the change', async () => {
    const el = await mount(YAML)
    await act(async () => {
      toggle(el).click()
    })
    const ta = el.querySelector('.base-code-block__source') as HTMLTextAreaElement
    expect(ta).not.toBeNull()
    expect(ta.value).toBe(YAML)
    expect(el.querySelector('.base-table__link')).toBeNull()
    const edited = YAML.replace('name: All', 'name: Everything')
    await act(async () => {
      editSource(ta, edited)
    })
    expect(commits).toEqual([edited])
    await act(async () => {
      toggle(el).click()
    })
    const tabs = [...el.querySelectorAll('[role="tab"]')]
    expect(tabs.map((t) => t.textContent)).toEqual(['Everything', 'Linked'])
    expect(rowNames(el).length).toBe(TEST_RECORDS.length)
  })

  it('invalid YAML shows the inline error, never a crash, with the raw text behind the toggle', async () => {
    const el = await mount('views: [broken')
    const error = el.querySelector('.base-code-block__error')
    expect(error).not.toBeNull()
    expect(error?.getAttribute('role')).toBe('alert')
    await act(async () => {
      toggle(el).click()
    })
    const ta = el.querySelector('.base-code-block__source') as HTMLTextAreaElement
    expect(ta.value).toBe('views: [broken')
  })

  it('an invalid base definition (parseable YAML) shows the inline error too', async () => {
    const el = await mount('name: no views here')
    const error = el.querySelector('.base-code-block__error')
    expect(error).not.toBeNull()
    expect(error?.textContent).toMatch(/views/i)
  })

  it('fixing the YAML through the editing surface recovers the rendered view', async () => {
    const el = await mount('views: [broken')
    await act(async () => {
      toggle(el).click()
    })
    const ta = el.querySelector('.base-code-block__source') as HTMLTextAreaElement
    await act(async () => {
      editSource(ta, YAML)
    })
    await act(async () => {
      toggle(el).click()
    })
    expect(el.querySelector('.base-code-block__error')).toBeNull()
    expect(rowNames(el).length).toBe(TEST_RECORDS.length)
  })
})
