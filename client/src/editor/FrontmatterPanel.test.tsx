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
import { type IndexRecord, type PropertyDecl, type PropertiesResponse } from '@shared/types'
import { FrontmatterPanel, type FrontmatterPanelProps } from './FrontmatterPanel'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { TEST_RECORDS } from '../views/testRecords'
import { createWikilinkResolveSource } from './wikilink/wikilinkPlugin'
import { settleFileWrites } from '../views/writeProperty'
import type { ColumnDecl } from '../views/folderSettings'

vi.mock('../api', async (importOriginal) => {
  const { propertiesStub } = await import('../views/propertiesStub')
  return {
    ...(await importOriginal<typeof import('../api')>()),
    // `mintNoteId` is the door in the main process (YAZ-2677 D4): the vault's next number.
    api: { readFile: vi.fn(), writeFile: vi.fn(), createFile: vi.fn(), mintNoteId: (await import('../testNoteIds')).testDoor(), properties: propertiesStub },
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

/** TYPED plus a name with spaces and capitals — an ordinary name since YAZ-4551 D19. */
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
/** An old per-page value (D19) for that folder's Status, in the folder's block of `in`: no row reads it unless the column is separate (YAZ-4713 C3). */
const LOCAL_NOTE = `---\nin:\n  ${FOLDER_ID}:\n    Status: Ready\n---\nOriginal note body\n`
/** The note's value for that folder's Status as the note's own field (YAZ-4713 C1). */
const FIELD_NOTE = `---\nStatus: Ready\n---\nOriginal note body\n`
/** The window's feed after its first snapshot, of a vault that uses IDs (YAZ-2523); `columns` undefined = the folder has no settings file. */
const folderFeed = (columns?: Record<string, PropertyDecl>) => {
  const source = createWikilinkResolveSource()
  const settings: IndexRecord[] = columns === undefined ? [] : [{ ...TEST_RECORDS[0], path: FOLDER, name: '.folder.md', basename: '.folder', title: 'vault', folder: '', id: FOLDER_ID, properties: { folder_settings: { columns, views: [{ type: 'board', name: 'Board' }] } } }]
  source.update(() => null, [{ ...TEST_RECORDS[0], path: PATH, basename: 'Deep Work' }], settings, true)
  return source
}

/** A folder's `.folder.md` as the index hands it over; `columns` undefined = no settings saved. */
const folderMd = (dir: string, { columns, id, title = dir.slice(dir.lastIndexOf('/') + 1) }: { columns?: Record<string, PropertyDecl>; id?: string; title?: string } = {}): IndexRecord => ({
  ...TEST_RECORDS[0],
  path: `${dir}/.folder.md`,
  name: '.folder.md',
  basename: '.folder',
  title,
  folder: dir === ROOT ? '' : dir.slice(ROOT.length + 1),
  id,
  properties: columns === undefined ? {} : { folder_settings: { columns, views: [{ type: 'board', name: 'Board' }] } },
})
/** A feed of those folders, in a vault that uses IDs: with none, the vault's kind and nothing else. */
const feedOf = (...folders: IndexRecord[]) => {
  const source = createWikilinkResolveSource()
  source.update(() => null, [], folders, true)
  return source
}

/** A note that is also a SHORTCUT in Areas (YAZ-2290 D2): `also_in` names that folder's id — and one no folder has. */
const AREAS_ID = 'k3m9x2pq7abc'
const SHORTCUT_NOTE = `---\nalso_in:\n  - ${AREAS_ID}\n  - a1b2c3d4e5f6\n---\nBody\n`
/** The living folder declares Status and effort; Areas declares effort (differently) and owner. */
const shortcutFeed = () => {
  const source = createWikilinkResolveSource()
  source.update(() => null, [], [folderMd(ROOT, { columns: { Status: { kind: 'select', options: ['Ready', 'Later'] }, effort: { kind: 'number' } } }), folderMd('/vault/Areas', { columns: { effort: { kind: 'text' }, owner: { kind: 'text' } }, id: AREAS_ID })], true)
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
    const el = mount(MESSY, { wikilinks: feedOf() })
    expect(header(el)?.getAttribute('aria-expanded')).toBe('false')
    expect(header(el)?.getAttribute('aria-label')).toBe('Properties (2)') // aliases and status: `title` is not counted (YAZ-2420 D27)
    expect(area(el)).toBeNull()
  })

  it('E: the `title` row is not shown and "Properties (N)" does not count it; the raw YAML view still shows the line (YAZ-2420 D27)', () => {
    const el = mount('---\ntitle: UP-001 - Abdul\nStatus: Ready\n---\nBody\n', { wikilinks: feedOf() })
    expect(header(el)?.getAttribute('aria-label')).toBe('Properties (1)')
    expand(el)
    expect(keysOf(el)).toEqual(['Status'])
    toRaw(el)
    expect(area(el)?.value).toBe('title: UP-001 - Abdul\nStatus: Ready')
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
    const el = mount(MESSY, { wikilinks: feedOf() })
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
    expect(header(el)?.getAttribute('aria-label')).toBe('Properties (2)')
  })

  it('the `title:` line edited in the raw YAML view is one more line of the block: it is saved, and the file is not renamed (YAZ-2420 D23)', async () => {
    readFile.mockResolvedValue(fileOf(MESSY))
    const el = mount(MESSY)
    expandRaw(el)
    typeInto(el, INTERIOR.replace('title: "Deep   Work"', 'title: Shallow Work'))
    click(btn(el, 'Save'))
    await settle()

    // The whole of what the panel asks of the bridge: this mock has no rename and no retitle to call.
    expect(writeFile).toHaveBeenCalledExactlyOnceWith({ path: PATH, content: MESSY.replace('title: "Deep   Work"', 'title: Shallow Work'), expectedMtime: 100 })
    expect(Object.keys(api)).toEqual(['readFile', 'writeFile', 'createFile', 'mintNoteId', 'properties'])
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
    // Any name is a property name (YAZ-4551 D19): "Not A Key" is typed by its value, like any other.
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

  it('adds a key — an empty name says "Type a property name", and a duplicate is refused outright', async () => {
    readFile.mockResolvedValue(fileOf(TYPED))
    const el = mount(TYPED)
    expand(el)
    click(btn(el, 'Add property'))

    setValue(byLabel<HTMLInputElement>(el, 'New property name'), '   ')
    click(btn(el, 'Add'))
    expect(errorLine(el)?.textContent).toBe('Type a property name')
    expect(writeFile).not.toHaveBeenCalled()

    setValue(byLabel<HTMLInputElement>(el, 'New property name'), 'status')
    click(btn(el, 'Add'))
    expect(errorLine(el)?.textContent).toBe('"status" is already a property of this page')
    expect(writeFile).not.toHaveBeenCalled()

    // A built-in prefix is refused with the same words as "+ Add column" (YAZ-4637 M7).
    setValue(byLabel<HTMLInputElement>(el, 'New property name'), 'file.size')
    click(btn(el, 'Add'))
    expect(errorLine(el)?.textContent).toBe('file.size starts with file., which the built-in columns use — choose another name')
    expect(writeFile).not.toHaveBeenCalled()

    setValue(byLabel<HTMLInputElement>(el, 'New property name'), 'author')
    click(btn(el, 'Add'))
    await flush()

    // No value is asked for (YAZ-4551 D20): the key starts with its kind's empty value.
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(writeFile).toHaveBeenCalledWith({
      path: PATH,
      content: TYPED.replace('parent: "[[Home]]"', 'parent: "[[Home]]"\nauthor: ""'),
      expectedMtime: 100,
    })
    // The form closes and the row is there, counted.
    expect(byLabel(el, 'New property name')).toBeNull()
    expect(keysOf(el)).toContain('author')
    expect(header(el)?.getAttribute('aria-label')).toBe('Properties (7)')
  })

  it("a new key starts on its DECLARED kind: the type list shows it, the first value is that kind's empty one, and no declaration is written again", async () => {
    readFile.mockResolvedValue(fileOf(TYPED))
    const el = mount(TYPED, { root: ROOT, properties: declaring({ rating: { kind: 'number' }, topics: { kind: 'list' } }) })
    expand(el)
    click(btn(el, 'Add property'))
    setValue(byLabel<HTMLInputElement>(el, 'New property name'), 'rating')
    expect(byLabel<HTMLSelectElement>(el, 'New property type')?.value).toBe('number')
    setValue(byLabel<HTMLInputElement>(el, 'New property name'), 'topics')
    expect(byLabel<HTMLSelectElement>(el, 'New property type')?.value).toBe('list')
    click(btn(el, 'Add'))
    await flush()

    expect(writeFile).toHaveBeenCalledWith({
      path: PATH,
      content: TYPED.replace('parent: "[[Home]]"', 'parent: "[[Home]]"\ntopics: []'),
      expectedMtime: 100,
    })
    expect((await propertiesStub.get(ROOT)).properties).toEqual({})
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
    // Every key a row, in the block's order, among the note's own; the folder has no column (YAZ-4713 C5).
    expect(keysOf(el)).toEqual(['folder_page', 'folder_pages', 'folder_page_settings'])
    expect(header(el)?.getAttribute('aria-label')).toBe('Properties (3)')
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
    const el = mount('---\nid: k3m9x2pq7abc\nstatus: draft\n---\nBody\n', { wikilinks: feedOf() })
    expand(el)
    expect(keysOf(el)).toEqual(['id', 'status'])
    const r = rowOf(el, 'id')
    expect(chipIn(r)).toBe('Reserved')
    expect(r.querySelector('[data-edit]')).toBeNull()
    expect(byLabel(r, 'Configure id')).toBeNull()
    expect(chipIn(rowOf(el, 'status'))).toBeNull()
  })

  it('an `id` that is no note id (another tool’s `id: 42`) is RESERVED like any other: the app writes its own over it, so it has no editor (YAZ-2420 D30)', () => {
    const el = mount('---\nid: 42\n---\nBody\n', { wikilinks: feedOf() })
    expand(el)
    const r = rowOf(el, 'id')
    expect(chipIn(r)).toBe('Reserved')
    expect(r.querySelector('[data-edit]')).toBeNull()
  })

  it('a link value naming a FOLDER by its id reads as the folder’s name, as a note’s reads as its title (YAZ-2290 D10)', () => {
    const source = createWikilinkResolveSource()
    source.update((target) => (target === AREAS_ID ? '/vault/Areas' : null), [], []) // the window's link resolver: a note, else a folder
    const el = mount(`---\narea: "[[${AREAS_ID}]]"\n---\nBody\n`, { root: ROOT, wikilinks: source })
    expand(el)
    // Changed by YAZ-4544 (4G): the link is the note editor's pill here, so it is read off the pill's class.
    expect(rowOf(el, 'area').querySelector('.view-link-pill')?.textContent).toBe('Areas')
    expect(rowOf(el, 'area').querySelector('.view-link-pill')?.classList.contains('file-icon--dir')).toBe(true)
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

  it('the note’s fields are typed by the page of the folder it LIVES in (YAZ-4713 C2, C8); a folder it is a shortcut in adds no column of its own', () => {
    const el = mount(SHORTCUT_NOTE, { root: ROOT, wikilinks: shortcutFeed() })
    expand(el)
    // Its own key, then the living folder's two columns as empty rows — Areas' `owner` is not merged in.
    expect(keysOf(el)).toEqual(['also_in', 'Status', 'effort'])
    expect(editorOf(el, 'effort')).toBe('number')
    expect(el.querySelector('.frontmatter-property-context select')).toBeNull() // no "Properties from"
  })

  it('is typed by the folder the note LIVES in (YAZ-2290): its definition for uppercase Status, and the note’s own field is written (YAZ-4713 C1)', async () => {
    const wikilinks = folderFeed({ Status: { kind: 'select', options: ['Ready', 'Later'] } })
    readFile.mockResolvedValue(fileOf(FIELD_NOTE))
    const el = mount(FIELD_NOTE, { root: ROOT, wikilinks })
    expand(el)
    expect(rowOf(el, 'Status').querySelector('.property-choice-chip')?.textContent).toBe('Ready')
    expect(byLabel(el, 'Type of Status')).toBeNull()
    expect(byLabel(el, 'Delete Status')).toBeNull()
    click(rowOf(el, 'Status').querySelector('[data-edit]'))
    expect([...document.querySelectorAll('[role="option"] .property-choice-chip')].map(option => option.textContent)).toEqual(['Ready', 'Later'])
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent?.startsWith('Later'))!
    click(option)
    await flush()
    expect(writeFile).toHaveBeenCalledExactlyOnceWith({ path: PATH, content: FIELD_NOTE.replace('Status: Ready', 'Status: Later'), expectedMtime: 100 })
  })

  it("the folder's columns the note has no value for are EMPTY rows — nothing is written until one is filled in, and then only that key (E1)", async () => {
    const wikilinks = folderFeed({ Status: { kind: 'select', options: ['Ready', 'Later'] }, effort: { kind: 'number' }, owner: { kind: 'text' } })
    readFile.mockResolvedValue(fileOf(FIELD_NOTE))
    const el = mount(FIELD_NOTE, { root: ROOT, wikilinks })
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
    expect(writeFile).toHaveBeenCalledExactlyOnceWith({ path: PATH, content: FIELD_NOTE.replace('Status: Ready\n', 'Status: Ready\neffort: 3\n'), expectedMtime: 100 })
  })

  it('a folder with no settings file has no column (YAZ-4713 C5): no empty row, and nothing is written', () => {
    const el = mount('Just a body\n', { root: ROOT, wikilinks: folderFeed() })
    expand(el)
    expect(keysOf(el)).toEqual([])
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

/** Add property works like a database (YAZ-4713 C8): the value is the note's field, and "Column on" picks the folder page that shows it. */
describe('FrontmatterPanel — "Column on" and the columns of the note’s page (YAZ-4713 C8)', () => {
  const NOTE = '/vault/A/B/C/Note.md'
  const A_ID = 'a2b3c4d5e6f7'
  const B_ID = 'b3c4d5e6f7g8'
  /** A/B and A saved settings; C saved none. */
  const B_COLUMNS: Record<string, PropertyDecl> = { effort: { kind: 'number' }, owner: { kind: 'text' } }
  const A_COLUMNS: Record<string, PropertyDecl> = { effort: { kind: 'text' }, priority: { kind: 'text' } }
  const nested = () => feedOf(folderMd('/vault/A', { columns: A_COLUMNS, id: A_ID }), folderMd('/vault/A/B', { columns: B_COLUMNS, id: B_ID }), folderMd('/vault/A/B/C'))
  const mountAt = (path: string, content: string, wikilinks = nested()): HTMLElement => {
    readFile.mockImplementation(async (p: string) => ({ path: p, content: p === path ? content : '', mtime: 100, size: 1 }))
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(<FrontmatterPanel file={{ path, content, mtime: 100 }} root={ROOT} wikilinks={wikilinks} />))
    expand(container)
    return container
  }
  const columnOn = (el: HTMLElement) => byLabel<HTMLSelectElement>(el, 'Column on')
  const choices = (el: HTMLElement) => [...(columnOn(el)?.options ?? [])].map((option) => option.textContent)
  const add = async (el: HTMLElement, name: string, on?: string): Promise<void> => {
    click(btn(el, 'Add property'))
    setValue(byLabel<HTMLInputElement>(el, 'New property name'), name)
    if (on !== undefined) setValue(columnOn(el), on)
    click(btn(el, 'Add'))
    await flush()
    await flush()
  }
  const saved = (path: string): Record<string, unknown> | undefined => {
    const write = writeFile.mock.calls.map((c) => c[0]).find((w) => w.path === path)
    return write === undefined ? undefined : ((parseFrontmatter(splitFrontmatter(write.content).frontmatter).properties.folder_settings as { columns: Record<string, unknown> }).columns)
  }

  it('the rows are the note’s fields, typed by its page’s columns — its folder’s over its parents’, nearest first (C2) — then the columns it holds no value for; no "Properties from"', () => {
    const el = mountAt(NOTE, '---\neffort: 3\n---\nBody\n')
    expect(el.querySelector('.frontmatter-property-context')).toBeNull()
    expect(keysOf(el)).toEqual(['effort', 'owner', 'priority'])
    expect(editorOf(el, 'effort')).toBe('number') // A/B's, the nearest
    expect(rowOf(el, 'priority').querySelector('.frontmatter-panel__key')?.getAttribute('title')).toBe('Column on A')
    expect(header(el)?.textContent).toBe('1')
  })

  it('"Column on" lists the note’s folder (the default), each folder above it — not the vault root — and "No column"', () => {
    const el = mountAt(NOTE, 'Body\n')
    click(btn(el, 'Add property'))
    expect(choices(el)).toEqual(['Column on C', 'Column on B', 'Column on A', 'No column'])
    expect(columnOn(el)?.value).toBe('/A/B/C')
  })

  it('a name a parent folder already defines: "Column on" starts on that folder, and Add writes no copy of its column (C6, 7A 8)', async () => {
    const el = mountAt(NOTE, 'Body\n')
    click(btn(el, 'Add property'))
    setValue(byLabel<HTMLInputElement>(el, 'New property name'), 'priority')
    expect(columnOn(el)?.value).toBe('/A')
    click(btn(el, 'Add'))
    await flush()
    await flush()
    expect(writeFile).toHaveBeenCalledExactlyOnceWith({ path: NOTE, content: '---\npriority: ""\n---\nBody\n', expectedMtime: 100 })
  })

  it('Settings › Folder pages › "Show parent folders’ columns" off: the rows are the note’s folder’s columns alone (C12, 7A 7)', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(<FrontmatterPanel file={{ path: '/vault/A/B/Note.md', content: 'Body\n', mtime: 100 }} root={ROOT} wikilinks={nested()} inheritColumns={false} />))
    expand(container)
    expect(keysOf(container)).toEqual(['effort', 'owner'])
  })

  it('adding `owner` with "Column on A": the field is the note’s own, and A’s `.folder.md` declares the column — a plain Text too', async () => {
    const el = mountAt(NOTE, 'Body\n')
    await add(el, 'reviewer', '/A')
    expect(saved('/vault/A/.folder.md')).toMatchObject({ reviewer: { kind: 'text' } })
    expect(writeFile.mock.calls.at(-1)![0]).toEqual({ path: NOTE, content: '---\nreviewer: ""\n---\nBody\n', expectedMtime: 100 })
  })

  it('"No column" writes only the field', async () => {
    const el = mountAt(NOTE, 'Body\n')
    await add(el, 'reviewer', 'no-column')
    expect(writeFile).toHaveBeenCalledExactlyOnceWith({ path: NOTE, content: '---\nreviewer: ""\n---\nBody\n', expectedMtime: 100 })
  })

  // CHECKER (YAZ-4713 round 1): fails at 0f4b998b8.
  it('CHECKER B3: "Column on A" when A’s folder page is read only (D36): A’s `.folder.md` is not written', async () => {
    const a = folderMd('/vault/A', { columns: A_COLUMNS, id: A_ID })
    const locked = { ...a, properties: { ...a.properties, readonly: true } }
    const A_FILE = '---\nreadonly: true\nfolder_settings:\n  columns:\n    effort:\n      kind: text\n    priority:\n      kind: text\n---\n'
    const el = mountAt(NOTE, 'Body\n', feedOf(locked, folderMd('/vault/A/B', { columns: B_COLUMNS, id: B_ID }), folderMd('/vault/A/B/C')))
    readFile.mockImplementation(async (p: string) => ({ path: p, content: p === NOTE ? 'Body\n' : p === '/vault/A/.folder.md' ? A_FILE : '', mtime: 100, size: 1 }))
    await add(el, 'reviewer', '/A')
    expect(writeFile.mock.calls.map((c) => c[0].path)).not.toContain('/vault/A/.folder.md')
    expect(el.querySelector('[role="alert"]')?.textContent).toBe('Could not add "reviewer": A\'s folder page is read only')
  })

  it('"Edit property" › Save on a field that read-only A defines (D36): A’s `.folder.md` is not written, and the folder page’s words say why', async () => {
    const a = folderMd('/vault/A', { columns: A_COLUMNS, id: A_ID })
    const locked = { ...a, properties: { ...a.properties, readonly: true } }
    const el = mountAt(NOTE, '---\npriority: P1\n---\nBody\n', feedOf(locked, folderMd('/vault/A/B', { columns: B_COLUMNS, id: B_ID }), folderMd('/vault/A/B/C')))
    click(byLabel(el, 'Configure priority'))
    click(buttonNamed(el, 'Edit property ›'))
    click(buttonNamed(document.querySelector('.frontmatter-property-menu__actions')!, 'Save'))
    await flush()
    expect(writeFile).not.toHaveBeenCalled()
    expect(document.querySelector('.frontmatter-property-menu [role="alert"]')?.textContent).toBe("Could not save the property: A's folder page is read only")
  })

  it('"Edit property" › Save on a field A defines with "Separate value for A" on: A keeps its switch (C3)', async () => {
    const A_SEPARATE: Record<string, ColumnDecl> = { ...A_COLUMNS, priority: { kind: 'text', separate: true } }
    const A_FILE = '---\nfolder_settings:\n  columns:\n    effort:\n      kind: text\n    priority:\n      kind: text\n      separate: true\n---\n'
    const el = mountAt(NOTE, '---\npriority: P1\n---\nBody\n', feedOf(folderMd('/vault/A', { columns: A_SEPARATE, id: A_ID }), folderMd('/vault/A/B', { columns: B_COLUMNS, id: B_ID }), folderMd('/vault/A/B/C')))
    readFile.mockImplementation(async (p: string) => ({ path: p, content: p === '/vault/A/.folder.md' ? A_FILE : '---\npriority: P1\n---\nBody\n', mtime: 100, size: 1 }))
    click(byLabel(el, 'Configure priority'))
    click(buttonNamed(el, 'Edit property ›'))
    click(byLabel(el, 'Property type: Text'))
    click(buttonNamed(el, 'Number'))
    click(buttonNamed(document.querySelector('.frontmatter-property-menu__actions')!, 'Save'))
    await flush()
    expect(saved('/vault/A/.folder.md')).toMatchObject({ priority: { kind: 'number', separate: true } })
  })

  it('"Edit property" on a field a parent folder defines saves that folder’s column: "In A"', async () => {
    const el = mountAt(NOTE, '---\npriority: P1\n---\nBody\n')
    click(byLabel(el, 'Configure priority'))
    click(buttonNamed(el, 'Edit property ›'))
    expect(document.querySelector('.frontmatter-property-menu__scope')?.textContent).toBe('In A')
  })

  it('a folder’s own panel: its own fields, typed by its parent’s page when a parent view shows subfolders as rows (YAZ-3746 2D, D31); the value is its own top-level key', async () => {
    const own = '/vault/A/B/.folder.md'
    const bytes = `---\nid: ${B_ID}\nowner: Yasin\n---\n`
    const a = folderMd('/vault/A', { columns: A_COLUMNS, id: A_ID })
    const rowsOfA = { ...a, properties: { folder_settings: { columns: A_COLUMNS, views: [{ type: 'table', name: 'T', subfolders: 'rows' }] } } }
    const el = mountAt(own, bytes, feedOf(rowsOfA, folderMd('/vault/A/B', { columns: B_COLUMNS, id: B_ID })))
    expect(keysOf(el)).toEqual(['id', 'owner', 'effort', 'priority'])
    expect(columnOn(el)).toBeNull()
    click(rowOf(el, 'priority').querySelector('[data-edit]'))
    setValue(byLabel<HTMLInputElement>(el, 'Edit priority'), 'P1')
    press(byLabel(el, 'Edit priority'), 'Enter')
    await flush()
    expect(writeFile).toHaveBeenCalledExactlyOnceWith({ path: own, content: `---\nid: ${B_ID}\nowner: Yasin\npriority: P1\n---\n`, expectedMtime: 100 })
  })

  it('a subfolder that is no row of its parent, and the vault root’s own panel: their own fields alone', () => {
    expect(keysOf(mountAt('/vault/A/B/.folder.md', '---\nowner: Yasin\n---\n'))).toEqual(['owner'])
    act(() => root?.unmount())
    container?.remove()
    expect(keysOf(mountAt('/vault/.folder.md', '---\nowner: Yasin\n---\n'))).toEqual(['owner'])
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
    act(() => root?.render(<FrontmatterPanel file={{ path: OWN, content, mtime: 0 }} wikilinks={feedOf()} />))
    return container
  }

  it('E: the folder\'s `title` is no row here either, and is not counted (YAZ-2420 D27)', () => {
    const el = mountOwn('---\ntitle: Upwork 2026\nowner: Yasin\n---\n')
    expect(header(el)?.getAttribute('aria-label')).toBe('Properties (1)')
    expand(el)
    expect(keysOf(el)).toEqual(['owner'])
  })

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
    source.update(() => null, [{ ...TEST_RECORDS[0], path: '/vault/home-k3m9x2pq7abc.md', name: 'home-k3m9x2pq7abc.md', basename: 'home-k3m9x2pq7abc', title: 'Home', folder: '', id: ID }])
    return source
  }
  // Changed by YAZ-4544 (4G): a link reads as the note editor's pill here too, so the chip class is the pill's.
  const linkIn = (el: HTMLElement, key: string) => rowOf(el, key).querySelector('.view-link-pill')?.textContent

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

  it('a link is the note editor’s pill, with its page’s icon; a click opens the page and edits nothing; ⌘-click opens a background tab; the pointer on it shows the linked page (YAZ-4544 4G)', () => {
    const open = { onOpenFile: vi.fn(), onOpenFileBackground: vi.fn() }
    const hover = { onHover: vi.fn(), onLeave: vi.fn() }
    const el = mount(NOTE, { root: ROOT, wikilinks: feed(), links: { open, hover } })
    expand(el)
    const pill = rowOf(el, 'parent').querySelector<HTMLElement>('.view-link-pill')!
    expect(pill.classList.contains('wikilink')).toBe(true)
    expect(pill.dataset.linkPath).toBe('/vault/home-k3m9x2pq7abc.md')
    expect(pill.classList.contains('file-icon--file')).toBe(true)
    expect(pill.dataset.kind).toBe('markdown')
    act(() => void pill.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    expect(hover.onHover).toHaveBeenCalledWith('/vault/home-k3m9x2pq7abc.md', expect.any(Object), false)
    act(() => void pill.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: rowOf(el, 'parent') })))
    expect(hover.onLeave).toHaveBeenCalledTimes(1)
    click(pill)
    expect(open.onOpenFile).toHaveBeenCalledWith('/vault/home-k3m9x2pq7abc.md')
    expect(byLabel(el, 'Edit parent')).toBeNull()
    act(() => void pill.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true })))
    expect(open.onOpenFileBackground).toHaveBeenCalledWith('/vault/home-k3m9x2pq7abc.md')
  })

  it('a text row still edits as text: the panel’s text editor does not complete `[[` (YAZ-4544 4G keeps it)', () => {
    const el = mount('---\nnote: see it\n---\n', { root: ROOT, wikilinks: feed() })
    expand(el)
    expect(editorOf(el, 'note')).toBe('text')
  })
})

