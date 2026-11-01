/**
 * A note's own right-click menu (YAZ-3653): the rows, when they are inert, what each one asks main
 * to run, the spelling rows, and the right-click that opens it (an image keeps the native menu).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { EditorView } from '@milkdown/kit/prose/view'
import { undo } from '@milkdown/kit/prose/history'
import type { MenuAction, MenuItem, MenuSection } from '../sidebar/menuSections'
import type { CopyAsMode } from '@shared/types'
import { caretIn, endOf, md, mount, posOf, runCommand, select, unmountAll } from './marks/markTestKit'
import { isOutlineItemCollapsed, toggleOutlineFold } from './outline/outlineFolding'
import { lineSections, misspellingAt, NoteMenu, noteMenuSections, TABLE_HANDLE_MENU } from './noteMenu'
import { CellSelection } from '@milkdown/kit/prose/tables'
import { cellDOM, cellPos, mountNote as mountTable, mouseAt, unmountAll as unmountTables } from './table/tableTestKit'

let root: Root | null = null
afterEach(async () => {
  act(() => root?.unmount())
  root = null
  document.body.querySelectorAll('.ctx-overlay').forEach((el) => el.remove())
  await unmountAll()
  await unmountTables()
})

/** Each row as `label` (`*` when inert), a parent's flyout after it in brackets. */
const shape = (sections: MenuSection[]): string[][] =>
  sections.filter((s) => s.length > 0).map((s) => s.map((item: MenuItem) => item.children === undefined ? `${item.label}${item.disabled === true ? '*' : ''}` : `${item.label} [${item.children.map((g) => g.map((c) => `${c.label}${c.disabled === true ? '*' : ''}`).join(', ')).join(' | ')}]`))
const leaf = (sections: MenuSection[], id: string): MenuAction =>
  sections.flat().flatMap((item) => (item.children === undefined ? [item] : [item, ...item.children.flat()])).find((item) => item.id === id) as MenuAction

/** `posAtCoords` needs layout jsdom does not have: the pointer stands at `pos`. */
const pointAt = (view: EditorView, pos: number) => vi.spyOn(view, 'posAtCoords').mockReturnValue({ pos, inside: -1 })

