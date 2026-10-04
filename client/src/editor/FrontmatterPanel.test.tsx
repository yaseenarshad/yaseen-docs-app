/**
 * The properties panel: TYPED ROWS by default (⚡ YAZ-884) over the RAW YAML fallback
 * (⚡ YAZ-883). Mounted with react-dom in jsdom, `api` mocked so every read / write is
 * observable — `views/writeProperty`'s bridge-mock idiom, since both of the panel's writes run
 * that module's read → rewrite → `expectedMtime` → retry-once dance (whole-block for raw, one key
 * for a row). The vault-wide registry is the shared `propertiesStub`, so a type declared from a
 * row is observable exactly where folder views read it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Profiler, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PROPERTY_NAME, type IndexRecord, type PropertyDecl, type PropertiesResponse } from '@shared/types'
import { FrontmatterPanel, type FrontmatterPanelProps } from './FrontmatterPanel'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { TEST_RECORDS } from '../views/testRecords'
import { createWikilinkResolveSource } from './wikilink/wikilinkPlugin'
import { settleFileWrites } from '../views/writeProperty'

vi.mock('../api', async (importOriginal) => {
  const { propertiesStub } = await import('../views/propertiesStub')
  return {
    ...(await importOriginal<typeof import('../api')>()),
    api: { readFile: vi.fn(), writeFile: vi.fn(), createFile: vi.fn(), properties: propertiesStub },
  }
})

import { BridgeRequestError, api } from '../api'
import { propertiesStub, resetPropertiesStub } from '../views/propertiesStub'

const readFile = vi.mocked(api.readFile)
const writeFile = vi.mocked(api.writeFile)
const createFile = vi.mocked(api.createFile)

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

/** Values no typed editor can hold, beside an ordinary flag. */
const OPAQUE = `---
draft: true
draft_layout:
  width: wide
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
  createFile.mockReset()
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
const byLabel = <T extends HTMLElement>(el: ParentNode, label: string): T | null => (el === container ? document.body : el).querySelector<T>(`[aria-label="${label}"]`)

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
const buttonNamed = (el: ParentNode, text: string): HTMLButtonElement | null => [...(el === container ? document.body : el).querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === text) ?? null
const removeProperty = (el: HTMLElement, key: string) => {
  click(byLabel(el, `Configure ${key}`))
  click(buttonNamed(el, 'Remove from this note'))
}

/** Where the folder the note at PATH lives in keeps its settings (YAZ-2290 D1). */
const FOLDER = '/vault/.folder.md'
const LOCAL_NOTE = '---\nStatus: Ready\n---\nOriginal note body\n'
/** The window's feed after its first snapshot; `columns` undefined = the folder has no settings file. */
const folderFeed = (columns?: Record<string, PropertyDecl>) => {
  const source = createWikilinkResolveSource()
  const settings: IndexRecord[] = columns === undefined ? [] : [{ ...TEST_RECORDS[0], path: FOLDER, name: '.folder.md', basename: '.folder', properties: { folder_settings: { columns, views: [{ type: 'board', name: 'Board' }] } } }]
  source.update(() => null, [{ ...TEST_RECORDS[0], path: PATH, basename: 'Deep Work' }], settings)
  return source
}

/** A note that is also a SHORTCUT in Areas (YAZ-2290 D2): `also_in` names that folder's id — and one no folder has. */
const AREAS_ID = 'k3m9x2pq7abc'
const SHORTCUT_NOTE = `---\nalso_in:\n  - ${AREAS_ID}\n  - a1b2c3d4e5f6\n---\nBody\n`
/** The living folder declares Status and effort; Areas declares effort (differently) and owner. */
const shortcutFeed = () => {
  const source = createWikilinkResolveSource()
  const settings = (path: string, columns: Record<string, PropertyDecl>, id?: string): IndexRecord => ({ ...TEST_RECORDS[0], path, name: '.folder.md', basename: '.folder', id, properties: { folder_settings: { columns, views: [{ type: 'board', name: 'Board' }] } } })
  source.update(() => null, [], [settings(FOLDER, { Status: { kind: 'select', options: ['Ready', 'Later'] }, effort: { kind: 'number' } }), settings('/vault/Areas/.folder.md', { effort: { kind: 'text' }, owner: { kind: 'text' } }, AREAS_ID)])
  return source
}


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
    expect(header(el)?.getAttribute('aria-label')).toBe('Properties (3)')
    expect(area(el)).toBeNull()
  })

  it('invalid frontmatter drops the count rather than guessing one', () => {
    const el = mount('---\ntags: [a, b\nstatus: : :\n---\nBody\n')
    expect(header(el)?.getAttribute('aria-label')).toBe('Properties')
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
    expect(header(el)?.getAttribute('aria-label')).toBe('Properties (3)')
  })

  it('a Save in flight joins the close/quit flush: the flush settles only once its write has landed (YAZ-2174)', async () => {
    readFile.mockResolvedValue(fileOf(MESSY))
    let land!: () => void
    writeFile.mockImplementationOnce(() => new Promise((r) => (land = () => r({ path: PATH, mtime: 200, size: 10 }))))
    const el = mount(MESSY)
    expandRaw(el)
    typeInto(el, INTERIOR.replace('status: draft', 'status: done'))
    click(btn(el, 'Save'))
    let flushed = false
    const flush = settleFileWrites().then(() => (flushed = true))
    await vi.waitFor(() => expect(writeFile).toHaveBeenCalledOnce())
    expect(flushed).toBe(false)
    await act(async () => {
      land()
      await flush
    })
    expect(flushed).toBe(true)
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
    expect(header(el)?.getAttribute('aria-label')).toBe('Add properties')
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
    expect(header(el)?.getAttribute('aria-label')).toBe('Properties (1)')
    // The chip itself shows only the glyph and the bare count (YAZ-1758).
    expect(el.querySelector('.frontmatter-panel__count')?.textContent).toBe('1')
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
    expect(header(el)?.getAttribute('aria-label')).toBe('Properties (7)')
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
    removeProperty(el, 'pages')
    await flush()

    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(writeFile).toHaveBeenCalledWith({ path: PATH, content: TYPED.replace('pages: 12\n', ''), expectedMtime: 100 })
    expect(keysOf(el)).not.toContain('pages')
    expect(header(el)?.getAttribute('aria-label')).toBe('Properties (5)')
  })

  it("a deleted key takes its OWN leading comment with it, and only that one", async () => {
    // The block's comment belongs to `status` (it sits directly above it), so `setFrontmatterProperty`
    // carries it out with the key — a comment describing a property is part of that property.
    readFile.mockResolvedValue(fileOf(TYPED))
    const el = mount(TYPED)
    expand(el)
    removeProperty(el, 'status')
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
    removeProperty(el, 'status')
    await flush()

    expect(errorLine(el)?.textContent).toBe('Could not delete "status": disk on fire')
    expect(keysOf(el)).toContain('status')
  })

  it('values no editor can hold are read-only, chipped, and offer nothing', () => {
    const el = mount(OPAQUE, { root: ROOT })
    expand(el)
    expect(keysOf(el)).toEqual(['draft', 'draft_layout', 'note', 'tags'])

    for (const key of ['draft_layout', 'note']) {
      const r = rowOf(el, key)
      expect(chipIn(r)).toBe('YAML')
      // 🔒 A row with no editor offers nothing but its chip.
      expect(r.querySelector('[data-edit]')).toBeNull()
      expect(byLabel(r, `Configure ${key}`)).toBeNull()
    }

    // The representable neighbour is untouched by any of that.
    const tags = rowOf(el, 'tags')
    expect(chipIn(tags)).toBeNull()
    expect(byLabel(tags, 'Configure tags')).not.toBeNull()
    expect(byLabel(tags, 'Delete tags')).toBeNull()

    // An ordinary flag: no chip, and an editor.
    const flag = rowOf(el, 'draft')
    expect(chipIn(flag)).toBeNull()
    expect(flag.querySelector('[data-edit]')).not.toBeNull()
  })

  it('`folder_settings` on a NOTE is an ordinary property: an empty one has an editor and its menu', () => {
    const el = mount('---\nfolder_settings:\nstatus: draft\n---\nBody\n', { root: ROOT })
    expand(el)
    const r = rowOf(el, 'folder_settings')
    expect(chipIn(r)).toBeNull()
    expect(r.querySelector('[data-edit]')).not.toBeNull()
    click(byLabel(r, 'Configure folder_settings')!)
    expect(buttonNamed(el, 'Remove from this note')).not.toBeNull()
  })

  it('`comments` is RESERVED (YAZ-1472): chipped, read-only — its door is the Comments block', () => {
    const el = mount('---\ncomments:\n  - id: 3f9a1c2e\n    at: 2026-09-11T18:22:31Z\n    body: Hi\nstatus: draft\n---\nBody\n', { root: ROOT })
    expand(el)
    expect(keysOf(el)).toEqual(['comments', 'status'])
    const r = rowOf(el, 'comments')
    expect(chipIn(r)).toBe('Reserved')
    expect(r.querySelector('[data-edit]')).toBeNull()
    expect(byLabel(r, 'Configure comments')).toBeNull()
    expect(chipIn(rowOf(el, 'status'))).toBeNull()
  })

  it('`id` is RESERVED too (YAZ-2293): chipped, read-only — editing it would orphan every link to the note', () => {
    const el = mount('---\nid: k3m9x2pq7abc\nstatus: draft\n---\nBody\n', { root: ROOT })
    expand(el)
    expect(keysOf(el)).toEqual(['id', 'status'])
    const r = rowOf(el, 'id')
    expect(chipIn(r)).toBe('Reserved')
    expect(r.querySelector('[data-edit]')).toBeNull()
    expect(byLabel(r, 'Configure id')).toBeNull()
    expect(chipIn(rowOf(el, 'status'))).toBeNull()
  })

  it('a link value naming a FOLDER by its id reads as the folder’s name, as a note’s reads as its title (YAZ-2290 D10)', () => {
    const source = createWikilinkResolveSource()
    source.update((target) => (target === AREAS_ID ? '/vault/Areas' : null), [], []) // the window's link resolver: a note, else a folder
    const el = mount(`---\narea: "[[${AREAS_ID}]]"\n---\nBody\n`, { root: ROOT, wikilinks: source })
    expand(el)
    expect(rowOf(el, 'area').querySelector('.view-table__chip')?.textContent).toBe('Areas')
  })

  it('`also_in` is RESERVED too (YAZ-2290 D2): chipped, read-only — and it reads as the folders it names, an id no folder has as written', () => {
    const el = mount(SHORTCUT_NOTE, { root: ROOT, wikilinks: shortcutFeed() })
    expand(el)
    const r = rowOf(el, 'also_in')
    expect(chipIn(r)).toBe('Reserved')
    expect(r.querySelector('[data-edit]')).toBeNull()
    expect(byLabel(r, 'Configure also_in')).toBeNull()
    expect([...r.querySelectorAll('.view-table__chip')].map((chip) => chip.textContent)).toEqual(['Areas', 'a1b2c3d4e5f6'])
  })

  it('lists the columns of the folders it is a SHORTCUT in after its own folder’s — a column several declare once, typed by the first (D2)', () => {
    const el = mount(SHORTCUT_NOTE, { root: ROOT, wikilinks: shortcutFeed() })
    expand(el)
    // Its own key, the living folder's two columns, then the one only the shortcut folder declares.
    expect(keysOf(el)).toEqual(['also_in', 'Status', 'effort', 'owner'])
    expect(editorOf(el, 'effort')).toBe('number') // the living folder says number; Areas says text
  })

  it('is typed by the folder the note LIVES in (YAZ-2290): its definition for uppercase Status, and only the note value is written', async () => {
    const wikilinks = folderFeed({ Status: { kind: 'select', options: ['Ready', 'Later'] } })
    readFile.mockResolvedValue(fileOf(LOCAL_NOTE))
    const el = mount(LOCAL_NOTE, { root: ROOT, wikilinks })
    expand(el)
    expect(byLabel(el, 'Property context')).toBeNull() // one folder, nothing to choose
    expect(rowOf(el, 'Status').querySelector('.property-choice-chip')?.textContent).toBe('Ready')
    expect(byLabel(el, 'Type of Status')).toBeNull()
    expect(byLabel(el, 'Delete Status')).toBeNull()
    click(rowOf(el, 'Status').querySelector('[data-edit]'))
    expect([...document.querySelectorAll('[role="option"] .property-choice-chip')].map(option => option.textContent)).toEqual(['Ready', 'Later'])
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent?.startsWith('Later'))!
    click(option)
    await flush()
    expect(writeFile).toHaveBeenCalledExactlyOnceWith({ path: PATH, content: LOCAL_NOTE.replace('Status: Ready', 'Status: Later'), expectedMtime: 100 })
  })

  it("the folder's columns the note has no value for are EMPTY rows — nothing is written until one is filled in, and then only that key (E1)", async () => {
    const wikilinks = folderFeed({ Status: { kind: 'select', options: ['Ready', 'Later'] }, effort: { kind: 'number' }, owner: { kind: 'text' } })
    readFile.mockResolvedValue(fileOf(LOCAL_NOTE))
    const el = mount(LOCAL_NOTE, { root: ROOT, wikilinks })
    expect(header(el)?.textContent).toBe('1') // the count is the note's OWN keys
    expand(el)
    expect(keysOf(el)).toEqual(['Status', 'effort', 'owner'])
    expect(editorOf(el, 'effort')).toBe('number')
    press(el.querySelector('.view-cell-edit__input'), 'Escape')
    await flush()
    expect(writeFile).not.toHaveBeenCalled()

    click(rowOf(el, 'effort').querySelector('[data-edit]'))
    const input = rowOf(el, 'effort').querySelector<HTMLInputElement>('input')
    setValue(input, '3')
    press(input, 'Enter')
    await flush()
    expect(writeFile).toHaveBeenCalledExactlyOnceWith({ path: PATH, content: '---\nStatus: Ready\neffort: 3\n---\nOriginal note body\n', expectedMtime: 100 })
  })

  it('a folder with no settings file types its notes from the defaults: an empty Status row (E2)', () => {
    const el = mount('Just a body\n', { root: ROOT, wikilinks: folderFeed() })
    expand(el)
    expect(keysOf(el)).toEqual(['status'])
    click(rowOf(el, 'status').querySelector('[data-edit]'))
    expect([...document.querySelectorAll('[role="option"] .property-choice-chip')].map(option => option.textContent)).toEqual(['1-Backlog', '2-Todo', '3-In-Progress', '4-Done'])
    expect(writeFile).not.toHaveBeenCalled()
  })

  it("saves a definition into the folder's settings file against its fresh bytes, preserving other settings and the note value", async () => {
    const wikilinks = folderFeed({ Status: { kind: 'select', options: ['Ready', 'Later'] } })
    const freshFolder = `---
