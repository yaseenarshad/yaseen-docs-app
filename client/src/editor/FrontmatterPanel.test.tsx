/**
 * The properties panel: TYPED ROWS by default (⚡ YAZ-884) over the RAW YAML fallback
 * (⚡ YAZ-883). Mounted with react-dom in jsdom, `api` mocked so every read / write is
 * observable — `views/writeProperty`'s bridge-mock idiom, since both of the panel's writes run
 * that module's read → rewrite → `expectedMtime` → retry-once dance (whole-block for raw, one key
 * for a row). The vault-wide registry is the shared `propertiesStub`, so a type declared from a
 * row is observable exactly where folder-page views read it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PROPERTY_NAME, type PropertiesResponse } from '@shared/types'
import { FrontmatterPanel, type FrontmatterPanelProps } from './FrontmatterPanel'

vi.mock('../api', async (importOriginal) => {
  const { propertiesStub } = await import('../views/propertiesStub')
  return {
    ...(await importOriginal<typeof import('../api')>()),
    api: { readFile: vi.fn(), writeFile: vi.fn(), properties: propertiesStub },
  }
})

import { BridgeRequestError, api } from '../api'
import { propertiesStub, resetPropertiesStub } from '../views/propertiesStub'

const readFile = vi.mocked(api.readFile)
const writeFile = vi.mocked(api.writeFile)

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const PATH = '/vault/Deep Work.md'
const ROOT = '/vault'

/** Messy on purpose: a comment, a quoted string, a list — the bytes a reformat would eat. */
const MESSY = `---
# how this note is filed
title: "Deep   Work"
aliases:
  - DW
status: draft
---
Body line
`
const INTERIOR = '# how this note is filed\ntitle: "Deep   Work"\naliases:\n  - DW\nstatus: draft'

/** One key per editor rung, plus a comment the surgical write must not touch. */
const TYPED = `---
# how this note is filed
status: draft
pages: 12
done: true
due: 2024-05-01
tags:
  - a
  - b
parent: "[[Home]]"
---
Body line
`

/** TYPED plus a name the registry's grammar rejects — an accepted edge, never a workaround UI. */
const LADDER = TYPED.replace('parent: "[[Home]]"', 'parent: "[[Home]]"\nNot A Key: whatever')

/** Values no typed editor can hold, and the two keys the app reserves for its own doors. */
const OPAQUE = `---
folder_page: true
folder_page_settings:
  folder: Notes
note: |
  line one
  line two
tags:
  - a
---
Body line
`

const declaring = (properties: PropertiesResponse['properties']): PropertiesResponse => ({ root: ROOT, version: 1, properties })

const fileOf = (content: string, mtime = 100) => ({ path: PATH, content, mtime, size: content.length })
const conflict = (mtime: number) => new BridgeRequestError('CONFLICT', 'file changed on disk', mtime)

let root: Root | null = null
let container: HTMLElement | null = null

beforeEach(() => {
  readFile.mockReset()
  writeFile.mockReset()
  writeFile.mockResolvedValue({ path: PATH, mtime: 200, size: 10 })
  resetPropertiesStub()
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

function mount(content: string, extra: Partial<FrontmatterPanelProps> = {}): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<FrontmatterPanel file={{ path: PATH, content, mtime: 100 }} {...extra} />))
  return container
}

const rerender = (content: string, extra: Partial<FrontmatterPanelProps> = {}) =>
  act(() => root?.render(<FrontmatterPanel file={{ path: PATH, content, mtime: 100 }} {...extra} />))

// ---------- DOM helpers ----------

const header = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.frontmatter-panel__header')
const area = (el: HTMLElement) => el.querySelector<HTMLTextAreaElement>('.frontmatter-panel__text')
const errorLine = (el: HTMLElement) => el.querySelector('.frontmatter-panel__error')
const btn = (el: HTMLElement, label: string) =>
  [...el.querySelectorAll<HTMLButtonElement>('.frontmatter-panel__btn')].find((b) => b.textContent === label) ?? null
