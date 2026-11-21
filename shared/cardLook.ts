import { isRecord } from './guards'
import type { CardSpacing, CardTablePosition, SettingsState, ShownHiddenWords } from './types'

/**
 * A vault's card look (YAZ-5484, scoping B1). YAZ-5484 REPLACES YAZ-5005 ("one setting for the whole app (all vaults),
 * because it is how the app looks"): the 13 Card look settings belong to the vault, so a vault of language cards and a
 * vault of med cards can look different, and the phone draws its cards with them. It lives in
 * `<vault>/.yaseendocs/card-look.json` and goes through the generic `vaultConfig` door, as `text-formatting.json`. Pure:
 * no React, no fs; the phone imports it too.
 *
 * The file holds only what differs from the defaults, beside a version:
 * `{ "version": 1, "hiddenWords": "box", "textSize": 18, "spacing": "custom", "custom": { "line": 1.6 } }`.
 * A key left out is the default. A vault with NO file reads the app's values (the Mac's settings, the fallback, also
 * for a window with no vault); the one-time move (`CARD_LOOK_MOVE`) writes them into each vault once. The phone, which
 * has no app values, reads the defaults then.
 */

export const CARD_LOOK_FILE = 'card-look.json'
export const CARD_LOOK_VERSION = 1
/** The keys this build's writer owns: every other key of the file (a later version's) is kept on a save. */
export const CARD_LOOK_KEYS: readonly string[] = ['version', 'hiddenWords', 'markNext', 'nextColour', 'width', 'textSize', 'titleSize', 'tables', 'spacing', 'custom', 'sidesFold', 'sidesFoldCardPages', 'sidesFoldExplore']

/** Card spacing's own values (Custom), in the file's names. */
export interface CardLookCustom {
  line?: number
  gap?: number
  indent?: number
  bulletGap?: number
  bulletSpace?: number
}

/** Only what differs from the defaults (`cardLookOf`). */
export interface CardLook {
  hiddenWords?: ShownHiddenWords
  markNext?: boolean
  nextColour?: string
  width?: number
  textSize?: number
  titleSize?: number
  tables?: CardTablePosition
  spacing?: CardSpacing
  custom?: CardLookCustom
  /** Card sides in pages (YAZ-5904): `true` folds Side 2 and after. */
  sidesFold?: boolean
  /** Card sides on card pages (YAZ-5904 Q1): `true` folds Side 2 and after on a card page. */
  sidesFoldCardPages?: boolean
  /** Card sides in Explore (YAZ-5904 D3): `true` folds Side 2 and after there. */
  sidesFoldExplore?: boolean
}

/** The 13 settings, by their app names (`SettingsState`). */
export type CardLookSettings = Pick<
  SettingsState,
  'shownHiddenWords' | 'markNextHidden' | 'nextHiddenColour' | 'cardWidth' | 'cardTextSize' | 'cardTitleSize' | 'cardTablePosition' | 'cardSpacing' | 'cardLineSpacing' | 'cardBlockGap' | 'cardBulletIndent' | 'cardBulletGap' | 'cardBulletSpace' | 'cardSidesFold' | 'cardSidesFoldCardPages' | 'cardSidesFoldExplore'
>

/**
 * The defaults: `DEFAULT_SETTINGS`' (with `CARD_SPACING_CLEAN`'s values for Custom), written out, as the ranges below
 * are: an import of `types.ts` values would add exports to the phone's first load (YAZ-5377), which the phone's card
 * chunks would then take from it. `cardLook.test.ts` checks they are the same.
 */
export const CARD_LOOK_DEFAULTS: Readonly<CardLookSettings> = /*#__PURE__*/ Object.freeze({
  shownHiddenWords: 'highlight',
  markNextHidden: true,
  nextHiddenColour: null,
  cardWidth: null,
  cardTextSize: null,
  cardTitleSize: null,
  cardTablePosition: 'pages',
  cardSpacing: 'pages',
  cardLineSpacing: 1.65,
  cardBlockGap: 8,
  cardBulletIndent: 34,
  cardBulletGap: 10,
  cardBulletSpace: 3,
  cardSidesFold: false,
  cardSidesFoldCardPages: false,
  cardSidesFoldExplore: false,
})

/** The Mac's `CARD_SPACING_CLEAN` (Clean's spacing), in the app's names. */
export const CARD_LOOK_CLEAN = /*#__PURE__*/ Object.freeze({ cardLineSpacing: 1.65, cardBlockGap: 8, cardBulletIndent: 34, cardBulletGap: 10, cardBulletSpace: 3 })

const whole = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
const oneOf = <T extends string>(list: readonly T[]) => (v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v)

