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

/** Where the folder the note at PATH lives in keeps its settings (YAZ-2290 D1), and that folder's id. */
const FOLDER = '/vault/.folder.md'
const FOLDER_ID = 'w7x8y9z0a1b2'
/** The note's value for that folder's Status: in the folder's block of `in` (D19). */
const LOCAL_NOTE = `---\nin:\n  ${FOLDER_ID}:\n    Status: Ready\n---\nOriginal note body\n`
/** The window's feed after its first snapshot; `columns` undefined = the folder has no settings file. */
const folderFeed = (columns?: Record<string, PropertyDecl>) => {
  const source = createWikilinkResolveSource()
  const settings: IndexRecord[] = columns === undefined ? [] : [{ ...TEST_RECORDS[0], path: FOLDER, name: '.folder.md', basename: '.folder', folder: '', id: FOLDER_ID, properties: { folder_settings: { columns, views: [{ type: 'board', name: 'Board' }] } } }]
  source.update(() => null, [{ ...TEST_RECORDS[0], path: PATH, basename: 'Deep Work' }], settings)
  return source
}

/** A folder's `.folder.md` as the index hands it over; `columns` undefined = no settings saved. */
const folderMd = (dir: string, { columns, id }: { columns?: Record<string, PropertyDecl>; id?: string } = {}): IndexRecord => ({
  ...TEST_RECORDS[0],
  path: `${dir}/.folder.md`,
  name: '.folder.md',
  basename: '.folder',
  folder: dir === ROOT ? '' : dir.slice(ROOT.length + 1),
  id,
  properties: columns === undefined ? {} : { folder_settings: { columns, views: [{ type: 'board', name: 'Board' }] } },
})
const feedOf = (...folders: IndexRecord[]) => {
  const source = createWikilinkResolveSource()
  source.update(() => null, [], folders)
  return source
}

