/**
 * The card look (YAZ-5484, which replaces YAZ-5005's one look for the whole app): the vault's card-look.json
 * (`shared/cardLook.ts`) and its CSS variables (`cardLook.ts`). Made-up values.
 */
import { describe, expect, it } from 'vitest'
import { CARD_LOOK_CLEAN, CARD_LOOK_DEFAULTS, appCardLook, cardLookFile, cardLookOf, cardLookSettings, sanitizeCardLook } from '@shared/cardLook'
import { CARD_SPACING_CLEAN, DEFAULT_SETTINGS } from '@shared/types'
import { cardLookVars, vaultCardVars } from './cardLook'

describe('card-look.json (shared/cardLook.ts)', () => {
  it('the defaults are the app\'s (DEFAULT_SETTINGS, CARD_SPACING_CLEAN), written out for the phone\'s first load', () => {
    const { shownHiddenWords, markNextHidden, nextHiddenColour, cardWidth, cardTextSize, cardTitleSize, cardTablePosition, cardSpacing, cardLineSpacing, cardBlockGap, cardBulletIndent, cardBulletGap, cardBulletSpace } = DEFAULT_SETTINGS
    expect(CARD_LOOK_DEFAULTS).toEqual({ shownHiddenWords, markNextHidden, nextHiddenColour, cardWidth, cardTextSize, cardTitleSize, cardTablePosition, cardSpacing, cardLineSpacing, cardBlockGap, cardBulletIndent, cardBulletGap, cardBulletSpace })
    expect(CARD_LOOK_CLEAN).toEqual(CARD_SPACING_CLEAN)
  })

  it('the sanitiser keeps each field that reads and drops each one that does not, alone', () => {
    expect(sanitizeCardLook({ version: 1, hiddenWords: 'box', markNext: false, nextColour: '#aa3399', width: 520, textSize: 18, titleSize: 24, tables: 'center', spacing: 'custom', custom: { line: 1.15, gap: 4, indent: 40, bulletGap: 12, bulletSpace: 2 } })).toEqual({
      hiddenWords: 'box',
      markNext: false,
      nextColour: '#aa3399',
      width: 520,
      textSize: 18,
      titleSize: 24,
      tables: 'center',
      spacing: 'custom',
      custom: { line: 1.15, gap: 4, indent: 40, bulletGap: 12, bulletSpace: 2 },
    })
    expect(sanitizeCardLook({ hiddenWords: 'bold', markNext: 'yes', nextColour: 'red', width: 100, textSize: 18.5, titleSize: 41, tables: 'right', spacing: 'tight', custom: { line: 9, gap: 4 } })).toEqual({ custom: { gap: 4 } })
    expect(sanitizeCardLook('nope')).toEqual({})
    expect(sanitizeCardLook({ custom: { line: 0 } })).toEqual({})
  })

  it('the file holds only what differs from the defaults; read back, it gives the same 13 settings', () => {
    const app = { ...DEFAULT_SETTINGS, shownHiddenWords: 'underline' as const, cardTitleSize: 30, cardSpacing: 'custom' as const, cardLineSpacing: 2 }
    const look = cardLookOf(app)
    expect(look).toEqual({ hiddenWords: 'underline', titleSize: 30, spacing: 'custom', custom: { line: 2 } })
    expect(cardLookFile(look)).toEqual({ version: 1, ...look })
    expect(cardLookSettings(look)).toEqual(appCardLook(app))
    expect(cardLookOf(DEFAULT_SETTINGS)).toEqual({})
    expect(cardLookSettings({})).toEqual(CARD_LOOK_DEFAULTS)
    // A value an older main process did not send, or a wrong one, is the default.
    expect(appCardLook({ ...DEFAULT_SETTINGS, cardWidth: 'wide' as unknown as number })).toEqual(CARD_LOOK_DEFAULTS)
  })
})

