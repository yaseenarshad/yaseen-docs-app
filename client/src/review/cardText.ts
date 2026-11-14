/**
 * Settings › Cards › Card look › Card text size and Card title size (YAZ-5387, Yaseen: "the title is massive … add text
 * sizing for cards, and then that could be the same as pages versus custom, and then you have title sizing") as the
 * variables App puts on `.app`, read by the card's own rules (`card.css`, `cardScreens.css`), so every place a card
 * shows follows: a card in a page, its embed, Edit card, Explore's card, the Inbox, Preview, a card file's tab.
 *  - `--card-text-size`: Custom only, its px. Same as pages sets none: the card reads its page's (or its screen's) size.
 *  - `--card-title-scale`: always, the title band's step of the card's text (`CARD_TITLE_SCALE`).
 * A value a main process older than these fields sent (the app not restarted after an update) reads as the default.
 */
import { CARD_TITLE_SCALE, isCardTextSize, type CardTitleSize, type SettingsState } from '@shared/types'

export function cardTextVars(s: SettingsState): Record<string, string | number> {
  const size: unknown = (s as Partial<SettingsState>).cardTextSize
  const title: unknown = (s as Partial<SettingsState>).cardTitleSize
  const step: CardTitleSize = typeof title === 'string' && title in CARD_TITLE_SCALE ? (title as CardTitleSize) : 'medium'
  return { ...(isCardTextSize(size) && { '--card-text-size': `${size}px` }), '--card-title-scale': CARD_TITLE_SCALE[step] }
}