owner: untouched
folder_settings:
  columns:
    Status:
      kind: select
      options: [Ready, Later]
    effort:
      kind: number
  defaultView: Table
  future_setting: keep me
  views:
    - type: table
      name: Table
---
`
    readFile.mockResolvedValue({ path: FOLDER, content: freshFolder, mtime: 444, size: freshFolder.length })
    const el = mount(LOCAL_NOTE, { root: ROOT, wikilinks })
    expand(el)
    click(byLabel(el, 'Configure Status'))
    click(buttonNamed(el, 'Edit property ›'))
    click(byLabel(el, 'Property type: Select'))
    click(buttonNamed(el, 'Multi-select'))
    expect(writeFile).not.toHaveBeenCalled()
    const actions = document.querySelector('.frontmatter-property-menu__actions')!
    click(buttonNamed(actions, 'Save'))
    await flush()
    expect(readFile).toHaveBeenCalledExactlyOnceWith(FOLDER)
    expect(writeFile).toHaveBeenCalledTimes(1)
    const write = writeFile.mock.calls[0][0]
    expect(write.path).toBe(FOLDER)
    expect(write.expectedMtime).toBe(444)
    const saved = parseFrontmatter(splitFrontmatter(write.content).frontmatter).properties
    expect(saved).toEqual({ owner: 'untouched', folder_settings: {
      columns: { Status: { kind: 'multi-select', options: ['Ready', 'Later'] }, effort: { kind: 'number' } },
      defaultView: 'Table', future_setting: 'keep me', views: [{ type: 'table', name: 'Table' }],
    } })
    expect((await propertiesStub.get(ROOT)).properties).toEqual({})
    toRaw(el)
    expect(area(el)?.value).toContain('Status: Ready')
  })

  it('with no index feed there is no folder to configure: removal is offered, a type dropdown is not', () => {
    const el = mount(TYPED)
    expand(el)
    expect(byLabel(rowOf(el, 'status'), 'Type of status')).toBeNull()
    expect(byLabel(rowOf(el, 'status'), 'Delete status')).toBeNull()
    click(byLabel(el, 'Configure status'))
    expect(buttonNamed(el, 'Remove from this note')).not.toBeNull()
    expect(buttonNamed(el, 'Edit property ›')).toBeNull()
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

describe('FrontmatterPanel — the app\'s own names are refused as new properties', () => {
  it('"comments" is not added to a note: said in the chip\'s own words, nothing written', () => {
    const name = 'comments'
    const el = mount(TYPED)
    expand(el)
    click(btn(el, 'Add property'))
    setValue(byLabel<HTMLInputElement>(el, 'New property name'), name)
    click(btn(el, 'Add'))
    expect(errorLine(el)?.textContent).toBe(`${name} is the app's own property — it is set where it belongs, not here`)
    expect(readFile).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })
})

