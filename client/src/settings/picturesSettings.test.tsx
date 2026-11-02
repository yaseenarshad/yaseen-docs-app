/**
 * Settings › Files & Links for drawings (YAZ-3943 demo 2 and round 3): "New boards keep pictures" (inside, the assets
 * folder, or a folder you pick), "Allowed picture folders" (this Mac's outside folders, each with Remove) and the
 * hover row "Links in drawings". The bridge is mocked: no row may reach a real main process.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_SETTINGS, type SettingsState } from '@shared/types'
import { api, BridgeRequestError } from '../api'
import { NO_PICTURES_FOLDER_YET } from './NewBoardPicturesControl'
import { SettingsDialog } from './SettingsDialog'
import { searchSettings, settingCandidates } from './searchSettings'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: {
    state: { settingsFolder: vi.fn(async () => ({ folder: null, missing: false })), setSettingsFolder: vi.fn() },
    app: { home: vi.fn(async () => '/Users/me') },
    pickPicturesFolder: vi.fn(),
    pictureFolders: { list: vi.fn(), remove: vi.fn() },
  },
}))

const pick = vi.mocked(api.pickPicturesFolder)
const list = vi.mocked(api.pictureFolders.list)
const remove = vi.mocked(api.pictureFolders.remove)

let root: Root | null = null
let el: HTMLElement
let onChange: ReturnType<typeof vi.fn>

beforeEach(() => {
  pick.mockReset()
  list.mockReset().mockResolvedValue([])
  remove.mockReset().mockResolvedValue([])
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  el.remove()
})

const flush = () => act(async () => await Promise.resolve())

/** The dialog on Files & Links, with `settings`; `places` null is a window with no vault. */
async function mount(settings: SettingsState = { ...DEFAULT_SETTINGS }, vaults: readonly { root: string; name: string }[] | null = [{ root: '/Users/me/Vault', name: 'Vault' }]) {
  const places = vaults ?? undefined
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  onChange = vi.fn()
  act(() => root?.render(<SettingsDialog ctx={{ settings, onChange, places }} onClose={vi.fn()} />))
  act(() => [...el.querySelectorAll<HTMLButtonElement>('.settings-nav__item')].find((b) => b.textContent === 'Files & Links')!.click())
  await flush()
}
/** Re-renders with the settings `onChange` last gave, as App does. */
async function rerender(settings: SettingsState) {
  act(() => root?.render(<SettingsDialog ctx={{ settings, onChange, places: [{ root: '/Users/me/Vault', name: 'Vault' }] }} onClose={vi.fn()} />))
  await flush()
}
const row = (id: string) => el.querySelector<HTMLElement>(`[data-setting="${id}"]`)!
const button = (id: string, label: string) => [...row(id).querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)

