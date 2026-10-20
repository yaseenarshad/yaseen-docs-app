/**
 * Settings search (YAZ-1679 D6): the candidates are built from the registry — label, hint,
 * keywords, group title, group hint, section title — and the match is the `[[` picker's exact →
 * prefix → substring rule.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { SettingsCtx } from './registry'
import { searchSettings, settingCandidates, type SettingHit } from './searchSettings'

const ctx = (sync?: SettingsCtx['sync'], review?: SettingsCtx['review']): SettingsCtx => ({ settings: { ...DEFAULT_SETTINGS }, onChange: () => undefined, sync, review })
const REVIEW: SettingsCtx['review'] = { settings: DEFAULT_REVIEW_SETTINGS, save: () => undefined }
const REVIEW_ROWS = ['enabled', 'baseDays', 'growth', 'maxDays', 'reviewByDefault']
const ids = (hits: readonly SettingHit[]) => hits.map((h) => h.item.id)

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
      'theme',
      'contentWidth',
      'lineSpacing',
      'blockGap',
      'textFormatting',
      'commentsOrder',
      'bulletThreading',
      'threadWidth',
      'threadColor',
      'sectionStep',
      'sectionLines',
      'tableOfContents',
      'tocLines',
      'confirmDelete',
      'confirmRename',
      'newNoteLocation',
      'startupWindows',
      'ids',
      'duplicates',
      'idLetters',
      'oldIds',
      'hotkeys-keyboard',
      'hotkeys-views',
      'hotkeys-window',
      'hotkeys-mouse',
    ])
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
    expect(ids(searchSettings(settingCandidates(ctx()), 'dark'))).toEqual(['theme'])
    expect(ids(searchSettings(settingCandidates(ctx()), 'readable line'))).toEqual(['contentWidth'])
    expect(ids(searchSettings(settingCandidates(ctx()), 'trash'))).toEqual(['confirmDelete'])
  })

  it('matches on the section title, returning every row of that section', () => {
    expect(ids(searchSettings(settingCandidates(ctx()), 'files & links'))).toEqual(['confirmDelete', 'confirmRename', 'newNoteLocation', 'startupWindows', 'ids', 'duplicates', 'idLetters', 'oldIds'])
  })

  it('"startup" and "launch" find the row that says which windows come back (YAZ-2589 D2)', () => {
    for (const query of ['startup', 'launch', 'when the app starts']) expect(ids(searchSettings(settingCandidates(ctx()), query))).toEqual(['startupWindows'])
  })

  it('"toc" finds the two rows of the table of contents and "jump" the first alone; "outline" and "headings" find it among others; the group\'s name finds both rows and the ⌘J line of the Hotkeys table (YAZ-2700, YAZ-2762)', () => {
    expect(ids(searchSettings(settingCandidates(ctx()), 'toc'))).toEqual(['tableOfContents', 'tocLines'])
    expect(ids(searchSettings(settingCandidates(ctx()), 'jump'))).toEqual(['tableOfContents'])
    // The words the app already uses for the bullet features and the fold keys: the row is one of the answers.
    for (const query of ['outline', 'headings']) expect(ids(searchSettings(settingCandidates(ctx()), query))).toContain('tableOfContents')
    expect(ids(searchSettings(settingCandidates(ctx()), 'table of contents'))).toEqual(['tableOfContents', 'tocLines', 'hotkeys-keyboard'])
  })

  it('"Level lines" (YAZ-2762): its label and "hierarchy" find that row alone; "outline", "guide" and "hover" find it among the rows that share the word', () => {
    for (const query of ['level lines', 'hierarchy']) expect(ids(searchSettings(settingCandidates(ctx()), query))).toEqual(['tocLines'])
    expect(ids(searchSettings(settingCandidates(ctx()), 'outline'))).toEqual(['bulletThreading', 'tableOfContents', 'tocLines'])
    // "guide" is the hint of Bullet threading and a keyword of the Section indent lines; "hover" is the other grey lines' word too.
    expect(ids(searchSettings(settingCandidates(ctx()), 'guide'))).toEqual(['bulletThreading', 'threadWidth', 'threadColor', 'sectionLines', 'tocLines'])
    expect(ids(searchSettings(settingCandidates(ctx()), 'hover'))).toEqual(['sectionLines', 'tocLines'])
    // The row says its group and its page to search, as each other row does.
    expect(settingCandidates(ctx()).find((h) => h.item.id === 'tocLines')?.name).toBe('Level lines outline toc hierarchy guide hover Table of contents The headings or the bullets of a note, at its right edge. Editor')
  })

  it('matches on the group title: "section indent" finds the two rows of that group, "spacing" the two of Spacing', () => {
    expect(ids(searchSettings(settingCandidates(ctx()), 'section indent'))).toEqual(['sectionStep', 'sectionLines'])
    expect(ids(searchSettings(settingCandidates(ctx()), 'spacing'))).toEqual(['lineSpacing', 'blockGap'])
  })

  it('matches on the group hint too: "guide lines" finds the three threading rows; "threading" finds them and the two Section indent rows, whose hint names Bullet threading', () => {
    expect(ids(searchSettings(settingCandidates(ctx()), 'guide lines'))).toEqual(['bulletThreading', 'threadWidth', 'threadColor'])
    expect(ids(searchSettings(settingCandidates(ctx()), 'threading'))).toEqual(['bulletThreading', 'threadWidth', 'threadColor', 'sectionStep', 'sectionLines'])
  })

  it('the pre-redesign labels still match as keywords: "thread width", "comments order"', () => {
    expect(ids(searchSettings(settingCandidates(ctx()), 'thread width'))).toEqual(['threadWidth'])
    expect(ids(searchSettings(settingCandidates(ctx()), 'comments order'))).toEqual(['commentsOrder'])
  })

  it('a hotkey label finds its Hotkeys table: "close tab" → Window', () => {
    expect(ids(searchSettings(settingCandidates(ctx()), 'close tab'))).toEqual(['hotkeys-window'])
    expect(ids(searchSettings(settingCandidates(ctx()), '⌘W'))).toEqual(['hotkeys-window'])
    // "underline" is also a word of Appearance › Text formatting (YAZ-3068), which comes first in registry order.
    expect(ids(searchSettings(settingCandidates(ctx()), 'underline'))).toEqual(['textFormatting', 'hotkeys-keyboard'])
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