const rows = (el: HTMLElement) => [...el.querySelectorAll<HTMLLIElement>('.frontmatter-panel__row')]
const keysOf = (el: HTMLElement) => rows(el).map((r) => r.querySelector('.frontmatter-panel__key')?.textContent)
const chipIn = (el: ParentNode) => el.querySelector('.frontmatter-panel__chip')?.textContent ?? null
const byLabel = <T extends HTMLElement>(el: ParentNode, label: string): T | null => el.querySelector<T>(`[aria-label="${label}"]`)

function rowOf(el: HTMLElement, key: string): HTMLLIElement {
  const r = el.querySelector<HTMLLIElement>(`.frontmatter-panel__row[data-key="${key}"]`)
  if (r === null) throw new Error(`no row for ${key}`)
  return r
}

const expand = (el: HTMLElement) => act(() => header(el)?.click())
/** The raw fallback is one click under the typed rows — every ⚡ YAZ-883 rule still lives there. */
const toRaw = (el: HTMLElement) => act(() => btn(el, 'Edit as YAML')?.click())
const expandRaw = (el: HTMLElement) => {
  expand(el)
  toRaw(el)
}

const click = (el: Element | null) => act(() => (el as HTMLElement | null)?.click())

/** Native prototype setter + bubbling event, so React's value tracker sees the change. */
function setValue(el: HTMLInputElement | HTMLSelectElement | null, value: string): void {
  if (el === null) throw new Error('no field')
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  act(() => {
    setter?.call(el, value)
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}

const press = (el: Element | null, key: string) => act(() => void el?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))

/** Type into the textarea the way React sees a real edit (native setter + an input event). */
function typeInto(el: HTMLElement, value: string): void {
  const field = area(el)
  if (field === null) throw new Error('the properties textarea is not open')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  act(() => {
    setter?.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** Let the save's read → write promise chain settle. */
const settle = () => act(async () => void (await Promise.resolve()))
/** Deeper: a row's write is read → write → snapshot, so it needs more than one tick. */
const flush = () => act(async () => void (await Promise.resolve().then().then().then()))

/**
 * Which editor a row mounted, read off the DOM `EditableCell` builds. Checkboxes are live (no
 * edit mode), so they are recognised WITHOUT a click — clicking one would commit a toggle.
 */
function editorOf(el: HTMLElement, key: string): string {
  // One editor at a time, like the real surface: Esc whatever is open before opening the next.
  // (jsdom's `.click()` moves no focus, so a still-focused editor swallows the first click.)
  const open = el.querySelector('.view-cell-edit__input')
  if (open !== null) press(open, 'Escape')
  const r = rowOf(el, key)
  if (r.querySelector('input[type="checkbox"][data-edit]') !== null) return 'checkbox'
  if (r.querySelector('[data-edit]') === null) return 'none'
  click(r.querySelector('[data-edit]'))
  if (r.querySelector('.view-cell-edit__chips') !== null) return 'chips'
  if (r.querySelector('.view-cell-edit__link') !== null) return 'link'
  return r.querySelector('input')?.getAttribute('type') ?? 'text'
}

// ---------- the raw fallback (⚡ YAZ-883): every rule intact, one click down ----------

describe('FrontmatterPanel — the raw YAML fallback (⚡ YAZ-883)', () => {
  it('is COLLAPSED by default and shows the top-level key count', () => {
    const el = mount(MESSY)
    expect(header(el)?.getAttribute('aria-expanded')).toBe('false')
    expect(header(el)?.textContent).toBe('Properties (3)')
    expect(area(el)).toBeNull()
  })

  it('invalid frontmatter drops the count rather than guessing one', () => {
    const el = mount('---\ntags: [a, b\nstatus: : :\n---\nBody\n')
    expect(header(el)?.textContent).toBe('Properties')
  })

  it('expanding shows the EXACT raw interior — comments, quoting and list shape intact', () => {
    const el = mount(MESSY)
    expandRaw(el)
    expect(area(el)?.value).toBe(INTERIOR)
    // Nothing is dirty yet, so the panel offers no buttons at all.
    expect(btn(el, 'Save')).toBeNull()
  })

  it('an edit saves the replaceFrontmatter result with the FRESH read mtime', async () => {
    readFile.mockResolvedValue(fileOf(MESSY))
    const el = mount(MESSY)
    expandRaw(el)
    // A value changes; the comment stays exactly where the user left it.
    typeInto(el, INTERIOR.replace('status: draft', 'status: done'))
    expect(btn(el, 'Save')).not.toBeNull()

    click(btn(el, 'Save'))
    await settle()

    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(writeFile).toHaveBeenCalledWith({
      path: PATH,
      content: MESSY.replace('status: draft', 'status: done'),
      expectedMtime: 100,
    })
    // Its own write is the new disk truth: clean again, showing what it wrote.
    expect(btn(el, 'Save')).toBeNull()
    expect(area(el)?.value).toBe(INTERIOR.replace('status: draft', 'status: done'))
    expect(header(el)?.textContent).toBe('Properties (3)')
  })

  it('invalid YAML blocks the write and says so inline', async () => {
    readFile.mockResolvedValue(fileOf(MESSY))
    const el = mount(MESSY)
    expandRaw(el)
    typeInto(el, 'tags: [a, b\nstatus: : :')

    click(btn(el, 'Save'))
    await settle()

    expect(writeFile).not.toHaveBeenCalled()
    expect(errorLine(el)?.textContent).toMatch(/^Not valid YAML: /)
    // The user's text is still there to fix — a rejected save never reverts anything.
    expect(area(el)?.value).toBe('tags: [a, b\nstatus: : :')
  })

  it("a bridge failure lands on the panel's OWN error line, not a notice", async () => {
    readFile.mockResolvedValue(fileOf(MESSY))
    writeFile.mockRejectedValue(new BridgeRequestError('IO_ERROR', 'disk on fire'))
    const el = mount(MESSY)
    expandRaw(el)
    typeInto(el, 'status: done')

    click(btn(el, 'Save'))
    await settle()

    expect(errorLine(el)?.textContent).toBe('Could not save the properties: disk on fire')
    expect(btn(el, 'Save')).not.toBeNull() // still dirty, still savable
  })

  it('Cancel and Esc both revert to the disk text and write nothing', () => {
    const el = mount(MESSY)
    expandRaw(el)
    typeInto(el, 'status: abandoned')
    click(btn(el, 'Cancel'))
    expect(area(el)?.value).toBe(INTERIOR)

    typeInto(el, 'status: abandoned again')
    press(area(el), 'Escape')
    expect(area(el)?.value).toBe(INTERIOR)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('an unchanged Save never touches disk (identity)', async () => {
    readFile.mockResolvedValue(fileOf(MESSY))
    const el = mount(MESSY)
    expandRaw(el)
    // Edited away and typed straight back: the bytes match, so there is nothing to write —
    // and with the draft equal to disk the panel does not even offer the button.
    typeInto(el, 'status: done')
    typeInto(el, INTERIOR)
    expect(btn(el, 'Save')).toBeNull()

    // Trailing whitespace the frame supplies anyway is the same non-write, through the button.
    typeInto(el, `${INTERIOR}\n`)
    click(btn(el, 'Save'))
    await settle()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('a page with NO frontmatter offers "Add properties", and saving creates the block', async () => {
    readFile.mockResolvedValue(fileOf('Just a body\n'))
    const el = mount('Just a body\n')
    expect(header(el)?.textContent).toBe('Add properties')
    expandRaw(el)
    expect(area(el)?.value).toBe('')

    typeInto(el, 'status: draft')
    click(btn(el, 'Save'))
    await settle()

    expect(writeFile).toHaveBeenCalledWith({
      path: PATH,
      content: '---\nstatus: draft\n---\nJust a body\n',
      expectedMtime: 100,
    })
    expect(header(el)?.textContent).toBe('Properties (1)')
  })

  it('re-reads and retries ONCE on CONFLICT, keeping the concurrent body edit', async () => {
    readFile
      .mockResolvedValueOnce(fileOf(MESSY, 100))
      .mockResolvedValueOnce(fileOf(MESSY.replace('Body line', 'Body line, edited elsewhere'), 150))
    writeFile.mockRejectedValueOnce(conflict(150)).mockResolvedValueOnce({ path: PATH, mtime: 300, size: 10 })
    const el = mount(MESSY)
    expandRaw(el)
    typeInto(el, 'status: done')

    click(btn(el, 'Save'))
    await settle()
    await settle()

    expect(readFile).toHaveBeenCalledTimes(2)
    expect(writeFile).toHaveBeenCalledTimes(2)
    expect(writeFile).toHaveBeenLastCalledWith({
      path: PATH,
      content: '---\nstatus: done\n---\nBody line, edited elsewhere\n',
      expectedMtime: 150,
    })
  })

  it('follows a reloaded file while clean, and never throws away a dirty draft', () => {
    const el = mount(MESSY)
    expandRaw(el)
    const next = MESSY.replace('status: draft', 'status: published')
    rerender(next)
    expect(area(el)?.value).toBe(INTERIOR.replace('status: draft', 'status: published'))

    typeInto(el, 'status: mine')
    rerender(MESSY)
    expect(area(el)?.value).toBe('status: mine')
  })

  it('an unparseable block has no rows to show, so raw IS the surface and offers no way back', () => {
    const el = mount('---\ntags: [a, b\nstatus: : :\n---\nBody\n')
    expand(el)
    expect(area(el)).not.toBeNull()
    expect(btn(el, 'Edit as YAML')).toBeNull()
    expect(btn(el, 'Edit as rows')).toBeNull()
  })
})

// ---------- typed rows (⚡ YAZ-884), the DEFAULT ----------

describe('FrontmatterPanel — typed rows (⚡ YAZ-884)', () => {
  it('opens on ROWS, one per top-level key, each with the editor its ladder rung asks for', () => {
    const el = mount(LADDER, { properties: declaring({ status: { kind: 'list' } }) })
    expand(el)
    expect(area(el)).toBeNull()
    expect(keysOf(el)).toEqual(['status', 'pages', 'done', 'due', 'tags', 'parent', 'Not A Key'])

    // Rung one, the vault-wide DECLARATION, beats what the note's own value would infer (text).
    expect(editorOf(el, 'status')).toBe('chips')
    // Rung two, the note's own value.
    expect(editorOf(el, 'pages')).toBe('number')
    expect(editorOf(el, 'done')).toBe('checkbox')
    expect(editorOf(el, 'due')).toBe('date')
    expect(editorOf(el, 'tags')).toBe('chips')
    expect(editorOf(el, 'parent')).toBe('link')
    // 🔒 A name the registry's grammar rejects can hold no declaration: plain text.
    expect(PROPERTY_NAME.test('Not A Key')).toBe(false)
    expect(editorOf(el, 'Not A Key')).toBe('text')
  })

  it('an edited value is written SURGICALLY — the rest of the block, comment included, is byte-identical', async () => {
    readFile.mockResolvedValue(fileOf(TYPED))
    const el = mount(TYPED)
    expand(el)
    click(rowOf(el, 'status').querySelector('[data-edit]'))
    setValue(byLabel<HTMLInputElement>(el, 'Edit status'), 'done')
    press(byLabel(el, 'Edit status'), 'Enter')
    await flush()

    const edited = TYPED.replace('status: draft', 'status: done')
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(writeFile).toHaveBeenCalledWith({ path: PATH, content: edited, expectedMtime: 100 })
    // The panel's own belief of disk moved with it, so the raw fallback shows the NEW block —
    // a later raw Save can never silently revert the typed edit.
    toRaw(el)
    expect(area(el)?.value).toBe(edited.slice(4, edited.indexOf('\n---\n')))
  })

  it('a number row commits a NUMBER and a checkbox row commits a BOOLEAN', async () => {
    readFile.mockResolvedValue(fileOf(TYPED))
    const el = mount(TYPED)
    expand(el)
    click(rowOf(el, 'pages').querySelector('[data-edit]'))
    setValue(byLabel<HTMLInputElement>(el, 'Edit pages'), '13')
    press(byLabel(el, 'Edit pages'), 'Enter')
    await flush()
    expect(writeFile).toHaveBeenLastCalledWith({ path: PATH, content: TYPED.replace('pages: 12', 'pages: 13'), expectedMtime: 100 })

    readFile.mockResolvedValue(fileOf(TYPED.replace('pages: 12', 'pages: 13')))
    click(rowOf(el, 'done').querySelector('[data-edit]'))
    await flush()
    expect(writeFile).toHaveBeenLastCalledWith({
      path: PATH,
      content: TYPED.replace('pages: 12', 'pages: 13').replace('done: true', 'done: false'),
      expectedMtime: 100,
    })
  })

  it('adds a key — the registry rejects a bad name in its OWN words, and a duplicate outright', async () => {
    readFile.mockResolvedValue(fileOf(TYPED))
    const el = mount(TYPED)
    expand(el)
    click(btn(el, 'Add property'))

    setValue(byLabel<HTMLInputElement>(el, 'New property name'), 'Bad Name')
    click(btn(el, 'Add'))
    expect(errorLine(el)?.textContent).toBe(`property names are snake_case (${String(PROPERTY_NAME)})`)
    expect(writeFile).not.toHaveBeenCalled()

    setValue(byLabel<HTMLInputElement>(el, 'New property name'), 'status')
    click(btn(el, 'Add'))
    expect(errorLine(el)?.textContent).toBe('"status" is already a property of this page')
    expect(writeFile).not.toHaveBeenCalled()

    setValue(byLabel<HTMLInputElement>(el, 'New property name'), 'author')
    setValue(byLabel<HTMLInputElement>(el, 'New property value'), 'Cal Newport')
    click(btn(el, 'Add'))
    await flush()

    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(writeFile).toHaveBeenCalledWith({
      path: PATH,
      content: TYPED.replace('parent: "[[Home]]"', 'parent: "[[Home]]"\nauthor: Cal Newport'),
      expectedMtime: 100,
    })
    // The form closes and the row is there, counted.
    expect(byLabel(el, 'New property name')).toBeNull()
    expect(keysOf(el)).toContain('author')
    expect(header(el)?.textContent).toBe('Properties (7)')
  })

  it("a new key's first value is shaped by its DECLARED kind, not by the text", async () => {
    readFile.mockResolvedValue(fileOf(TYPED))
    const el = mount(TYPED, { properties: declaring({ rating: { kind: 'number' } }) })
    expand(el)
    click(btn(el, 'Add property'))
    setValue(byLabel<HTMLInputElement>(el, 'New property name'), 'rating')
    setValue(byLabel<HTMLInputElement>(el, 'New property value'), '5')
    click(btn(el, 'Add'))
    await flush()

    expect(writeFile).toHaveBeenCalledWith({
      path: PATH,
      content: TYPED.replace('parent: "[[Home]]"', 'parent: "[[Home]]"\nrating: 5'),
      expectedMtime: 100,
    })
  })

  it('deletes a key through the same one-key write, leaving every other byte alone', async () => {
    readFile.mockResolvedValue(fileOf(TYPED))
    const el = mount(TYPED)
    expand(el)
    click(byLabel(rowOf(el, 'pages'), 'Delete pages'))
    await flush()

    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(writeFile).toHaveBeenCalledWith({ path: PATH, content: TYPED.replace('pages: 12\n', ''), expectedMtime: 100 })
    expect(keysOf(el)).not.toContain('pages')
    expect(header(el)?.textContent).toBe('Properties (5)')
  })

  it("a deleted key takes its OWN leading comment with it, and only that one", async () => {
    // The block's comment belongs to `status` (it sits directly above it), so `setFrontmatterProperty`
    // carries it out with the key — a comment describing a property is part of that property.
    readFile.mockResolvedValue(fileOf(TYPED))
    const el = mount(TYPED)
    expand(el)
    click(byLabel(rowOf(el, 'status'), 'Delete status'))
    await flush()

    expect(writeFile).toHaveBeenCalledWith({
      path: PATH,
      content: TYPED.replace('# how this note is filed\nstatus: draft\n', ''),
      expectedMtime: 100,
    })
  })

  it('a failed row write lands on the panel\'s own error line and writes nothing else', async () => {
    readFile.mockResolvedValue(fileOf(TYPED))
    writeFile.mockRejectedValue(new BridgeRequestError('IO_ERROR', 'disk on fire'))
    const el = mount(TYPED)
    expand(el)
    click(byLabel(rowOf(el, 'status'), 'Delete status'))
    await flush()

    expect(errorLine(el)?.textContent).toBe('Could not delete "status": disk on fire')
    expect(keysOf(el)).toContain('status')
  })

  it('RESERVED keys and values no editor can hold are read-only, chipped, and offer nothing', () => {
    const el = mount(OPAQUE, { root: ROOT })
    expand(el)
    expect(keysOf(el)).toEqual(['folder_page', 'folder_page_settings', 'note', 'tags'])

    for (const [key, chip] of [
      ['folder_page', 'Reserved'],
      ['folder_page_settings', 'Reserved'],
      ['note', 'YAML'],
    ] as const) {
      const r = rowOf(el, key)
      expect(chipIn(r)).toBe(chip)
      // 🔒 A row with no editor offers nothing but its chip.
      expect(r.querySelector('[data-edit]')).toBeNull()
      expect(byLabel(r, `Delete ${key}`)).toBeNull()
      expect(byLabel(r, `Type of ${key}`)).toBeNull()
    }

    // The representable neighbour is untouched by any of that.
    const tags = rowOf(el, 'tags')
    expect(chipIn(tags)).toBeNull()
    expect(byLabel(tags, 'Delete tags')).not.toBeNull()
  })

  it('declares a type VAULT-WIDE from a row — the note itself is never written', async () => {
    const el = mount(TYPED, { root: ROOT, properties: declaring({}) })
    expand(el)
    const select = byLabel<HTMLSelectElement>(rowOf(el, 'status'), 'Type of status')
    expect(select?.value).toBe('')

    setValue(select, 'list')
    await flush()

    expect(await propertiesStub.get(ROOT)).toEqual({ root: ROOT, version: 1, properties: { status: { kind: 'list' } } })
    expect(writeFile).not.toHaveBeenCalled()

    // The declaration reaches every surface through App's `useProperties` broadcast; here it is
    // the same prop the folder page's contents block reads, and the row retypes with it.
    rerender(TYPED, { root: ROOT, properties: declaring({ status: { kind: 'list' } }) })
    expect(byLabel<HTMLSelectElement>(rowOf(el, 'status'), 'Type of status')?.value).toBe('list')
    expect(editorOf(el, 'status')).toBe('chips')
  })

  it('with no vault root there is no type affordance at all', () => {
    const el = mount(TYPED)
    expand(el)
    expect(byLabel(rowOf(el, 'status'), 'Type of status')).toBeNull()
    expect(byLabel(rowOf(el, 'status'), 'Delete status')).not.toBeNull()
  })

  it('the raw fallback is one click away and back — but a DIRTY draft holds the door shut', () => {
    const el = mount(TYPED)
    expand(el)
    expect(rows(el)).toHaveLength(6)

    toRaw(el)
    expect(rows(el)).toHaveLength(0)
    expect(area(el)?.value).toBe(TYPED.slice(4, TYPED.indexOf('\n---\n')))

    typeInto(el, 'status: mine')
    expect(btn(el, 'Edit as rows')?.disabled).toBe(true)
    expect(btn(el, 'Edit as rows')?.title).toBe('Save or cancel your YAML edits first')
    click(btn(el, 'Edit as rows'))
    expect(rows(el)).toHaveLength(0) // a disabled toggle really does nothing

    click(btn(el, 'Cancel'))
    expect(btn(el, 'Edit as rows')?.disabled).toBe(false)
    click(btn(el, 'Edit as rows'))
    expect(rows(el)).toHaveLength(6)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('a page with no frontmatter opens on an empty row list and the one act that matters', () => {
    const el = mount('Just a body\n')
    expand(el)
    expect(rows(el)).toHaveLength(0)
    expect(btn(el, 'Add property')).not.toBeNull()
    expect(btn(el, 'Edit as YAML')).not.toBeNull()
  })
})
