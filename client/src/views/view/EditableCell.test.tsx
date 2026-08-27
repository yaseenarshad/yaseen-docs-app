/**
 * Inline cell editors (5B, GRO-2142): ViewsPane mounted with react-dom in jsdom over
 * `TEST_RECORDS`, `writeProperty` mocked. Each editor type (text, number, checkbox, date,
 * list, link) commits the correctly-typed YAML value on Enter and blur, Esc cancels without
 * a write, `file.*` / `formula.*` cells stay read-only, cells update optimistically and
 * revert with an inline error when the write fails, and the link editor completes `[[…]]`
 * from index basenames.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { parseViews, type ParsedViews } from '../viewSchema'
import { ViewsPane, type ViewsPaneProps } from '../ViewsPane'
import { testFolderPage } from '../testFolderPage'
import { TEST_RECORDS } from '../testRecords'

vi.mock('../writeProperty', () => ({ writeProperty: vi.fn() }))
import { writeProperty } from '../writeProperty'

const write = vi.mocked(writeProperty)

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** YAZ-846: `folderPage` is required — the contents block is the only mount there is. */
const FOLDER_PAGE = testFolderPage()

/** file.name plus one column per editor type, and a read-only formula column. */
const EDIT_BASE = `views:
  - type: table
    name: T
    order:
      - file.name
      - note.status
      - note.priority
      - note.published
      - note.date
      - note.tags
      - note.related
      - formula.nope
`

const AGENTIC = '/vault/Content Pillars/1. Agentic Agency/Agentic Agency.md'
const LEVELS = '/vault/Content Pillars/1. Agentic Agency/The Levels of an Agency.md'

let root: Root | null = null
let container: HTMLElement | null = null
let draw: () => void = () => {}