describe('FrontmatterPanel — the index feed (YAZ-2196)', () => {
  it('re-renders when a folder settings file moved, and not on a refetch that moved none', () => {
    const source = createWikilinkResolveSource()
    const settings = (mtime: number): IndexRecord => ({ ...TEST_RECORDS[0], path: FOLDER, name: '.folder.md', basename: '.folder', mtime, properties: {} })
    source.update(() => null, [], [settings(1)])
    let renders = 0
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(<Profiler id="panel" onRender={() => renders++}><FrontmatterPanel file={{ path: PATH, content: LOCAL_NOTE, mtime: 1 }} wikilinks={source} /></Profiler>))
    const mounted = renders
    act(() => source.update(() => null, [{ ...TEST_RECORDS[0] }], [settings(1)])) // a save elsewhere: new arrays, the same settings file
    expect(renders).toBe(mounted)
    act(() => source.update(() => null, [], [settings(2)]))
    expect(renders).toBeGreaterThan(mounted)
  })
})

/** A folder's OWN panel (YAZ-2290 D9) is mounted on its settings file; the file exists only after the first change (D1). */
describe('FrontmatterPanel — a folder\'s own panel (YAZ-2290 D9)', () => {
  const OWN = '/vault/Projects/.folder.md'
  const mountOwn = (content: string): HTMLElement => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(<FrontmatterPanel file={{ path: OWN, content, mtime: 0 }} />))
    return container
  }

  it('the row menu says "Remove from this folder"', () => {
    const el = mountOwn('---\nowner: Yasin\n---\n')
    expand(el)
    click(byLabel(el, 'Configure owner'))
    expect(buttonNamed(el, 'Remove from this folder')).not.toBeNull()
    expect(buttonNamed(el, 'Remove from this note')).toBeNull()
  })

  it('invalid raw YAML on a folder with no settings file is refused BEFORE anything is created', async () => {
    readFile.mockRejectedValue(new BridgeRequestError('NOT_FOUND', 'path does not exist'))
    const el = mountOwn('')
    expandRaw(el)
    typeInto(el, 'tags: [a, b\nstatus: : :')
    click(btn(el, 'Save'))
    await settle()
    expect(errorLine(el)?.textContent).toMatch(/^Not valid YAML: /)
    expect(readFile).not.toHaveBeenCalled()
    expect(createFile).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('"folder_settings" is refused as a new property — the row would be hidden — and nothing is created', () => {
    const el = mountOwn('')
    expand(el)
    click(btn(el, 'Add property'))
    setValue(byLabel<HTMLInputElement>(el, 'New property name'), 'folder_settings')
    click(btn(el, 'Add'))
    expect(errorLine(el)?.textContent).toBe("folder_settings is the app's own property — it is set where it belongs, not here")
    expect(createFile).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })
})

