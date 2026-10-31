/**
 * Settings › Editor › Selection toolbar (YAZ-3806 T5, T7): the row in the real Settings dialog, its show boxes and
 * Reset, and the order rules a drag writes. A drag's pointer moves need real layout, so the drag itself is in the
 * demo; the drop it writes is `moveGroup` / `moveButton`, tested here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_SETTINGS, DEFAULT_TOOLBAR, TOOLBAR_BUTTONS, type SettingsState } from '@shared/types'
import { SettingsDialog } from './SettingsDialog'
import { groupButtons } from '../editor/toolbarPrefs'
import { moveButton, moveGroup, toggleButton } from './ToolbarArrange'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { state: { settingsFolder: vi.fn(async () => ({ folder: null, missing: false })), setSettingsFolder: vi.fn() } },
}))

let root: Root | null = null
let el: HTMLElement
afterEach(() => {
  act(() => root?.unmount())
  root = null
  el?.remove()
})

async function mountEditorPage(settings: SettingsState, onChange: (next: SettingsState) => void) {
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  act(() => root?.render(<SettingsDialog ctx={{ settings, onChange }} onClose={vi.fn()} />))
  act(() => [...el.querySelectorAll<HTMLButtonElement>('.settings-nav__item')].find((b) => b.textContent === 'Editor')?.click())
  await act(async () => await Promise.resolve())
}

const row = () => el.querySelector<HTMLElement>('[data-setting="selectionToolbar"]')!

describe('Settings › Editor › Selection toolbar (YAZ-3806 T7)', () => {
  it('lists each group with its buttons in order — a grip, a show box, the icon and the name — and Reset to default', async () => {
    await mountEditorPage({ ...DEFAULT_SETTINGS }, vi.fn())
    const groups = [...row().querySelectorAll<HTMLElement>('.toolbar-arrange__group')]
    expect(groups.map((g) => g.querySelector('.toolbar-arrange__head')!.textContent)).toEqual(['Line type', 'Lists', 'Text style', 'Code and link'])
    expect(groups.map((g) => [...g.querySelectorAll<HTMLElement>('.toolbar-arrange__row')].map((r) => r.dataset.button))).toEqual([
      ['h1', 'h2', 'h3', 'text'],
      ['checklist', 'bulletList', 'numberedList'],
      ['bold', 'italic', 'underline', 'strikethrough', 'highlight', 'highlight-green', 'highlight-blue', 'highlight-pink'],
      ['code', 'link'],
    ])
    const bullet = row().querySelector<HTMLElement>('[data-button="bulletList"]')!
    expect(bullet.querySelector('.tab-row-panel__grip svg')).not.toBeNull()
    expect(bullet.querySelector('.toolbar-arrange__icon svg')).not.toBeNull()
    expect(bullet.querySelector('.toolbar-arrange__name')!.textContent).toBe('Bullet list')
    expect(bullet.querySelector('[role="checkbox"]')!.getAttribute('aria-checked')).toBe('true')
    expect([...row().querySelectorAll('button')].some((b) => b.textContent === 'Reset to default')).toBe(true)
  })

  it('a show box writes the setting: untick hides the button, tick shows it again in its place; Reset writes the default', async () => {
    const onChange = vi.fn()
    const hidden = { ...DEFAULT_TOOLBAR, hidden: ['bold' as const] }
    await mountEditorPage({ ...DEFAULT_SETTINGS, selectionToolbar: hidden }, onChange)
    const box = (button: string) => row().querySelector<HTMLButtonElement>(`[data-button="${button}"] [role="checkbox"]`)!
    expect(box('bold').getAttribute('aria-checked')).toBe('false')

    act(() => box('italic').click())
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, selectionToolbar: { ...hidden, hidden: ['bold', 'italic'] } })
    act(() => box('bold').click())
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, selectionToolbar: DEFAULT_TOOLBAR })
    act(() => [...row().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Reset to default')!.click())
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, selectionToolbar: DEFAULT_TOOLBAR })
  })
})

describe('the last button (YAZ-3806 T7)', () => {
  it('the one button that still shows cannot be unticked: a strip with no button would be an empty box', async () => {
    const onChange = vi.fn()
    const hidden = TOOLBAR_BUTTONS.filter((b) => b !== 'link')
    await mountEditorPage({ ...DEFAULT_SETTINGS, selectionToolbar: { ...DEFAULT_TOOLBAR, hidden } }, onChange)
    const box = (button: string) => row().querySelector<HTMLButtonElement>(`[data-button="${button}"] [role="checkbox"]`)!
    expect(box('link').disabled).toBe(true)
    expect(box('code').disabled).toBe(false)
    act(() => box('code').click())
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, selectionToolbar: { ...DEFAULT_TOOLBAR, hidden: hidden.filter((b) => b !== 'code') } })
  })
})

describe('the order a drop writes (YAZ-3806 T5)', () => {
  it('moveGroup moves a group; moveButton moves a button inside its group only, the other groups untouched', () => {
    expect(moveGroup(DEFAULT_TOOLBAR, 1, 0).groups).toEqual(['lists', 'lineType', 'textStyle', 'insert'])
    const moved = moveButton(DEFAULT_TOOLBAR, 'insert', 1, 0)
    expect(groupButtons(moved, 'insert')).toEqual(['link', 'code'])
    expect(groupButtons(moved, 'textStyle')).toEqual(groupButtons(DEFAULT_TOOLBAR, 'textStyle'))
    expect(groupButtons(moveButton(DEFAULT_TOOLBAR, 'textStyle', 2, 0), 'textStyle').slice(0, 3)).toEqual(['underline', 'bold', 'italic'])
    expect(moved.buttons).toHaveLength(DEFAULT_TOOLBAR.buttons.length)
  })

  it('toggleButton hides and shows; a shown button keeps its place', () => {
    const off = toggleButton(DEFAULT_TOOLBAR, 'link')
    expect(off.hidden).toEqual(['link'])
    expect(toggleButton(off, 'link')).toEqual(DEFAULT_TOOLBAR)
  })
})