describe('the card look as CSS variables (cardLook.ts)', () => {
  it('`.app` (the app\'s look): the old attributes are variables; Same as pages and Default set no card variable', () => {
    expect(cardLookVars(DEFAULT_SETTINGS)).toEqual({ '--card-text-width': '640px', '--shown-hidden-words': 'highlight', '--mark-next-hidden': 'on', '--card-clean': 'off' })
    // The old helpers' values, one by one (YAZ-5050 Custom, YAZ-5387 sizes, YAZ-5136 tables).
    expect(cardLookVars({ ...DEFAULT_SETTINGS, cardSpacing: 'custom', cardLineSpacing: 2, cardBlockGap: 4, cardBulletIndent: 40, cardBulletGap: 12, cardBulletSpace: 2, cardTablePosition: 'left' })).toMatchObject({
      '--card-line-height': '2',
      '--card-block-gap': '4px',
      '--card-bullet-indent': '40px',
      '--card-bullet-gap': '12px',
      '--card-bullet-space': '2px',
      '--card-table-inline': '0',
    })
  })

  it('every setting has its variable: hidden words, the next mark and its colour, Clean\'s look, sizes, width, tables', () => {
    const vars = cardLookVars({ ...DEFAULT_SETTINGS, shownHiddenWords: 'box', nextHiddenColour: '#aa3399', cardSpacing: 'clean', cardWidth: 520, cardTextSize: 18, cardTitleSize: 24, cardTablePosition: 'center' })
    expect(vars).toEqual({
      '--card-line-height': '1.5',
      '--card-block-gap': '8px',
      '--card-bullet-indent': '34px',
      '--card-bullet-gap': '10px',
      '--card-bullet-space': '0px',
      '--card-text-size': '18px',
      '--card-title-size': '24px',
      '--card-text-width': '520px',
      '--card-table-inline': 'auto',
      '--card-next-hidden': '#aa3399',
      '--shown-hidden-words': 'box',
      '--mark-next-hidden': 'on',
      '--card-clean': 'on',
      '--inbox-card-pad': '44px',
    })
    // Off: no word marked, and its colour not set.
    expect(cardLookVars({ ...DEFAULT_SETTINGS, markNextHidden: false, nextHiddenColour: '#aa3399' })).toMatchObject({ '--mark-next-hidden': 'off' })
    expect(cardLookVars({ ...DEFAULT_SETTINGS, markNextHidden: false, nextHiddenColour: '#aa3399' })).not.toHaveProperty('--card-next-hidden')
  })

  it('YAZ-5133 and YAZ-5387: a field a main process older than it did not send, round 1\'s title steps, or a wrong value: the default, never "undefinedpx"', () => {
    const { cardBulletSpace: _gone, cardTextSize: _s, cardTitleSize: _t, ...old } = { ...DEFAULT_SETTINGS, cardSpacing: 'custom' as const, cardLineSpacing: 1.15, cardBlockGap: 4 }
    const vars = cardLookVars(old as typeof DEFAULT_SETTINGS)
    expect(vars).toMatchObject({ '--card-line-height': '1.15', '--card-block-gap': '4px', '--card-bullet-indent': '34px', '--card-bullet-gap': '10px', '--card-bullet-space': '0px' })
    for (const v of Object.values(vars)) expect(String(v)).not.toMatch(/undefined|NaN|null/)
    const bare = { ...DEFAULT_SETTINGS, cardSpacing: 'custom' as const, cardLineSpacing: undefined, cardBlockGap: 'x', cardBulletIndent: null, cardBulletGap: Number.NaN, cardTextSize: 99, cardTitleSize: 'large' } as unknown as typeof DEFAULT_SETTINGS
    expect(cardLookVars(bare)).toMatchObject({ '--card-line-height': '1.5', '--card-block-gap': '8px', '--card-bullet-indent': '34px', '--card-bullet-gap': '10px', '--card-bullet-space': '0px' })
    expect(cardLookVars(bare)).not.toHaveProperty('--card-text-size')
    expect(cardLookVars(bare)).not.toHaveProperty('--card-title-size')
    // Clean is Clean's values, whatever Custom holds.
    expect(cardLookVars({ ...DEFAULT_SETTINGS, cardSpacing: 'clean', cardLineSpacing: 2, cardBulletSpace: 8 })).toMatchObject({ '--card-line-height': '1.5', '--card-bullet-space': '0px' })
  })

  it('settings from a main process older than these fields: On, Highlight, no Clean', () => {
    const { markNextHidden: _a, shownHiddenWords: _b, cardSpacing: _c, ...old } = DEFAULT_SETTINGS
    expect(cardLookVars(old as typeof DEFAULT_SETTINGS)).toMatchObject({ '--shown-hidden-words': 'highlight', '--mark-next-hidden': 'on', '--card-clean': 'off' })
  })

  it('a vault\'s surface: WHOLE variables, `initial` where its look sets none, so `.app`\'s look never leaks in (YAZ-5164: no Card text size reads the page\'s)', () => {
    const vars = cardLookVars(DEFAULT_SETTINGS, true)
    for (const name of ['--card-line-height', '--card-block-gap', '--card-bullet-indent', '--card-bullet-gap', '--card-bullet-space', '--card-text-size', '--card-title-size', '--card-table-inline', '--card-next-hidden', '--inbox-card-pad']) expect(vars[name], name).toBe('initial')
    expect(vars).toMatchObject({ '--shown-hidden-words': 'highlight', '--mark-next-hidden': 'on', '--card-clean': 'off' })
  })

  it('vaultCardVars keeps one object for the same look and settings', () => {
    const look = { hiddenWords: 'box' as const }
    const a = vaultCardVars(look, DEFAULT_SETTINGS, () => ({ ...DEFAULT_SETTINGS, ...cardLookSettings(look) }))
    expect(vaultCardVars(look, DEFAULT_SETTINGS, () => DEFAULT_SETTINGS)).toBe(a)
    expect(a).toMatchObject({ '--shown-hidden-words': 'box' })
    expect(vaultCardVars(look, { ...DEFAULT_SETTINGS }, () => DEFAULT_SETTINGS)).not.toBe(a)
  })
})
