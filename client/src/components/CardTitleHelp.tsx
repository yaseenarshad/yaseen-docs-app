import { CARD_TITLE_HELP } from '@shared/cardTitleShows'
import { EyeIcon } from '../views/view/icons'
import { HoverTip } from './HoverTip'
import './cardTitleHelp.css'

/**
 * The small eye by "Show card titles" and by the card menu's "Title in review" (YAZ-5696 round 2, Yaseen: "a tooltip
 * with a small eye in order to explain them"): hover, or the keyboard's focus, shows each of the four choices in one
 * line (`CARD_TITLE_HELP`). The words are the screen reader's too.
 */
export function CardTitleHelp({ inRow = false }: { inRow?: boolean }) {
  const description = CARD_TITLE_HELP.map((h) => `${h.label}: ${h.text}`).join(' ')
  return (
    <HoverTip text={<CardTitleHelpBox />} focus={!inRow}>
      {/* In a menu row (a button already) the eye is a mark, not a second button: the row's hover box is its own. */}
      {inRow ? (
        <span className="card-title-help card-title-help--row" role="img" aria-label="What the choices mean" aria-description={description}>
          <EyeIcon />
        </span>
      ) : (
        <button type="button" className="card-title-help" aria-label="What the choices mean" aria-description={description}>
          <EyeIcon />
        </button>
      )}
    </HoverTip>
  )
}

/** The four lines: the choice's name in bold, then what it does. */
export function CardTitleHelpBox() {
  return (
    <span className="card-title-help__box">
      {CARD_TITLE_HELP.map((h) => (
        <span key={h.label} className="card-title-help__line">
          <strong>{h.label}:</strong> {h.text}
        </span>
      ))}
    </span>
  )
}
