/**
 * PREVIEW A CARD (YAZ-5152, Yaseen: "preview the card as if it was in the inbox ... with the hidden words and then the
 * space bar"; the plan he approved, "Yes, build it"): the card exactly as the Inbox shows it — the Inbox's own card
 * (`inboxCard.tsx`: its front, Space's steps, the next-word mark, the scroll, the width edges, "Side 1 of 2"), the
 * Reviews strip from the last side, the window's Card width and Card spacing.
 *
 *  - INSIDE THE APP (option A, Yaseen: "Yes, A"): App draws it in the page area, as the Inbox tab draws (the tab stack);
 *    the sidebar and the tab row stay and work. A quiet bar on top: "Preview · <the card> · nothing is saved", and
 *    Close (Esc). One press on a tab or in the sidebar (`leaveOn`) leaves the preview (`onLeave`), and the click goes
 *    on to do its own job; the keyboard then stays where that click puts it. ⌘W is App's: it closes only the preview.
 *
 *  - NOTHING IS SAVED: it has no answer buttons, no timer, no session, no review door. It writes nothing: no review,
 *    no schedule, no Up next and no counts. The Reviews strip has no delete here.
 *  - SPACE: the next hidden word, then the next side, as in the Inbox; at the end, the card again from its front.
 *    A click on a blank shows that word, elsewhere on the card the marked one, as in the Inbox (YAZ-5049 round 4).
 *    P plays the card's sound, as in the Inbox.
 *  - ESC closes it, and the keyboard goes back where it was: from Edit card, to its editor, the caret kept.
 *
 * Opened from anywhere by `CARD_PREVIEW` (`editor/card/cardOpen.ts`); App draws it.
 */
import { useEffect, useRef, type CSSProperties } from 'react'
import type { ReviewSettings } from '@shared/reviews'
import type { CardPreviewRequest } from '../editor/card/cardOpen'
import { toggleCardAudio } from '../editor/card/cardMedia'
import type { ExploreVault } from '../explore/ExplorePage'
import { CardBand, CardId, CardStrip, type CardLinkDoors } from './cardParts'
import { CardSideCount, InboxCardFace, InboxCardPanel, bandTitle, bandTitleStep, useCardFront, useCardSteps, useStepScroll } from './inboxCard'
import { cardColumnStyle, useInboxCardWidth } from './inboxCardWidth'
import { KeyLabel } from '../keys/KeyLabel'
import { EyeIcon } from '../views/view/icons'
import '../explore/explore.css'

export interface CardPreviewProps {
  card: CardPreviewRequest
  vault: ExploreVault
  /** The vault's review settings, for the Reviews strip. Absent (Review off): no strip. */
  settings?: ReviewSettings
  doors: CardLinkDoors
  onNotice: (message: string) => void
  /** Esc or Close: the keyboard goes back where it was. */
  onClose: () => void
  /** Where one press leaves the preview and still does its own job (App: the tab row and the sidebar). */
  leaveOn?: string
  /** That press: the preview goes, and the keyboard stays where the click puts it. */
  onLeave?: () => void
  /** A Files window has no page area: the preview covers the window. */
  whole?: boolean
  /** The card look of the card's vault (YAZ-5484, `review/cardLook.ts`): on the preview, so the card draws with ITS vault's look. */
  style?: CSSProperties
}

