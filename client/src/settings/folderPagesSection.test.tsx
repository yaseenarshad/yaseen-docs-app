/**
 * Settings › Folder pages (YAZ-4585, D34 of YAZ-4501): each row writes its part of the one `folderPages` object, the
 * folder views' "Preview on hover" moved here with the same key, and the two switches that default to another setting
 * show that setting until they are set.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_SETTINGS, type SettingsState } from '@shared/types'
import { SettingsDialog } from './SettingsDialog'
import { SETTINGS_SECTIONS } from './registry'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  // Settings opens on General (YAZ-3276 D7), whose Settings folder row asks main where the settings are.
  return { ...actual, api: { state: { settingsFolder: vi.fn(async () => ({ folder: null, missing: false })), setSettingsFolder: vi.fn() } } }
})

let root: Root | null = null
let el: HTMLElement
const onChange = vi.fn()

beforeEach(() => onChange.mockReset())
afterEach(() => {
  act(() => root?.unmount())
  root = null
  el.remove()
})

async function open(page: string, settings: SettingsState = { ...DEFAULT_SETTINGS }) {
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  act(() => root?.render(<SettingsDialog ctx={{ settings, onChange }} onClose={vi.fn()} />))
  act(() => [...el.querySelectorAll<HTMLButtonElement>('.settings-nav__item')].find((b) => b.textContent === page)?.click())
  await act(async () => await Promise.resolve())
}
const row = (id: string) => el.querySelector<HTMLElement>(`[data-setting="${id}"]`)
const button = (id: string, label: string) => [...(row(id)?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((b) => b.textContent === label)!
const pressed = (id: string) => [...(row(id)?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent
const written = (): SettingsState => onChange.mock.calls.at(-1)![0]

describe('Settings › Folder pages (YAZ-4585)', () => {
  it('each row writes its part of folderPages, and every other part stays', async () => {
    await open('Folder pages')
    const clicks: [string, string, Partial<SettingsState['folderPages']>][] = [
      ['weekStartsOn', 'Monday', { weekStartsOn: 'monday' }], // Sunday is the default (YAZ-3746 demo round 2)
      ['rowBand', 'Off', { rowBand: false }],
      ['keepWindowPinned', 'Off', { keepWindowPinned: false }],
      ['rowHeight', 'Tall', { rowHeight: 'tall' }],
      ['rowNumbers', 'Off', { rowNumbers: false }],
      ['textInCells', 'Clip', { textInCells: 'clip' }],
      ['groupIndent', 'Large', { groupIndent: 'large' }],
      // YAZ-4798: where you are in a grouped table.
      ['stickyGroups', 'Off', { stickyGroups: false }],
      ['groupLines', 'On', { groupLines: 'always' }],
      ['groupLineStyle', 'Thread', { groupLineStyle: 'thread' }],
      ['showEmptyGroups', 'Off', { showEmptyGroups: false }], // on by default (YAZ-3746 demo round 2, F2)
      ['showEmptyColumns', 'On', { showEmptyColumns: true }], // its own switch (YAZ-4608 C2)
      ['subfolders', 'Both', { subfolders: 'both' }],
      ['foldersFirst', 'Off', { foldersFirst: false }],
      ['calendarScale', 'Week', { calendarScale: 'week' }],
      ['cardTitles', 'Wrap', { cardTitles: 'wrap' }],
      ['hideWeekends', 'On', { hideWeekends: true }],
      ['showFolderPageFiles', 'On', { showFolderPageFiles: true }],
      ['askBeforeDelete', 'Off', { askBeforeDelete: false }],
      ['confirmChanges', 'Off', { confirmChanges: false }],
      ['showOtherFiles', 'Off', { showOtherFiles: false }],
      ['inheritColumns', 'Off', { inheritColumns: false }],
      ['columnMarks', 'Icon and folder name', { columnMarks: 'name' }],
    ]
    for (const [part, label, change] of clicks) {
      act(() => button(`folderPages.${part}`, label).click())
      expect(written().folderPages).toEqual({ ...DEFAULT_SETTINGS.folderPages, ...change })
      expect(written().theme).toBe(DEFAULT_SETTINGS.theme)
    }
  })

  it('every default shows: Sunday, short rows, numbers on, by kind, Medium, empty groups on, Their notes, Month, Clip, files off, Confirm changes on', async () => {
    await open('Folder pages')
    expect(pressed('folderPages.weekStartsOn')).toBe('Sunday') // Sunday to Saturday (YAZ-3746 demo round 2)
    expect(pressed('folderPages.rowHeight')).toBe('Short')
    expect(pressed('folderPages.rowNumbers')).toBe('On')
    expect(pressed('folderPages.textInCells')).toBe('By kind')
    expect(pressed('folderPages.groupIndent')).toBe('Medium')
    // YAZ-4798: sticky group headers on, group lines on hover, plain lines.
    expect(pressed('folderPages.stickyGroups')).toBe('On')
    expect(pressed('folderPages.groupLines')).toBe('On hover')
    expect(pressed('folderPages.groupLineStyle')).toBe('Lines')
    expect(pressed('folderPages.showEmptyGroups')).toBe('On') // YAZ-3746 demo round 2 (F2)
    expect(pressed('folderPages.showEmptyColumns')).toBe('Off')
    expect(pressed('folderPages.subfolders')).toBe('Their notes')
    expect(pressed('folderPages.foldersFirst')).toBe('On')
    expect(pressed('folderPages.calendarScale')).toBe('Month')
    expect(pressed('folderPages.cardTitles')).toBe('Clip')
    expect(pressed('folderPages.hideWeekends')).toBe('Off')
    expect(pressed('folderPages.showFolderPageFiles')).toBe('Off')
    // Delete note… asks first unless this is turned off (YAZ-4592 S26).
    expect(pressed('folderPages.askBeforeDelete')).toBe('On')
    expect(pressed('folderPages.confirmChanges')).toBe('On') // a folder page asks before it changes a note (YAZ-3746 13AN)
    expect(pressed('folderPages.showOtherFiles')).toBe('On')
    expect(pressed('folderPages.inheritColumns')).toBe('On') // YAZ-4713 C12: a page shows its parent folders' columns
    expect(pressed('folderPages.columnMarks')).toBe('Icon') // C11: the header's mark is an icon by default
  })

  it('the calendar lines (YAZ-4878): 1 px and Gray by default; a pick in "Thickness ▾" writes weekLine, one in the colour dot writes dayLineColor', async () => {
    await open('Folder pages')
    for (const part of ['weekLine', 'dayLine']) expect(row(`folderPages.${part}`)?.querySelector('.cal-line__thickness')?.textContent).toBe('1 px')
    // The dropdown is on the body (`Popover`'s `portal`, YAZ-4878 demo), not in the row.
    const inPanel = (find: (b: HTMLButtonElement) => boolean) => [...document.body.querySelectorAll<HTMLButtonElement>('.cal-line__panel button')].find(find)!
    act(() => row('folderPages.weekLine')!.querySelector<HTMLButtonElement>('.cal-line__thickness')!.click())
    act(() => inPanel((b) => b.textContent === '3 px').click())
    expect(written().folderPages).toEqual({ ...DEFAULT_SETTINGS.folderPages, weekLine: 3 })
    act(() => row('folderPages.dayLine')!.querySelector<HTMLButtonElement>('.cal-line__colour')!.click())
    act(() => inPanel((b) => b.textContent === 'Teal').click())
    expect(written().folderPages).toEqual({ ...DEFAULT_SETTINGS.folderPages, dayLineColor: 'teal' })
  })

  it('Row band and the window pin show the table block’s setting until they are set', async () => {
    await open('Folder pages', { ...DEFAULT_SETTINGS, tableRowBand: 'off', tableCellNotePinned: false })
    expect(pressed('folderPages.rowBand')).toBe('Off')
    expect(pressed('folderPages.keepWindowPinned')).toBe('Off')
    act(() => root?.unmount())
    el.remove()
    await open('Folder pages', { ...DEFAULT_SETTINGS, tableRowBand: 'off', tableCellNotePinned: false, folderPages: { ...DEFAULT_SETTINGS.folderPages, rowBand: true, keepWindowPinned: true } })
    expect(pressed('folderPages.rowBand')).toBe('On')
    expect(pressed('folderPages.keepWindowPinned')).toBe('On')
  })

  it('the two row band rows point at each other (YAZ-4608 C5)', async () => {
    const items = SETTINGS_SECTIONS.flatMap((s) => s.groups.flatMap((g) => g.items))
    const hint = (id: string) => String(items.find((item) => item.id === id)!.hint)
    expect(hint('tableRowBand')).toContain('Folder pages › Row band on hover')
    // No-break spaces after the arrows (YAZ-4643 S7). The table rows moved to Settings › Tables › All tables (YAZ-4775).
    expect(hint('folderPages.rowBand')).toContain('Tables › All tables › Row band')
    await open('Folder pages')
    expect(row('folderPages.rowBand')?.querySelector('.setting__hint')?.textContent).toContain('Tables › All tables › Row band')
  })

  it('a hint keeps "›" with the word after it (YAZ-4643 S7): a no-break space, so the arrow never ends a line', async () => {
    await open('Folder pages')
    for (const id of ['folderPages.rowBand', 'folderPages.keepWindowPinned']) {
      const hint = row(id)?.querySelector('.setting__hint')?.textContent ?? ''
      expect(hint).toContain('›')
      expect(hint).toMatch(/› \S/)
      expect(hint).not.toMatch(/› /)
    }
  })

  it('Preview on hover for folder views lives here now, on the same key; Files & Links keeps the other places', async () => {
    await open('Folder pages')
    act(() => button('hoverPreviewIn.folderViews', 'Off').click())
    expect(written().hoverPreviewIn).toEqual({ ...DEFAULT_SETTINGS.hoverPreviewIn, folderViews: false })
    const ids = (section: string) => SETTINGS_SECTIONS.find((s) => s.id === section)!.groups.flatMap((g) => g.items.map((item) => item.id))
    expect(ids('files')).not.toContain('hoverPreviewIn.folderViews')
    expect(ids('files')).toContain('hoverPreviewIn.backlinks')
  })
})