describe('the note menu rows (YAZ-3653)', () => {
  it('a selection in an editable note: every row on, in the copy and paste groups', async () => {
    const { crepe, view } = await mount('* one\n* two\n')
    select(crepe, posOf(crepe, 'one'), endOf(crepe, 'two'))
    const run = vi.fn()
    const sections = noteMenuSections(view, null, run)
    expect(shape(sections)).toEqual([
      ['Cut', 'Copy', 'Copy as [Plain text, Markdown | Without folded lines]'],
      ['Paste', 'Paste as [Plain text, Markdown]'],
      ['Add link…'],
    ])
    expect(sections.flat().map((item) => item.hint)).toEqual(['⌘X', '⌘C', undefined, '⌘V', undefined, undefined])
    for (const id of ['cut', 'copy', 'copy-plain', 'copy-markdown', 'copy-visible', 'paste', 'paste-plain', 'paste-markdown']) leaf(sections, id).onSelect()
    expect(run.mock.calls.map(([action]) => action)).toEqual(['cut', 'copy', 'copy-plain', 'copy-markdown', 'copy-visible', 'paste', 'paste-plain', 'paste-markdown'])
  })

  it('no selection: Cut and the copies are inert; a read-only note: Cut and the pastes are', async () => {
    const { crepe, view } = await mount('* one\n')
    caretIn(crepe, 'one')
    expect(shape(noteMenuSections(view, null, vi.fn()))).toEqual([
      ['Cut*', 'Copy*', 'Copy as [Plain text*, Markdown* | Without folded lines*]'],
      ['Paste', 'Paste as [Plain text, Markdown]'],
    ])
    select(crepe, posOf(crepe, 'one'), endOf(crepe, 'one'))
    crepe.setReadonly(true)
    expect(shape(noteMenuSections(view, null, vi.fn()))).toEqual([
      ['Cut*', 'Copy', 'Copy as [Plain text, Markdown | Without folded lines]'],
      ['Paste*', 'Paste as [Plain text*, Markdown*]'],
    ])
  })

  it('a misspelled word: its guesses replace it (⌘Z undoes it) and Add to dictionary sends the word', async () => {
    const { crepe, view } = await mount('Fix teh typo\n')
    pointAt(view, posOf(crepe, 'teh') + 1)
    const suggest = vi.fn((word: string) => (word === 'teh' ? ['the', 'tea'] : null))
    const misspelling = misspellingAt(view, 0, 0, suggest)
    expect(misspelling).toEqual({ word: 'teh', from: posOf(crepe, 'teh'), to: endOf(crepe, 'teh'), suggestions: ['the', 'tea'] })
    const run = vi.fn()
    const sections = noteMenuSections(view, misspelling, run)
    expect(shape(sections)[0]).toEqual(['the', 'tea', 'Add to dictionary'])
    leaf(sections, 'add-word').onSelect()
    expect(run).toHaveBeenCalledExactlyOnceWith('add-word', 'teh')
    leaf(sections, 'guess-0').onSelect()
    expect(md(crepe)).toBe('Fix the typo\n')
    undo(view.state, view.dispatch)
    expect(md(crepe)).toBe('Fix teh typo\n')
  })

  it('a guess after the note changed under the open menu: the word is not there, nothing is replaced', async () => {
    const { crepe, view } = await mount('Fix teh typo\n')
    pointAt(view, posOf(crepe, 'teh') + 1)
    const misspelling = misspellingAt(view, 0, 0, () => ['the'])!
    const sections = noteMenuSections(view, misspelling, vi.fn())
    view.dispatch(view.state.tr.insertText('Now ', 1))
    leaf(sections, 'guess-0').onSelect()
    expect(md(crepe)).toBe('Now Fix teh typo\n')
  })

  it('nothing selected, right-clicked in a bullet: Without folded lines stays on (it copies the bullet); outside one it is inert', async () => {
    const { crepe, view } = await mount('* one\n  * kid\n\nplain\n')
    caretIn(crepe, 'plain')
    const row = (pointer: number) => leaf(noteMenuSections(view, null, vi.fn(), pointer), 'copy-visible').disabled
    expect(row(posOf(crepe, 'kid'))).toBe(false)
    expect(row(posOf(crepe, 'plain'))).toBe(true)
    expect(leaf(noteMenuSections(view, null, vi.fn(), posOf(crepe, 'kid')), 'copy').disabled).toBe(true)
  })

  it('a word spelled right, a word in code, or no word: no spelling rows', async () => {
    const { crepe, view } = await mount('fine words\n\n```\nteh\n```\n')
    const suggest = vi.fn((word: string) => (word === 'teh' ? [] : null))
    pointAt(view, posOf(crepe, 'words') + 2)
    expect(misspellingAt(view, 0, 0, suggest)).toBeNull()
    pointAt(view, posOf(crepe, 'teh') + 1)
    expect(misspellingAt(view, 0, 0, suggest)).toBeNull()
    expect(suggest).toHaveBeenCalledOnce()
  })
})

