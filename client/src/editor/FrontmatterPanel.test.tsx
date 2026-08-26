/**
 * The properties panel (⚡ YAZ-883): frontmatter as RAW YAML, written back verbatim. Mounted with
 * react-dom in jsdom, `api` mocked so every read / write is observable — `views/writeProperty`'s
 * bridge-mock idiom, since the panel runs that module's read → rewrite → `expectedMtime` →
 * retry-once dance whole-block instead of one key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { FrontmatterPanel } from './FrontmatterPanel'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { readFile: vi.fn(), writeFile: vi.fn() },
}))

import { BridgeRequestError, api } from '../api'

const readFile = vi.mocked(api.readFile)
const writeFile = vi.mocked(api.writeFile)

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const PATH = '/vault/Deep Work.md'

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

const fileOf = (content: string, mtime = 100) => ({ path: PATH, content, mtime, size: content.length })
const conflict = (mtime: number) => new BridgeRequestError('CONFLICT', 'file changed on disk', mtime)

let root: Root | null = null
let container: HTMLElement | null = null

beforeEach(() => {
  readFile.mockReset()
  writeFile.mockReset()
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

function mount(content: string, mtime = 100): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<FrontmatterPanel file={{ path: PATH, content, mtime }} />))
  return container
}

const header = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.frontmatter-panel__header')
const area = (el: HTMLElement) => el.querySelector<HTMLTextAreaElement>('.frontmatter-panel__text')
const errorLine = (el: HTMLElement) => el.querySelector('.frontmatter-panel__error')
const btn = (el: HTMLElement, label: string) =>
  [...el.querySelectorAll<HTMLButtonElement>('.frontmatter-panel__btn')].find((b) => b.textContent === label) ?? null

const expand = (el: HTMLElement) => act(() => header(el)?.click())

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

describe('FrontmatterPanel (⚡ YAZ-883)', () => {
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
    expand(el)
    expect(area(el)?.value).toBe(INTERIOR)
    // Nothing is dirty yet, so the panel offers no buttons at all.
    expect(btn(el, 'Save')).toBeNull()
  })

  it('an edit saves the replaceFrontmatter result with the FRESH read mtime', async () => {
    readFile.mockResolvedValue(fileOf(MESSY))
    writeFile.mockResolvedValue({ path: PATH, mtime: 200, size: 10 })
    const el = mount(MESSY)
    expand(el)
    // A value changes; the comment stays exactly where the user left it.
    typeInto(el, INTERIOR.replace('status: draft', 'status: done'))
    expect(btn(el, 'Save')).not.toBeNull()

    act(() => btn(el, 'Save')?.click())
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
    expand(el)
    typeInto(el, 'tags: [a, b\nstatus: : :')

    act(() => btn(el, 'Save')?.click())
    await settle()

    expect(writeFile).not.toHaveBeenCalled()
    expect(errorLine(el)?.textContent).toMatch(/^Not valid YAML: /)
    // The user's text is still there to fix — a rejected save never reverts anything.
    expect(area(el)?.value).toBe('tags: [a, b\nstatus: : :')
  })

  it('a bridge failure lands on the panel\'s OWN error line, not a notice', async () => {
    readFile.mockResolvedValue(fileOf(MESSY))
    writeFile.mockRejectedValue(new BridgeRequestError('IO_ERROR', 'disk on fire'))
    const el = mount(MESSY)
    expand(el)
    typeInto(el, 'status: done')

    act(() => btn(el, 'Save')?.click())
    await settle()

    expect(errorLine(el)?.textContent).toBe('Could not save the properties: disk on fire')
    expect(btn(el, 'Save')).not.toBeNull() // still dirty, still savable
  })

  it('Cancel and Esc both revert to the disk text and write nothing', () => {
    const el = mount(MESSY)
    expand(el)
    typeInto(el, 'status: abandoned')
    act(() => btn(el, 'Cancel')?.click())
    expect(area(el)?.value).toBe(INTERIOR)

    typeInto(el, 'status: abandoned again')
    act(() => void area(el)?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(area(el)?.value).toBe(INTERIOR)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('an unchanged Save never touches disk (identity)', async () => {
    readFile.mockResolvedValue(fileOf(MESSY))
    const el = mount(MESSY)
    expand(el)
    // Edited away and typed straight back: the bytes match, so there is nothing to write —
    // and with the draft equal to disk the panel does not even offer the button.
    typeInto(el, 'status: done')
    typeInto(el, INTERIOR)
    expect(btn(el, 'Save')).toBeNull()

    // Trailing whitespace the frame supplies anyway is the same non-write, through the button.
    typeInto(el, `${INTERIOR}\n`)
    act(() => btn(el, 'Save')?.click())
    await settle()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('a page with NO frontmatter offers "Add properties", and saving creates the block', async () => {
    readFile.mockResolvedValue(fileOf('Just a body\n'))
    writeFile.mockResolvedValue({ path: PATH, mtime: 200, size: 10 })
    const el = mount('Just a body\n')
    expect(header(el)?.textContent).toBe('Add properties')
    expand(el)
    expect(area(el)?.value).toBe('')

    typeInto(el, 'status: draft')
    act(() => btn(el, 'Save')?.click())
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
    expand(el)
    typeInto(el, 'status: done')

    act(() => btn(el, 'Save')?.click())
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
    expand(el)
    const next = MESSY.replace('status: draft', 'status: published')
    act(() => root?.render(<FrontmatterPanel file={{ path: PATH, content: next, mtime: 200 }} />))
    expect(area(el)?.value).toBe(INTERIOR.replace('status: draft', 'status: published'))

    typeInto(el, 'status: mine')
    act(() => root?.render(<FrontmatterPanel file={{ path: PATH, content: MESSY, mtime: 300 }} />))
    expect(area(el)?.value).toBe('status: mine')
  })
})
