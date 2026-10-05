/**
 * The move confirm (D21): the app asks before a move, or a "Remove shortcut", that clears a
 * folder's values. The copy is LOCKED, so it is pinned character for character; the sheet's
 * behaviour is pinned against `ConfirmRename`'s, whose keys it shares.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { PathTitles } from '../lib/pageLabel'
import type { Move } from '../links/shortcuts'
import { ConfirmMove, folderList, moveConfirmMessage, removeShortcutConfirmMessage } from './ConfirmMove'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('the LOCKED copy (D21)', () => {
  const note = { name: 'FV-001 - Zain Shah', kind: 'file' as const }
  const folder = { name: 'candidates', kind: 'dir' as const }
  const TWO = ['Fiverr', 'ENG PIPELINE']

  it('a note is moved to a place where a folder that shows it now will not show it, and the note holds values for that folder', () => {
    expect(moveConfirmMessage([note], 'z.ARCHIVE', { notes: 1, folders: TWO })).toBe("Move 'FV-001 - Zain Shah' to 'z.ARCHIVE'? Its values for Fiverr and ENG PIPELINE will be cleared.")
  })

  it('a folder is moved and notes under it would lose values: the count, and one note in the singular', () => {
    expect(moveConfirmMessage([folder], 'z.ARCHIVE', { notes: 54, folders: TWO })).toBe("Move 'candidates' to 'z.ARCHIVE'? 54 notes will lose their values for Fiverr and ENG PIPELINE.")
    expect(moveConfirmMessage([folder], 'z.ARCHIVE', { notes: 1, folders: ['Fiverr'] })).toBe("Move 'candidates' to 'z.ARCHIVE'? 1 note will lose its values for Fiverr.")
  })

  it('Cut, then Paste into a folder: several items are ONE sheet for all of them', () => {
    expect(moveConfirmMessage([note, folder, note], 'z.ARCHIVE', { notes: 2, folders: TWO })).toBe("Move 3 items to 'z.ARCHIVE'? 2 notes will lose their values for Fiverr and ENG PIPELINE.")
    expect(moveConfirmMessage([note, note], 'z.ARCHIVE', { notes: 1, folders: ['Fiverr'] })).toBe("Move 2 items to 'z.ARCHIVE'? 1 note will lose its values for Fiverr.")
  })

  it('a copy into another folder (YAZ-2420 3E1): a note\'s values "will not be copied"; a folder or several items count the notes that will not keep theirs', () => {
    expect(moveConfirmMessage([note], 'z.ARCHIVE', { notes: 1, folders: TWO }, true)).toBe("Copy 'FV-001 - Zain Shah' to 'z.ARCHIVE'? Its values for Fiverr and ENG PIPELINE will not be copied.")
    expect(moveConfirmMessage([folder], 'z.ARCHIVE', { notes: 54, folders: TWO }, true)).toBe("Copy 'candidates' to 'z.ARCHIVE'? 54 notes will not keep their values for Fiverr and ENG PIPELINE.")
    expect(moveConfirmMessage([note, folder], 'z.ARCHIVE', { notes: 1, folders: ['Fiverr'] }, true)).toBe("Copy 2 items to 'z.ARCHIVE'? 1 note will not keep its values for Fiverr.")
  })

  it('"Remove shortcut", and the note holds values for a folder that will no longer show it', () => {
    expect(removeShortcutConfirmMessage('_PIPELINE-CONTEXT', 'ENG PIPELINE', ['ENG PIPELINE'])).toBe("Remove the shortcut from 'ENG PIPELINE'? The values of '_PIPELINE-CONTEXT' for ENG PIPELINE will be cleared.")
  })

  it('the folders named in the sheet: one, `A and B`, `A, B and C`, and more than three as the first three `and N more`', () => {
    expect(folderList(['Fiverr'])).toBe('Fiverr')
    expect(folderList(['A', 'B'])).toBe('A and B')
    expect(folderList(['A', 'B', 'C'])).toBe('A, B and C')
    expect(folderList(['A', 'B', 'C', 'D'])).toBe('A, B, C and 1 more')
    expect(folderList(['Fiverr', 'ENG PIPELINE', 'AI-Dev-Hire', 'D', 'E'])).toBe('Fiverr, ENG PIPELINE, AI-Dev-Hire and 2 more')
  })
})

let root: Root | null = null
let container: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

const NOTE: Move = { oldPath: '/v/Hiring/Fiverr/Zain Shah.md', newPath: '/v/z.ARCHIVE/Zain Shah.md', kind: 'file' }
const LOST = { notes: 1, folders: ['/v/Hiring/Fiverr', '/v/Hiring'] }

function mount(ask: { moves: readonly Move[]; copy?: boolean } | { shortcut: { path: string; dir: string } } = { moves: [NOTE] }, lost = LOST, titles: PathTitles = new Map()) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<ConfirmMove {...ask} lost={lost} titles={titles} onConfirm={onConfirm} onCancel={onCancel} />))
  return { el: container, onConfirm, onCancel }
}

const text = (el: HTMLElement) => el.querySelector('.confirm__text')?.textContent
const btn = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === label)
/** Keys reach the sheet the way a user's do: from the focused button INSIDE it. */
const press = (el: HTMLElement, key: string) => act(() => void btn(el, 'Cancel')?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))

