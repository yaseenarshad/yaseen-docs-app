/**
 * THE FORMAT HINT (YAZ-5114, YAZ-5059 decision 8, suggestion 18): one quiet line under the key row of Edit card, on a
 * NEW, EMPTY card only — its text is nothing, or only the placeholder "Title" (`CARD_TITLE_PLACEHOLDER`) — when Edit
 * card opens: "Formats in your card skill: acronym · book · comparison · 8 more. Learn the formats". The names are the
 * pages of the `formats` folder of the card skill the vault uses (its own `Card skill` folder, else the app's copy),
 * A to Z; App reads them (`api.app.cardFormats`) and hands them here (`setCardFormatHints`). The line goes at the first
 * text, and never shows on a card that has text when Edit card opens. Settings › Review › Card tips Off: no line. A
 * skill with no `formats` folder, or an empty one: no line.
 *
 * "Learn the formats" sends ONE bubbling DOM event, `CARD_FORMATS_OPEN` (detail `CardFormatsOpenRequest`), as
 * `CARD_OPEN` does: App's listener opens the folder. The card UI never calls the app itself.
 */
import type { CardSkillFormats } from '@shared/cardSkillFolder'

/** "Learn the formats" (YAZ-5114): bubbles from the hint to the document; App opens `folder`. */
export const CARD_FORMATS_OPEN = 'mdapp:card-formats-open'

/** The detail of `CARD_FORMATS_OPEN`: the `formats` folder of the skill the hint named. */
export interface CardFormatsOpenRequest {
  folder: string
}

/**
 * Where "Learn the formats" opens `folder` (YAZ-5114): `files`, the sidebar's Files on that folder, when it is in a vault
 * of the window (the vault's own `Card skill`); else `finder`. The app's copy is outside every vault, and the skill's
 * sidebar row (YAZ-5108) and the course (YAZ-5120) that the issue names are not built yet.
 */
export function cardFormatsOpenIn(folder: string, roots: readonly string[]): 'files' | 'finder' {
  return roots.some((root) => folder.startsWith(`${root.replace(/\/+$/, '')}/`)) ? 'files' : 'finder'
}

/** How many names the line says before "N more". */
const NAMED = 3

/** What App gives the cards: Card tips on or off, and each vault's skill formats (null: that skill has no `formats` folder). */
interface FormatHints {
  on: boolean
  byVault: ReadonlyMap<string, CardSkillFormats | null>
}
let hints: FormatHints = { on: true, byVault: new Map() }

/** App's door (YAZ-5114): Card tips, and the formats of each vault of the window. */
export function setCardFormatHints(next: Partial<FormatHints>): void {
  hints = { ...hints, ...next }
}

/** The formats for a card of the page `path`: the longest vault root that holds it, else the window's first vault. */
export function cardFormatsFor(path: string | null): CardSkillFormats | null {
  let best: string | null = null
  for (const root of hints.byVault.keys()) {
    const base = root.replace(/\/+$/, '')
    if (path !== null && (path === base || path.startsWith(`${base}/`)) && (best === null || base.length > best.length)) best = root
  }
  const key = best ?? hints.byVault.keys().next().value
  return key === undefined ? null : (hints.byVault.get(key) ?? null)
}

/** Is a card with `text` new and empty for the hint: nothing, or only the placeholder title? */
export const isEmptyNewCard = (text: string, placeholder: string): boolean => text.trim() === '' || text.trim() === placeholder

/** The line's words before the link: "Formats in your card skill: a · b · c · 8 more." */
export function cardFormatHintText(formats: readonly string[]): string {
  const more = formats.length - NAMED
  return `Formats in your card skill: ${[...formats.slice(0, NAMED), ...(more > 0 ? [`${more} more`] : [])].join(' · ')}.`
}

/** The hint's element for `skill`. Its link sends `CARD_FORMATS_OPEN` with the skill's `formats` folder. */
export function cardFormatHint(skill: CardSkillFormats): HTMLElement {
  const row = document.createElement('div')
  row.className = 'card__formats'
  row.contentEditable = 'false'
  const link = document.createElement('button')
  link.type = 'button'
  link.className = 'card__formats-link'
  link.textContent = 'Learn the formats'
  // Pressed, not clicked: the card's own mousedown selects the card, and the editor keeps the keyboard.
  link.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    link.dispatchEvent(new CustomEvent<CardFormatsOpenRequest>(CARD_FORMATS_OPEN, { bubbles: true, detail: { folder: skill.folder } }))
  })
  row.append(`${cardFormatHintText(skill.formats)} `, link)
  return row
}

/** The hint for a card of `path` that is new and empty now, or null: Card tips Off, no skill formats, or none in it. */
export function newCardFormatHint(path: string | null): HTMLElement | null {
  if (!hints.on) return null
  const skill = cardFormatsFor(path)
  return skill === null || skill.formats.length === 0 ? null : cardFormatHint(skill)
}
