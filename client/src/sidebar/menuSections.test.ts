/**
 * The sidebar menu's GATING rules (🔒 D8, YAZ-1674), tested pure: `buildMenuSections` takes the
 * pinned targets and the handlers and answers with seven groups of items. Every rule that used to
 * be pinned against `ContextMenu`'s DOM lives here now — which item appears for which target,
 * what it is called, where it sits, what it hands its handler — while `ContextMenu.test.tsx`
 * keeps only the component's mechanics.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildMenuSections, type MenuAction, type MenuHandlers, type MenuParent, type MenuSection, type MenuSectionTargets } from './menuSections'

const targets = (over: Partial<MenuSectionTargets> = {}): MenuSectionTargets => ({
  x: 0,
  y: 0,
  targetDir: '/v',
  rowKind: null,
  copyPath: null,
  openPath: null,
  // The multi-select pair (🔒 D5, YAZ-1337): null is the ordinary menu — no selection to act on.
  copyPaths: null,
  openTabPaths: null,
  clipPaths: null,
  newWindowPath: null,
  renamePath: null,
  deletePath: null,
  revealPath: null,
  openVsCodePath: null,
  openDefaultPath: null,
  focusPaths: null,
  focusIsOn: false,
  favoritePaths: null,
  favoriteIsOn: false,
  reviewDir: null,
  reviewPath: null,
  reviewIsOn: false,
  shortcutDir: null,
  removeShortcut: null,
  // The window's vaults (YAZ-2602): no flyout to add one and no vault row, as on every row of a window with one vault.
  addVaults: null,
  removeVault: null,
  lens: 'files',
  leaveSearchTo: null,
  clip: null,
  ...over,
})

const handlers = (over: Partial<MenuHandlers> = {}): MenuHandlers => ({
  onOpen: vi.fn(),
  onOpenInNewTabs: vi.fn(),
  onOpenNewWindow: vi.fn(),
  onOpenVsCode: vi.fn(),
  onOpenDefault: vi.fn(),
  onReveal: vi.fn(),
  onToggleFocus: vi.fn(),
  onCut: vi.fn(),
  onCopy: vi.fn(),
  onPaste: vi.fn(),
  onNotice: vi.fn(),
  onNewNote: vi.fn(),
  onNewDatedNote: vi.fn(),
  onNewFolder: vi.fn(),
  onNewDatedFolder: vi.fn(),
  onToggleFavorite: vi.fn(),
  onReviewFolder: vi.fn(),
  onSetReview: vi.fn(),
  onAddShortcut: vi.fn(),
  onRemoveShortcut: vi.fn(),
  onRename: vi.fn(),
  onDelete: vi.fn(),
  onAddVault: vi.fn(),
  onPickVault: vi.fn(),
  onRemoveVault: vi.fn(),
  ...over,
})

const build = (t: Partial<MenuSectionTargets> = {}, h: Partial<MenuHandlers> = {}) => buildMenuSections(targets(t), handlers(h))
const labelsOf = (sections: MenuSection[]) => sections.flat().map((i) => i.label)
const itemOf = (sections: MenuSection[], label: string) => sections.flat().find((i) => i.label === label)
/** Select a LEAF by label — a parent has no `onSelect`, and reaching for one is a test bug, so it throws. */
const select = (sections: MenuSection[], label: string) => {
  const found = itemOf(sections, label)
  if (found === undefined || found.onSelect === undefined) throw new Error(`no leaf "${label}"`)
  found.onSelect()
}
/** A LEAF by label (`disabled` lives on leaves only); undefined when absent or a parent. */
const leafOf = (sections: MenuSection[], label: string): MenuAction | undefined => {
  const found = itemOf(sections, label)
  return found !== undefined && found.onSelect !== undefined ? found : undefined
}
/** The "Open in ▸" parent's sections (D7 amended), or undefined when there is no parent. */
const openInOf = (sections: MenuSection[]): readonly MenuAction[][] | undefined => (itemOf(sections, 'Open in') as MenuParent | undefined)?.children
const openInLabels = (sections: MenuSection[]) => openInOf(sections)?.map((section) => section.map((i) => i.label))
/** A leaf inside the flyout, by label. */
const subItemOf = (sections: MenuSection[], label: string) => openInOf(sections)?.flat().find((i) => i.label === label)
/** The non-empty groups' labels — what the component draws, separators between. */
const groupsOf = (sections: MenuSection[]) => sections.filter((s) => s.length > 0).map((s) => s.map((i) => i.label))