describe('ConfirmMove', () => {
  it('names the note without its `.md`, and the destination and the folders by their directory names', () => {
    const { el } = mount()
    expect(text(el)).toBe("Move 'Zain Shah' to 'z.ARCHIVE'? Its values for Fiverr and Hiring will be cleared.")
  })

  it('E: the move sheet names the note, the destination and the folders by their titles (YAZ-2420 D14)', () => {
    const titles = new Map([[NOTE.oldPath, 'FV-001 - Zain Shah'], ['/v/z.ARCHIVE', 'Archive'], ['/v/Hiring/Fiverr', 'Fiverr 2026']])
    expect(text(mount(undefined, undefined, titles).el)).toBe("Move 'FV-001 - Zain Shah' to 'Archive'? Its values for Fiverr 2026 and Hiring will be cleared.")
    act(() => root?.unmount())
    expect(text(mount({ shortcut: { path: NOTE.oldPath, dir: '/v/z.ARCHIVE' } }, { notes: 1, folders: ['/v/z.ARCHIVE'] }, titles).el)).toBe("Remove the shortcut from 'Archive'? The values of 'FV-001 - Zain Shah' for Archive will be cleared.")
  })

  it('names a FOLDER whole: one called `2026.md` keeps its `.md`', () => {
    const { el } = mount({ moves: [{ oldPath: '/v/Hiring/2026.md', newPath: '/v/z.ARCHIVE/2026.md', kind: 'dir' }] }, { notes: 3, folders: ['/v/Hiring'] })
    expect(text(el)).toBe("Move '2026.md' to 'z.ARCHIVE'? 3 notes will lose their values for Hiring.")
  })

  it('several items are counted, never named', () => {
    const { el } = mount({ moves: [NOTE, { oldPath: '/v/Hiring/Fiverr/B.md', newPath: '/v/z.ARCHIVE/B.md', kind: 'file' }] }, { notes: 2, folders: ['/v/Hiring/Fiverr'] })
    expect(text(el)).toBe("Move 2 items to 'z.ARCHIVE'? 2 notes will lose their values for Fiverr.")
  })

  it('a move to the vault’s top level: the destination is named by the vault’s name — and so is the root’s own folder', () => {
    const { el } = mount({ moves: [{ ...NOTE, newPath: '/v/Zain Shah.md' }] })
    expect(text(el)).toBe("Move 'Zain Shah' to 'v'? Its values for Fiverr and Hiring will be cleared.")
    act(() => root?.render(<ConfirmMove moves={[{ oldPath: '/v/Top.md', newPath: '/v/Hiring/Top.md', kind: 'file' }]} lost={{ notes: 1, folders: ['/v'] }} titles={new Map()} onConfirm={() => undefined} onCancel={() => undefined} />))
    expect(text(el)).toBe("Move 'Top' to 'Hiring'? Its values for v will be cleared.")
  })

  it('"Remove shortcut": the folder the row stands in, the note, and the folders whose values go; Cancel and Remove', () => {
    const { el } = mount({ shortcut: { path: '/v/Notes/_PIPELINE-CONTEXT.md', dir: '/v/ENG PIPELINE' } }, { notes: 1, folders: ['/v/ENG PIPELINE'] })
    expect(text(el)).toBe("Remove the shortcut from 'ENG PIPELINE'? The values of '_PIPELINE-CONTEXT' for ENG PIPELINE will be cleared.")
    expect([...el.querySelectorAll('.confirm__btn')].map((b) => b.textContent)).toEqual(['Cancel', 'Remove'])
    expect(btn(el, 'Remove')?.classList.contains('confirm__btn--danger')).toBe(true)
  })

  it('a pasted Copy (YAZ-2420 3E1): the same sheet in the copy wording, offering Cancel and Copy', () => {
    const { el } = mount({ moves: [NOTE], copy: true })
    expect(text(el)).toBe("Copy 'Zain Shah' to 'z.ARCHIVE'? Its values for Fiverr and Hiring will not be copied.")
    expect([...el.querySelectorAll('.confirm__btn')].map((b) => b.textContent)).toEqual(['Cancel', 'Copy'])
  })

  it('offers exactly Cancel and Move', () => {
    const { el } = mount()
    expect([...el.querySelectorAll('.confirm__btn')].map((b) => b.textContent)).toEqual(['Cancel', 'Move'])
  })

  it('the confirm button is styled as the destructive action, the way the delete confirm’s is', () => {
    const { el } = mount()
    expect(btn(el, 'Move')?.classList.contains('confirm__btn--danger')).toBe(true)
    expect(btn(el, 'Cancel')?.classList.contains('confirm__btn--danger')).toBe(false)
  })

  it('Cancel has the focus, so a stray Enter moves nothing: a key arriving from OUTSIDE the sheet is not heard', () => {
    const { el, onConfirm, onCancel } = mount()
    expect(document.activeElement).toBe(btn(el, 'Cancel'))
    act(() => void document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('Escape and click-away cancel; clicking Cancel cancels', () => {
    const { el, onConfirm, onCancel } = mount()
    press(el, 'Escape')
    act(() => void el.querySelector('.confirm-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    act(() => btn(el, 'Cancel')?.click())
    expect(onCancel).toHaveBeenCalledTimes(3)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('clicking Move confirms', () => {
    const { el, onConfirm } = mount()
    act(() => btn(el, 'Move')?.click())
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('is an in-app dialog, labelled by its own text, with no "Don\'t ask me again"', () => {
    const { el } = mount()
    const dialog = el.querySelector('.confirm')
    expect(dialog?.getAttribute('role')).toBe('dialog')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(dialog?.getAttribute('aria-labelledby')).toBe('confirm-move-text')
    expect(el.querySelector('input[type="checkbox"]')).toBeNull()
  })
})
