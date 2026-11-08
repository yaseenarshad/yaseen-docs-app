/**
 * The Undo toast for view changes (YAZ-4594 S29): hide a column, delete a view, remove a group level, unfreeze columns
 * or rows, and clear a fill each say so through the host's notice with the app's Undo (`fades: true`, the S6 pattern).
 * Undo writes the folder settings back as they were before, in ONE write. ViewsPane is mounted in jsdom over
 * `TEST_RECORDS`; `onChange` swaps in the new def as the host does.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Notice } from '../../lib/notice'
import { type ParsedViews, parseViews, serializeViews } from '../viewSchema'
import { type FolderHost, ViewsPane } from '../ViewsPane'
import { testFolderHost } from '../testFolderHost'
import { TEST_RECORDS } from '../testRecords'

// `getSettings`: a keydown that bubbles to the window reaches the Find bar's listener, which reads the hotkeys.
vi.mock('../../lib/storage', () => ({ storage: { getViewGroups: () => [], setViewGroups: () => undefined, getSettings: () => undefined } }))

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const TABLE = `views:
  - type: table
    name: T
    frozenColumns: 2
    frozenRows: 1
    order:
      - file.name
      - note.status
      - note.priority
    groupBy:
      property: note.status
    fills:
      - note: "[[Attribution]]"
        fill: pink
  - type: board
    name: B
`

let root: Root | null = null
let container: HTMLElement | null = null
let draw: () => void = () => {}

function mount(text = TABLE, over: Partial<FolderHost> = {}) {
  let parsed = parseViews(text)
  const onChange = vi.fn((next: ParsedViews) => {
    parsed = next
    draw()
  })
  const onNotice = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const folder = testFolderHost({ onNotice, ...over })
  draw = () => act(() => root?.render(<ViewsPane parsed={parsed} onChange={onChange} root="/vault" folderPath="/vault/pillars.md" records={TEST_RECORDS} folder={folder} onOpenFile={vi.fn()} />))
  draw()
  const el = container
  /** The last toast's text, after checking it is an Undo that fades. */
  const toast = (): string => {
    const [message, icon, type, action] = onNotice.mock.lastCall as [string, string, string, Notice['action']]
    expect([icon, type, action?.label, action?.fades]).toEqual(['info', 'undo', 'Undo', true])
    return message
  }
  /** Undo on the last toast: exactly one more write, and the def is back to `text`'s (a key put back may come last in the YAML). */
  const undo = () => {
    const writes = onChange.mock.calls.length
    const [, , , action] = onNotice.mock.lastCall as [string, string, string, Notice['action']]
    act(() => action!.run())
    expect(onChange).toHaveBeenCalledTimes(writes + 1)
    expect(parsed.def).toEqual(parseViews(text).def)
  }
  return { el, onChange, onNotice, toast, undo, yaml: () => serializeViews(parsed), def: () => parsed.def }
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

const q = <T extends Element>(el: ParentNode, sel: string): T => {
  const n = el.querySelector<T>(sel)
  if (n === null) throw new Error(`missing ${sel}`)
  return n
}
const click = (el: Element) => act(() => (el as HTMLElement).click())
const rightClick = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 40 })))
const item = (el: ParentNode, text: string): HTMLElement => {
  const n = [...el.querySelectorAll<HTMLElement>('.ctx-menu [role="menuitem"], .ctx-menu__sub [role="menuitem"]')].find((b) => b.textContent === text)
  if (n === undefined) throw new Error(`missing menu item ${text}`)
  return n
}
const header = (el: ParentNode, label: string): HTMLElement => [...el.querySelectorAll<HTMLElement>('.view-table thead th')].find((t) => t.textContent === label)!
const rowNamed = (el: ParentNode, name: string): HTMLElement =>
  [...el.querySelectorAll<HTMLElement>('.view-table tbody tr')].find((tr) => tr.querySelector('.view-table__name')?.textContent === name)!
/** A field's value through React's setter, then its `input` event, as the header menu's tests do. */
const setValue = (el: HTMLInputElement | HTMLSelectElement, value: string): void => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value)
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}
const press = (el: Element, key: string): void => act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))