function installClipboard(fail?: Error) {
  const writeText = vi.fn(async () => {
    if (fail !== undefined) throw fail
  })
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return writeText
}

afterEach(() => {
  vi.restoreAllMocks()
})

/** A Markdown FILE row inside no selection — the fullest singular menu there is. */
const FILE_ROW: Partial<MenuSectionTargets> = {
  rowKind: 'file',
  copyPath: '/v/Note.md',
  clipPaths: ['/v/Note.md'],
  newWindowPath: '/v/Note.md',
  renamePath: '/v/Note.md',
  deletePath: '/v/Note.md',
  revealPath: '/v/Note.md',
  openVsCodePath: '/v/Note.md',
  openDefaultPath: '/v/Note.md',
  focusPaths: ['/v/Note.md'],
}

/** Blank space: every row-only target null, the root fallbacks in place (GRO-2273, GRO-2274). */
const BLANK: Partial<MenuSectionTargets> = { copyPath: '/v', revealPath: '/v', openVsCodePath: '/v', openDefaultPath: '/v' }

describe('the seven groups (🔒 D7, amended)', () => {
  it('always answers seven sections in order — Open, clipboard, create, more create, this row, Open in, Delete — empties included', () => {
    expect(build()).toHaveLength(7)
    expect(build(FILE_ROW)).toHaveLength(7)
  })

  it('a Markdown FILE row fills all seven, in the pinned order — the focus toggle is the Open group\'s one item there (YAZ-2619 R6)', () => {
    // No plural open and no folder to open, so the focus toggle stands alone above the clipboard
    // group; the OS verbs live in the "Open in ▸" flyout, a group of its own before Delete.
    expect(groupsOf(build(FILE_ROW))).toEqual([
      ['Add to focus'],
      ['Cut', 'Copy', 'Paste', 'Copy path'],
      ['New note', 'New folder'],
      ['New dated note', 'New dated folder'],
      ['Rename'],
      ['Open in'],
      ['Delete'],
    ])
  })

  it('BLANK SPACE has no row to rename or delete: the this-row and Delete groups are empty, so the menu ends on "Open in"', () => {
    expect(groupsOf(build(BLANK))).toEqual([
      ['Paste', 'Copy path'],
      ['New note', 'New folder'],
      ['New dated note', 'New dated folder'],
      ['Open in'], // the root's own OS verbs — the one this-row item blank space has
    ])
  })

  it('a 2+ selection: "Open N in new tabs" LEADS the menu and "Copy N paths" leads the text clipboard, below the Open group', () => {
    const labels = labelsOf(build({ ...FILE_ROW, copyPaths: ['/v/a.md', '/v/b.md'], openTabPaths: ['/v/a.md', '/v/b.md'], clipPaths: ['/v/a.md', '/v/b.md'] }))
    expect(labels[0]).toBe('Open 2 in new tabs')
    // 🔒 D7 loosens YAZ-1337's "the plural pair leads": the plural copy now sits in its group.
    expect(labels.indexOf('Copy 2 paths')).toBeGreaterThan(labels.indexOf('Open 2 in new tabs'))
    expect(labels.indexOf('Copy 2 paths')).toBe(labels.indexOf('Copy path') - 1)
  })

  it('"Open N in new tabs" LEADS the group and hands the exact list (🔒 D5, YAZ-1337); no target, no item', () => {
    const onOpenInNewTabs = vi.fn()
    expect(labelsOf(build({ copyPaths: ['/v/one', '/v/two'], openTabPaths: null })).some((l) => /in new tabs$/.test(l))).toBe(false)
    select(build({ openTabPaths: ['/v/a.md', '/v/b.md'] }, { onOpenInNewTabs }), 'Open 2 in new tabs')
    expect(onOpenInNewTabs).toHaveBeenCalledExactlyOnceWith(['/v/a.md', '/v/b.md'])
  })

  it('Delete is LAST wherever it appears, alone in its group, and flagged danger (GRO-2272 C1a)', () => {
    const sections = build(FILE_ROW)
    const labels = labelsOf(sections)
    expect(labels[labels.length - 1]).toBe('Delete')
    expect(sections[6]).toHaveLength(1)
    expect(itemOf(sections, 'Delete')?.danger).toBe(true)
    expect(sections.flat().filter((i) => i.danger === true).map((i) => i.label)).toEqual(['Delete'])
  })
})

/**
 * The create groups (YAZ-2249 🔒 E1/E2): the everyday pair first, then its own section for the
 * dated twins, lined up under the pair — so the extras never crowd the
 * everyday items. Both stay above the act-on-this-row group. Pinned here
 * because the position IS the ruling, not an accident of ordering.
 */
