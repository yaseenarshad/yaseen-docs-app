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
  words: name.split(' '),
}))

describe('settingCandidates', () => {
  it('covers every setting of every available section, one candidate each, in registry order', () => {
    expect(ids(settingCandidates(ctx()))).toEqual([
      // General (YAZ-3276 D7): the settings folder, then Reopen, moved here from Files & Links.
      'settingsFolder',
      'startupWindows',
      'vaultOpensOn',
      'theme',
      'contentWidth',
      'lineSpacing',
      'blockGap',
      'textFormatting',
      'commentsOrder',
      'diagramDarkColors',
      // Settings › Sidebar (YAZ-3440 D7), after Appearance. The Line set's colour rows show only with that set.
      'sidebarLines',
      'sidebarLineStyle',
      'sidebarThreadColor',
      'sidebarStickyLevels',
      'sidebarArrowMotion',
      'sidebarFolderIcons',
      'sidebarRevealActive',
      'sidebarIconSet',
      'sidebarFileIcons',
      ...['note', 'text', 'pdf', 'image', 'drawing', 'diagram'].map((k) => `sidebarIconColors.${k}`),
      // The icon rules (YAZ-3440 D9).
      'sidebarIconRules',
      // ⌘D's place (YAZ-3556 D8).
      'goTo',
      // Settings › Notifications (YAZ-3303), under Appearance.
      ...['noticeLength', 'noticeUndo', 'noticeClipboard', 'noticeLists', 'gestureSounds', 'hearSounds'],
      'bulletThreading',
      'threadWidth',
      'threadColor',
      'sectionStep',
      'sectionLines',
      'tocOnByDefault',
      'tableOfContents',
      'tocLines',
      // Settings › Code (YAZ-3449).
      'codeReadOnly',
      'codeWrap',
      'codeMinimap',
      'codeLanguageHelpers',
      // Settings › Excalidraw canvas (YAZ-3037).
      ...['gridModeEnabled', 'objectsSnapModeEnabled', 'snapToMidpoints', 'arrowBinding', 'selectOn', 'toolLock', 'zenModeEnabled', 'writingMode', 'framesVisible', 'writingStrokeWidth', 'vectorStrokeWidth', 'defaultFontFamily', 'defaultRoughness', 'defaultTextAlign'].map((k) => `canvas.${k}`),
      // Settings › Images (YAZ-3038).
      'pixabayApiKey',
      'libraryFolder',
      'confirmDelete',
      'confirmRename',
      'newNoteLocation',
      // Settings › Files & Links › Daily notes (YAZ-3607): the switch, then the rows it shows.
      'dailyNotes',
      'dailyNoteFolder',
      'dailyNoteFormat',
      'dailyNoteDayFolder',
      // Settings › Files & Links › Preview on hover (YAZ-3403): the master switch, then one row per place.
      'hoverPreview',
      ...['sidebar', 'search', 'newTab', 'tabBoard', 'tabs', 'backlinks', 'folderViews', 'links'].map((place) => `hoverPreviewIn.${place}`),
      'ids',
      'duplicates',
      'idLetters',
      'oldIds',
      // Settings › Hotkeys (YAZ-3397 D5): one candidate per KEY, so a search finds the row, not the table.
      ...hotkeyRows(),
    ])
  })

  it('Hotkeys: the colours, then one card per key with its rows (YAZ-3564), every App command among them, the Mac\'s keys, and Reset all — every id unique (YAZ-3397 D5, D8)', () => {
    const rows = hotkeyRows()
    expect(rows[0]).toBe('hotkeys-legend')
    // The shared keys a pick settles come first: ⌘D's card, then ⌘K's.
    expect(rows.slice(1, 6)).toEqual(['hotkey-goTo', 'hotkey-drawing-duplicate', 'hotkey-diagram-duplicate', 'hotkey-code-addSelectionToNextFindMatch', 'hotkey-search'])
    for (const id of ['newTab', 'newWindow', 'newFilesWindow', 'newItem', 'goTo', 'closeTab', 'closeWindow', 'switchVault', 'openFolder', 'search', 'settings', 'toggleSidebar', 'copyPath', 'tabOverview', 'nextTab', 'prevTab']) expect(rows).toContain(`hotkey-${id}`)
    expect(rows).toContain('hotkey-note-toc')
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
    expect(sectionsOf({ ...ctx({ status: null, setEnabled: () => undefined }, REVIEW), storage, sharing })).toEqual(['general', 'appearance', 'sidebar', 'notifications', 'editor', 'code', 'canvas', 'images', 'files', 'review', 'sync', 'storage', 'sharing', 'hotkeys'])
    expect(sectionsOf(ctx())).toEqual(['general', 'appearance', 'sidebar', 'notifications', 'editor', 'code', 'canvas', 'images', 'files', 'hotkeys'])
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
    // "dark" is also the draw.io row's word (YAZ-3037), and draw.io's own key for its dark colours (YAZ-3564).
    expect(ids(searchSettings(settingCandidates(ctx()), 'dark'))).toEqual(['hotkey-diagram-adaptiveColors', 'hotkey-drawing-toggleTheme', 'theme', 'diagramDarkColors'])
    expect(ids(searchSettings(settingCandidates(ctx()), 'readable line'))).toEqual(['contentWidth'])
    // The sounds of Settings › Notifications (YAZ-3303) say "the Trash" in their hints.
    // "trash" is also the word of ⌘⌫ in the Window hotkeys (YAZ-3272 D20).
    expect(ids(searchSettings(settingCandidates(ctx()), 'trash'))).toEqual(['gestureSounds', 'hearSounds', 'confirmDelete', 'hotkey-app-trash'])
  })

  it('matches on the section title, returning every row of that section', () => {
    expect(ids(searchSettings(settingCandidates(ctx()), 'files & links'))).toEqual(['confirmDelete', 'confirmRename', 'newNoteLocation', 'dailyNotes', 'dailyNoteFolder', 'dailyNoteFormat', 'dailyNoteDayFolder', 'hoverPreview', 'hoverPreviewIn.sidebar', 'hoverPreviewIn.search', 'hoverPreviewIn.newTab', 'hoverPreviewIn.tabBoard', 'hoverPreviewIn.tabs', 'hoverPreviewIn.backlinks', 'hoverPreviewIn.folderViews', 'hoverPreviewIn.links', 'ids', 'duplicates', 'idLetters', 'oldIds'])
  })

  it('"startup" and "launch" find the row that says which windows come back (YAZ-2589 D2)', () => {
    for (const query of ['startup', 'launch', 'when the app starts']) expect(ids(searchSettings(settingCandidates(ctx()), query))).toEqual(['startupWindows'])
  })

  it('"toc" finds the three rows of the table of contents and "jump" "Pin default" and the code tab\'s "Jump across files" (YAZ-3500); "outline" and "headings" find them among others; the group\'s name finds the rows and the ⌘J line of the Hotkeys table, "Table of contents default" first; "pin" and "default" find their rows (YAZ-2700, YAZ-2762, YAZ-3558 S18)', () => {
    expect(ids(searchSettings(settingCandidates(ctx()), 'toc'))).toEqual(['tocOnByDefault', 'tableOfContents', 'tocLines'])
    expect(ids(searchSettings(settingCandidates(ctx()), 'jump')).sort()).toEqual(['codeLanguageHelpers', 'tableOfContents'])
    // The words the app already uses for the bullet features and the fold keys: the row is one of the answers.
    for (const query of ['outline', 'headings']) expect(ids(searchSettings(settingCandidates(ctx()), query))).toContain('tableOfContents')
    // The settings folder's hint names the table of contents width, which stays on this Mac (YAZ-3276 D7); General comes first.
    // "Table of contents default" and the ⌘J row's label start with the words, so they rank first (a prefix hit, YAZ-3397 D5).
    expect(ids(searchSettings(settingCandidates(ctx()), 'table of contents'))).toEqual(['tocOnByDefault', 'hotkey-note-toc', 'settingsFolder', 'tableOfContents', 'tocLines'])
    expect(ids(searchSettings(settingCandidates(ctx()), 'pin'))[0]).toBe('tableOfContents')
    expect(ids(searchSettings(settingCandidates(ctx()), 'default'))).toEqual(expect.arrayContaining(['tocOnByDefault', 'tableOfContents']))
  })

  it('"Level lines" (YAZ-2762, YAZ-3309 D6, YAZ-3440 D7): the label of the TOC\'s row and of the sidebar\'s row find those two rows, the sidebar\'s first (its label starts with the words); "hierarchy", "guide" and "hover" find the two Show rows among the rows that share the word', () => {
    // The sidebar's group is "Level lines" too (YAZ-3440 D7): its other two rows follow, by the group title.
    expect(ids(searchSettings(settingCandidates(ctx()), 'level lines'))).toEqual(['sidebarLines', 'tocLines', 'sidebarLineStyle', 'sidebarThreadColor'])
    expect(ids(searchSettings(settingCandidates(ctx()), 'hierarchy'))).toEqual(['sidebarLines', 'tocLines'])
    // The canvas's frame outline and draw.io's shape outline share the word too (YAZ-3037).
    expect(ids(searchSettings(settingCandidates(ctx()), 'outline'))).toEqual(['hotkey-diagram-outline', 'bulletThreading', 'tocOnByDefault', 'tableOfContents', 'tocLines', 'canvas.framesVisible', 'hotkey-diagram-colourOther', 'hotkey-drawing-colors'])
    // "guide" is the hint of Bullet threading and a keyword of the Section indent lines; "hover" is the other grey lines' word too, and the board preview's (YAZ-3044 A20).
    expect(ids(searchSettings(settingCandidates(ctx()), 'guide'))).toEqual(['sidebarLines', 'bulletThreading', 'threadWidth', 'threadColor', 'sectionLines', 'tocLines'])
    // And the hover preview's master switch and each place's own (YAZ-3403).
    expect(ids(searchSettings(settingCandidates(ctx()), 'hover'))).toEqual(['sidebarLines', 'sectionLines', 'tocLines', 'hoverPreview', 'hoverPreviewIn.sidebar', 'hoverPreviewIn.search', 'hoverPreviewIn.newTab', 'hoverPreviewIn.tabBoard', 'hoverPreviewIn.tabs', 'hoverPreviewIn.backlinks', 'hoverPreviewIn.folderViews', 'hoverPreviewIn.links', 'hotkey-code-showHover'])
    // The row says its group and its page to search, as each other row does.
    expect(settingCandidates(ctx()).find((h) => h.item.id === 'tocLines')?.name).toBe('Level lines outline toc hierarchy guide hover Table of contents The headings or the bullets of a note, at its right edge. Editor')
  })

  it('the sidebar\'s level lines (YAZ-3309 D6, D7, D9, S12): "sidebar" finds the three rows of the group first; "folder", "tree" and "indent" find Show, not the TOC row; "thread" finds Style and Thread colour beside Bullet threading; "accent" finds the two colour pickers', () => {
    // The hover preview's Sidebar row (YAZ-3403) is named "Sidebar" outright, so it leads.
    expect(ids(searchSettings(settingCandidates(ctx()), 'sidebar')).slice(0, 4)).toEqual(['hoverPreviewIn.sidebar', 'sidebarLines', 'sidebarLineStyle', 'sidebarThreadColor'])
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

  it('a query word splits on . - / _ as a row word does (YAZ-3410): "draw.io bold" finds the draw.io Bold row; the row words are split once, with the candidates', () => {
    const all = settingCandidates(ctx())
    // A diagram row goes by draw.io's name too (YAZ-3564).
    expect(ids(searchSettings(all, 'draw.io bold'))).toEqual(['hotkey-diagram-bold'])
    expect(ids(searchSettings(all, 'draw-io bold'))).toEqual(['hotkey-diagram-bold'])
    const bold = all.find((h) => h.item.id === 'hotkey-diagram-bold')
    expect(bold?.words).toEqual(expect.arrayContaining(['draw', 'io', 'bold']))
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
    // ⌥⌘W (the code tab's Match whole word) holds the text "⌘W" too; Close tab comes first.
    expect(ids(searchSettings(settingCandidates(ctx()), '⌘W'))).toEqual(['hotkey-closeTab', 'hotkey-code-findWholeWord'])
    // "underline" is also a word of Appearance › Text formatting (YAZ-3068); a note and a draw.io diagram both
    // underline with ⌘U (YAZ-3037): both rows answer, the note's first (its label is the word).
    expect(ids(searchSettings(settingCandidates(ctx()), 'underline'))).toEqual(['hotkey-note-underline', 'hotkey-drawing-textUnderline', 'hotkey-diagram-underline', 'textFormatting'])
    expect(ids(searchSettings(settingCandidates(ctx()), 'export excalidraw'))).toEqual(['hotkey-app-menuExportExcalidrawDrawing', 'hotkey-drawing-saveAs'])
    // A changed key is searched by the key it has NOW.
    const moved = { ...ctx(), settings: { ...DEFAULT_SETTINGS, hotkeys: { search: 'CmdOrCtrl+Shift+K' } } }
    // ⌘⇧K is also draw.io's Shapes and the code tab's Delete line (other places, YAZ-3564): Search the vault comes first.
    expect(ids(searchSettings(settingCandidates(moved), '⌘⇧K'))).toEqual(['hotkey-search', 'hotkey-diagram-toggleShapes', 'hotkey-code-deleteLines'])
    // ⌘K is no App key now; the places that use it (draw.io's Tags, the code tab's two-step ⌘K keys) still answer.
    expect(ids(searchSettings(settingCandidates(moved), '⌘K'))).not.toContain('hotkey-search')
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