describe('the right-click (YAZ-3653)', () => {
  async function open(markdown: string) {
    const mounted = await mount(markdown)
    window.yaseenDocs = { ...window.yaseenDocs, spell: { suggestions: () => null } } as typeof window.yaseenDocs
    const host = document.createElement('div')
    document.body.append(host)
    act(() => {
      root = createRoot(host)
      root.render(<NoteMenu view={mounted.view} />)
    })
    return mounted
  }
  const rightClick = (target: Element) => {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 50 })
    act(() => void target.dispatchEvent(event))
    return event
  }

  it('in the note: the app menu opens instead of the native one', async () => {
    const { crepe, view } = await open('* one\n')
    pointAt(view, posOf(crepe, 'one'))
    const event = rightClick(view.dom.querySelector('p')!)
    expect(event.defaultPrevented).toBe(true)
    // The bullet's Turn into strip first (YAZ-3727 D15), then the clipboard rows.
    expect([...document.querySelectorAll('.ctx-menu [role=menuitem]')].map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['Bullet list', 'Numbered list', 'Checklist', 'Text', 'Cut', 'Copy', 'Copy as', 'Paste', 'Paste as'])
  })

  it('Without folded lines on a right-clicked bullet: main is asked, and the copy is that bullet without its folded lines', async () => {
    // Main's half, faked: `menu.edit('copy-visible')` asks the note's copy listener, as `menu:copy-as` does.
    const listeners: Array<(mode: CopyAsMode) => unknown> = []
    let answer: unknown
    const edit = vi.fn(async (_action: string, _word?: string) => {
      answer = listeners.map((listener) => listener('visible')).find((a) => a !== undefined)
    })
    window.yaseenDocs = { ...window.yaseenDocs, menu: { ...window.yaseenDocs?.menu, onCopyAs: (listener) => (listeners.push(listener), () => undefined), edit } } as typeof window.yaseenDocs
    const { crepe, view } = await open('* Tasks\n  * [ ] one\n    * hidden\n* Rules\n')
    expect(runCommand(crepe, toggleOutlineFold(posOf(crepe, 'one') - 2))).toBe(true)
    caretIn(crepe, 'Rules')
    view.focus()
    pointAt(view, posOf(crepe, 'Tasks'))
    rightClick(view.dom.querySelector('p')!)
    const row = (label: string) => [...document.querySelectorAll<HTMLElement>('.ctx-menu [role=menuitem]')].find((b) => b.textContent === label)!
    act(() => row('Copy as').click())
    expect(row('Without folded lines').getAttribute('aria-disabled')).not.toBe('true')
    await act(async () => row('Without folded lines').click())
    expect(edit.mock.calls.map(([action]) => action)).toEqual(['copy-visible'])
    expect(answer).toMatchObject({ text: '• Tasks\n  ☐ one' })
  })

  it('on a link: only the link’s own menu opens (its right-click comes first)', async () => {
    const mounted = await mount('see [the site](https://example.com) here\n', { markdownLinkNav: { open: vi.fn(async () => undefined), onNotice: vi.fn() } })
    const host = document.createElement('div')
    document.body.append(host)
    act(() => {
      root = createRoot(host)
      root.render(<NoteMenu view={mounted.view} />)
    })
    expect(rightClick(mounted.view.dom.querySelector('a')!).defaultPrevented).toBe(true)
    expect(document.querySelectorAll('.ctx-menu')).toHaveLength(1)
    expect(document.querySelector('.ctx-menu--editor')).not.toBeNull()
    document.querySelectorAll('.ctx-menu--editor').forEach((el) => el.remove())
  })

  it('M8: Escape closes the menu and gives the focus back to the note', async () => {
    const { crepe, view } = await open('* one\n')
    caretIn(crepe, 'one')
    view.focus()
    pointAt(view, posOf(crepe, 'one'))
    rightClick(view.dom.querySelector('p')!)
    ;(document.activeElement as HTMLElement | null)?.blur()
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(document.querySelector('.ctx-menu')).toBeNull()
    expect(view.hasFocus()).toBe(true)
  })

  it('D9: a word selected on the page that the note has not read yet turns Cut and Copy on', async () => {
    const { crepe, view } = await mount('* one two\n')
    caretIn(crepe, 'one')
    const text = view.dom.querySelector('p')!.firstChild!
    document.getSelection()!.setBaseAndExtent(text, 0, text, 3)
    expect(view.state.selection.empty).toBe(true)
    expect(shape(noteMenuSections(view, null, vi.fn()))[0]).toEqual(['Cut', 'Copy', 'Copy as [Plain text, Markdown | Without folded lines]'])
  })

  it('a table handle opens the same menu as a right-click in its cell, at the handle, on the cells it selected (YAZ-3820)', async () => {
    const { view } = await open('| h1 | h2 |\n| -- | -- |\n| a | b |\n')
    const labels = () => [...document.querySelectorAll('.ctx-menu [role=menuitem]')].map((b) => b.textContent)
    // The handle selected column B, then asks for the menu at a cell of it in row 1.
    view.dispatch(view.state.tr.setSelection(CellSelection.colSelection(view.state.doc.resolve(cellPos(view, 0, 1)))))
    pointAt(view, cellPos(view, 0, 1) + 2)
    rightClick(view.dom.querySelectorAll('th')[1]!)
    const fromCell = labels()
    expect(fromCell).toContain('Sort A to Z')
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(document.querySelector('.ctx-menu')).toBeNull()
    act(() => void view.dom.dispatchEvent(new CustomEvent(TABLE_HANDLE_MENU, { bubbles: true, detail: { x: 70, y: 80, pos: cellPos(view, 0, 1) } })))
    expect(labels()).toEqual(fromCell)
    const menu = document.querySelector<HTMLElement>('.ctx-menu')!
    expect([menu.style.left, menu.style.top]).toEqual(['70px', '80px'])
    // An item acts on the cells the handle selected: the whole column goes.
    const remove = [...document.querySelectorAll<HTMLElement>('.ctx-menu [role=menuitem]')].find((b) => b.textContent === 'Delete column')!
    act(() => remove.click())
    expect(view.state.doc.firstChild!.firstChild!.childCount).toBe(1)
    expect(view.state.doc.firstChild!.textContent).toBe('h1a')
  })

  it('a click on the real column handle of the table block opens the menu with the Table part (YAZ-3820)', async () => {
    const { view } = await mountTable()
    window.yaseenDocs = { ...window.yaseenDocs, spell: { suggestions: () => null } } as typeof window.yaseenDocs
    const host = document.createElement('div')
    document.body.append(host)
    act(() => {
      root = createRoot(host)
      root.render(<NoteMenu view={view} />)
    })
    // Hover a cell of column B, so the handle belongs to it, then click the handle: the vendored DOM sends its event.
    mouseAt('pointermove', cellDOM(view, 1, 1).firstChild!, 150, 45)
    const handle = view.dom.querySelector<HTMLElement>('.milkdown-table-block [data-role="col-drag-handle"]')!
    act(() => void handle.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 7, clientY: 9 })))
    const labels = [...document.querySelectorAll('.ctx-menu [role=menuitem]')].map((b) => b.textContent)
    expect(labels).toContain('Sort A to Z')
    expect(labels).toContain('Delete column')
    expect((view.state.selection as CellSelection).isColSelection()).toBe(true)
  })

  it('on an image: the image\'s rows in the app menu (YAZ-3727 D22); Reveal only for a vault image', async () => {
    const edit = vi.fn(async (_action: string, _arg?: unknown) => undefined)
    window.yaseenDocs = { ...window.yaseenDocs, menu: { ...window.yaseenDocs?.menu, edit } } as typeof window.yaseenDocs
    const { view } = await open('* one\n')
    // A bare <img> put in the note's DOM: ProseMirror may redraw the line over it, so each right-click gets a new one.
    const imageAt = (src: string) => {
      const image = document.createElement('img')
      image.src = src
      view.dom.querySelector('p')!.append(image)
      return image
    }
    const row = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu [role=menuitem]')].find((b) => b.textContent === label)!
    expect(rightClick(imageAt('https://example.com/a.png')).defaultPrevented).toBe(true)
    expect([...document.querySelectorAll('.ctx-menu [role=menuitem]')].map((b) => `${b.textContent}${(b as HTMLButtonElement).disabled ? '*' : ''}`)).toEqual(['Copy image', 'Reveal in Finder*'])
    await act(async () => row('Copy image').click())
    expect(edit).toHaveBeenLastCalledWith('copy-image', { x: 40, y: 50 })
    rightClick(imageAt('app://vault/root/a.png?from='))
    await act(async () => row('Reveal in Finder').click())
    expect(edit).toHaveBeenLastCalledWith('reveal-image', 'app://vault/root/a.png?from=')
  })
})