describe('create groups (YAZ-2249 🔒 E1/E2)', () => {
  it('offers New note · New folder, then its own section: New dated note · New dated folder', () => {
    expect(build()[2].map((i) => i.label)).toEqual(['New note', 'New folder'])
    expect(build()[3].map((i) => i.label)).toEqual(['New dated note', 'New dated folder'])
  })

  it('is offered on every row type — the group targets a DIRECTORY, never the clicked row', () => {
    expect(labelsOf(build(FILE_ROW))).toContain('New dated folder')
    expect(labelsOf(build(BLANK))).toContain('New dated folder')
  })

  it('New dated note hands the click to its own handler (YAZ-2242)', () => {
    const onNewDatedNote = vi.fn()
    select(build({}, { onNewDatedNote }), 'New dated note')
    expect(onNewDatedNote).toHaveBeenCalledTimes(1)
  })

  it('hands the click to the caller — the handler itself is the item (the New note idiom)', () => {
    const onNewFolder = vi.fn()
    const onNewDatedFolder = vi.fn()
    const sections = build({}, { onNewFolder, onNewDatedFolder })
    select(sections, 'New folder')
    select(sections, 'New dated folder')
    expect(onNewFolder).toHaveBeenCalledTimes(1)
    expect(onNewDatedFolder).toHaveBeenCalledTimes(1)
  })
})

/**
 * "Open in ▸" (D7 amended, YAZ-1674): the OS verbs (GRO-2168, GRO-2274,
 * YAZ-963, YAZ-1577) collapse into one parent. Every child keeps its own gate — a path or nothing,
 * the root on blank space, New window FILE rows only — and Reveal sits alone below a separator
 * (a second section). No child → no parent. The parent has no select of its own.
 */
describe('"Open in ▸" (D7 amended)', () => {
  it('a Markdown FILE row: the three open verbs, then Reveal in its own section', () => {
    expect(openInLabels(build(FILE_ROW))).toEqual([['New window', 'VS Code', 'Default app'], ['Reveal in Finder']])
  })

  it('the parent is a parent: no onSelect, and it stands ALONE in its own group between the this-row items and Delete', () => {
    const sections = build({ ...FILE_ROW, openTabPaths: ['/v/a.md', '/v/b.md'] })
    expect(itemOf(sections, 'Open in')?.onSelect).toBeUndefined()
    expect(sections[0].map((i) => i.label)).toEqual(['Open 2 in new tabs', 'Add to focus'])
    expect(sections[4].map((i) => i.label)).toEqual(['Rename'])
    expect(sections[5].map((i) => i.label)).toEqual(['Open in'])
  })

  it('no child at all → no parent', () => {
    expect(itemOf(build(), 'Open in')).toBeUndefined()
  })

  it('"New window" is FILE rows only (D2, GRO-2168): blank space gets VS Code / Default app / Reveal on the root', () => {
    const onOpenNewWindow = vi.fn()
    expect(openInLabels(build(BLANK))).toEqual([['VS Code', 'Default app'], ['Reveal in Finder']])
    expect(subItemOf(build(BLANK), 'New window')).toBeUndefined()
    subItemOf(build({ newWindowPath: '/v/a.md' }, { onOpenNewWindow }), 'New window')?.onSelect()
    expect(onOpenNewWindow).toHaveBeenCalledExactlyOnceWith('/v/a.md')
  })

  it('each of VS Code / Default app / Reveal is a path or nothing, Default app directly after VS Code, and hands the caller its OWN path', () => {
    const onOpenVsCode = vi.fn()
    const onOpenDefault = vi.fn()
    const onReveal = vi.fn()
    expect(openInLabels(build({ openVsCodePath: '/v/Zeta' }))).toEqual([['VS Code'], []])
    expect(openInLabels(build({ revealPath: '/v' }))).toEqual([[], ['Reveal in Finder']])
    const sections = build({ openVsCodePath: '/v/Zeta', openDefaultPath: '/v/book.epub', revealPath: '/v/sub' }, { onOpenVsCode, onOpenDefault, onReveal })
    const labels = openInOf(sections)?.flat().map((i) => i.label) ?? []
    expect(labels.indexOf('Default app')).toBe(labels.indexOf('VS Code') + 1)
    subItemOf(sections, 'VS Code')?.onSelect()
    subItemOf(sections, 'Default app')?.onSelect()
    subItemOf(sections, 'Reveal in Finder')?.onSelect()
    expect(onOpenVsCode).toHaveBeenCalledExactlyOnceWith('/v/Zeta')
    expect(onOpenDefault).toHaveBeenCalledExactlyOnceWith('/v/book.epub')
    expect(onReveal).toHaveBeenCalledExactlyOnceWith('/v/sub')
  })
})

