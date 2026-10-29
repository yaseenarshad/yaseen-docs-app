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
import { toggleOutlineFold } from './outline/outlineFolding'
import { misspellingAt, NoteMenu, noteMenuSections } from './noteMenu'

let root: Root | null = null
afterEach(async () => {
  act(() => root?.unmount())
  root = null
  document.body.querySelectorAll('.ctx-overlay').forEach((el) => el.remove())
  await unmountAll()
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
    expect([...document.querySelectorAll('.ctx-menu [role=menuitem]')].map((b) => b.textContent)).toEqual(['Cut', 'Copy', 'Copy as', 'Paste', 'Paste as'])
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

  it('on an image: the native image menu stays', async () => {
    const { view } = await open('* one\n')
    const image = document.createElement('img')
    view.dom.querySelector('p')!.append(image)
    expect(rightClick(image).defaultPrevented).toBe(false)
    expect(document.querySelector('.ctx-menu')).toBeNull()
  })
})