/**
 * Two kinds of value (YAZ-4713): the note's OWN field, at the top level, one per key (C1), and a page's
 * own value of a "Separate value for <folder>" column, under `in` in the block named by the page's id (C3),
 * shown as "<column> · <folder>". A block no page shows is listed under "Values from pages that do not show
 * this note", with Clear (C9). Every edit goes where its row lives.
 */
describe('FrontmatterPanel — a page’s own values, and values no page shows (YAZ-4713 C3, C9)', () => {
  const NOOR = '/vault/Hiring/Noor.md'
  const HIRING_ID = '3y7505rsr6fd'
  const TASKS_ID = 'mzf9cjhn02vm'
  const ARCHIVE_ID = 'a7ch1ve00001'
  /** Hiring declares a Status and a score; Tasks, where the note is a shortcut, keeps its own Status (C3) and declares an owner. */
  const HIRING: Record<string, PropertyDecl> = { Status: { kind: 'select', options: ['Applied', 'Interview'] }, score: { kind: 'number' } }
  const TASKS: Record<string, PropertyDecl> = { Status: { kind: 'text', separate: true } as PropertyDecl, owner: { kind: 'text' } }
  const feed = () => feedOf(folderMd('/vault/Archive', { id: ARCHIVE_ID }), folderMd('/vault/Hiring', { columns: HIRING, id: HIRING_ID, title: 'Hiring' }), folderMd('/vault/Tasks', { columns: TASKS, id: TASKS_ID, title: 'Tasks' }))
  const CONTENT = `---
id: k3m9x2pq7abc
aliases: [Noor]
Status: Interview
also_in:
  - ${TASKS_ID}
in:
  ${TASKS_ID}:
    Status: 2-Todo
  ${ARCHIVE_ID}:
    Status: Old
---
Body
`
  const mountNote = (content = CONTENT, wikilinks = feed()): HTMLElement => {
    readFile.mockResolvedValue({ path: NOOR, content, mtime: 100, size: content.length })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(<FrontmatterPanel file={{ path: NOOR, content, mtime: 100 }} root={ROOT} wikilinks={wikilinks} />))
    expand(container)
    return container
  }
  const written = (): string => writeFile.mock.calls.at(-1)![0].content
  const kept = (el: HTMLElement) => [...el.querySelectorAll('.frontmatter-panel__kept .frontmatter-panel__key')].map((k) => k.textContent)

  it('the shared value and a page’s own value, each clearly named: "Status" and "Status · Tasks" (Yaseen, 2026-11-08); `in` is no row', () => {
    const el = mountNote()
    // Then, apart, the value of a page that does not show the note (C9).
    expect(keysOf(el)).toEqual(['id', 'aliases', 'Status', 'also_in', 'score', 'Status · Tasks', 'Status · Archive'])
    expect(rows(el).find((r) => r.querySelector('.frontmatter-panel__key')?.textContent === 'Status · Tasks')?.querySelector('.frontmatter-panel__value')?.textContent).toBe('2-Todo')
    expect(header(el)?.getAttribute('aria-label')).toBe('Properties (5)')
  })

  it('an edit of "Status · Tasks" writes Tasks’ block; an edit of "Status" the note’s own field', async () => {
    const el = mountNote()
    const separate = rows(el).find((r) => r.querySelector('.frontmatter-panel__key')?.textContent === 'Status · Tasks')!
    click(separate.querySelector('[data-edit]'))
    setValue(separate.querySelector<HTMLInputElement>('input'), '3-Doing')
    press(separate.querySelector('input'), 'Enter')
    await flush()
    expect(written()).toBe(CONTENT.replace('Status: 2-Todo', 'Status: 3-Doing'))
  })

  it('"Other folders’ values for this note" (C9): Archive’s value, with Clear — which removes only it', async () => {
    const el = mountNote()
    expect(el.querySelector('.frontmatter-panel__kept .frontmatter-property-context')?.textContent).toBe("Other folders' values for this note")
    expect(kept(el)).toEqual(['Status · Archive'])
    click(byLabel(el, 'Clear Status · Archive'))
    await flush()
    expect(written()).toBe(CONTENT.replace(`  ${ARCHIVE_ID}:\n    Status: Old\n`, ''))
  })

  it('an edit never drops a block (C9): a page the note left keeps its value until it is cleared', async () => {
    const el = mountNote()
    const scoreRow = rowOf(el, 'score')
    click(scoreRow.querySelector('[data-edit]'))
    setValue(scoreRow.querySelector<HTMLInputElement>('input'), '4')
    press(scoreRow.querySelector('input'), 'Enter')
    await flush()
    expect(written()).toBe(CONTENT.replace('---\nBody', 'score: 4\n---\nBody'))
  })

  it('a separate column on a page with no id: its row shows empty beside the shared one, and nothing is kept elsewhere', () => {
    const tasks = { ...folderMd('/vault/Tasks', { columns: TASKS, title: 'Tasks' }), id: undefined }
    const bytes = '---\nStatus: Interview\n---\nBody\n'
    const el = mountNote(bytes, feedOf(folderMd('/vault/Hiring', { columns: { Status: { kind: 'text', separate: true } as PropertyDecl }, title: 'Hiring' }), tasks))
    expect(keysOf(el)).toEqual(['Status', 'Status · Hiring'])
    expect(kept(el)).toEqual([])
  })

  describe('in a vault that does not use IDs (YAZ-2523 V5, V12)', () => {
    const unnumbered = (): IndexRecord[] => [folderMd('/vault/Archive'), folderMd('/vault/Hiring', { columns: HIRING }), folderMd('/vault/Tasks', { columns: TASKS })]
    const plainFeed = () => {
      const source = createWikilinkResolveSource()
      source.update(() => null, [], unnumbered())
      return source
    }
    const BLOCKS = CONTENT.slice(CONTENT.indexOf('\nin:\n') + 1, CONTENT.indexOf('---\nBody'))
    const PLAIN = CONTENT.replace('aliases: [Noor]\n', 'title: Noor Khan\naliases: [Noor]\n').replace('---\nBody', 'comments: []\nreviews: []\n---\nBody')

    it('no page’s own rows and no kept values: the note’s own frontmatter, `title` and `in` among them, then its page’s columns it holds no value for', () => {
      const el = mountNote(PLAIN, plainFeed())
      expect(keysOf(el)).toEqual(['id', 'title', 'aliases', 'Status', 'also_in', 'in', 'comments', 'reviews', 'score'])
      expect(kept(el)).toEqual([])
      expect(header(el)?.getAttribute('aria-label')).toBe('Properties (8)')
    })

    it('`id`, `title` and `also_in` are ordinary; `in` is a value no editor holds; `comments` and `reviews` are still Reserved', () => {
      const el = mountNote(PLAIN, plainFeed())
      for (const key of ['id', 'title', 'also_in']) expect(rowOf(el, key).querySelector('[data-edit]')).not.toBeNull()
      expect(rowOf(el, 'also_in').querySelector('.frontmatter-panel__value')?.textContent).toBe(TASKS_ID)
      expect(chipIn(rowOf(el, 'in'))).toBe('YAML')
      for (const key of ['comments', 'reviews']) expect(chipIn(rowOf(el, key))).toBe('Reserved')
    })

    it('an edit writes that one line: the `in:` blocks stay byte for byte', async () => {
      const el = mountNote(PLAIN, plainFeed())
      click(rowOf(el, 'title').querySelector('[data-edit]'))
      setValue(rowOf(el, 'title').querySelector<HTMLInputElement>('input'), 'Noor K')
      press(rowOf(el, 'title').querySelector('input'), 'Enter')
      await flush()
      expect(written()).toBe(PLAIN.replace('title: Noor Khan', 'title: Noor K'))
      expect(written()).toContain(BLOCKS)
    })
  })
})