describe('Open item (YAZ-2290 D3)', () => {
  it('is absent without a target — a file row, blank space, a 2+ selection', () => {
    expect(itemOf(build(FILE_ROW), 'Open')).toBeUndefined()
    expect(itemOf(build(BLANK), 'Open')).toBeUndefined()
  })

  it('a folder row: it LEADS the menu, above Focus, and hands the caller the folder', () => {
    const onOpen = vi.fn()
    const sections = build({ openPath: '/v/Projects', focusPaths: ['/v/Projects'] }, { onOpen })
    expect(sections[0].map((i) => i.label)).toEqual(['Open', 'Add to focus'])
    select(sections, 'Open')
    expect(onOpen).toHaveBeenCalledExactlyOnceWith('/v/Projects')
  })
})

/**
 * The focus toggle (YAZ-2619 D3): ONE state-aware item on every ROW — file or dir — never on blank
 * space (R7). It CLOSES the Open group (R6): after the plural open, ahead of the clipboard group.
 * The label counts a 2+ selection (R9), and the handler gets the paths and the direction it read.
 */
describe('Focus item (YAZ-2619 D3)', () => {
  it('R7: is absent on blank space — no target, no item', () => {
    expect(labelsOf(build(BLANK)).some((l) => l.endsWith('focus'))).toBe(false)
  })

  it('S5, S6, R9: reads Add or Remove by `focusIsOn`, counts a 2+ selection, and hands over the exact paths and the direction', () => {
    expect(labelsOf(build({ focusPaths: ['/v/a.md'] }))).toContain('Add to focus')
    expect(labelsOf(build({ focusPaths: ['/v/dir'], focusIsOn: true }))).toContain('Remove from focus')
    expect(labelsOf(build({ focusPaths: ['/v/a.md', '/v/b', '/v/c.md'], focusIsOn: true }))).toContain('Remove 3 from focus')
    const onToggleFocus = vi.fn()
    select(build({ focusPaths: ['/v/a.md', '/v/b'] }, { onToggleFocus }), 'Add 2 to focus')
    expect(onToggleFocus).toHaveBeenCalledExactlyOnceWith(['/v/a.md', '/v/b'], false)
    const onRemove = vi.fn()
    select(build({ focusPaths: ['/v/a.md'], focusIsOn: true }, { onToggleFocus: onRemove }), 'Remove from focus')
    expect(onRemove).toHaveBeenCalledExactlyOnceWith(['/v/a.md'], true)
  })

  it('R6: closes the Open group — after the plural open, before the clipboard group', () => {
    const sections = build({ ...FILE_ROW, focusPaths: ['/v/a.md', '/v/b.md'], openTabPaths: ['/v/a.md', '/v/b.md'] })
    expect(sections[0].map((i) => i.label)).toEqual(['Open 2 in new tabs', 'Add 2 to focus'])
    expect(sections[1][0]?.label).toBe('Cut')
  })
})

/**
 * The file clipboard (🔒 D5, YAZ-1674): Cut / Copy on any ROW — file or dir, both lenses — never on
 * blank space; the label counts a 2+ selection. Paste is offered exactly where "New folder" is
 * and is DISABLED, not hidden, while the clipboard is empty.
 */