describe('Settings › Files & Links › New boards keep pictures', () => {
  it('three choices, "Inside the board" by default; "In a folder you pick" shows "No folder chosen yet" and Choose…', async () => {
    await mount()
    expect([...row('newBoardPictures').querySelectorAll('[role="group"][aria-label="New boards keep pictures"] button')].map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([
      ['Inside the board', 'true'],
      ['In the assets folder', 'false'],
      ['In a folder you pick', 'false'],
    ])
    expect(button('newBoardPictures', 'Choose…')).toBeUndefined()
    act(() => button('newBoardPictures', 'In a folder you pick')!.click())
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, newBoardPictures: 'folder' })
    await rerender({ ...DEFAULT_SETTINGS, newBoardPictures: 'folder' })
    expect(row('newBoardPictures').querySelector('[data-testid="new-board-pictures-folder"]')!.textContent).toBe(NO_PICTURES_FOLDER_YET)
    expect(button('newBoardPictures', 'Choose…')).toBeDefined()
  })

  it('Choose… opens the folder window on the vault (or the chosen folder) and saves the pick; an outside pick shows as ~/…; a refusal shows its reason and changes nothing', async () => {
    const settings = { ...DEFAULT_SETTINGS, newBoardPictures: 'folder' as const }
    await mount(settings)
    pick.mockResolvedValueOnce({ folder: '/Users/me/Pictures/Boards' })
    await act(async () => button('newBoardPictures', 'Choose…')!.click())
    // No confirm box follows Settings' pick, so main approves an outside folder at once (YAZ-4074 6A item 3).
    expect(pick).toHaveBeenLastCalledWith({ root: '/Users/me/Vault', approveNow: true })
    expect(onChange).toHaveBeenLastCalledWith({ ...settings, newBoardPicturesFolder: '/Users/me/Pictures/Boards' })
    await rerender({ ...settings, newBoardPicturesFolder: '/Users/me/Pictures/Boards' })
    expect(row('newBoardPictures').querySelector('[data-testid="new-board-pictures-folder"]')!.textContent).toBe('~/Pictures/Boards')

    onChange.mockClear()
    pick.mockRejectedValueOnce(new BridgeRequestError('BAD_REQUEST', "The app can't keep pictures in a system folder. Pick another folder."))
    await act(async () => button('newBoardPictures', 'Choose…')!.click())
    expect(pick).toHaveBeenLastCalledWith({ root: '/Users/me/Vault', current: '/Users/me/Pictures/Boards', approveNow: true })
    expect(row('newBoardPictures').querySelector('[role="alert"]')!.textContent).toBe("The app can't keep pictures in a system folder. Pick another folder.")
    expect(onChange).not.toHaveBeenCalled()
    pick.mockResolvedValueOnce({ cancelled: true })
    await act(async () => button('newBoardPictures', 'Choose…')!.click())
    expect(onChange).not.toHaveBeenCalled()
  })

  it('a window with no vault has no Choose…', async () => {
    await mount({ ...DEFAULT_SETTINGS, newBoardPictures: 'folder', newBoardPicturesFolder: 'Board pictures' }, null)
    expect(row('newBoardPictures').querySelector('[data-testid="new-board-pictures-folder"]')!.textContent).toBe('Board pictures')
    expect(button('newBoardPictures', 'Choose…')).toBeUndefined()
  })
})

describe('Settings › Files & Links › Allowed picture folders', () => {
  it('"None yet" with no folder; each folder as ~/… with Remove, which takes it off and reads the list again', async () => {
    await mount()
    expect(row('allowedPictureFolders').textContent).toContain('None yet')
    act(() => root?.unmount())
    el.remove()

    list.mockResolvedValue(['/Users/me/Pictures/Boards', '/Volumes/Disk/pics'])
    await mount()
    expect([...row('allowedPictureFolders').querySelectorAll('.settings__path')].map((p) => [p.textContent, p.getAttribute('title')])).toEqual([
      ['~/Pictures/Boards', '/Users/me/Pictures/Boards'],
      ['/Volumes/Disk/pics', '/Volumes/Disk/pics'],
    ])
    list.mockResolvedValue(['/Volumes/Disk/pics'])
    await act(async () => row('allowedPictureFolders').querySelector<HTMLButtonElement>('button[aria-label="Remove ~/Pictures/Boards from the allowed picture folders"]')!.click())
    await flush()
    expect(remove).toHaveBeenCalledWith('/Users/me/Pictures/Boards')
    expect([...row('allowedPictureFolders').querySelectorAll('.settings__path')].map((p) => p.textContent)).toEqual(['/Volumes/Disk/pics'])
  })
})

describe('Settings › Files & Links › Preview on hover › Links in drawings (YAZ-3943 demo 2)', () => {
  it('is on by default, and Off turns the drawings place off alone', async () => {
    await mount()
    expect(row('hoverPreviewIn.drawings').textContent).toContain('Links in drawings')
    act(() => row('hoverPreviewIn.drawings').querySelector<HTMLButtonElement>('[aria-label="Preview on hover: Links in drawings"] button:last-child')!.click())
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, hoverPreviewIn: { ...DEFAULT_SETTINGS.hoverPreviewIn, drawings: false } })
  })
})

describe('the settings search finds the new rows by their words', () => {
  const ids = (query: string) => searchSettings(settingCandidates({ settings: DEFAULT_SETTINGS, onChange: vi.fn() }), query).map((h) => h.item.id)
  it('"allowed folders", "pictures folder", "links in drawings", "pills" and "new boards" reach them', () => {
    expect(ids('allowed folders')).toEqual(['allowedPictureFolders'])
    expect(ids('pictures folder')).toEqual(expect.arrayContaining(['newBoardPictures', 'allowedPictureFolders']))
    expect(ids('links in drawings')).toEqual(['hoverPreviewIn.drawings'])
    expect(ids('pills')).toContain('hoverPreviewIn.drawings')
    expect(ids('new boards')[0]).toBe('newBoardPictures')
  })
})
