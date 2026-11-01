/**
 * Make a link in a drawing's text box (YAZ-4039 D12): the `[[` picker at the caret of the engine's text editor, and a
 * pasted page path as a link. The engine's half (the hooks, the pill as one unit, Edit link and Remove link) is
 * `engine/.../tests/hostLinks.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', async (original) => ({ api: { ...(await original<typeof import('../api')>()).api, mintNoteId: vi.fn() } }))
vi.mock('../editor/wikilink/createFromLink', () => ({ createFromLink: vi.fn() }))
import { fileLink } from '@shared/links'
import { createWikilinkCandidateSource } from '../editor/wikilink/wikilinkPicker'
import type { LinkCandidate } from '../links/completion'
import { api } from '../api'
import { createFromLink } from '../editor/wikilink/createFromLink'
import { createWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { createDrawingLinkPicker, createLinkedPage, type PickerEditor } from './drawingLinkPicker'
import { drawingPasteLink } from './drawingLinks'
import { openEditLinkBox } from './editLinkBox'

const rows: LinkCandidate[] = [
  { name: 'Growth plan', insert: 'YAS-1', label: 'Growth plan', path: '/vault/Growth plan.md' },
  { name: 'Groceries', insert: 'YAS-2', label: 'Groceries', path: '/vault/Groceries.md' },
]

function setup(create?: (editor: PickerEditor, name: string) => void) {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const picker = createDrawingLinkPicker(() => parent, () => rows, create)
  const replace = vi.fn()
  const replaceLink = vi.fn(() => true)
  const editor = (text: string, typed = true, caret = text.length): PickerEditor => ({ text, caret, typed, caretRect: () => ({ left: 10, top: 20, right: 10, bottom: 40 }), replace, replaceLink })
  const items = () => [...parent.querySelectorAll('.wikilink-picker__item')].map((item) => item.textContent)
  return { parent, picker, replace, replaceLink, editor, items }
}

const key = (name: string) => new KeyboardEvent('keydown', { key: name })

afterEach(() => {
  document.body.replaceChildren()
})

describe('the [[ picker', () => {
  it('opens on a typed [[ at the caret, and a pick writes [[ID]]', () => {
    const { picker, editor, items, replace, parent } = setup()
    picker.change(editor('see [[Gro'))
    expect(items()).toEqual(['Growth plan', 'Groceries'])
    expect(parent.querySelector<HTMLElement>('.wikilink-picker')!.style.top).toBe('44px')
    expect(picker.keyDown(key('ArrowDown'))).toBe(true)
    expect(picker.keyDown(key('Enter'))).toBe(true)
    expect(replace).toHaveBeenCalledWith(4, 9, '[[YAS-2]]')
    expect(items()).toEqual([])
  })

  it('a click on a row picks it', () => {
    const { picker, editor, replace, parent } = setup()
    picker.change(editor('[[grow'))
    parent.querySelector<HTMLButtonElement>('.wikilink-picker__item')!.click()
    expect(replace).toHaveBeenCalledWith(0, 6, '[[YAS-1]]')
  })

  it('stays shut on a caret move, and leaves keys alone while shut', () => {
    const { picker, editor, items } = setup()
    picker.change(editor('see [[Gro', false))
    expect(items()).toEqual([])
    expect(picker.keyDown(key('Enter'))).toBe(false)
  })

  it('Esc closes it for that [[ and keeps the text; a | closes it', () => {
    const { picker, editor, items, replace } = setup()
    picker.change(editor('[[Gro'))
    expect(picker.keyDown(key('Escape'))).toBe(true)
    picker.change(editor('[[Grow'))
    expect(items()).toEqual([])
    expect(replace).not.toHaveBeenCalled()
    picker.change(editor('x [[Gro'))
    expect(items()).toHaveLength(2)
    picker.change(editor('x [[Gro|'))
    expect(items()).toEqual([])
  })

  it('offers a Create row while no row has the typed name; its pick writes the link and makes the page', () => {
    const create = vi.fn()
    const { picker, editor, items, replace } = setup(create)
    picker.change(editor('[[Gro'))
    expect(items()).toEqual(['Growth plan', 'Groceries', 'Create "Gro"'])
    picker.change(editor('[[Nothing like it'))
    expect(items()).toEqual(['Create "Nothing like it"'])
    picker.keyDown(key('Enter'))
    expect(replace).toHaveBeenCalledWith(0, 17, '[[Nothing like it]]')
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ text: '[[Nothing like it' }), 'Nothing like it')
  })

  it('offers no Create row with no vault to make the page in', () => {
    const { picker, editor, items } = setup()
    picker.change(editor('[[Nothing like it'))
    expect(items()).toEqual([])
  })
})

describe("a Create row's page (YAZ-1357 D3, the note's order)", () => {
  const nav = { root: '/vault', createFolder: () => 'Inbox', openCurrent: vi.fn(), openBackground: vi.fn(), onNotice: vi.fn() }
  const mint = vi.mocked(api.mintNoteId)
  const make = vi.mocked(createFromLink)
  const ids = () => {
    const links = createWikilinkResolveSource()
    links.update(() => null, [], [], true, ['YAS'])
    return links
  }

  it('asks for the number, puts [[ID]] where the name stands, then makes the note with that ID', async () => {
    const { editor, replaceLink } = setup()
    mint.mockResolvedValueOnce('YAS-9')
    make.mockResolvedValueOnce({ status: 'created', path: '/vault/Inbox/New page.md' })
    await createLinkedPage(editor('[[New page]]'), 'New page', ids(), nav)
    expect(replaceLink).toHaveBeenCalledWith('[[New page]]', '[[YAS-9]]')
    expect(make).toHaveBeenLastCalledWith('/vault', 'New page', true, 'Inbox', 'YAS-9')
    expect(nav.onNotice).toHaveBeenLastCalledWith('Created "New page"')
  })

  it('gives the link its name back when the note is not made', async () => {
    const { editor, replaceLink } = setup()
    mint.mockResolvedValueOnce('YAS-9')
    make.mockResolvedValueOnce({ status: 'error', message: 'disk full' })
    await createLinkedPage(editor('[[New page]]'), 'New page', ids(), nav)
    expect(replaceLink).toHaveBeenLastCalledWith('[[YAS-9]]', '[[New page]]')
    expect(nav.onNotice).toHaveBeenLastCalledWith('disk full')
  })

  it('keeps the typed name where the vault uses no IDs', async () => {
    const { editor, replaceLink } = setup()
    const links = createWikilinkResolveSource()
    links.update(() => null)
    make.mockResolvedValueOnce({ status: 'created', path: '/vault/Inbox/New page.md' })
    mint.mockClear()
    await createLinkedPage(editor('[[New page]]'), 'New page', links, nav)
    expect(mint).not.toHaveBeenCalled()
    expect(replaceLink).not.toHaveBeenCalled()
    expect(make).toHaveBeenLastCalledWith('/vault', 'New page', false, 'Inbox', undefined)
  })
})

describe('a pasted link', () => {
  const candidates = createWikilinkCandidateSource()
  candidates.update(rows)

  it('turns a page path and a yaseendocs link of the vault into [[ID]]', () => {
    expect(drawingPasteLink('/vault/Growth plan.md', '/vault', '/vault/Board.excalidraw', candidates)).toBe('[[YAS-1]]')
    expect(drawingPasteLink(fileLink('/vault/Groceries.md'), '/vault', '/vault/Board.excalidraw', candidates)).toBe('[[YAS-2]]')
  })

  it('leaves other text to paste as text: a copied [[link]] is a pill as it is', () => {
    expect(drawingPasteLink('[[YAS-1]]', '/vault', '/vault/Board.excalidraw', candidates)).toBeNull()
    expect(drawingPasteLink('/elsewhere/a.md', '/vault', '/vault/Board.excalidraw', candidates)).toBeNull()
    expect(drawingPasteLink('/vault/Growth plan.md\nmore', '/vault', '/vault/Board.excalidraw', candidates)).toBeNull()
  })
})

describe('the Edit link box', () => {
  it("shows the link's text, and Enter writes the new one", () => {
    const done = vi.fn()
    openEditLinkBox(document.body, 10, 20, 'YAS-1', done)
    const input = document.querySelector<HTMLInputElement>('.drawing-link-edit input')!
    expect(input.value).toBe('YAS-1')
    input.value = '[[Groceries]]'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(done).toHaveBeenCalledWith('Groceries')
    expect(document.querySelector('.drawing-link-edit')).toBeNull()
  })

  it('Esc changes nothing', () => {
    const done = vi.fn()
    openEditLinkBox(document.body, 10, 20, 'YAS-1', done)
    const input = document.querySelector<HTMLInputElement>('.drawing-link-edit input')!
    input.value = 'Other'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(done).not.toHaveBeenCalled()
    expect(document.querySelector('.drawing-link-edit')).toBeNull()
  })
})