describe('Cut / Copy / Paste (YAZ-1674)', () => {
  it('Cut and Copy are absent on blank space (nothing to clip) and present, bare, on a single row', () => {
    expect(labelsOf(build(BLANK))).not.toContain('Cut')
    expect(labelsOf(build(BLANK))).not.toContain('Copy')
    const sections = build({ clipPaths: ['/v/sub'] })
    expect(sections[1].map((i) => i.label)).toEqual(['Cut', 'Copy', 'Paste'])
  })

  it('a 2+ selection counts: "Cut 3 items" / "Copy 3 items", handing the ORDERED list as given', () => {
    const onCut = vi.fn()
    const onCopy = vi.fn()
    const sections = build({ clipPaths: ['/v/sub', '/v/a.md', '/v/b.md'] }, { onCut, onCopy })
    select(sections, 'Cut 3 items')
    select(sections, 'Copy 3 items')
    expect(onCut).toHaveBeenCalledExactlyOnceWith(['/v/sub', '/v/a.md', '/v/b.md'])
    expect(onCopy).toHaveBeenCalledExactlyOnceWith(['/v/sub', '/v/a.md', '/v/b.md'])
  })

  it('carries the shortcut hints: ⌘X, ⌘C, ⌘V — and ⌘⇧C on Copy path', () => {
    const sections = build({ clipPaths: ['/v/a.md'], copyPath: '/v/a.md' })
    expect(sections[1].map((i) => [i.label, i.hint])).toEqual([['Cut', '⌘X'], ['Copy', '⌘C'], ['Paste', '⌘V'], ['Copy path', '⌘⇧C']])
  })

  it('Paste is DISABLED with an empty clipboard — rendered for discoverability, inert on select', () => {
    const onPaste = vi.fn()
    const paste = leafOf(build({ clip: null }, { onPaste }), 'Paste')
    expect(paste?.disabled).toBe(true)
    paste?.onSelect()
    expect(onPaste).not.toHaveBeenCalled()
  })

  it.each<[number, string]>([
    [1, 'Paste 1 item'],
    [2, 'Paste 2 items'],
    [7, 'Paste 7 items'],
  ])('with %i clipped it reads "%s", enabled, and selects the paste', (count, label) => {
    const onPaste = vi.fn()
    const sections = build({ clip: { count, op: 'copy', paths: Array.from({ length: count }, (_, i) => `/v/${i}.md`) } }, { onPaste })
    expect(itemOf(sections, 'Paste')).toBeUndefined()
    const paste = leafOf(sections, label)
    expect(paste?.disabled).toBeUndefined()
    paste?.onSelect()
    expect(onPaste).toHaveBeenCalledTimes(1)
  })
})

/**
 * The text clipboard: "Copy path" (GRO-2273, the root on blank space), "Copy N paths" (🔒 D5,
 * YAZ-1337 — the whole ordered selection, newline-joined), each confirming through the one notice
 * (YAZ-1341) and REPORTING a refused clipboard. They are the only copy items (YAZ-2420 🔒 D22, D31).
 */
describe('Copy path / Copy N paths', () => {
  it('Copy path writes the exact path and confirms; absent without one', async () => {
    const writeText = installClipboard()
    const onNotice = vi.fn()
    expect(itemOf(build({ copyPath: null }), 'Copy path')).toBeUndefined()
    select(build({ copyPath: '/v' }, { onNotice }), 'Copy path')
    expect(writeText).toHaveBeenCalledExactlyOnceWith('/v')
    await Promise.resolve()
    expect(onNotice).toHaveBeenCalledExactlyOnceWith('Copied path')
  })

  it('Copy path reports a clipboard the OS refused', async () => {
    installClipboard(new Error('denied'))
    const onNotice = vi.fn()
    select(build({ copyPath: '/v/a.md' }, { onNotice }), 'Copy path')
    await Promise.resolve()
    await Promise.resolve()
    expect(onNotice).toHaveBeenCalledExactlyOnceWith("Can't copy path: denied")
  })

  it('Copy N paths joins the ordered selection with newlines and confirms with the count; absent outside a 2+ selection', async () => {
    const writeText = installClipboard()
    const onNotice = vi.fn()
    expect(labelsOf(build()).some((l) => /^Copy \d+ paths$/.test(l))).toBe(false)
    select(build({ copyPaths: ['/v/sub', '/v/a.md'] }, { onNotice }), 'Copy 2 paths')
    expect(writeText).toHaveBeenCalledExactlyOnceWith('/v/sub\n/v/a.md')
    await Promise.resolve()
    expect(onNotice).toHaveBeenCalledExactlyOnceWith('Copied 2 paths')
  })

  it('Copy N paths reports a refused clipboard too', async () => {
    installClipboard(new Error('denied'))
    const onNotice = vi.fn()
    select(build({ copyPaths: ['/v/a.md', '/v/b.md'] }, { onNotice }), 'Copy 2 paths')
    await Promise.resolve()
    await Promise.resolve()
    expect(onNotice).toHaveBeenCalledExactlyOnceWith("Can't copy paths: denied")
  })

  it('"Copy path" is the one item of a row that copies text: beside the file clipboard\'s Copy, nothing else is named Copy — no "Copy ID" (YAZ-2420 D22, D31)', () => {
    expect(labelsOf(build(FILE_ROW)).filter((label) => label.startsWith('Copy'))).toEqual(['Copy', 'Copy path'])
  })
})