function mount(text: string, props: Partial<ViewsPaneProps> = {}) {
  let parsed = parseViews(text)
  const onOpenFile = vi.fn()
  const onChange = vi.fn((next: ParsedViews) => {
    parsed = next
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  draw = () =>
    act(() =>
      root?.render(
        <ViewsPane
          parsed={parsed}
          onChange={onChange}
          root={null}
          thisFile={null}
          records={TEST_RECORDS}
          folderPage={FOLDER_PAGE}
          onOpenFile={onOpenFile}
          {...props}
        />,
      ),
    )
  draw()
  const el = container
  return { el, onChange, onOpenFile }
}

beforeEach(() => {
  write.mockReset()
  write.mockResolvedValue({ mtime: 1 })
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
  act(() => (el as HTMLElement).click())
  draw()
}

/** Native prototype setter + bubbling event, so React's value tracker sees the change. */
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

/** React maps onBlur onto the delegated focusout event. */
function blur(el: Element): void {
  act(() => el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
  draw()
}

/** Settle the writeProperty promise so success/failure state lands. */
async function flush(): Promise<void> {
  await act(async () => {})
  draw()
}

const cell = (el: ParentNode, r: number, c: number) => q<HTMLElement>(el, `[data-cell="${r}:${c}"]`)
/** Open a table editor through its public whole-cell activation boundary. */
const open = (el: ParentNode, r: number, c: number) => click(cell(el, r, c))

// ---------- tests ----------

describe('text editor', () => {
  it('Enter commits the string through writeProperty, optimistically updates and refocuses the cell', () => {
    const { el } = mount(EDIT_BASE)
    open(el, 0, 1) // status: idea
    const input = byLabel<HTMLInputElement>(el, 'Edit status')
    expect(input.value).toBe('idea')
    setValue(input, 'done')
    press(input, 'Enter')
    expect(write).toHaveBeenCalledExactlyOnceWith(AGENTIC, 'status', 'done')
    expect(el.querySelector('[aria-label="Edit status"]')).toBeNull()
    expect(cell(el, 0, 1).textContent).toBe('done')
    expect(document.activeElement).toBe(cell(el, 0, 1))
  })

  it('blur commits too; committing the unchanged value never writes', () => {
    const { el } = mount(EDIT_BASE)
    open(el, 0, 1)
    const input = byLabel<HTMLInputElement>(el, 'Edit status')
    setValue(input, 'parked')
    blur(input)
    expect(write).toHaveBeenCalledExactlyOnceWith(AGENTIC, 'status', 'parked')

    open(el, 1, 1) // status: drafting, left as-is
    press(byLabel(el, 'Edit status'), 'Enter')
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('Esc cancels without a write and restores the display', () => {
    const { el } = mount(EDIT_BASE)
    open(el, 0, 1)
    const input = byLabel<HTMLInputElement>(el, 'Edit status')
    setValue(input, 'nope')
    press(input, 'Escape')
    expect(write).not.toHaveBeenCalled()
    expect(el.querySelector('[aria-label="Edit status"]')).toBeNull()
    expect(cell(el, 0, 1).textContent).toBe('idea')
  })
})

describe('typed commits', () => {
  it('the number editor commits a YAML number, not a string', () => {
    const { el } = mount(EDIT_BASE)
    open(el, 0, 2) // priority: 2
    const input = byLabel<HTMLInputElement>(el, 'Edit priority')
    expect(input.type).toBe('number')
    setValue(input, '5')
    press(input, 'Enter')
    expect(write).toHaveBeenCalledExactlyOnceWith(AGENTIC, 'priority', 5)
  })

  it('the checkbox toggles and commits a boolean in one click', () => {
    const { el } = mount(EDIT_BASE)
    const box = q<HTMLInputElement>(cell(el, 0, 3), 'input[type="checkbox"]') // published: false
    expect(box.disabled).toBe(false)
    click(cell(el, 0, 3))
    expect(write).toHaveBeenCalledExactlyOnceWith(AGENTIC, 'published', true)
    expect(q<HTMLInputElement>(cell(el, 0, 3), 'input[type="checkbox"]').checked).toBe(true)
  })

  it('the date editor is a native date input committing the ISO string', () => {
    const { el } = mount(EDIT_BASE)
    open(el, 0, 4) // date: 2026-08-01
    const input = byLabel<HTMLInputElement>(el, 'Edit date')
    expect(input.type).toBe('date')
    setValue(input, '2026-09-01')
    press(input, 'Enter')
    expect(write).toHaveBeenCalledExactlyOnceWith(AGENTIC, 'date', '2026-09-01')
  })
})

describe('list editor', () => {
  it('adds a chip per Enter and commits the YAML array on an empty Enter', () => {
    const { el } = mount(EDIT_BASE)
    open(el, 0, 5) // tags: [agentic, pillar]
    const input = byLabel<HTMLInputElement>(el, 'Edit tags')
    setValue(input, 'new')
    press(input, 'Enter')
    expect(write).not.toHaveBeenCalled()
    press(input, 'Enter')
    expect(write).toHaveBeenCalledExactlyOnceWith(AGENTIC, 'tags', ['agentic', 'pillar', 'new'])
    expect([...cell(el, 0, 5).querySelectorAll('.view-table__chip')].map((c) => c.textContent)).toEqual([
      'agentic',
      'pillar',
      'new',
    ])
  })

  it('keeps commas inside one free-form item', () => {
    const { el } = mount(EDIT_BASE)
    open(el, 0, 5)
    const input = byLabel<HTMLInputElement>(el, 'Edit tags')
    setValue(input, 'alpha,beta')
    press(input, 'Enter')
    press(input, 'Enter')
    expect(write).toHaveBeenCalledExactlyOnceWith(AGENTIC, 'tags', ['agentic', 'pillar', 'alpha,beta'])
  })

  it('removes chips, commits on blur and cancels on Esc', () => {
    const { el } = mount(EDIT_BASE)
    open(el, 0, 5)
    click(byLabel(el, 'Remove agentic'))
    blur(byLabel(el, 'Edit tags'))
    expect(write).toHaveBeenCalledExactlyOnceWith(AGENTIC, 'tags', ['pillar'])

    open(el, 1, 5) // tags: [agentic/levels]
    click(byLabel(el, 'Remove agentic/levels'))
    press(byLabel(el, 'Edit tags'), 'Escape')
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('a numeric-list cell opened and blurred untouched never writes (chips stringify on seed)', () => {
    // committing the unchanged value never writes — even when the seed lost the types ([1, 2] → ['1', '2'])
    const records = TEST_RECORDS.map((r) =>
      r.path === AGENTIC ? { ...r, properties: { ...r.properties, nums: [1, 2] } } : r,
    )
    const { el } = mount('views:\n  - type: table\n    name: T\n    order:\n      - file.name\n      - note.nums\n', {
      records,
    })
    open(el, 0, 1)
    blur(byLabel(el, 'Edit nums'))
    expect(write).not.toHaveBeenCalled()
    expect(el.querySelector('[aria-label="Edit nums"]')).toBeNull()
  })
})

describe('link editor', () => {
  it('completes [[…]] from index basenames and commits the wikilink string', () => {
    const { el } = mount(EDIT_BASE)
    open(el, 1, 6) // related: [[Agentic Agency]]
    const input = byLabel<HTMLInputElement>(el, 'Edit related')
    expect(input.value).toBe('[[Agentic Agency]]')
    setValue(input, '[[Cre')
    const options = [...el.querySelectorAll('[role="option"]')].map((o) => o.textContent)
    expect(options).toEqual(['Creator Economy'])
    click(q(el, '[role="option"]'))
    expect(byLabel<HTMLInputElement>(el, 'Edit related').value).toBe('[[Creator Economy]]')
    press(byLabel(el, 'Edit related'), 'Enter')
    expect(write).toHaveBeenCalledExactlyOnceWith(LEVELS, 'related', '[[Creator Economy]]')
  })

  it('Enter picks the highlighted suggestion first, then commits', () => {
    const { el } = mount(EDIT_BASE)
    open(el, 1, 6)
    const input = byLabel<HTMLInputElement>(el, 'Edit related')
    setValue(input, '[[Gold')
    press(input, 'Enter') // completes to [[The Gold In Your Archive]]
    expect(write).not.toHaveBeenCalled()
    expect(byLabel<HTMLInputElement>(el, 'Edit related').value).toBe('[[The Gold In Your Archive]]')
    press(byLabel(el, 'Edit related'), 'Enter')
    expect(write).toHaveBeenCalledExactlyOnceWith(LEVELS, 'related', '[[The Gold In Your Archive]]')
  })
})

describe('read-only cells', () => {
  it('file.* and formula.* cells have no editor', () => {
    const { el, onOpenFile } = mount(EDIT_BASE)
    expect(cell(el, 0, 0).querySelector('[data-edit]')).toBeNull() // file.name keeps its open link
    expect(cell(el, 0, 7).querySelector('[data-edit]')).toBeNull() // formula.nope
    act(() => cell(el, 0, 7).focus())
    press(cell(el, 0, 7), 'Enter')
    expect(cell(el, 0, 7).querySelector('input')).toBeNull()
    expect(write).not.toHaveBeenCalled()
    expect(onOpenFile).not.toHaveBeenCalled()
  })
})

describe('keyboard flow', () => {
  it('Enter on a focused editable cell starts editing (4B nav intact)', () => {
    const { el } = mount(EDIT_BASE)
    act(() => cell(el, 0, 1).focus())
    press(cell(el, 0, 1), 'Enter')
    expect(el.querySelector('[aria-label="Edit status"]')).not.toBeNull()
  })
})

describe('failed writes', () => {
  it('reverts the optimistic value and shows an inline error', async () => {
    write.mockRejectedValueOnce(new Error('disk on fire'))
    const { el } = mount(EDIT_BASE)
    open(el, 0, 1)
    const input = byLabel<HTMLInputElement>(el, 'Edit status')
    setValue(input, 'done')
    press(input, 'Enter')
    expect(cell(el, 0, 1).textContent).toBe('done') // optimistic
    await flush()
    const err = q<HTMLElement>(cell(el, 0, 1), '[role="alert"]')
    expect(err.title).toBe('disk on fire')
    expect(cell(el, 0, 1).textContent).toContain('idea') // restored
  })
})

// The rung-3 case that stood here — an explicit `.obsidian/types.json` assignment beating the
// value type — went with the `types` prop in YAZ-846, and ⚡ YAZ-815 then deleted the rung and the
// whole chain behind it. The ladder that remains is unit-tested rung by rung in
// `editorType.test.ts`.
describe('type inference wiring', () => {
  it('a note without the key borrows the dominant type across the view', () => {
    const { el } = mount(EDIT_BASE)
    open(el, 3, 2) // The Gold In Your Archive has no priority; 2, 1, 3 elsewhere
    expect(byLabel<HTMLInputElement>(el, 'Edit priority').type).toBe('number')
  })
})

describe('cards and list property chips', () => {
  it('a card property commits through the same editor', () => {
    const { el } = mount('views:\n  - type: cards\n    name: C\n    order:\n      - file.name\n      - note.status\n')
    click(q(el, '.view-card__prop-value [data-edit]'))
    const input = byLabel<HTMLInputElement>(el, 'Edit status')
    setValue(input, 'done')
    press(input, 'Enter')
    expect(write).toHaveBeenCalledExactlyOnceWith(AGENTIC, 'status', 'done')
  })

  it('a list item property commits through the same editor', () => {
    const { el } = mount(
      'views:\n  - type: list\n    name: L\n    indentProperties: true\n    order:\n      - file.name\n      - note.status\n',
    )
    click(q(el, '.view-list__prop-value [data-edit]'))
    const input = byLabel<HTMLInputElement>(el, 'Edit status')
    setValue(input, 'done')
    press(input, 'Enter')
    expect(write).toHaveBeenCalledExactlyOnceWith(AGENTIC, 'status', 'done')
  })
})