describe('a right-click on a line\'s text shows the bullet menu\'s rows too (YAZ-3727 D15)', () => {
  async function open(markdown: string, options: { onOpen?: () => void; suggest?: (word: string) => string[] | null } = {}) {
    const mounted = await mount(markdown, options.onOpen === undefined ? {} : { zoom: { title: () => 'Note', onOpen: options.onOpen } })
    window.yaseenDocs = { ...window.yaseenDocs, spell: { suggestions: options.suggest ?? (() => null) } } as typeof window.yaseenDocs
    const host = document.createElement('div')
    document.body.append(host)
    act(() => {
      root = createRoot(host)
      root.render(<NoteMenu view={mounted.view} />)
    })
    return mounted
  }
  /** A right press on the text of `text`'s line, then its contextmenu. `between` runs in between: what the press selects. */
  function rightClickOn(view: EditorView, at: number, between?: () => void) {
    pointAt(view, at)
    const target = view.domAtPos(at).node.parentElement!
    act(() => void target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 2 })))
    between?.()
    act(() => void target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 50 })))
  }
  /** The menu's groups: each row's label, a strip's buttons as `<Checklist, Bullet list*, …>` (`*` lit). */
  const groups = () =>
    [...document.querySelectorAll('.ctx-menu > .ctx-menu__group')].map((group) =>
      [...group.children].map((el) =>
        el.classList.contains('ctx-menu__strip') ? `<${[...el.querySelectorAll('button')].map((b) => `${b.getAttribute('aria-label')}${b.getAttribute('aria-pressed') === 'true' ? '*' : ''}`).join(', ')}>` : el.textContent,
      ),
    )
  const STRIP = (lit: string | null) => `<${['Bullet list', 'Numbered list', 'Checklist', 'Text'].map((label) => (label === lit ? `${label}*` : label)).join(', ')}>`
  const CLIPBOARD = [['Cut', 'Copy', 'Copy as'], ['Paste', 'Paste as']]
  const press = (label: string) => act(() => document.querySelector<HTMLButtonElement>(`.ctx-menu__strip button[aria-label="${label}"]`)!.click())

  it('on a bullet with children: Open in new tab, the strip, the children rows, then the clipboard rows, in groups', async () => {
    const { crepe, view } = await open('* a\n  * kid\n* b\n', { onOpen: vi.fn() })
    rightClickOn(view, posOf(crepe, 'a'))
    expect(groups()).toEqual([['Open in new tab'], [STRIP('Bullet list')], ['Number children', 'Collapse all⌘⇧U', 'Expand all⌘⇧I'].map((label) => label.replace(/⌘.*/, '')), ...CLIPBOARD])
    // D19: no glyph, so no row is pushed right to line up after one.
    expect(document.querySelector('.ctx-menu')!.classList.contains('ctx-menu--glyphs')).toBe(false)
    // D17: no "⇧-click" hint here (on the text it only extends the selection), so the menu is no wider than the strip.
    expect([...document.querySelectorAll<HTMLElement>('.ctx-menu [role=menuitem]')].find((b) => b.textContent === 'Open in new tab')!.dataset.hint).toBeUndefined()
    // The strip's glyphs are the bullet menu's own SVGs.
    expect(document.querySelectorAll('.ctx-menu__strip button > svg')).toHaveLength(4)
  })

  it('a misspelled word: the spelling rows first, then the line\'s rows', async () => {
    const { crepe, view } = await open('* teh list\n', { suggest: (word) => (word === 'teh' ? ['the'] : null) })
    rightClickOn(view, posOf(crepe, 'teh') + 1)
    expect(groups()).toEqual([['the', 'Add to dictionary'], [STRIP('Bullet list')], ...CLIPBOARD])
  })

  it('a strip button changes the whole list, as on the dot, and closes the menu', async () => {
    const { crepe, view } = await open('* a\n* b\n* c\n')
    rightClickOn(view, posOf(crepe, 'b'))
    press('Numbered list')
    expect(md(crepe)).toBe('1. a\n2. b\n3. c\n')
    expect(document.querySelector('.ctx-menu')).toBeNull()
  })

  it('the word the right press selected is no highlight: still the whole list', async () => {
    const { crepe, view } = await open('* a\n* bee\n* c\n')
    caretIn(crepe, 'a')
    rightClickOn(view, posOf(crepe, 'bee') + 1, () => select(crepe, posOf(crepe, 'bee'), endOf(crepe, 'bee')))
    expect(groups()[0]).toEqual([STRIP('Bullet list')])
    press('Numbered list')
    expect(md(crepe)).toBe('1. a\n2. bee\n3. c\n')
  })

  it('text highlighted before the right-click: only the highlighted lines change', async () => {
    const { crepe, view } = await open('* a\n* b\n* c\n')
    select(crepe, posOf(crepe, 'b'), endOf(crepe, 'c'))
    rightClickOn(view, posOf(crepe, 'b'))
    press('Numbered list')
    expect(md(crepe)).toBe('* a\n\n1. b\n2. c\n')
  })

  it('a plain line: the strip with Text lit, no Open in new tab; ⌘Z gives it back', async () => {
    const { crepe, view } = await open('p1\n\np2\n', { onOpen: vi.fn() })
    rightClickOn(view, posOf(crepe, 'p2'))
    expect(groups()).toEqual([[STRIP('Text')], ...CLIPBOARD])
    press('Bullet list')
    expect(md(crepe)).toBe('p1\n\n* p2\n')
    undo(view.state, view.dispatch)
    expect(md(crepe)).toBe('p1\n\np2\n')
  })

  it('a right-click beside the text, in the gap after a checkbox: the bullet\'s rows (D22)', async () => {
    const { crepe, view } = await open('* [ ] a\n* [ ] b\n')
    // Inside the list item, before its line: where the gap between the box and the text resolves.
    expect(lineSections(view, posOf(crepe, 'a') - 1, view.state.selection).flat().filter((item) => item.kind === 'strip')).toHaveLength(1)
    rightClickOn(view, posOf(crepe, 'a') - 1)
    expect(groups()[0]).toEqual([STRIP('Checklist')])
  })

  it('on a fold chevron: the line\'s menu, as on its text, Collapse all and Expand all with the children rows; one ⌘Z (D23)', async () => {
    const { crepe, view } = await open('* a\n  * kid\n* b\n  * kid2\n')
    const chevron = document.createElement('span')
    chevron.className = 'outline-toggle'
    view.dom.querySelector('p')!.prepend(chevron)
    pointAt(view, posOf(crepe, 'a'))
    act(() => void chevron.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 50 })))
    expect(groups().slice(0, 2)).toEqual([[STRIP('Bullet list')], ['Number children', 'Collapse all', 'Expand all']])
    const items = () => {
      const found: number[] = []
      view.state.doc.descendants((node, pos) => {
        if (node.type.name === 'list_item' && node.childCount > 1) found.push(pos)
      })
      return found.map((pos) => isOutlineItemCollapsed(view.state, pos))
    }
    act(() => [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu [role=menuitem]')].find((b) => b.textContent === 'Collapse all')!.click())
    expect(items()).toEqual([true, true])
    expect(document.querySelector('.ctx-menu')).toBeNull()
    // ⌘Z through the editor's keymaps: the fold-all's own undo (`foldAllHotkeys.ts`), not the text history.
    const cmdZ = new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', keyCode: 90, metaKey: true, bubbles: true, cancelable: true })
    view.someProp('handleKeyDown', (handler) => handler(view, cmdZ))
    expect(items()).toEqual([false, false])
  })

  it('in a code block or a table cell: no line rows', async () => {
    const { crepe, view } = await open('```\ncode\n```\n')
    rightClickOn(view, posOf(crepe, 'code') + 1)
    expect(document.querySelector('.ctx-menu__strip')).toBeNull()
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    const table = await mountTable('| h1 | h2 |\n| -- | -- |\n| a | b |\n')
    expect(lineSections(table.view, cellPos(table.view, 1, 0) + 2, table.view.state.selection)).toEqual([])
  })

  it('a note that cannot change: no strip and no children rows; Open in new tab stays', async () => {
    const { crepe, view } = await open('* a\n  * kid\n', { onOpen: vi.fn() })
    crepe.setReadonly(true)
    rightClickOn(view, posOf(crepe, 'a'))
    expect(groups()[0]).toEqual(['Open in new tab'])
    expect(document.querySelector('.ctx-menu__strip')).toBeNull()
  })

  it('the note changed under the open menu: a strip button changes nothing', async () => {
    const { crepe, view } = await open('* a\n* b\n')
    rightClickOn(view, posOf(crepe, 'a'))
    const button = document.querySelector<HTMLButtonElement>('.ctx-menu__strip button[aria-label="Numbered list"]')!
    view.dispatch(view.state.tr.insertText('x', endOf(crepe, 'b')))
    act(() => button.click())
    expect(md(crepe)).toBe('* a\n* bx\n')
  })
})