/** Rename and Delete: a concrete row only, NEVER blank space (GRO-2241, GRO-2272); each hands its own path. */
describe('Rename / Delete', () => {
  it('both absent on blank space', () => {
    const labels = labelsOf(build(BLANK))
    expect(labels).not.toContain('Rename')
    expect(labels).not.toContain('Delete')
  })

  it('each hands the caller its own target', () => {
    const onRename = vi.fn()
    const onDelete = vi.fn()
    const sections = build({ renamePath: '/v/sub', deletePath: '/v/sub' }, { onRename, onDelete })
    select(sections, 'Rename')
    select(sections, 'Delete')
    expect(onRename).toHaveBeenCalledExactlyOnceWith('/v/sub')
    expect(onDelete).toHaveBeenCalledExactlyOnceWith('/v/sub')
  })
})

/**
 * The review items (YAZ-2322) act ON the right-clicked row, so they lead the this-row group, above
 * Rename: a FOLDER row starts a review of what is due inside it, and a NOTE row carries ONE
 * state-aware item that takes it out of review or puts it back (the favorite toggle's idiom).
 */
describe('review items (YAZ-2322)', () => {
  it('"Review this folder" is offered on a folder row only, and hands the folder to its handler', () => {
    const onReviewFolder = vi.fn()
    expect(labelsOf(build(FILE_ROW))).not.toContain('Review this folder')
    expect(labelsOf(build(BLANK))).not.toContain('Review this folder')
    const sections = build({ rowKind: 'dir', renamePath: '/v/sub', reviewDir: '/v/sub' }, { onReviewFolder })
    expect(sections[4].map((i) => i.label)).toEqual(['Review this folder', 'Rename'])
    select(sections, 'Review this folder')
    expect(onReviewFolder).toHaveBeenCalledExactlyOnceWith('/v/sub')
  })

  it('a note in review reads "Turn review off", one out of it "Turn review on" — above Rename', () => {
    const on = build({ ...FILE_ROW, reviewPath: '/v/Note.md', reviewIsOn: true })
    expect(on[4].map((i) => i.label)).toEqual(['Turn review off', 'Rename'])
    const off = build({ ...FILE_ROW, reviewPath: '/v/Note.md', reviewIsOn: false })
    expect(off[4].map((i) => i.label)).toEqual(['Turn review on', 'Rename'])
  })

  it('hands the select its target and the state to SET', () => {
    const onSetReview = vi.fn()
    select(build({ reviewPath: '/v/a.md', reviewIsOn: true }, { onSetReview }), 'Turn review off')
    expect(onSetReview).toHaveBeenCalledExactlyOnceWith('/v/a.md', false)
    const turnOn = vi.fn()
    select(build({ reviewPath: '/v/a.md', reviewIsOn: false }, { onSetReview: turnOn }), 'Turn review on')
    expect(turnOn).toHaveBeenCalledExactlyOnceWith('/v/a.md', true)
  })

  it('is absent with no target — a folder, blank space, a file that is not a note', () => {
    expect(labelsOf(build(FILE_ROW)).some((l) => l.startsWith('Turn review'))).toBe(false)
    expect(labelsOf(build(BLANK)).some((l) => l.startsWith('Turn review'))).toBe(false)
  })
})

/**
 * The favorite toggle (YAZ-1766 D3): ONE state-aware item on every ROW — file or dir, whichever
 * lens — never on blank space; it counts a 2+ selection and reads Add unless EVERY path is already
 * pinned. It leads the "Open in ▸" group (Yasin, demo 2026-09-21), one hairline above Delete.
 */
