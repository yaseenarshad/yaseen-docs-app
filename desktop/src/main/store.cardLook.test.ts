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
import { CARD_SPACING_CLEAN, CARD_SPACINGS, CARD_WIDTH_CLEAN, CARD_WIDTH_MAX, CARD_WIDTH_MIN, CARD_WIDTH_START, DEFAULT_SETTINGS, PAGE_BULLET_GAP_MAX, PAGE_BULLET_GAP_MIN, PAGE_BULLET_INDENT_MAX, PAGE_BULLET_INDENT_MIN, SHOWN_HIDDEN_WORDS, INBOX_OPEN_AT, type SettingsState } from '@shared/types'
import { createStore, isSettings } from './store'

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
  cardLineSpacing: [1, 1.15, 1.5, 2],
  cardBlockGap: [2, 4, 8, 12],
  // The px rows: their ends, and Reset's value.
  cardBulletIndent: [PAGE_BULLET_INDENT_MIN, CARD_SPACING_CLEAN.cardBulletIndent, PAGE_BULLET_INDENT_MAX],
  cardBulletGap: [PAGE_BULLET_GAP_MIN, CARD_SPACING_CLEAN.cardBulletGap, PAGE_BULLET_GAP_MAX],
  cardBulletSpace: [0, 2, 4, 8],
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

  it.each(CASES)('%s = %j passes the door, is saved, and reads back after a restart', async (key, value) => {
    const next = { ...DEFAULT_SETTINGS, [key]: value } as SettingsState
    expect(isSettings(next)).toBe(true)
    const store = createStore(file)
    store.setSettings(next)
    expect(store.get().settings[key as keyof SettingsState]).toEqual(value)
    await store.flush()
    expect(createStore(file).get().settings[key as keyof SettingsState]).toEqual(value)
  })

  it('every Card look row is in the list above', () => {
    expect(Object.keys(CARD_LOOK).sort()).toEqual(['cardBlockGap', 'cardBulletGap', 'cardBulletIndent', 'cardBulletSpace', 'cardLineSpacing', 'cardSpacing', 'cardTablePosition', 'cardWidth', 'markNextHidden', 'nextHiddenColour', 'shownHiddenWords'])
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