/** Each field's check, the store's (`desktop/src/main/store.ts`) and `types.ts`' ranges. */
const OK = {
  hiddenWords: oneOf<ShownHiddenWords>(['highlight', 'underline', 'box']),
  markNext: (v: unknown): v is boolean => typeof v === 'boolean',
  nextColour: (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v),
  // CARD_WIDTH_MIN–MAX, CARD_TEXT_SIZE_MIN–MAX, CARD_TITLE_SIZE_MIN–MAX
  width: (v: unknown): v is number => whole(v, 400, 1600),
  textSize: (v: unknown): v is number => whole(v, 12, 32),
  titleSize: (v: unknown): v is number => whole(v, 12, 40),
  tables: oneOf<CardTablePosition>(['pages', 'left', 'center']),
  spacing: oneOf<CardSpacing>(['pages', 'clean', 'custom']),
  sidesFold: (v: unknown): v is boolean => typeof v === 'boolean',
  sidesFoldCardPages: (v: unknown): v is boolean => typeof v === 'boolean',
  sidesFoldExplore: (v: unknown): v is boolean => typeof v === 'boolean',
}
/** Custom's fields: line 1–3; gap and space 0–CARD_BLOCK_GAP_MAX; indent PAGE_BULLET_INDENT_MIN–MAX; bullet gap PAGE_BULLET_GAP_MIN–MAX. */
const CUSTOM_OK: { [K in keyof Required<CardLookCustom>]: (v: unknown) => v is number } = {
  line: (v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 3,
  gap: (v): v is number => whole(v, 0, 24),
  indent: (v): v is number => whole(v, 8, 48),
  bulletGap: (v): v is number => whole(v, 2, 20),
  bulletSpace: (v): v is number => whole(v, 0, 24),
}

/** The file (or a hand edit), cleaned: each field that does not read is dropped alone, so the others stay. */
export function sanitizeCardLook(raw: unknown): CardLook {
  if (!isRecord(raw)) return {}
  const out: CardLook = {}
  for (const key of Object.keys(OK) as (keyof typeof OK)[]) if (OK[key](raw[key])) Object.assign(out, { [key]: raw[key] })
  if (isRecord(raw.custom)) {
    const custom: CardLookCustom = {}
    for (const key of Object.keys(CUSTOM_OK) as (keyof CardLookCustom)[]) if (CUSTOM_OK[key](raw.custom[key])) custom[key] = raw.custom[key] as number
    if (Object.keys(custom).length > 0) out.custom = custom
  }
  return out
}

/** What a vault's file says, as the 13 settings: each key it leaves out is the default. */
export function cardLookSettings(look: CardLook): CardLookSettings {
  const d = CARD_LOOK_DEFAULTS
  const c = look.custom ?? {}
  return {
    shownHiddenWords: look.hiddenWords ?? d.shownHiddenWords,
    markNextHidden: look.markNext ?? d.markNextHidden,
    nextHiddenColour: look.nextColour ?? d.nextHiddenColour,
    cardWidth: look.width ?? d.cardWidth,
    cardTextSize: look.textSize ?? d.cardTextSize,
    cardTitleSize: look.titleSize ?? d.cardTitleSize,
    cardTablePosition: look.tables ?? d.cardTablePosition,
    cardSpacing: look.spacing ?? d.cardSpacing,
    cardLineSpacing: c.line ?? d.cardLineSpacing,
    cardBlockGap: c.gap ?? d.cardBlockGap,
    cardBulletIndent: c.indent ?? d.cardBulletIndent,
    cardBulletGap: c.bulletGap ?? d.cardBulletGap,
    cardBulletSpace: c.bulletSpace ?? d.cardBulletSpace,
    cardSidesFold: look.sidesFold ?? d.cardSidesFold,
    cardSidesFoldCardPages: look.sidesFoldCardPages ?? d.cardSidesFoldCardPages,
    cardSidesFoldExplore: look.sidesFoldExplore ?? d.cardSidesFoldExplore,
  }
}

/** The 13 settings as the file holds them: only what differs from the defaults (a value that does not read is left out). */
export function cardLookOf(s: Partial<CardLookSettings>): CardLook {
  const d = CARD_LOOK_DEFAULTS
  const differs = <K extends keyof CardLookSettings>(k: K): boolean => s[k] !== undefined && s[k] !== d[k]
  const custom = sanitizeCardLook({
    custom: {
      ...(differs('cardLineSpacing') && { line: s.cardLineSpacing }),
      ...(differs('cardBlockGap') && { gap: s.cardBlockGap }),
      ...(differs('cardBulletIndent') && { indent: s.cardBulletIndent }),
      ...(differs('cardBulletGap') && { bulletGap: s.cardBulletGap }),
      ...(differs('cardBulletSpace') && { bulletSpace: s.cardBulletSpace }),
    },
  }).custom
  return sanitizeCardLook({
    ...(differs('shownHiddenWords') && { hiddenWords: s.shownHiddenWords }),
    ...(differs('markNextHidden') && { markNext: s.markNextHidden }),
    ...(differs('nextHiddenColour') && { nextColour: s.nextHiddenColour }),
    ...(differs('cardWidth') && { width: s.cardWidth }),
    ...(differs('cardTextSize') && { textSize: s.cardTextSize }),
    ...(differs('cardTitleSize') && { titleSize: s.cardTitleSize }),
    ...(differs('cardTablePosition') && { tables: s.cardTablePosition }),
    ...(differs('cardSpacing') && { spacing: s.cardSpacing }),
    ...(custom !== undefined && { custom }),
    ...(differs('cardSidesFold') && { sidesFold: s.cardSidesFold }),
    ...(differs('cardSidesFoldCardPages') && { sidesFoldCardPages: s.cardSidesFoldCardPages }),
    ...(differs('cardSidesFoldExplore') && { sidesFoldExplore: s.cardSidesFoldExplore }),
  })
}

/** The 13 settings of `s` (the app's), each missing or wrong one the default (a main process older than a field). */
export const appCardLook = (s: Partial<CardLookSettings>): CardLookSettings => cardLookSettings(cardLookOf(s))

/** What a writer writes: the version, then only what differs from the defaults. */
export function cardLookFile(look: CardLook): { version: number } & CardLook {
  return { version: CARD_LOOK_VERSION, ...sanitizeCardLook(look) }
}

/**
 * A look as the CSS variables the card's CSS (`client/src/editor/card/card.css`, `cardScreens.css`, `table.css`) reads,
 * WHOLE: every variable set, `initial` where the look sets none (the card's CSS then falls back to the page's value, as
 * with no setting), so a surface that wears it never shows another vault's look from an ancestor. The Mac wears it on
 * each surface of a vault's cards (`client/src/review/cardLook.ts`, which sets `--card-text-width` from the app's
 * Content width for Same as pages); the phone on its card surfaces, where `--card-text-width` is only a max.
 *  - `--shown-hidden-words`, `--mark-next-hidden`, `--card-clean`: read by style queries (they were attributes on
 *    `.app` before YAZ-5484; the nearest value wins, so two vaults never clash);
 *  - `--card-next-hidden`: the picked next colour over the theme's `--next-hidden`;
 *  - Card spacing (Clean's values or Custom's; none for Same as pages) and Clean's `--inbox-card-pad`;
 *  - `--card-text-size`, `--card-title-size` (Custom only, YAZ-5387), `--card-text-width`, `--card-table-inline`;
 *  - `--card-sides-fold-pages`, `--card-sides-fold-card-pages`, `--card-sides-fold-explore` (YAZ-5904): `on` folds Side 2 and after where a surface may
 *    fold its card (`client/src/editor/card/cardFold.ts`); `card.css` picks one for each card, or a page's `card-sides`.
 */
export function cardLookStyle(look: CardLook): Record<string, string> {
  const s = cardLookSettings(look)
  const spacing = s.cardSpacing === 'clean' ? CARD_LOOK_CLEAN : s.cardSpacing === 'custom' ? s : null
  const clean = s.cardSpacing !== 'pages'
  const px = (v: number | null | undefined): string => (typeof v === 'number' ? `${v}px` : 'initial')
  return {
    '--shown-hidden-words': s.shownHiddenWords,
    '--mark-next-hidden': s.markNextHidden ? 'on' : 'off',
    '--card-next-hidden': s.markNextHidden && s.nextHiddenColour !== null ? s.nextHiddenColour : 'initial',
    '--card-clean': clean ? 'on' : 'off',
    '--inbox-card-pad': clean ? '44px' : 'initial',
    '--card-line-height': spacing === null ? 'initial' : String(spacing.cardLineSpacing),
    '--card-block-gap': px(spacing?.cardBlockGap),
    '--card-bullet-indent': px(spacing?.cardBulletIndent),
    '--card-bullet-gap': px(spacing?.cardBulletGap),
    '--card-bullet-space': px(spacing?.cardBulletSpace),
    '--card-text-size': px(s.cardTextSize),
    '--card-title-size': px(s.cardTitleSize),
    '--card-text-width': px(s.cardWidth),
    '--card-table-inline': s.cardTablePosition === 'left' ? '0' : s.cardTablePosition === 'center' ? 'auto' : 'initial',
    // Show all is `initial` (none): `card.css` reads `off` then, and a whole surface still hides an ancestor's `on`.
    '--card-sides-fold-pages': s.cardSidesFold ? 'on' : 'initial',
    '--card-sides-fold-card-pages': s.cardSidesFoldCardPages ? 'on' : 'initial',
    '--card-sides-fold-explore': s.cardSidesFoldExplore ? 'on' : 'initial',
  }
}
