import { CARD_TITLE_HELP } from '@shared/cardTitleShows'
import { EyeIcon } from '../views/view/icons'
import { HoverTip } from './HoverTip'
import './cardTitleHelp.css'

/**
 * The small eye by "Show card titles" and by the card menu's "Title in review" (YAZ-5696 round 2, Yaseen: "a tooltip
 * with a small eye in order to explain them"): hover, or the keyboard's focus, shows each of the four choices in one
 * line (`CARD_TITLE_HELP`). The words are the screen reader's too.
 */
export function CardTitleHelp() {
  return (
    <HoverTip text={<CardTitleHelpBox />} focus>
      <button type="button" className="card-title-help" aria-label="What the choices mean" aria-description={CARD_TITLE_HELP.map((h) => `${h.label}: ${h.text}`).join(' ')}>
        <EyeIcon />
      </button>
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