describe('the Undo toast for view changes (YAZ-4594 S29)', () => {
  it('"Hide column" in the column menu: a toast, and Undo shows the column again in one write', () => {
    const { el, toast, undo, yaml } = mount()
    rightClick(header(el, 'Priority'))
    click(item(el, 'Hide column'))
    expect(yaml()).not.toContain('note.priority')
    expect(toast()).toBe('Hid Priority')
    undo()
  })

  it('a hide in the Properties menu offers Undo; a show does not', () => {
    const { el, onNotice, toast, undo } = mount()
    click(q(el, '[aria-label="Columns and view"]'))
    const box = q<HTMLInputElement>(el, '[aria-label="Show Priority"]')
    click(box)
    expect(toast()).toBe('Hid Priority')
    undo()
    click(q(el, '[aria-label="Show Priority"]'))
    click(q(el, '[aria-label="Show Priority"]'))
    expect(onNotice).toHaveBeenCalledTimes(2) // the second hide; the show between said nothing
  })

  it('"Delete" on a view tab: a toast, and Undo brings the view back in its place, active again', () => {
    const { el, toast, undo } = mount()
    rightClick(q(el, '[role="tab"]').closest('.view-tab')!)
    click(item(el, 'Delete'))
    click([...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === 'Delete')!)
    expect([...el.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(['B'])
    expect(toast()).toBe('Deleted view T')
    undo()
    expect([...el.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(['T', 'B'])
    expect(q(el, '[role="tab"][aria-selected="true"]').textContent).toBe('T')
  })

  it('"Remove this group level" in the column menu: a toast, and Undo groups again', () => {
    const { el, toast, undo, yaml } = mount()
    rightClick(header(el, 'Status'))
    click(item(el, 'Group'))
    click(item(el, 'Remove this group level'))
    expect(yaml()).not.toContain('groupBy')
    expect(toast()).toBe('Removed group level Status')
    undo()
  })

  it('"Unfreeze columns" and "Unfreeze rows": a toast each, and Undo freezes again; a freeze says nothing', () => {
    const { el, onNotice, toast, undo, yaml } = mount()
    rightClick(header(el, 'Priority'))
    click(item(el, 'Unfreeze columns'))
    expect(yaml()).not.toContain('frozenColumns')
    expect(toast()).toBe('Unfroze columns')
    undo()
    rightClick(q(rowNamed(el, 'Attribution'), 'td[data-cell]'))
    click(item(el, 'Unfreeze rows'))
    expect(yaml()).not.toContain('frozenRows')
    expect(toast()).toBe('Unfroze rows')
    undo()
    rightClick(header(el, 'Priority'))
    click(item(el, 'Freeze up to this column'))
    expect(onNotice).toHaveBeenCalledTimes(2)
  })

  it('"No fill": a toast, and Undo paints the fill again; No fill where there is none says nothing', () => {
    const { el, onNotice, toast, undo, yaml } = mount()
    rightClick(q(rowNamed(el, 'Attribution'), 'td[data-cell]'))
    click(item(el, 'Fill row'))
    click(item(el, 'No fill'))
    expect(yaml()).not.toContain('fills')
    expect(toast()).toBe('Cleared fill')
    undo()
    rightClick(q(rowNamed(el, 'Agentic Agency'), 'td[data-cell]'))
    click(item(el, 'Fill row'))
    click(item(el, 'No fill'))
    expect(onNotice).toHaveBeenCalledTimes(1)
  })

  it('a later Undo writes over the def that is current then: the settings exactly as they were before the hide', () => {
    const { el, onNotice, onChange, yaml, def } = mount()
    rightClick(header(el, 'Priority'))
    click(item(el, 'Hide column'))
    rightClick(header(el, 'Status'))
    click(item(el, 'Unfreeze columns'))
    expect(yaml()).not.toContain('frozenColumns')
    const [, , , action] = onNotice.mock.calls[0] as [string, string, string, Notice['action']]
    const writes = onChange.mock.calls.length
    act(() => action!.run())
    expect(onChange).toHaveBeenCalledTimes(writes + 1)
    expect(def()).toEqual(parseViews(TABLE).def)
  })
})

describe('the Undo toast also covers rename column, change column type and delete column (YAZ-4608 C6)', () => {
  it('"Rename column…" in the column menu: a toast names both labels, and Undo puts the label back', () => {
    const { el, toast, undo, yaml } = mount()
    rightClick(header(el, 'Priority'))
    click(item(el, 'Rename column…'))
    const field = q<HTMLInputElement>(el, '.ctx-menu input[aria-label="Rename Priority"]')
    setValue(field, 'Prio')
    press(field, 'Enter')
    expect(yaml()).toContain('displayName: Prio')
    expect(toast()).toBe('Renamed Priority to Prio')
    undo()
  })

  it('the column editor’s Display name: the same toast; an emptied name reads as the default label', () => {
    const { el, toast, undo, onNotice } = mount()
    click(q(el, '[aria-label="Columns and view"]'))
    click(q(el, '[aria-label="Open Priority"]'))
    const field = q<HTMLInputElement>(el, '[aria-label="Display name"]')
    setValue(field, 'Prio')
    press(field, 'Enter')
    expect(toast()).toBe('Renamed Priority to Prio')
    undo()
    // The same name again changes nothing, so it says nothing.
    setValue(q<HTMLInputElement>(el, '[aria-label="Display name"]'), '')
    press(q(el, '[aria-label="Display name"]'), 'Enter')
    expect(onNotice).toHaveBeenCalledTimes(1)
  })

  it('a Type change in the column editor: a toast, and Undo writes the declaration that stood before back, against the one it wrote', async () => {
    const before = { kind: 'select' as const, options: ['a', 'b'] }
    const setColumn = vi.fn().mockResolvedValue(undefined)
    const { el, onNotice } = mount(TABLE, { settings: { columns: { status: before }, views: [], problems: [] }, setColumn })
    rightClick(header(el, 'Status'))
    click(item(el, 'Edit column…'))
    setValue(q<HTMLSelectElement>(el, '.ctx-menu [aria-label="Edit property Status"]'), 'text')
    await act(async () => {})
    expect(setColumn).toHaveBeenCalledExactlyOnceWith('status', { kind: 'text' }, before)
    const [message, icon, type, action] = onNotice.mock.lastCall as [string, string, string, Notice['action']]
    expect([message, icon, type, action?.label, action?.fades]).toEqual(['Changed Status to Text', 'info', 'undo', 'Undo', true])
    act(() => action!.run())
    expect(setColumn).toHaveBeenLastCalledWith('status', before, { kind: 'text' })
  })

  it('a first declaration’s Undo removes it again through setColumns, with the views as they are', async () => {
    const setColumn = vi.fn().mockResolvedValue(undefined)
    const setColumns = vi.fn()
    const { el, onNotice, def } = mount(TABLE, { setColumn, setColumns })
    rightClick(header(el, 'Priority'))
    click(item(el, 'Edit column…'))
    setValue(q<HTMLSelectElement>(el, '.ctx-menu [aria-label="Edit property Priority"]'), 'number')
    await act(async () => {})
    expect(setColumn).toHaveBeenCalledExactlyOnceWith('priority', { kind: 'number' }, undefined)
    const [message, , , action] = onNotice.mock.lastCall as [string, string, string, Notice['action']]
    expect(message).toBe('Changed Priority to Number')
    act(() => action!.run())
    expect(setColumns).toHaveBeenCalledExactlyOnceWith({}, def().views)
  })

  it('a refused declaration write says nothing: the inline error is the report', async () => {
    const setColumn = vi.fn().mockRejectedValue(new Error('changed since opened'))
    const { el, onNotice } = mount(TABLE, { setColumn })
    rightClick(header(el, 'Status'))
    click(item(el, 'Edit column…'))
    setValue(q<HTMLSelectElement>(el, '.ctx-menu [aria-label="Edit property Status"]'), 'number')
    await act(async () => {})
    expect(onNotice).not.toHaveBeenCalled()
    expect(el.querySelector('.column-detail')?.textContent).toContain('changed since opened')
  })
})