export function CardPreview({ card, vault, settings, doors, onNotice, onClose, leaveOn, onLeave, whole = false, style }: CardPreviewProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const columnRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const { width, startDrag } = useInboxCardWidth(columnRef, rootRef)
  // A title hidden in review is the Inbox's (YAZ-5695): no band, and the bar names the card by its ID.
  const { text, title: headTitle } = useCardFront(card.text, card, settings?.titleAt ?? 'always')
  // One preview is one card: a new ask (another card) starts at its front.
  const cardKey = `${card.path}\n${card.id ?? ''}\n${card.text}`
  const steps = useCardSteps(text, cardKey, rootRef, bandTitleStep(headTitle, card.titleAt, settings?.titleAt ?? 'always'))
  // YAZ-5696: the Inbox's timing (the card's own choice, else the vault's; Review off: at once).
  const band = bandTitle(headTitle, card.titleAt, settings?.titleAt ?? 'always', steps)
  useStepScroll(steps, true, rootRef)
  const live = useRef({ steps, onClose, leaveOn, onLeave })
  live.current = { steps, onClose, leaveOn, onLeave }
  /** Left by a click elsewhere: that click owns the keyboard, so it is not pulled back. */
  const left = useRef(false)

  // The keyboard comes here, and goes back where it was when the preview closes (Edit card's caret too).
  useEffect(() => {
    const from = document.activeElement
    rootRef.current?.focus({ preventScroll: true })
    return () => {
      if (!left.current && from instanceof HTMLElement && from.isConnected) from.focus({ preventScroll: true })
    }
  }, [])
  // One press on a tab or in the sidebar: the preview goes, and the press goes on (never stopped) to do its job.
  useEffect(() => {
    const onPress = ({ target }: Event) => {
      const { leaveOn, onLeave } = live.current
      if (leaveOn === undefined || onLeave === undefined || !(target instanceof Element) || target.closest(leaveOn) === null) return
      left.current = true
      onLeave()
    }
    window.addEventListener('pointerdown', onPress, true)
    return () => window.removeEventListener('pointerdown', onPress, true)
  }, [])
  // Its keys, ahead of everything under it (the page, Explore, the Inbox): it is a dialog over them.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return
      const { steps, onClose } = live.current
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        return onClose()
      }
      if (event.key === ' ') {
        event.preventDefault()
        event.stopPropagation()
        if (event.repeat && steps.done) return
        if (!steps.stepOn()) steps.restart()
        return
      }
      if (event.key === 'p' || event.key === 'P') {
        event.preventDefault()
        event.stopPropagation()
        if (!event.repeat) toggleCardAudio(rootRef.current?.querySelector('.card-inbox__card') ?? null)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const named = headTitle !== '' ? headTitle : (card.id ?? '')
  /** A click on the card (not on a blank: that shows its word): the marked word, or at the end the front again. */
  const step = () => {
    if (!steps.stepOn('mouse')) steps.restart()
  }
  return (
    <div className={whole ? 'card-preview card-preview--window' : 'card-preview'} role="dialog" aria-modal="false" aria-label="Preview card" style={style}>
      <div className="card-preview__bar">
        <EyeIcon />
        <span className="card-preview__label">Preview</span>
        <span className="card-preview__what">{named === '' ? '· nothing is saved' : `· ${named} · nothing is saved`}</span>
        <button type="button" className="card-preview__close" onMouseDown={(e) => e.preventDefault()} onClick={onClose}>
          <KeyLabel action="Close" keys="esc" />
        </button>
      </div>
      <div ref={rootRef} className="card-inbox card-inbox--preview" tabIndex={-1}>
        <div ref={columnRef} className="card-inbox__column" style={cardColumnStyle(width)}>
          <div className="card-inbox__above">
            <span className="card-inbox__head">{card.id !== null && <CardId id={card.id} onNotice={onNotice} />}</span>
            {text !== null && <CardSideCount steps={steps} />}
          </div>
          <InboxCardPanel
            startDrag={startDrag}
            bodyRef={bodyRef}
            band={
              // YAZ-5857: no band while the title waits.
              headTitle !== '' &&
              !band.waits && (
                <CardBand>
                  <span className="card-inbox__name">{headTitle}</span>
                </CardBand>
              )
            }
          >
            {text !== null && <InboxCardFace text={text} path={card.path} vault={vault} steps={steps} doors={doors} onStep={step} />}
          </InboxCardPanel>
          {/* The Reviews strip from the last side (YAZ-5105), as in the Inbox; no delete in a preview. */}
          {settings !== undefined && steps.onLastSide && <CardStrip key={cardKey} reviews={card.reviews} settings={settings} properties={{ values: card.properties ?? {} }} />}
        </div>
      </div>
    </div>
  )
}
