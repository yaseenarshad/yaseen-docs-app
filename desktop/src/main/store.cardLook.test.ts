/**
 * YAZ-5053 round 4 (Yaseen: "clicking these options on or off doesnt stick… it doesnt select"): every choice that
 * Settings › Review › Card look offers goes through the main process's door (`isSettings`), is saved, and reads back
 * from the file after a restart. The values are the rows' own choices (`client/src/settings/options.ts`; the desktop
 * build cannot import the client), and `SettingsDialog.test.tsx` clicks each one and sees it selected.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CARD_SPACING_CLEAN, CARD_SPACINGS, CARD_WIDTH_CLEAN, CARD_WIDTH_MAX, CARD_WIDTH_MIN, CARD_WIDTH_START, CARD_TEXT_SIZE_MAX, CARD_TEXT_SIZE_MIN, CARD_TEXT_SIZE_START, CARD_TITLE_SIZE_MAX, CARD_TITLE_SIZE_MIN, cardTitleSizeStart, DEFAULT_SETTINGS, PAGE_BULLET_GAP_MAX, PAGE_BULLET_GAP_MIN, PAGE_BULLET_INDENT_MAX, PAGE_BULLET_INDENT_MIN, SHOWN_HIDDEN_WORDS, INBOX_OPEN_AT, type SettingsState } from '@shared/types'
import { createStore, isSettings, sanitizeSettings } from './store'

let dir: string
let file: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'yd-card-look-'))
  file = path.join(dir, 'yaseendocs.json')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Each Card look row and every value it can set, as the row offers them. */
const CARD_LOOK: { [K in keyof SettingsState]?: readonly SettingsState[K][] } = {
  shownHiddenWords: SHOWN_HIDDEN_WORDS,
  markNextHidden: [true, false],
  // The picker sends a hex colour; Reset sends null.
  nextHiddenColour: ['#2a8bd1', '#aa3399', null],
  cardSpacing: CARD_SPACINGS,
  // YAZ-5136 round 3: Card tables.
  cardTablePosition: ['pages', 'left', 'center'],
  // YAZ-5144 round 2: Same as pages (null), or Custom px: its ends, its start (Reset) and Clean's.
  cardWidth: [null, CARD_WIDTH_MIN, CARD_WIDTH_CLEAN, CARD_WIDTH_START, CARD_WIDTH_MAX],
  // YAZ-5387: Card text size and Card title size, Default (null) or Custom px: their ends and their start (Reset).
  cardTextSize: [null, CARD_TEXT_SIZE_MIN, CARD_TEXT_SIZE_START, CARD_TEXT_SIZE_MAX],
  cardTitleSize: [null, CARD_TITLE_SIZE_MIN, cardTitleSizeStart(null), CARD_TITLE_SIZE_MAX],
  cardLineSpacing: [1, 1.15, 1.5, 2],
  cardBlockGap: [2, 4, 8, 12],
  // The px rows: their ends, and Reset's value.
  cardBulletIndent: [PAGE_BULLET_INDENT_MIN, CARD_SPACING_CLEAN.cardBulletIndent, PAGE_BULLET_INDENT_MAX],
  cardBulletGap: [PAGE_BULLET_GAP_MIN, CARD_SPACING_CLEAN.cardBulletGap, PAGE_BULLET_GAP_MAX],
  cardBulletSpace: [0, 2, 4, 8],
  // YAZ-5904: Card sides in pages and in Explore, Show all (false) · Fold Side 2 and after (true).
  cardSidesFold: [false, true],
  cardSidesFoldCardPages: [false, true],
  cardSidesFoldExplore: [false, true],
}
const CASES = Object.entries(CARD_LOOK).flatMap(([key, vals]) => (vals as unknown[]).map((value) => [key, value] as const))

describe('YAZ-5136 round 2: Settings › Tables › Table position', () => {
  it('is Left by default; Left and Centre pass the door and read back; anything else does not', async () => {
    expect(DEFAULT_SETTINGS.tablePosition).toBe('left')
    for (const tablePosition of ['left', 'center'] as const) {
      const store = createStore(file)
      store.setSettings({ ...DEFAULT_SETTINGS, tablePosition })
      await store.flush()
      expect(createStore(file).get().settings.tablePosition).toBe(tablePosition)
    }
    for (const tablePosition of ['right', 'centre', null]) expect(isSettings({ ...DEFAULT_SETTINGS, tablePosition })).toBe(false)
  })
})