describe('a read-only note (YAZ-3076 D2, S23)', () => {
  const LOCKED = TYPED.replace('---\n', '---\nreadonly: true\n')

  it('every row is its value with no editor and no property menu; `readonly` itself is Reserved; no Add property', () => {
    const el = mount(LOCKED, { readOnly: true })
    expand(el)
    expect(keysOf(el)).toContain('readonly')
    expect(chipIn(rowOf(el, 'readonly'))).toBe('Reserved')
    // A flag's value is drawn as a disabled box; nothing in a row takes input.
    for (const row of rows(el)) expect(row.querySelector('input:not([disabled]), select, textarea, button, [contenteditable="true"]'), row.dataset.key).toBeNull()
    expect(el.querySelector('[aria-label^="Configure "]')).toBeNull()
    expect(btn(el, 'Add property')).toBeNull()
    // A row the user could edit before carries no chip: it is not the app's, only locked.
    expect(chipIn(rowOf(el, 'parent'))).toBeNull()
  })

  it('the YAML is shown but cannot be typed into, and nothing saves', () => {
    const el = mount(LOCKED, { readOnly: true })
    expandRaw(el)
    expect(area(el)?.value).toContain('readonly: true')
    expect(area(el)?.readOnly).toBe(true)
    expect(btn(el, 'Save')).toBeNull()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('a YAML draft typed before the switch turned on loses its Save; the switch going off gives it back', () => {
    const el = mount(TYPED)
    expandRaw(el)
    typeInto(el, 'status: changed\n')
    expect(btn(el, 'Save')).not.toBeNull()
    rerender(TYPED, { readOnly: true })
    expect(btn(el, 'Save')).toBeNull()
    expect(area(el)?.readOnly).toBe(true)
    // The draft is the user's text: it is kept, and "Allow edits" gives its Save back.
    rerender(TYPED, { readOnly: false })
    expect(area(el)?.value).toBe('status: changed\n')
    expect(btn(el, 'Save')).not.toBeNull()
  })
})

describe('FrontmatterPanel — any name, a type when you add, a real right-click (YAZ-4551)', () => {
  const contextMenu = (target: Element | null): MouseEvent => {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 30, clientY: 40 })
    act(() => void target?.dispatchEvent(event))
    return event
  }
  const menuItems = (): string[] => [...document.querySelectorAll('.ctx-menu [role="menuitem"]')].map((b) => b.textContent ?? '')
  const menuItem = (text: string): HTMLButtonElement => {
    const b = [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')].find((n) => n.textContent === text)
    if (b === undefined) throw new Error(`no menu item ${text}`)
    return b
  }

  it('a note’s "Due Date" with a date value gets the date editor (D19: no name gate)', () => {
    const el = mount('---\nDue Date: 2026-12-01\nAI or App: App\n---\nBody\n')
    expand(el)
    expect(editorOf(el, 'Due Date')).toBe('date')
    expect(editorOf(el, 'AI or App')).toBe('text')
  })

  it('Add asks for a name and a type, no value: "Due Date" as a Date writes an empty value and the declaration in properties.json', async () => {
    readFile.mockResolvedValue(fileOf(TYPED))
    const el = mount(TYPED, { root: ROOT })
    expand(el)
    click(btn(el, 'Add property'))
    expect(byLabel(el, 'New property value')).toBeNull()
    expect(byLabel<HTMLInputElement>(el, 'New property name')?.placeholder).toBe('Property name')
    const type = byLabel<HTMLSelectElement>(el, 'New property type')!
    expect(type.value).toBe('text')
    expect([...type.options].map((o) => o.textContent)).toEqual(['Text', 'Number', 'Date', 'Checkbox', 'List', 'Link', 'Multi-link', 'Select', 'Multi-select'])
    setValue(byLabel<HTMLInputElement>(el, 'New property name'), 'Due Date')
    setValue(type, 'date')
    click(btn(el, 'Add'))
    await flush()
    expect((await propertiesStub.get(ROOT)).properties).toEqual({ 'Due Date': { kind: 'date' } })
    // A date starts as no value, `key:` (YAZ-4551 polish): '' would read as a text value.
    expect(writeFile).toHaveBeenCalledExactlyOnceWith({ path: PATH, content: TYPED.replace('parent: "[[Home]]"', 'parent: "[[Home]]"\nDue Date:'), expectedMtime: 100 })
    expect(keysOf(el)).toContain('Due Date')
  })

  it.each([
    ['number', 'Score:'],
    ['date', 'Score:'],
    ['link', 'Score:'],
    ['select', 'Score:'],
    ['text', 'Score: ""'],
    ['checkbox', 'Score: false'],
    ['list', 'Score: []'],
    ['multi-select', 'Score: []'],
  ])('a new %s property starts as `%s`', async (kind, line) => {
    readFile.mockResolvedValue(fileOf(TYPED))
    const el = mount(TYPED, { root: ROOT })
    expand(el)
    click(btn(el, 'Add property'))
    setValue(byLabel<HTMLInputElement>(el, 'New property name'), 'Score')
    setValue(byLabel<HTMLSelectElement>(el, 'New property type'), kind)
    click(btn(el, 'Add'))
    await flush()
    expect(writeFile).toHaveBeenCalledExactlyOnceWith({ path: PATH, content: TYPED.replace('parent: "[[Home]]"', `parent: "[[Home]]"\n${line}`), expectedMtime: 100 })
  })

  it('Enter in the name box adds; Text for a name with no type writes no declaration', async () => {
    readFile.mockResolvedValue(fileOf(TYPED))
    const el = mount(TYPED, { root: ROOT })
    expand(el)
    click(btn(el, 'Add property'))
    const name = byLabel<HTMLInputElement>(el, 'New property name')!
    setValue(name, 'Yaseen')
    press(name, 'Enter')
    await flush()
    expect(writeFile).toHaveBeenCalledExactlyOnceWith({ path: PATH, content: TYPED.replace('parent: "[[Home]]"', 'parent: "[[Home]]"\nYaseen: ""'), expectedMtime: 100 })
    expect((await propertiesStub.get(ROOT)).properties).toEqual({})
  })

  it('a property added with "Column on <folder>" (the default) writes its type as that folder’s column, then the empty value as the note’s own field (YAZ-4713 C8)', async () => {
    const wikilinks = folderFeed({ Status: { kind: 'select', options: ['Ready', 'Later'] } })
    const folderBytes = `---\nid: ${FOLDER_ID}\nfolder_settings:\n  columns:\n    Status:\n      kind: select\n      options: [Ready, Later]\n  views:\n    - type: board\n      name: Board\n---\n`
    readFile.mockImplementation(async (path: string) => (path === FOLDER ? { path, content: folderBytes, mtime: 300, size: 1 } : fileOf(FIELD_NOTE)))
    const el = mount(FIELD_NOTE, { root: ROOT, wikilinks })
    expand(el)
    click(btn(el, 'Add property'))
    setValue(byLabel<HTMLInputElement>(el, 'New property name'), 'Due Date')
    setValue(byLabel<HTMLSelectElement>(el, 'New property type'), 'date')
    click(btn(el, 'Add'))
    await flush()
    await flush()
    expect(writeFile).toHaveBeenCalledTimes(2)
    const [column, value] = writeFile.mock.calls.map((c) => c[0])
    expect(column.path).toBe(FOLDER)
    expect((parseFrontmatter(splitFrontmatter(column.content).frontmatter).properties.folder_settings as { columns: unknown }).columns).toEqual({
      Status: { kind: 'select', options: ['Ready', 'Later'] },
      'Due Date': { kind: 'date' },
    })
    expect(value).toEqual({ path: PATH, content: FIELD_NOTE.replace('Status: Ready\n', 'Status: Ready\nDue Date:\n'), expectedMtime: 100 })
    expect((await propertiesStub.get(ROOT)).properties).toEqual({}) // a folder's property is not vault-wide
  })

  it('a note at the vault root: "Column on <vault>" and "No column" are two choices, and either can be picked again (7A 1)', async () => {
    readFile.mockImplementation(async () => fileOf(FIELD_NOTE))
    const el = mount(FIELD_NOTE, { root: ROOT, wikilinks: folderFeed({ Status: { kind: 'select', options: ['Ready', 'Later'] } }) })
    expand(el)
    click(btn(el, 'Add property'))
    setValue(byLabel<HTMLInputElement>(el, 'New property name'), 'Due Date')
    const columnOn = byLabel<HTMLSelectElement>(el, 'Column on')!
    expect([...columnOn.options].map((o) => o.textContent)).toEqual(['Column on vault', 'No column'])
    expect(columnOn.value).toBe('/')
    setValue(columnOn, 'no-column')
    expect(byLabel<HTMLSelectElement>(el, 'Column on')!.value).toBe('no-column')
    setValue(byLabel<HTMLSelectElement>(el, 'Column on')!, '/')
    expect(byLabel<HTMLSelectElement>(el, 'Column on')!.value).toBe('/')
    setValue(byLabel<HTMLSelectElement>(el, 'Column on')!, 'no-column')
    click(btn(el, 'Add'))
    await flush()
    await flush()
    expect(writeFile).toHaveBeenCalledExactlyOnceWith({ path: PATH, content: FIELD_NOTE.replace('Status: Ready\n', 'Status: Ready\nDue Date: ""\n'), expectedMtime: 100 })
  })

  it('a right-click is no native menu: it closes the popover and opens "<Type> · <name>", Change type ›, Rename…, Copy value, Remove from this note', () => {
    const el = mount(TYPED, { root: ROOT })
    expand(el)
    click(byLabel(el, 'Configure status'))
    expect(document.querySelector('.frontmatter-property-menu')).not.toBeNull()
    const event = contextMenu(byLabel(el, 'Configure status'))
    expect(event.defaultPrevented).toBe(true)
    expect(document.querySelector('.frontmatter-property-menu')).toBeNull()
    expect(document.querySelector('.ctx-menu .ctx-menu__heading')?.textContent).toBe('Text · status')
    expect(menuItems()).toEqual(['Change type ›', 'Rename…', 'Copy value', 'Remove from this note'])
    press(document.body, 'Escape')
    contextMenu(byLabel(el, 'Configure pages'))
    expect(document.querySelector('.ctx-menu .ctx-menu__heading')?.textContent).toBe('Number · pages')
  })

  it('Change type › opens the same definition editor; for a note field Save writes properties.json, and nothing in the note', async () => {
    const el = mount(TYPED, { root: ROOT })
    expand(el)
    contextMenu(byLabel(el, 'Configure status'))
    click(menuItem('Change type ›'))
    expect(document.querySelector('.ctx-menu')).toBeNull()
    expect(document.querySelector('.frontmatter-property-menu__scope')?.textContent).toBe('In every note of this vault')
    click(byLabel(el, 'Property type: Text'))
    click(buttonNamed(el, 'Number'))
    click(buttonNamed(document.querySelector('.frontmatter-property-menu__actions')!, 'Save'))
    await flush()
    expect((await propertiesStub.get(ROOT)).properties).toEqual({ status: { kind: 'number' } })
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('"Edit property ›" in the left-click popover shows for a note field too; with no vault root it does not (nowhere to save)', () => {
    const el = mount(TYPED, { root: ROOT })
    expand(el)
    click(byLabel(el, 'Configure status'))
    expect(buttonNamed(el, 'Edit property ›')).not.toBeNull()
  })

  it('Rename… moves the key in this note only — one write; the value and the key’s place stay', async () => {
    readFile.mockResolvedValue(fileOf(TYPED))
    const el = mount(TYPED, { root: ROOT })
    expand(el)
    contextMenu(byLabel(el, 'Configure due'))
    click(menuItem('Rename…'))
    const field = byLabel<HTMLInputElement>(el, 'Rename due')!
    expect(field.value).toBe('due')
    setValue(field, 'Due Date')
    press(field, 'Enter')
    await flush()
    expect(writeFile).toHaveBeenCalledExactlyOnceWith({ path: PATH, content: TYPED.replace('due: 2024-05-01', 'Due Date: 2024-05-01'), expectedMtime: 100 })
    expect(keysOf(el)).toEqual(['status', 'pages', 'done', 'Due Date', 'tags', 'parent'])
    expect(document.querySelector('.ctx-menu')).toBeNull()
  })

  it('Rename… refuses a name the note holds already, and writes nothing', () => {
    const el = mount(TYPED, { root: ROOT })
    expand(el)
    contextMenu(byLabel(el, 'Configure due'))
    click(menuItem('Rename…'))
    const field = byLabel<HTMLInputElement>(el, 'Rename due')!
    setValue(field, 'status')
    press(field, 'Enter')
    expect(errorLine(el)?.textContent).toBe('"status" is already a property of this page')
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('Copy value puts the value on the clipboard (a list as "a, b"); Remove from this note removes the key', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    readFile.mockResolvedValue(fileOf(TYPED))
    const el = mount(TYPED, { root: ROOT })
    expand(el)
    contextMenu(byLabel(el, 'Configure status'))
    click(menuItem('Copy value'))
    expect(writeText).toHaveBeenLastCalledWith('draft')
    contextMenu(byLabel(el, 'Configure tags'))
    click(menuItem('Copy value'))
    expect(writeText).toHaveBeenLastCalledWith('a, b')
    expect(writeFile).not.toHaveBeenCalled()

    contextMenu(byLabel(el, 'Configure pages'))
    click(menuItem('Remove from this note'))
    await flush()
    expect(writeFile).toHaveBeenCalledExactlyOnceWith({ path: PATH, content: TYPED.replace('pages: 12\n', ''), expectedMtime: 100 })
  })
})

