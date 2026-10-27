/**
 * Settings search (YAZ-1679 D6): the candidates are built from the registry — label, hint,
 * keywords, group title, group hint, section title — and the match is the `[[` picker's exact →
 * prefix → substring rule.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { SettingsCtx } from './registry'
import { searchSettings, settingCandidates, wordMatches, type SettingHit } from './searchSettings'

const ctx = (sync?: SettingsCtx['sync'], review?: SettingsCtx['review']): SettingsCtx => ({ settings: { ...DEFAULT_SETTINGS }, onChange: () => undefined, sync, review })
const REVIEW: SettingsCtx['review'] = { settings: DEFAULT_REVIEW_SETTINGS, save: () => undefined }
const REVIEW_ROWS = ['enabled', 'baseDays', 'growth', 'maxDays', 'reviewByDefault']
const ids = (hits: readonly SettingHit[]) => hits.map((h) => h.item.id)
/** The Hotkeys page's rows, in page order. */
const hotkeyRows = () => ids(settingCandidates(ctx()).filter((h) => h.section.id === 'hotkeys'))

/** A synthetic candidate list where the three tiers are all present for one needle. */
const tiers: SettingHit[] = (['width of the thread', 'width', 'content width'] as const).map((name) => ({
  section: { id: 'appearance', title: 'Appearance', groups: [] },
  group: { items: [] },
  item: { id: name, label: name, render: () => null },
  name,
  lower: name.toLowerCase(),
}))

describe('settingCandidates', () => {
  it('covers every setting of every available section, one candidate each, in registry order', () => {
    expect(ids(settingCandidates(ctx()))).toEqual([
      // General (YAZ-3276 D7): the settings folder, then Reopen, moved here from Files & Links.
      'settingsFolder',
      'startupWindows',
      'theme',
      'contentWidth',
      'lineSpacing',
      'blockGap',
      'textFormatting',
      'commentsOrder',
      // Appearance › Sidebar level lines (YAZ-3309 D6).
      'sidebarLines',
      'sidebarLineStyle',
      'sidebarThreadColor',
      'diagramDarkColors',
      // Settings › Notifications (YAZ-3303), under Appearance.
      ...['noticeLength', 'noticeUndo', 'noticeClipboard', 'noticeLists', 'gestureSounds', 'hearSounds'],
      'bulletThreading',
      'threadWidth',
      'threadColor',
      'sectionStep',
      'sectionLines',
      'tableOfContents',
      'tocLines',
      // Settings › Excalidraw canvas (YAZ-3037).
      ...['gridModeEnabled', 'objectsSnapModeEnabled', 'snapToMidpoints', 'arrowBinding', 'selectOn', 'toolLock', 'zenModeEnabled', 'writingMode', 'framesVisible', 'writingStrokeWidth', 'vectorStrokeWidth', 'defaultFontFamily', 'defaultRoughness', 'defaultTextAlign'].map((k) => `canvas.${k}`),
      // Settings › Images (YAZ-3038).
      'pixabayApiKey',
      'libraryFolder',
      'confirmDelete',
      'confirmRename',
      'hoverPreview',
      'newNoteLocation',
      'ids',
      'duplicates',
      'idLetters',
      'oldIds',
      // Settings › Hotkeys (YAZ-3397 D5): one candidate per KEY, so a search finds the row, not the table.
      ...hotkeyRows(),
    ])
  })

  it('Hotkeys: the changeable commands head Window, then one row per built-in key, the Mac\'s keys, and Reset all — every id unique (YAZ-3397 D5, D8)', () => {
    const rows = hotkeyRows()
    expect(rows.slice(0, 14)).toEqual(['newTab', 'newWindow', 'newFilesWindow', 'closeTab', 'closeWindow', 'switchVault', 'openFolder', 'search', 'settings', 'toggleSidebar', 'copyPath', 'tabOverview', 'nextTab', 'prevTab'].map((id) => `hotkey-${id}`))
    expect(rows).toContain('hotkey-keyboard-table-of-contents')
    expect(rows).toContain('hotkey-macos-spotlight')
    expect(rows[rows.length - 1]).toBe('hotkeys-reset-all')
    expect(new Set(rows).size).toBe(rows.length)
  })

  it('includes the Sync page only when the engine is there', () => {
    expect(ids(settingCandidates(ctx({ status: null, setEnabled: () => undefined })))).toContain('githubSync')
    expect(ids(settingCandidates(ctx()))).not.toContain('githubSync')
  })

  it('includes the Review section only with a vault open, between Files & Links and Sync (YAZ-2322)', () => {
    const all = ids(settingCandidates(ctx({ status: null, setEnabled: () => undefined }, REVIEW)))
    expect(all.slice(all.indexOf('ids'), all.indexOf('githubSync') + 1)).toEqual(['ids', 'duplicates', 'idLetters', 'oldIds', ...REVIEW_ROWS, 'githubSync'])
    expect(ids(settingCandidates(ctx())).filter((id) => REVIEW_ROWS.includes(id))).toEqual([])
  })

  it('includes Storage and Sharing only with their hooks, after Sync and before Hotkeys; Excalidraw canvas and Images sit between Editor and Files & Links (YAZ-3028 merge)', () => {
    const storage: SettingsCtx['storage'] = { stats: null, failed: false, refresh: () => undefined, shrink: async () => ({ shrunk: 0, skipped: 0, bytesMoved: 0 }), lastShrink: null }
    const sharing: SettingsCtx['sharing'] = { root: '/v', status: null, rows: null, listError: null, now: 0, refresh: () => undefined, show: () => undefined }
    const sectionsOf = (c: SettingsCtx) => [...new Set(settingCandidates(c).map((h) => h.section.id))]
    expect(sectionsOf({ ...ctx({ status: null, setEnabled: () => undefined }, REVIEW), storage, sharing })).toEqual(['general', 'appearance', 'notifications', 'editor', 'canvas', 'images', 'files', 'review', 'sync', 'storage', 'sharing', 'hotkeys'])
    expect(sectionsOf(ctx())).toEqual(['general', 'appearance', 'notifications', 'editor', 'canvas', 'images', 'files', 'hotkeys'])
  })

  it('a candidate carries label, hint, keywords, group title and section title, case-folded in `lower`', () => {
    const confirm = settingCandidates(ctx()).find((h) => h.item.id === 'confirmDelete')
    expect(confirm?.name).toBe('Confirm before deleting Deleted notes and folders move to the Trash either way. Files & Links')
    expect(confirm?.lower).toBe(confirm?.name.toLowerCase())
    const width = settingCandidates(ctx()).find((h) => h.item.id === 'threadWidth')
    expect(width?.name).toBe('Line width thread width Bullet threading Guide lines that connect nested bullets. Editor')
    expect(width?.group.title).toBe('Bullet threading')
    // Comments is a group of Appearance (YAZ-2709): its row says so to search.
    const order = settingCandidates(ctx()).find((h) => h.item.id === 'commentsOrder')
    expect(order?.name).toBe('Order comments order sort Comments Appearance')
    expect(order?.section.id).toBe('appearance')
  })

  it('the sync hint is the live repo fact, so a remote URL is searchable', () => {
    const hit = settingCandidates(ctx({ status: { root: '/v', state: 'synced', repo: { remoteUrl: 'git@github.com:me/notes.git', branch: 'main' } }, setEnabled: () => undefined })).find((h) => h.item.id === 'githubSync')
    expect(hit?.name).toContain('repo git@github.com:me/notes.git · branch main')
  })
})