describe('FrontmatterPanel — the property search (YAZ-1473)', () => {
  const search = (el: HTMLElement) => byLabel<HTMLInputElement>(el, 'Search properties')
  const status = (el: HTMLElement) => el.querySelector('[role="status"]')?.textContent ?? null

  it('sits above the rows once expanded — never collapsed, in raw mode, or on an empty page', () => {
    const el = mount(TYPED)
    expect(search(el)).toBeNull()
    expand(el)
    const box = search(el)
    expect(box?.placeholder).toBe('Search properties…')
    // Above the first row, not beside or below the list.
    expect(box!.compareDocumentPosition(rows(el)[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    toRaw(el)
    expect(search(el)).toBeNull()

    const bare = mount('Just a body\n')
    expand(bare)
    expect(search(bare)).toBeNull()
  })

  it('filters by KEY — trimmed, case-insensitive, block order kept, chipped rows included — and writes nothing', () => {
    const el = mount(OPAQUE)
    expand(el)
    expect(keysOf(el)).toEqual(['draft', 'draft_layout', 'note', 'tags'])
    setValue(search(el), '  DRAFT ')
    expect(keysOf(el)).toEqual(['draft', 'draft_layout'])
    expect(el.querySelector('.frontmatter-panel__count')?.textContent).toBe('4') // the count is the block's, not the match's
    setValue(search(el), 'ta')
    expect(keysOf(el)).toEqual(['tags'])
    // Key only — `matchesColumn` would also match the canonical `note.` prefix and light up every row.
    setValue(search(el), 'note')
    expect(keysOf(el)).toEqual(['note'])
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('no match says so and keeps the footer; × clears and refocuses the box', () => {
    const el = mount(TYPED)
    expand(el)
    setValue(search(el), 'zzz')
    expect(rows(el)).toHaveLength(0)
    expect(status(el)).toBe('No properties found.')
    expect(btn(el, 'Add property')).not.toBeNull()
    expect(btn(el, 'Edit as YAML')).not.toBeNull()
    click(byLabel(el, 'Clear search properties'))
    expect(rows(el)).toHaveLength(6)
    expect(status(el)).toBeNull()
    expect(document.activeElement).toBe(search(el))
  })

  it('collapsing, Add property and the mode toggle all reset the query, so a row is never born hidden', () => {
    const el = mount(TYPED)
    expand(el)
    setValue(search(el), 'sta')
    expect(keysOf(el)).toEqual(['status'])
    expand(el) // collapse
    expand(el)
    expect(search(el)?.value).toBe('')
    expect(rows(el)).toHaveLength(6)

    setValue(search(el), 'sta')
    click(btn(el, 'Add property'))
    expect(search(el)?.value).toBe('')
    expect(rows(el)).toHaveLength(6)
    expect(byLabel(el, 'New property name')).not.toBeNull()

    click(btn(el, 'Cancel'))
    setValue(search(el), 'sta')
    toRaw(el)
    click(btn(el, 'Edit as rows'))
    expect(search(el)?.value).toBe('')
    expect(rows(el)).toHaveLength(6)
    expect(writeFile).not.toHaveBeenCalled()
  })
})

// ---------- an id link reads as the note's title (YAZ-2293 D8) ----------

describe('FrontmatterPanel — a stored id link reads as the note title (YAZ-2293 D8)', () => {
  const ID = 'k3m9x2pq7abc'
  /** One typed link row, and a list no typed editor can hold (the read-only YAML row). */
  const NOTE = `---\nparent: "[[${ID}]]"\nrefs:\n  - "[[${ID}]]"\n  - |\n    a\n    b\n---\nBody line\n`
  const feed = () => {
    const source = createWikilinkResolveSource()
    source.update(() => null, [{ ...TEST_RECORDS[0], path: '/vault/Home.md', name: 'Home.md', basename: 'Home', folder: '', id: ID }])
    return source
  }
  const linkIn = (el: HTMLElement, key: string) => rowOf(el, key).querySelector('.view-table__chip--link')?.textContent

  it('a link row and a read-only row both show the title, while the editor still holds the id the file stores', () => {
    const el = mount(NOTE, { root: ROOT, wikilinks: feed() })
    expand(el)
    expect(linkIn(el, 'parent')).toBe('Home')
    expect(linkIn(el, 'refs')).toBe('Home')
    click(rowOf(el, 'parent').querySelector('[data-edit]'))
    expect(byLabel<HTMLInputElement>(el, 'Edit parent')?.value).toBe(`[[${ID}]]`)
  })

  it('an id the index does not know shows as written', () => {
    const el = mount(NOTE, { root: ROOT })
    expand(el)
    expect(linkIn(el, 'parent')).toBe(ID)
  })
})