describe('favorite toggle item (YAZ-1766 D3)', () => {
  it('reads "Add to favorites" on a row that is not pinned, "Remove from favorites" on one that is', () => {
    expect(labelsOf(build({ favoritePaths: ['/v/a.md'], favoriteIsOn: false }))).toContain('Add to favorites')
    expect(labelsOf(build({ favoritePaths: ['/v/a.md'], favoriteIsOn: false }))).not.toContain('Remove from favorites')
    expect(labelsOf(build({ favoritePaths: ['/v/dir'], favoriteIsOn: true }))).toContain('Remove from favorites')
    expect(labelsOf(build({ favoritePaths: ['/v/dir'], favoriteIsOn: true }))).not.toContain('Add to favorites')
  })

  it('is absent on blank space (a null target)', () => {
    expect(labelsOf(build(BLANK)).some((l) => l.includes('favorites'))).toBe(false)
  })

  it('counts a 2+ selection: "Add 2 to favorites" / "Remove 3 from favorites"', () => {
    expect(labelsOf(build({ favoritePaths: ['/v/a.md', '/v/b'], favoriteIsOn: false }))).toContain('Add 2 to favorites')
    expect(labelsOf(build({ favoritePaths: ['/v/a.md', '/v/b', '/v/c.md'], favoriteIsOn: true }))).toContain('Remove 3 from favorites')
  })

  it('a MIXED selection reads Add (isOn is false unless every path is pinned) and hands every path with the direction', () => {
    const onToggleFavorite = vi.fn()
    select(build({ favoritePaths: ['/v/a.md', '/v/b'], favoriteIsOn: false }, { onToggleFavorite }), 'Add 2 to favorites')
    expect(onToggleFavorite).toHaveBeenCalledExactlyOnceWith(['/v/a.md', '/v/b'], false)
    const onRemove = vi.fn()
    select(build({ favoritePaths: ['/v/a.md'], favoriteIsOn: true }, { onToggleFavorite: onRemove }), 'Remove from favorites')
    expect(onRemove).toHaveBeenCalledExactlyOnceWith(['/v/a.md'], true)
  })

  it('leads the "Open in ▸" group — the this-row group ends on Rename, and the toggle sits directly above the flyout', () => {
    const sections = build({ ...FILE_ROW, favoritePaths: ['/v/Note.md'], favoriteIsOn: false })
    expect(sections[4].map((i) => i.label)).toEqual(['Rename'])
    expect(sections[5].map((i) => i.label)).toEqual(['Add to favorites', 'Open in'])
  })
})

/**
 * "Add note shortcut" (YAZ-2290 D2): a FOLDER row's item and nobody else's — the Sidebar hands
 * a target only for one folder row outside a plural selection. It sits under the favorite toggle.
 */
describe('Add note shortcut item (YAZ-2290 D2)', () => {
  it('is absent without a target — a file row, blank space, a 2+ selection', () => {
    expect(itemOf(build(FILE_ROW), 'Add note shortcut')).toBeUndefined()
    expect(itemOf(build(BLANK), 'Add note shortcut')).toBeUndefined()
    expect(itemOf(build({ copyPaths: ['/v/a', '/v/b'], openTabPaths: ['/v/a', '/v/b'], favoritePaths: ['/v/a', '/v/b'] }), 'Add note shortcut')).toBeUndefined()
  })

  it('a folder row: directly under the favorite toggle, above the flyout, and it hands the caller the folder', () => {
    const onAddShortcut = vi.fn()
    const sections = build({ shortcutDir: '/v/Projects', favoritePaths: ['/v/Projects'], revealPath: '/v/Projects' }, { onAddShortcut })
    expect(sections[5].map((i) => i.label)).toEqual(['Add to favorites', 'Add note shortcut', 'Open in'])
    select(sections, 'Add note shortcut')
    expect(onAddShortcut).toHaveBeenCalledExactlyOnceWith('/v/Projects')
  })
})

/**
 * A SHORTCUT row (YAZ-2290 E5): the note shown in a folder it does not live in. "Remove
 * shortcut" stands where Delete would, and the file clipboard is withheld — the row is not a file
 * in this folder. Everything that acts on the note in its real place stays.
 */
describe('a shortcut row (YAZ-2290 E5)', () => {
  /** What the Sidebar pins for one: the file row's targets, minus Delete, Rename and the clip. */
  const SHORTCUT_ROW: Partial<MenuSectionTargets> = { ...FILE_ROW, clipPaths: null, renamePath: null, deletePath: null, removeShortcut: { path: '/v/Note.md', dir: '/v/Projects' } }

  it('"Remove shortcut" stands LAST and alone where Delete would — no Delete, and nothing flagged danger', () => {
    const sections = build(SHORTCUT_ROW)
    expect(sections[6].map((i) => i.label)).toEqual(['Remove shortcut'])
    expect(labelsOf(sections)).not.toContain('Delete')
    expect(sections.flat().some((i) => i.danger === true)).toBe(false)
  })

  it('hands the caller the note and the folder it leaves', () => {
    const onRemoveShortcut = vi.fn()
    select(build(SHORTCUT_ROW, { onRemoveShortcut }), 'Remove shortcut')
    expect(onRemoveShortcut).toHaveBeenCalledExactlyOnceWith('/v/Note.md', '/v/Projects')
  })

  it('withholds Cut, Copy and Paste — even with something clipped — and keeps the real-place items, the focus toggle among them (YAZ-2619 R8)', () => {
    expect(groupsOf(build({ ...SHORTCUT_ROW, clip: { count: 2, op: 'copy', paths: ['/v/a.md', '/v/b.md'] } }))).toEqual([
      ['Add to focus'],
      ['Copy path'],
      ['New note', 'New folder'],
      ['New dated note', 'New dated folder'],
      ['Open in'],
      ['Remove shortcut'],
    ])
  })

  it('is absent on every other row', () => {
    expect(itemOf(build(FILE_ROW), 'Remove shortcut')).toBeUndefined()
    expect(itemOf(build(BLANK), 'Remove shortcut')).toBeUndefined()
  })
})