describe('searchSettings', () => {
  it('ranks exact before prefix before substring — the [[ picker rule', () => {
    expect(searchSettings(tiers, 'width').map((h) => h.name)).toEqual(['width', 'width of the thread', 'content width'])
    expect(searchSettings(tiers, '  WIDTH ').map((h) => h.name)).toEqual(['width', 'width of the thread', 'content width'])
  })

  it('never truncates: every match comes back', () => {
    expect(searchSettings(tiers, 'width')).toHaveLength(3)
  })

  it('matches on a keyword the label does not contain', () => {
    expect(ids(searchSettings(settingCandidates(ctx()), 'system'))).toEqual(['theme'])
    // "dark" is also the draw.io row's word (YAZ-3037).
    expect(ids(searchSettings(settingCandidates(ctx()), 'dark'))).toEqual(['theme', 'diagramDarkColors'])
    expect(ids(searchSettings(settingCandidates(ctx()), 'readable line'))).toEqual(['contentWidth'])
    // The sounds of Settings › Notifications (YAZ-3303) say "the Trash" in their hints.
    // "trash" is also the word of ⌘⌫ in the Window hotkeys (YAZ-3272 D20).
    expect(ids(searchSettings(settingCandidates(ctx()), 'trash'))).toEqual(['gestureSounds', 'hearSounds', 'confirmDelete', 'hotkey-window-move-the-selected-files-and-folders-to-t'])
  })

  it('matches on the section title, returning every row of that section', () => {
    expect(ids(searchSettings(settingCandidates(ctx()), 'files & links'))).toEqual(['confirmDelete', 'confirmRename', 'hoverPreview', 'newNoteLocation', 'ids', 'duplicates', 'idLetters', 'oldIds'])
  })

  it('"startup" and "launch" find the row that says which windows come back (YAZ-2589 D2)', () => {
    for (const query of ['startup', 'launch', 'when the app starts']) expect(ids(searchSettings(settingCandidates(ctx()), query))).toEqual(['startupWindows'])
  })

  it('"toc" finds the two rows of the table of contents and "jump" the first alone; "outline" and "headings" find it among others; the group\'s name finds both rows and the ⌘J line of the Hotkeys table (YAZ-2700, YAZ-2762)', () => {
    expect(ids(searchSettings(settingCandidates(ctx()), 'toc'))).toEqual(['tableOfContents', 'tocLines'])
    expect(ids(searchSettings(settingCandidates(ctx()), 'jump'))).toEqual(['tableOfContents'])
    // The words the app already uses for the bullet features and the fold keys: the row is one of the answers.
    for (const query of ['outline', 'headings']) expect(ids(searchSettings(settingCandidates(ctx()), query))).toContain('tableOfContents')
    // The settings folder's hint names the table of contents width, which stays on this Mac (YAZ-3276 D7); General comes first.
    // The ⌘J row's label starts with the words, so it ranks first (a prefix hit, YAZ-3397 D5).
    expect(ids(searchSettings(settingCandidates(ctx()), 'table of contents'))).toEqual(['hotkey-keyboard-table-of-contents', 'settingsFolder', 'tableOfContents', 'tocLines'])
  })

  it('"Level lines" (YAZ-2762, YAZ-3309 D6): the label of the TOC\'s row and the title of the sidebar\'s group find the TOC row and the three rows of the group; "hierarchy", "guide" and "hover" find the two Show rows among the rows that share the word', () => {
    expect(ids(searchSettings(settingCandidates(ctx()), 'level lines'))).toEqual(['tocLines', 'sidebarLines', 'sidebarLineStyle', 'sidebarThreadColor'])
    expect(ids(searchSettings(settingCandidates(ctx()), 'hierarchy'))).toEqual(['sidebarLines', 'tocLines'])
    // The canvas's frame outline and draw.io's shape outline share the word too (YAZ-3037).
    expect(ids(searchSettings(settingCandidates(ctx()), 'outline'))).toEqual(['bulletThreading', 'tableOfContents', 'tocLines', 'canvas.framesVisible', 'hotkey-drawio-a-shape-s-outline-a-text-s-background'])
    // "guide" is the hint of Bullet threading and a keyword of the Section indent lines; "hover" is the other grey lines' word too, and the board preview's (YAZ-3044 A20).
    expect(ids(searchSettings(settingCandidates(ctx()), 'guide'))).toEqual(['sidebarLines', 'bulletThreading', 'threadWidth', 'threadColor', 'sectionLines', 'tocLines'])
    expect(ids(searchSettings(settingCandidates(ctx()), 'hover'))).toEqual(['sidebarLines', 'sectionLines', 'tocLines', 'hoverPreview'])
    // The row says its group and its page to search, as each other row does.
    expect(settingCandidates(ctx()).find((h) => h.item.id === 'tocLines')?.name).toBe('Level lines outline toc hierarchy guide hover Table of contents The headings or the bullets of a note, at its right edge. Editor')
  })

  it('the sidebar\'s level lines (YAZ-3309 D6, D7, D9, S12): "sidebar" finds the three rows of the group first; "folder", "tree" and "indent" find Show, not the TOC row; "thread" finds Style and Thread colour beside Bullet threading; "accent" finds the two colour pickers', () => {
    expect(ids(searchSettings(settingCandidates(ctx()), 'sidebar')).slice(0, 3)).toEqual(['sidebarLines', 'sidebarLineStyle', 'sidebarThreadColor'])
    for (const query of ['folder', 'tree', 'indent']) {
      expect(ids(searchSettings(settingCandidates(ctx()), query))).toContain('sidebarLines')
      expect(ids(searchSettings(settingCandidates(ctx()), query))).not.toContain('tocLines')
    }
    expect(ids(searchSettings(settingCandidates(ctx()), 'thread'))).toEqual(['sidebarThreadColor', 'sidebarLineStyle', 'bulletThreading', 'threadWidth', 'threadColor', 'sectionStep', 'sectionLines'])
    expect(ids(searchSettings(settingCandidates(ctx()), 'accent'))).toEqual(['sidebarThreadColor', 'threadColor'])
  })

  it('matches on the group title: "section indent" finds the two rows of that group, "spacing" the two of Spacing', () => {
    expect(ids(searchSettings(settingCandidates(ctx()), 'section indent'))).toEqual(['sectionStep', 'sectionLines'])
    expect(ids(searchSettings(settingCandidates(ctx()), 'spacing'))).toEqual(['lineSpacing', 'blockGap'])
  })

  it('matches on the group hint too: "guide lines" finds the three threading rows; "threading" finds them and the two Section indent rows, whose hint names Bullet threading (and the line style of the sidebar, whose hint does too, YAZ-3309 D7)', () => {
    expect(ids(searchSettings(settingCandidates(ctx()), 'guide lines'))).toEqual(['bulletThreading', 'threadWidth', 'threadColor'])
    expect(ids(searchSettings(settingCandidates(ctx()), 'threading'))).toEqual(['sidebarLineStyle', 'bulletThreading', 'threadWidth', 'threadColor', 'sectionStep', 'sectionLines'])
  })

  it('the pre-redesign labels still match as keywords: "thread width", "comments order"', () => {
    expect(ids(searchSettings(settingCandidates(ctx()), 'thread width'))).toEqual(['threadWidth'])
    expect(ids(searchSettings(settingCandidates(ctx()), 'comments order'))).toEqual(['commentsOrder'])
  })

  it('words, when no substring matches (YAZ-3397 D5): "file window" finds New Files window first, "file winodw" too (one slip); a query that matches as text keeps only those rows', () => {
    const all = settingCandidates(ctx())
    expect(ids(searchSettings(all, 'file window'))[0]).toBe('hotkey-newFilesWindow')
    expect(ids(searchSettings(all, 'file winodw'))[0]).toBe('hotkey-newFilesWindow')
    expect(ids(searchSettings(all, 'swich vault'))).toEqual(['hotkey-switchVault'])
    // Three letters get no slip: "pth" is not "pat".
    expect(ids(searchSettings(all, 'copy pth'))).toEqual([])
    expect(ids(searchSettings(all, 'files window'))).toEqual(['hotkey-newFilesWindow'])
  })

  it('wordMatches: a start of the word, or one slip (wrong, missing, extra or swapped letter) from four letters on', () => {
    expect(wordMatches('fil', 'files')).toBe(true)
    expect(wordMatches('winodw', 'window')).toBe(true)
    expect(wordMatches('windw', 'window')).toBe(true)
    expect(wordMatches('wiindow', 'window')).toBe(true)
    expect(wordMatches('wimdow', 'window')).toBe(true)
    expect(wordMatches('fle', 'files')).toBe(false)
    expect(wordMatches('wnidwo', 'window')).toBe(false)
  })

  it('a hotkey label or key finds its ONE row (YAZ-3397 D5): "close tab" and "⌘W" → Close tab', () => {
    expect(ids(searchSettings(settingCandidates(ctx()), 'close tab'))).toEqual(['hotkey-closeTab'])
    expect(ids(searchSettings(settingCandidates(ctx()), '⌘W'))).toEqual(['hotkey-closeTab'])
    // "underline" is also a word of Appearance › Text formatting (YAZ-3068); a note and a draw.io diagram both
    // underline with ⌘U (YAZ-3037): both rows answer, the note's first (its label is the word).
    expect(ids(searchSettings(settingCandidates(ctx()), 'underline'))).toEqual(['hotkey-keyboard-underline', 'textFormatting', 'hotkey-drawio-bold-underline'])
    expect(ids(searchSettings(settingCandidates(ctx()), 'export excalidraw'))).toEqual(['hotkey-canvas-export-excalidraw-drawing'])
    // A changed key is searched by the key it has NOW.
    const moved = { ...ctx(), settings: { ...DEFAULT_SETTINGS, hotkeys: { search: 'CmdOrCtrl+Shift+K' } } }
    expect(ids(searchSettings(settingCandidates(moved), '⌘⇧K'))).toEqual(['hotkey-search'])
    expect(ids(searchSettings(settingCandidates(moved), '⌘K'))).toEqual([])
  })

  it('"review", "upkeep" and "inbox" each find every row of the Review section (YAZ-2322)', () => {
    const candidates = settingCandidates(ctx(undefined, REVIEW))
    for (const query of ['review', 'upkeep', 'inbox']) {
      expect(ids(searchSettings(candidates, query).filter((h) => h.section.id === 'review')).sort()).toEqual([...REVIEW_ROWS].sort())
    }
  })

  it('no match is an empty list', () => {
    expect(searchSettings(settingCandidates(ctx()), 'zzzz')).toEqual([])
  })
})
