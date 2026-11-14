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
import { CARD_SPACING_CLEAN, CARD_SPACINGS, CARD_WIDTHS, DEFAULT_SETTINGS, PAGE_BULLET_GAP_MAX, PAGE_BULLET_GAP_MIN, PAGE_BULLET_INDENT_MAX, PAGE_BULLET_INDENT_MIN, SHOWN_HIDDEN_WORDS, type SettingsState } from '@shared/types'
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
  // YAZ-5144: Same as pages, Narrow, Medium, Full.
  cardWidth: CARD_WIDTHS,
  cardLineSpacing: [1, 1.15, 1.5, 2],
  cardBlockGap: [2, 4, 8, 12],
  // The px rows: their ends, and Reset's value.
  cardBulletIndent: [PAGE_BULLET_INDENT_MIN, CARD_SPACING_CLEAN.cardBulletIndent, PAGE_BULLET_INDENT_MAX],
  cardBulletGap: [PAGE_BULLET_GAP_MIN, CARD_SPACING_CLEAN.cardBulletGap, PAGE_BULLET_GAP_MAX],
  cardBulletSpace: [0, 2, 4, 8],
}
const CASES = Object.entries(CARD_LOOK).flatMap(([key, vals]) => (vals as unknown[]).map((value) => [key, value] as const))

describe('YAZ-5053 round 4: each Card look setting is saved and reads back', () => {
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
    expect(Object.keys(CARD_LOOK).sort()).toEqual(['cardBlockGap', 'cardBulletGap', 'cardBulletIndent', 'cardBulletSpace', 'cardLineSpacing', 'cardSpacing', 'cardWidth', 'markNextHidden', 'nextHiddenColour', 'shownHiddenWords'])
  })
})