/** A note that is also a SHORTCUT in Areas (YAZ-2290 D2): `also_in` names that folder's id — and one no folder has. */
const AREAS_ID = 'k3m9x2pq7abc'
const SHORTCUT_NOTE = `---\nalso_in:\n  - ${AREAS_ID}\n  - a1b2c3d4e5f6\n---\nBody\n`
/** The living folder declares Status and effort; Areas declares effort (differently) and owner. */
const shortcutFeed = () => {
  const source = createWikilinkResolveSource()
  source.update(() => null, [], [folderMd(ROOT, { columns: { Status: { kind: 'select', options: ['Ready', 'Later'] }, effort: { kind: 'number' } } }), folderMd('/vault/Areas', { columns: { effort: { kind: 'text' }, owner: { kind: 'text' } }, id: AREAS_ID })])
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

  it('A note still carrying `folder_page`, `folder_pages` or `folder_page_settings` (the old model’s keys): ordinary frontmatter — each is the note’s own row, none hidden or Reserved; opening rewrites nothing and nothing is lost', async () => {
    const interior = 'folder_page: true\nfolder_pages:\n  - "[[KPIs]]"\nfolder_page_settings:\n  views:\n    - type: board\n      name: Board\ntitle: Old hub'
    const el = mount(`---\n${interior}\n---\nBody\n`, { root: ROOT, wikilinks: folderFeed() })
    expand(el)
    await flush()
    // Nothing reads them, so opening rewrites nothing.
    expect(writeFile).not.toHaveBeenCalled()
    expect(createFile).not.toHaveBeenCalled()
    // Every key a row, in the block's order, among the note's own; then the folder's one default column, unfilled.
    expect(keysOf(el)).toEqual(['folder_page', 'folder_pages', 'folder_page_settings', 'title', 'status'])
    expect(header(el)?.getAttribute('aria-label')).toBe('Properties (4)')
    // Typed by their own values, like any property: a flag, a list, and a map no editor can hold.
    for (const key of ['folder_page', 'folder_pages', 'folder_page_settings']) expect(chipIn(rowOf(el, key))).not.toBe('Reserved')
    expect(chipIn(rowOf(el, 'folder_page_settings'))).toBe('YAML') // what any nested map wears (`draft_layout` above)
    for (const key of ['folder_page', 'folder_pages']) {
      expect(chipIn(rowOf(el, key))).toBeNull()
      expect(byLabel(rowOf(el, key), `Configure ${key}`)).not.toBeNull() // removable like any property of the note's
    }
    expect(editorOf(el, 'folder_page')).toBe('checkbox')
    expect(editorOf(el, 'folder_pages')).toBe('chips')
    // And nothing is lost: the block is there as written.
    press(el.querySelector('.view-cell-edit__input'), 'Escape')
    toRaw(el)
    expect(area(el)?.value).toBe(interior)
    expect(writeFile).not.toHaveBeenCalled()
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

  it('an `id` that is no note id (a hand-written `id: 42`) is the user’s own property: an editor and no chip', () => {
    const el = mount('---\nid: 42\n---\nBody\n', { root: ROOT })
    expand(el)
    const r = rowOf(el, 'id')
    expect(chipIn(r)).toBeNull()
    expect(r.querySelector('[data-edit]')).not.toBeNull()
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

  it('ONE folder is in force at a time: the columns of a folder it is a SHORTCUT in are listed only once that folder is picked', () => {
    const el = mount(SHORTCUT_NOTE, { root: ROOT, wikilinks: shortcutFeed() })
    expand(el)
    // Its own key, then the living folder's two columns — Areas' `owner` is not merged in.
    expect(keysOf(el)).toEqual(['also_in', 'Status', 'effort'])
    expect(editorOf(el, 'effort')).toBe('number')
    setValue(el.querySelector<HTMLSelectElement>('.frontmatter-property-context select'), '/vault/Areas')
    expect(keysOf(el)).toEqual(['also_in', 'effort', 'owner'])
    expect(editorOf(el, 'effort')).toBe('text')
  })

  it('is typed by the folder the note LIVES in (YAZ-2290): its definition for uppercase Status, and only the note’s value for that folder is written', async () => {
    const wikilinks = folderFeed({ Status: { kind: 'select', options: ['Ready', 'Later'] } })
    readFile.mockResolvedValue(fileOf(LOCAL_NOTE))
    const el = mount(LOCAL_NOTE, { root: ROOT, wikilinks })
    expand(el)
    expect(el.querySelector('.frontmatter-property-context select')).toBeNull() // one folder, nothing to choose
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
    expect(header(el)?.textContent).toBe('1') // the count is the values the note HOLDS, never the empty rows
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
    expect(writeFile).toHaveBeenCalledExactlyOnceWith({ path: PATH, content: LOCAL_NOTE.replace('    Status: Ready\n', '    Status: Ready\n    effort: 3\n'), expectedMtime: 100 })
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

/** The panel says which folder its fields come from, and one folder is in force at a time. */
describe('FrontmatterPanel — "Properties from"', () => {
  const NOTE = '/vault/A/B/C/Note.md'
  const AREAS = '/vault/Areas'
  const HEALTH_ID = 'h4j5k6m7n8p9'
  const A_ID = 'a2b3c4d5e6f7'
  const B_ID = 'b3c4d5e6f7g8'
  /** A/B and A saved settings; C saved none. */
  const B_COLUMNS: Record<string, PropertyDecl> = { effort: { kind: 'number' }, owner: { kind: 'text' } }
  const A_COLUMNS: Record<string, PropertyDecl> = { effort: { kind: 'text' }, priority: { kind: 'text' } }
  const nested = () => feedOf(folderMd('/vault/A', { columns: A_COLUMNS, id: A_ID }), folderMd('/vault/A/B', { columns: B_COLUMNS, id: B_ID }), folderMd('/vault/A/B/C'))
  const mountAt = (path: string, content: string, wikilinks = nested(), properties?: PropertiesResponse): HTMLElement => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(<FrontmatterPanel file={{ path, content, mtime: 100 }} root={ROOT} wikilinks={wikilinks} properties={properties} />))
    expand(container)
    return container
  }
  const from = (el: HTMLElement) => el.querySelector('.frontmatter-property-context')
  const picker = (el: HTMLElement) => el.querySelector<HTMLSelectElement>('.frontmatter-property-context select')
  const choices = (el: HTMLElement) => [...(picker(el)?.options ?? [])].map((option) => option.textContent)
  const pick = (el: HTMLElement, dir: string) => setValue(picker(el), dir)

  it('a note in a folder, no folder above it, no shortcuts: reads "Properties from <that folder’s name>" — plain text, nothing to choose', () => {
    const el = mountAt('/vault/Projects/Note.md', 'Body\n', feedOf(folderMd('/vault/Projects')))
    expect(from(el)?.textContent).toBe('Properties from Projects')
    expect(el.querySelector('select')).toBeNull()
  })

  it('a note with folders above it: a dropdown — the folder it lives in and each folder above it, nearest first; the vault root is not a choice', () => {
    const el = mountAt(NOTE, 'Body\n')
    expect(from(el)?.textContent).toMatch(/^Properties from /)
    expect(choices(el)).toEqual(['C', 'B', 'A'])
    expect([...picker(el)!.options].map((option) => option.value)).toEqual(['/vault/A/B/C', '/vault/A/B', '/vault/A'])
  })

  it('a note that is a shortcut in other folders: those folders, and the folders above them, are choices too, after the ones above — each folder once', () => {
    const wikilinks = feedOf(folderMd('/vault/A', { id: A_ID }), folderMd('/vault/A/B'), folderMd(`${AREAS}/Health`, { id: HEALTH_ID }))
    const el = mountAt('/vault/A/B/Note.md', `---\nalso_in:\n  - ${HEALTH_ID}\n  - ${A_ID}\n---\nBody\n`, wikilinks)
    expect(choices(el)).toEqual(['B', 'A', 'Health', 'Areas'])
    // The words are the dropdown's name.
    expect(picker(el)?.labels[0].textContent).toMatch(/^Properties from /)
    expect(picker(el)?.hasAttribute('aria-label')).toBe(false)
  })

  it('two choices with the same name read as their paths from the root; a name only one has stays bare', () => {
    const wikilinks = feedOf(folderMd('/vault/A', { id: A_ID }), folderMd('/vault/A/Health'), folderMd(`${AREAS}/Health`, { id: HEALTH_ID }))
    const el = mountAt('/vault/A/Health/Note.md', `---\nalso_in:\n  - ${HEALTH_ID}\n---\nBody\n`, wikilinks)
    expect(choices(el)).toEqual(['A/Health', 'A', 'Areas/Health', 'Areas'])
  })

  it('a note in A/B/C where only A/B and A have saved settings: A/B is chosen first; C and A can be picked', () => {
    const el = mountAt(NOTE, 'Body\n')
    expect(picker(el)?.value).toBe('/vault/A/B')
    expect(keysOf(el)).toEqual(['effort', 'owner'])
    pick(el, '/vault/A/B/C')
    expect(keysOf(el)).toEqual(['status']) // nothing saved there: the default column
    pick(el, '/vault/A')
    expect(keysOf(el)).toEqual(['effort', 'priority'])
  })

  it('no folder in the list has saved settings: the folder the note lives in is chosen; its default columns show', () => {
    const el = mountAt(NOTE, 'Body\n', feedOf(folderMd('/vault/A'), folderMd('/vault/A/B'), folderMd('/vault/A/B/C')))
    expect(choices(el)).toEqual(['C', 'B', 'A'])
    expect(picker(el)?.value).toBe('/vault/A/B/C')
    expect(keysOf(el)).toEqual(['status'])
  })

  it('picking another folder: the rows are typed and listed by THAT folder’s columns — its unfilled columns are empty rows — and nothing is written', async () => {
    const el = mountAt(NOTE, `---\nin:\n  ${B_ID}:\n    effort: 3\n---\nBody\n`)
    expect(keysOf(el)).toEqual(['effort', 'owner'])
    expect(editorOf(el, 'effort')).toBe('number')
    expect(rowOf(el, 'effort').querySelector('.property-empty')).toBeNull() // B's value: 3
    pick(el, '/vault/A')
    expect(keysOf(el)).toEqual(['effort', 'priority'])
    expect(rowOf(el, 'effort').querySelector('.property-empty')).not.toBeNull() // A holds none
    expect(editorOf(el, 'effort')).toBe('text')
    expect(rowOf(el, 'priority').querySelector('[data-edit]')).not.toBeNull()
    press(el.querySelector('.view-cell-edit__input'), 'Escape')
    await flush()
    expect(readFile).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('the choice is not saved anywhere: remounting the panel chooses again by the rule, and a change of the note’s path resets it', async () => {
    const wikilinks = nested()
    const stored = JSON.stringify({ ...localStorage })
    let el = mountAt(NOTE, 'Body\n', wikilinks)
    pick(el, '/vault/A')
    expect(picker(el)?.value).toBe('/vault/A')
    // The editor mounts one panel per note (keyed by its path).
    act(() => root?.render(<FrontmatterPanel key="other" file={{ path: '/vault/A/B/C/Other.md', content: 'Body\n', mtime: 100 }} root={ROOT} wikilinks={wikilinks} />))
    expand(el)
    expect(picker(el)?.value).toBe('/vault/A/B')
    pick(el, '/vault/A')
    act(() => root?.unmount())
    el.remove()
    el = mountAt(NOTE, 'Body\n', wikilinks)
    expect(picker(el)?.value).toBe('/vault/A/B')
    await flush()
    expect(writeFile).not.toHaveBeenCalled()
    expect(JSON.stringify({ ...localStorage })).toBe(stored)
  })

  it('a field of the note’s own is typed by the lower rungs, else its own value — never by the chosen folder — and is listed before the folder’s rows', () => {
    const el = mountAt(NOTE, '---\ncount: 3\ndue: 2026-01-01\n---\nBody\n', nested(), declaring({ due: { kind: 'date' } }))
    expect(keysOf(el)).toEqual(['count', 'due', 'effort', 'owner'])
    expect(editorOf(el, 'count')).toBe('number') // its own value
    expect(editorOf(el, 'due')).toBe('date') // the legacy declaration
  })

  it('"Edit property" saves the definition to the CHOSEN folder’s `.folder.md`, and the popup says "In <chosen folder’s name>"', async () => {
    const chosen = '/vault/A/.folder.md'
    const bytes = '---\nfolder_settings:\n  columns:\n    effort:\n      kind: text\n    priority:\n      kind: text\n  views:\n    - type: board\n      name: Board\n---\n'
    readFile.mockResolvedValue({ path: chosen, content: bytes, mtime: 444, size: bytes.length })
    const el = mountAt(NOTE, `---\nin:\n  ${B_ID}:\n    effort: 3\n---\nBody\n`)
    pick(el, '/vault/A')
    click(byLabel(el, 'Configure effort'))
    click(buttonNamed(el, 'Edit property ›'))
    expect(document.querySelector('.frontmatter-property-menu__scope')?.textContent).toBe('In A')
    click(byLabel(el, 'Property type: Text'))
    click(buttonNamed(el, 'Number'))
    click(buttonNamed(document.querySelector('.frontmatter-property-menu__actions')!, 'Save'))
    await flush()
    expect(readFile).toHaveBeenCalledExactlyOnceWith(chosen)
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(writeFile.mock.calls[0][0].path).toBe(chosen)
    expect((parseFrontmatter(splitFrontmatter(writeFile.mock.calls[0][0].content).frontmatter).properties.folder_settings as { columns: unknown }).columns).toEqual({ effort: { kind: 'number' }, priority: { kind: 'text' } })
  })

  it('a note at the vault’s top level: "Properties from" the vault itself — the only choice is the root, by the vault folder’s name — and "Edit property" saves to `<vault>/.folder.md`', async () => {
    const bytes = '---\nfolder_settings:\n  columns:\n    Status:\n      kind: select\n  views:\n    - type: board\n      name: Board\n---\n'
    readFile.mockResolvedValue({ path: FOLDER, content: bytes, mtime: 444, size: bytes.length })
    const el = mountAt(PATH, LOCAL_NOTE, feedOf(folderMd(ROOT, { columns: { Status: { kind: 'select' } } }), folderMd('/vault/A')))
    expect(from(el)?.textContent).toBe('Properties from vault')
    expect(el.querySelector('select')).toBeNull()
    click(byLabel(el, 'Configure Status'))
    click(buttonNamed(el, 'Edit property ›'))
    expect(document.querySelector('.frontmatter-property-menu__scope')?.textContent).toBe('In vault')
    click(byLabel(el, 'Property type: Select'))
    click(buttonNamed(el, 'Multi-select'))
    click(buttonNamed(document.querySelector('.frontmatter-property-menu__actions')!, 'Save'))
    await flush()
    expect(writeFile.mock.calls.map(([write]) => write.path)).toEqual([FOLDER])
  })

  it('a folder’s own panel: no "Properties from", and its rows are not the folder’s columns', () => {
    const el = mountAt('/vault/A/B/.folder.md', '---\nowner: Yasin\n---\n')
    expect(from(el)).toBeNull()
    expect(el.textContent).not.toContain('Properties from')
    expect(keysOf(el)).toEqual(['owner'])
  })

  it('the raw YAML surface has no rows to type, so it names no folder', () => {
    const el = mountAt(NOTE, 'Body\n')
    toRaw(el)
    expect(from(el)).toBeNull()
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

/**
 * Two kinds of field (D19): the note's OWN, at the top level, and a FOLDER's, under `in` in the
 * block named by the folder's id. One list — the note's own rows, then "Properties from <folder>"
 * and that folder's rows — and every edit goes where its row lives.
 */
describe('FrontmatterPanel — each folder has its own properties (D19)', () => {
  const NOOR = '/vault/Hiring/Noor.md'
  const HIRING_ID = '3y7505rsr6fd'
  const TASKS_ID = 'mzf9cjhn02vm'
  /** Hiring declares a Status and a score; Tasks, where the note is a shortcut, a Status of its own and an owner. */
  const HIRING: Record<string, PropertyDecl> = { Status: { kind: 'select', options: ['Applied', 'Interview'] }, score: { kind: 'number' } }
  const TASKS: Record<string, PropertyDecl> = { Status: { kind: 'text' }, owner: { kind: 'text' } }
  const feedD19 = () => feedOf(folderMd('/vault/Hiring', { columns: HIRING, id: HIRING_ID }), folderMd('/vault/Tasks', { columns: TASKS, id: TASKS_ID }))
  const CONTENT = `---
id: k3m9x2pq7abc
aliases: [Noor]
Status: mine
also_in:
  - ${TASKS_ID}
in:
  ${HIRING_ID}:
    Status: Interview
    old_field: left behind
  ${TASKS_ID}:
    Status: 2-Todo
---
Body
`
  const mountNote = (content = CONTENT, path = NOOR, wikilinks = feedD19()): HTMLElement => {
    readFile.mockResolvedValue({ path, content, mtime: 100, size: content.length })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(<FrontmatterPanel file={{ path, content, mtime: 100 }} root={ROOT} wikilinks={wikilinks} />))
    expand(container)
    return container
  }
  const from = (el: HTMLElement) => el.querySelector<HTMLElement>('.frontmatter-property-context')
  /** The note's own rows: the ones above "Properties from". */
  const ownRows = (el: HTMLElement) => rows(el).filter((r) => (r.compareDocumentPosition(from(el)!) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0)
  /** The chosen folder's rows: the ones under it. */
  const folderRows = (el: HTMLElement) => [...el.querySelectorAll<HTMLLIElement>('.frontmatter-property-context ~ .frontmatter-panel__row')]
  const names = (list: HTMLLIElement[]) => list.map((r) => r.dataset.key)
  const row = (list: HTMLLIElement[], key: string): HTMLLIElement => {
    const found = list.find((r) => r.dataset.key === key)
    if (found === undefined) throw new Error(`no row for ${key}`)
    return found
  }
  const shows = (r: HTMLLIElement) => r.querySelector('.frontmatter-panel__value')?.textContent
  const edit = async (r: HTMLLIElement, value: string): Promise<void> => {
    click(r.querySelector('[data-edit]'))
    const input = r.querySelector<HTMLInputElement>('input')
    setValue(input, value)
    press(input, 'Enter')
    await flush()
  }
  const removeRow = async (r: HTMLLIElement): Promise<void> => {
    click(r.querySelector('.frontmatter-property-name'))
    click(buttonNamed(document.body, 'Remove from this note'))
    await flush()
  }
  const written = (): string => writeFile.mock.calls.at(-1)![0].content

  it('Open a note’s panel: the note’s own fields, then "Properties from <folder>" with that folder’s columns and the note’s values for that folder — unfilled columns as empty rows', () => {
    const el = mountNote()
    expect(names(ownRows(el))).toEqual(['id', 'aliases', 'Status', 'also_in'])
    expect(from(el)?.textContent).toMatch(/^Properties from /)
    expect(el.querySelector<HTMLSelectElement>('.frontmatter-property-context select')?.value).toBe('/vault/Hiring')
    expect(names(folderRows(el))).toEqual(['Status', 'old_field', 'score'])
    expect(shows(row(ownRows(el), 'Status'))).toBe('mine') // the note's own
    expect(shows(row(folderRows(el), 'Status'))).toBe('Interview') // Hiring's
    expect(shows(row(folderRows(el), 'score'))).toBe('Empty')
    // ONE list: the heading row sits in it, between the two groups.
    expect(from(el)?.parentElement).toBe(el.querySelector('.frontmatter-panel__rows'))
    expect(el.querySelectorAll('.frontmatter-panel__rows')).toHaveLength(1)
  })

  it('the count is the fields the note holds — its own, and its values for the chosen folder; `in` is not one', () => {
    const el = mountNote()
    expect(header(el)?.getAttribute('aria-label')).toBe('Properties (6)') // id, aliases, Status, also_in + Hiring's Status, old_field
    setValue(el.querySelector<HTMLSelectElement>('.frontmatter-property-context select'), '/vault/Tasks')
    expect(header(el)?.getAttribute('aria-label')).toBe('Properties (5)')
  })

  it('Pick another folder in the dropdown: the folder part shows that folder’s columns and values; the note’s own fields do not change', () => {
    const el = mountNote()
    const own = ownRows(el).map((r) => r.outerHTML)
    setValue(el.querySelector<HTMLSelectElement>('.frontmatter-property-context select'), '/vault/Tasks')
    expect(names(folderRows(el))).toEqual(['Status', 'owner'])
    expect(shows(row(folderRows(el), 'Status'))).toBe('2-Todo')
    expect(shows(row(folderRows(el), 'owner'))).toBe('Empty')
    expect(ownRows(el).map((r) => r.outerHTML)).toEqual(own)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('Edit a value under "Properties from <folder>": written to that folder’s block', async () => {
    const el = mountNote()
    await edit(row(folderRows(el), 'score'), '8')
    expect(writeFile).toHaveBeenCalledExactlyOnceWith({ path: NOOR, content: CONTENT.replace('    old_field: left behind\n', '    old_field: left behind\n    score: 8\n'), expectedMtime: 100 })
    // The panel's own belief of disk moved with it.
    toRaw(el)
    expect(area(el)?.value).toContain('    score: 8')
  })

  it('Edit one of the note’s own fields: written at the top level, as today', async () => {
    const el = mountNote()
    await edit(row(ownRows(el), 'Status'), 'yours')
    expect(writeFile).toHaveBeenCalledExactlyOnceWith({ path: NOOR, content: CONTENT.replace('Status: mine', 'Status: yours'), expectedMtime: 100 })
    expect(shows(row(folderRows(el), 'Status'))).toBe('Interview')
  })

  it('Add a property while a folder is chosen: added to that folder’s block', async () => {
    const el = mountNote()
    click(btn(el, 'Add property'))
    // Taken is asked of the FOLDER's block: the note's own `aliases` is no clash, Hiring's `old_field` is.
    setValue(byLabel<HTMLInputElement>(el, 'New property name'), 'old_field')
    click(btn(el, 'Add'))
    expect(errorLine(el)?.textContent).toBe('"old_field" is already a property of this page')
    setValue(byLabel<HTMLInputElement>(el, 'New property name'), 'aliases')
    setValue(byLabel<HTMLInputElement>(el, 'New property value'), 'N')
    click(btn(el, 'Add'))
    await flush()
    expect(writeFile).toHaveBeenCalledExactlyOnceWith({ path: NOOR, content: CONTENT.replace('    old_field: left behind\n', '    old_field: left behind\n    aliases: N\n'), expectedMtime: 100 })
    expect(names(folderRows(el))).toEqual(['Status', 'old_field', 'aliases', 'score'])
  })

  it('Add a property with no folder — a note outside any vault: it has no "Properties from", and the property is added at the top level, as today', async () => {
    const loose = '/elsewhere/Loose.md'
    const el = mountNote(CONTENT, loose) // the feed is the vault's: no folder of it shows this note
    expect(from(el)).toBeNull()
    expect(keysOf(el)).toEqual(['id', 'aliases', 'Status', 'also_in'])
    click(btn(el, 'Add property'))
    setValue(byLabel<HTMLInputElement>(el, 'New property name'), 'author')
    setValue(byLabel<HTMLInputElement>(el, 'New property value'), 'Cal')
    click(btn(el, 'Add'))
    await flush()
    expect(writeFile).toHaveBeenCalledExactlyOnceWith({ path: loose, content: CONTENT.replace('---\nBody', 'author: Cal\n---\nBody'), expectedMtime: 100 })
  })

  it('A value in a folder’s block for a column the folder no longer has: shown as a plain row under that folder, editable and removable', async () => {
    const el = mountNote()
    const old = row(folderRows(el), 'old_field')
    expect(chipIn(old)).toBeNull()
    expect(shows(old)).toBe('left behind')
    await edit(old, 'kept')
    expect(written()).toBe(CONTENT.replace('old_field: left behind', 'old_field: kept'))
    readFile.mockResolvedValue({ path: NOOR, content: written(), mtime: 100, size: 1 })
    await removeRow(row(folderRows(el), 'old_field'))
    expect(written()).toBe(CONTENT.replace('    old_field: left behind\n', ''))
    expect(names(folderRows(el))).toEqual(['Status', 'score'])
  })

  it('Remove a value under a folder: removed from that folder’s block only', async () => {
    const el = mountNote()
    await removeRow(row(folderRows(el), 'Status'))
    expect(writeFile).toHaveBeenCalledExactlyOnceWith({ path: NOOR, content: CONTENT.replace('    Status: Interview\n', ''), expectedMtime: 100 })
    expect(shows(row(folderRows(el), 'Status'))).toBe('Empty') // still Hiring's column: an empty row
    expect(shows(row(ownRows(el), 'Status'))).toBe('mine')
  })

  it('removing the last value under a folder takes its block, and `in` with the last block', async () => {
    const one = `---\ntitle: Noor\nin:\n  ${HIRING_ID}:\n    score: 8\n---\nBody\n`
    const el = mountNote(one)
    await removeRow(row(folderRows(el), 'score'))
    expect(written()).toBe('---\ntitle: Noor\n---\nBody\n')
  })

  describe('a folder’s values leave the note when the note leaves the folder (D20)', () => {
    const ARCHIVE_ID = 'a7ch1ve00001'
    const GONE_ID = 'n0f01der0000'
    /** Noor was moved into Hiring outside the app: it still holds Archive's values, and a deleted folder's. */
    const STALE = `  ${ARCHIVE_ID}:\n    Status: Old\n`
    const MOVED = CONTENT.replace('\nin:\n', `\nin:\n${STALE}  ${GONE_ID}:\n    Status: Lost\n`)
    const feedD20 = () => feedOf(folderMd('/vault/Archive', { id: ARCHIVE_ID }), folderMd('/vault/Hiring', { columns: HIRING, id: HIRING_ID }), folderMd('/vault/Tasks', { columns: TASKS, id: TASKS_ID }))

    it('reading a note, or opening its panel, never removes a block: nothing is written', async () => {
      const el = mountNote(MOVED, NOOR, feedD20())
      setValue(el.querySelector<HTMLSelectElement>('.frontmatter-property-context select'), '/vault/Tasks')
      await flush()
      expect(writeFile).not.toHaveBeenCalled()
      toRaw(el)
      expect(area(el)?.value).toContain(STALE)
    })

    it('a properties-panel edit of a folder value removes, in the SAME save, the blocks of folders that exist and do not show the note; the folders that show it, and one the app cannot find, keep theirs', async () => {
      const el = mountNote(MOVED, NOOR, feedD20())
      await edit(row(folderRows(el), 'score'), '8')
      expect(writeFile).toHaveBeenCalledExactlyOnceWith({ path: NOOR, content: MOVED.replace(STALE, '').replace('    old_field: left behind\n', '    old_field: left behind\n    score: 8\n'), expectedMtime: 100 })
      // The panel's own belief of disk moved with it.
      toRaw(el)
      expect(area(el)?.value).not.toContain(ARCHIVE_ID)
    })

    it('an edit of one of the note’s own fields does the same', async () => {
      const el = mountNote(MOVED, NOOR, feedD20())
      await edit(row(ownRows(el), 'Status'), 'yours')
      expect(writeFile).toHaveBeenCalledExactlyOnceWith({ path: NOOR, content: MOVED.replace(STALE, '').replace('Status: mine', 'Status: yours'), expectedMtime: 100 })
    })

    it('the write the removal rides on is refused: nothing is removed, and the panel says so', async () => {
      const el = mountNote(MOVED, NOOR, feedD20())
      writeFile.mockRejectedValueOnce(new Error('disk full'))
      await edit(row(ownRows(el), 'Status'), 'yours')
      toRaw(el)
      expect(area(el)?.value).toContain(STALE)
      expect(area(el)?.value).toContain('Status: mine')
    })
  })

  it('The `in` key itself: reserved — not a row, and not addable as a property name', () => {
    const el = mountNote()
    expect(keysOf(el)).not.toContain('in')
    click(btn(el, 'Add property'))
    setValue(byLabel<HTMLInputElement>(el, 'New property name'), 'in')
    click(btn(el, 'Add'))
    expect(errorLine(el)?.textContent).toBe("in is the app's own property — it is set where it belongs, not here")
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('`in` is no row with no folder either: a note the panel has no folder for shows its own fields alone', () => {
    const el = mount(CONTENT)
    expand(el)
    expect(keysOf(el)).toEqual(['id', 'aliases', 'Status', 'also_in'])
    expect(header(el)?.getAttribute('aria-label')).toBe('Properties (4)')
  })

  it('A note at the vault’s top level: its values go in the block of the vault’s own `.folder.md` id, like any folder', async () => {
    const top = '---\ntitle: Deep Work\n---\nBody\n'
    const el = mountNote(top, PATH, feedOf(folderMd(ROOT, { columns: { effort: { kind: 'number' } }, id: FOLDER_ID })))
    expect(from(el)?.textContent).toBe('Properties from vault')
    await edit(row(folderRows(el), 'effort'), '3')
    expect(writeFile).toHaveBeenCalledExactlyOnceWith({ path: PATH, content: `---\ntitle: Deep Work\nin:\n  ${FOLDER_ID}:\n    effort: 3\n---\nBody\n`, expectedMtime: 100 })
  })

  it('A folder’s own panel (the panel on a folder’s page): unchanged — the folder’s own properties are the top level of its `.folder.md`', async () => {
    const own = '/vault/Hiring/.folder.md'
    const bytes = `---\nid: ${HIRING_ID}\nowner: Yasin\nfolder_settings:\n  columns:\n    score:\n      kind: number\n---\n`
    const el = mountNote(bytes, own)
    expect(from(el)).toBeNull()
    expect(keysOf(el)).toEqual(['id', 'owner'])
    click(rowOf(el, 'owner').querySelector('[data-edit]'))
    setValue(byLabel<HTMLInputElement>(el, 'Edit owner'), 'Noor')
    press(byLabel(el, 'Edit owner'), 'Enter')
    await flush()
    expect(written()).toBe(bytes.replace('owner: Yasin', 'owner: Noor'))
    click(btn(el, 'Add property'))
    setValue(byLabel<HTMLInputElement>(el, 'New property name'), 'team')
    setValue(byLabel<HTMLInputElement>(el, 'New property value'), 'People')
    readFile.mockResolvedValue({ path: own, content: written(), mtime: 100, size: 1 })
    click(btn(el, 'Add'))
    await flush()
    expect(written()).toBe(bytes.replace('owner: Yasin', 'owner: Noor').replace(/---\n$/, 'team: People\n---\n'))
  })

  it('The raw YAML mode: shows the whole frontmatter, `in:` included, as written', () => {
    const el = mountNote()
    toRaw(el)
    expect(area(el)?.value).toBe(CONTENT.slice(4, CONTENT.indexOf('\n---\n')))
    expect(area(el)?.value).toContain(`in:\n  ${HIRING_ID}:\n    Status: Interview`)
  })

  it('a folder with no id shows its columns empty; the first value written there gives the folder its id first — the path its first shortcut uses — then writes', async () => {
    const note = '---\ntitle: Noor\n---\nBody\n'
    const disk = new Map<string, string>([[NOOR, note]])
    const el = mountNote(note, NOOR, feedOf(folderMd('/vault/Hiring', { columns: { score: { kind: 'number' } } })))
    readFile.mockImplementation(async (path) => {
      const content = disk.get(path)
      if (content === undefined) throw new BridgeRequestError('NOT_FOUND', 'path does not exist')
      return { path, content, mtime: 100, size: content.length }
    })
    writeFile.mockImplementation(async ({ path, content }) => {
      disk.set(path, content)
      return { path, mtime: 200, size: content.length }
    })
    expect(shows(row(folderRows(el), 'score'))).toBe('Empty')
    await edit(row(folderRows(el), 'score'), '8')
    await flush()
    expect(writeFile.mock.calls.map(([request]) => request.path)).toEqual(['/vault/Hiring/.folder.md', NOOR])
    const id = /^id: (\S+)$/m.exec(disk.get('/vault/Hiring/.folder.md')!)![1]
    expect(disk.get(NOOR)).toBe(`---\ntitle: Noor\nin:\n  ${id}:\n    score: 8\n---\nBody\n`)
  })
})