/**
 * The window's vaults in the menu (YAZ-2602 D2, D3, D7). Blank space offers "Add vault to this
 * window ▸" — the last item of its menu, under the root's "Open in ▸" — and with two or more vaults
 * nothing else: the root items are the vault row's then. A vault row is a folder that is a vault:
 * it creates, pastes and focuses like a folder, and leaves the window instead of being deleted.
 */
describe('the vault items (YAZ-2602)', () => {
  const KNOWN = [{ path: '/w/Work', name: 'Work' }, { path: '/x/Archive', name: 'Old notes' }]
  const flyoutOf = (sections: MenuSection[], label: string) => (itemOf(sections, label) as MenuParent | undefined)?.children
  /** A vault row: no target for Open, Cut, Copy, Rename, Delete, the favorite, the shortcut or a review — and none for "Default app". */
  // A vault row names no focus paths (A2): the Sidebar hands null, and the toggle is not built.
  const VAULT_ROW: Partial<MenuSectionTargets> = { targetDir: '/w', rowKind: 'dir', copyPath: '/w', revealPath: '/w', openVsCodePath: '/w', focusPaths: null, removeVault: '/w' }

  it('blank space with one vault: today\'s menu, and "Add vault to this window" closes it, in the root\'s last group (S1)', () => {
    const sections = build({ ...BLANK, addVaults: KNOWN })
    expect(sections).toHaveLength(7)
    expect(groupsOf(sections)).toEqual([
      ['Paste', 'Copy path'],
      ['New note', 'New folder'],
      ['New dated note', 'New dated folder'],
      ['Open in', 'Add vault to this window'],
    ])
  })

  it('its flyout lists the known vaults in the order given, then "Open folder…" under a separator; each adds its vault, the last one runs the picker (S1 to S3)', () => {
    const h = handlers()
    const flyout = flyoutOf(buildMenuSections(targets({ ...BLANK, addVaults: KNOWN }), h), 'Add vault to this window')
    expect(flyout?.map((section) => section.map((i) => i.label))).toEqual([['Work', 'Old notes'], ['Open folder…']])
    flyout?.[0][1].onSelect()
    expect(h.onAddVault).toHaveBeenCalledExactlyOnceWith('/x/Archive')
    flyout?.[1][0].onSelect()
    expect(h.onPickVault).toHaveBeenCalledTimes(1)
  })

  it('with no known vault to add the flyout still offers "Open folder…"', () => {
    expect(flyoutOf(build({ ...BLANK, addVaults: [] }), 'Add vault to this window')?.map((section) => section.map((i) => i.label))).toEqual([[], ['Open folder…']])
  })

  it('blank space with two or more vaults has nowhere to create or paste: the add item is the whole menu (S10)', () => {
    expect(groupsOf(build({ targetDir: null, addVaults: KNOWN }))).toEqual([['Add vault to this window']])
  })

  it('a row never offers it, and a row that is no vault row never offers "Remove from this window" (S51)', () => {
    for (const row of [FILE_ROW, BLANK]) {
      expect(itemOf(build(row), 'Add vault to this window')).toBeUndefined()
      expect(itemOf(build(row), 'Remove from this window')).toBeUndefined()
    }
  })

  it('a vault row: Paste, Copy path · the create pair · the dated pair · Open in · Remove from this window — and no focus item (S13, A2)', () => {
    const sections = build(VAULT_ROW)
    expect(groupsOf(sections)).toEqual([
      ['Paste', 'Copy path'],
      ['New note', 'New folder'],
      ['New dated note', 'New dated folder'],
      ['Open in'],
      ['Remove from this window'],
    ])
    expect(openInLabels(sections)).toEqual([['VS Code'], ['Reveal in Finder']])
  })

  it('"Remove from this window" hands the vault to its handler and is not a danger item: nothing is deleted (D7)', () => {
    const h = handlers()
    const sections = buildMenuSections(targets(VAULT_ROW), h)
    expect(leafOf(sections, 'Remove from this window')?.danger).toBeUndefined()
    select(sections, 'Remove from this window')
    expect(h.onRemoveVault).toHaveBeenCalledExactlyOnceWith('/w')
  })
})