describe('YAZ-5053 round 4: each Card look setting is saved and reads back', () => {
  it('YAZ-5144 round 2: a Card width out of range, not whole, or one of round 1\'s steps does not pass the door', () => {
    for (const cardWidth of [CARD_WIDTH_MIN - 1, CARD_WIDTH_MAX + 1, 640.5, 'narrow', 'pages', '640'])
      expect(isSettings({ ...DEFAULT_SETTINGS, cardWidth }), String(cardWidth)).toBe(false)
  })

  it('YAZ-5387: a Card text size out of range or not whole, does not pass the door; an old file reads the defaults', () => {
    for (const cardTextSize of [CARD_TEXT_SIZE_MIN - 1, CARD_TEXT_SIZE_MAX + 1, 16.5, '16', '16px', 'pages'])
      expect(isSettings({ ...DEFAULT_SETTINGS, cardTextSize }), String(cardTextSize)).toBe(false)
    for (const cardTitleSize of [CARD_TITLE_SIZE_MIN - 1, CARD_TITLE_SIZE_MAX + 1, 18.5, '18', 'medium', 'large'])
      expect(isSettings({ ...DEFAULT_SETTINGS, cardTitleSize }), String(cardTitleSize)).toBe(false)
    expect([DEFAULT_SETTINGS.cardTextSize, DEFAULT_SETTINGS.cardTitleSize]).toEqual([null, null])
  })

  it('YAZ-5387 round 2: a file saved with round 1\'s Small · Medium · Large reads Default; Custom starts at Default\'s px', () => {
    for (const cardTitleSize of ['small', 'medium', 'large']) expect(sanitizeSettings({ ...DEFAULT_SETTINGS, cardTitleSize, cardTextSize: 20 }), cardTitleSize).toMatchObject({ cardTitleSize: null, cardTextSize: 20 })
    expect([cardTitleSizeStart(null), cardTitleSizeStart(20), cardTitleSizeStart(32)]).toEqual([18, 23, 36])
  })

  it.each(CASES)('%s = %j passes the door, is saved, and reads back after a restart', async (key, value) => {
    const next = { ...DEFAULT_SETTINGS, [key]: value } as SettingsState
    expect(isSettings(next)).toBe(true)
    const store = createStore(file)
    store.setSettings(next)
    expect(store.get().settings[key as keyof SettingsState]).toEqual(value)
    await store.flush()
    expect(createStore(file).get().settings[key as keyof SettingsState]).toEqual(value)
  })

  it('YAZ-5904: Card sides in pages, on card pages and in Explore are Show all by default; a value that is not a boolean does not pass the door', () => {
    expect([DEFAULT_SETTINGS.cardSidesFold, DEFAULT_SETTINGS.cardSidesFoldCardPages, DEFAULT_SETTINGS.cardSidesFoldExplore]).toEqual([false, false, false])
    for (const v of ['fold', 1, null]) {
      expect(isSettings({ ...DEFAULT_SETTINGS, cardSidesFold: v }), String(v)).toBe(false)
      expect(isSettings({ ...DEFAULT_SETTINGS, cardSidesFoldCardPages: v }), String(v)).toBe(false)
      expect(isSettings({ ...DEFAULT_SETTINGS, cardSidesFoldExplore: v }), String(v)).toBe(false)
    }
  })

  it('every Card look row is in the list above', () => {
    expect(Object.keys(CARD_LOOK).sort()).toEqual(['cardBlockGap', 'cardBulletGap', 'cardBulletIndent', 'cardBulletSpace', 'cardLineSpacing', 'cardSidesFold', 'cardSidesFoldCardPages', 'cardSidesFoldExplore', 'cardSpacing', 'cardTablePosition', 'cardTextSize', 'cardTitleSize', 'cardWidth', 'markNextHidden', 'nextHiddenColour', 'shownHiddenWords'])
  })
})

describe('YAZ-5307: Settings › Cards › Inbox: O opens the page at', () => {
  it('is The top by default; The top and The card pass the door, are saved, and read back after a restart; anything else does not', async () => {
    expect(DEFAULT_SETTINGS.inboxOpenAt).toBe('top')
    expect(INBOX_OPEN_AT).toEqual(['top', 'card'])
    for (const inboxOpenAt of INBOX_OPEN_AT) {
      const next = { ...DEFAULT_SETTINGS, inboxOpenAt }
      expect(isSettings(next)).toBe(true)
      const store = createStore(file)
      store.setSettings(next)
      await store.flush()
      expect(createStore(file).get().settings.inboxOpenAt).toBe(inboxOpenAt)
    }
    for (const inboxOpenAt of ['Card', 'page', '', null, true]) expect(isSettings({ ...DEFAULT_SETTINGS, inboxOpenAt }), String(inboxOpenAt)).toBe(false)
  })
})
