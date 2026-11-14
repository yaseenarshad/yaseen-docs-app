/**
 * PREVIEW A CARD (YAZ-5152, Yaseen: "preview the card as if it was in the inbox ... with the hidden words and then the
 * space bar"; the plan he approved, "Yes, build it"): the card exactly as the Inbox shows it — the Inbox's own card
 * (`inboxCard.tsx`: its front, Space's steps, the next-word mark, the scroll, the width edges, "Side 1 of 2"), the
 * Reviews strip from the last side, the window's Card width and Card spacing — over the window, as a dialog.
 *
 *  - NOTHING IS SAVED: it has no answer buttons, no timer, no session, no review door. It writes nothing: no review,
 *    no schedule, no Up next and no counts. The Reviews strip has no delete here.
 *  - The bottom bar reads "Preview · Esc to close".
 *  - SPACE: the next hidden word, then the next side, as in the Inbox; at the end, the card again from its front.
 *    A click on a blank shows that word, elsewhere on the card the marked one, as in the Inbox (YAZ-5049 round 4).
 *    P plays the card's sound, as in the Inbox.
 *  - ESC closes it, and the keyboard goes back where it was: from Edit card, to its editor, the caret kept.
 *
 * Opened from anywhere by `CARD_PREVIEW` (`editor/card/cardOpen.ts`); App draws it.
 */
import { useEffect, useRef } from 'react'
import type { ReviewSettings } from '@shared/reviews'
import type { CardPreviewRequest } from '../editor/card/cardOpen'
import { toggleCardAudio } from '../editor/card/cardMedia'
import type { ExploreVault } from '../explore/ExplorePage'
import { CardId, CardReviews, type CardLinkDoors } from './cardParts'
import { CardSideCount, InboxCardFace, InboxCardPanel, useCardFront, useCardSteps, useStepScroll } from './inboxCard'
import { useInboxCardWidth } from './inboxCardWidth'
import '../explore/explore.css'

export interface CardPreviewProps {
  card: CardPreviewRequest
  vault: ExploreVault
  /** The vault's review settings, for the Reviews strip. Absent (Review off): no strip. */
  settings?: ReviewSettings
  doors: CardLinkDoors
  onNotice: (message: string) => void
  onClose: () => void
}

export function CardPreview({ card, vault, settings, doors, onNotice, onClose }: CardPreviewProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const columnRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const { width, startDrag } = useInboxCardWidth(columnRef, rootRef)
  const { text, title } = useCardFront(card.text, card.notitle)
  // One preview is one card: a new ask (another card) starts at its front.
  const cardKey = `${card.path}\n${card.id ?? ''}\n${card.text}`
  const steps = useCardSteps(text, cardKey, rootRef)
  useStepScroll(steps, true, bodyRef, rootRef)
  const live = useRef({ steps, onClose })
  live.current = { steps, onClose }

  // The keyboard comes here, and goes back where it was when the preview closes (Edit card's caret too).
  useEffect(() => {
    const from = document.activeElement
    rootRef.current?.focus({ preventScroll: true })
    return () => {
      if (from instanceof HTMLElement && from.isConnected) from.focus({ preventScroll: true })
    }
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

  const headTitle = title.waits && !steps.done ? '' : title.text
  /** A click on the card (not on a blank: that shows its word): the marked word, or at the end the front again. */
  const step = () => {
    if (!steps.stepOn('mouse')) steps.restart()
  }
  return (
    <div className="card-preview" role="dialog" aria-modal="true" aria-label="Preview card">
      <div ref={rootRef} className="card-inbox card-inbox--preview" tabIndex={-1}>
        <div ref={columnRef} className="card-inbox__column" style={width === null ? undefined : { width: `min(${width}px, 100%)` }}>
          <div className="card-inbox__above">
            <span className="card-inbox__head">
              {headTitle !== '' && (
                <>
                  <span className="card-inbox__name">{headTitle}</span>
                  {card.id !== null && (
                    <span className="card-inbox__dot" aria-hidden>
                      ·
                    </span>
                  )}
                </>
              )}
              {card.id !== null && <CardId id={card.id} onNotice={onNotice} />}
            </span>
            {text !== null && <CardSideCount steps={steps} />}
          </div>
          <InboxCardPanel startDrag={startDrag} bodyRef={bodyRef}>
            {text !== null && <InboxCardFace text={text} path={card.path} vault={vault} steps={steps} doors={doors} onStep={step} />}
          </InboxCardPanel>
          {/* The Reviews strip from the last side (YAZ-5105), as in the Inbox; no delete in a preview. */}
          {settings !== undefined && steps.onLastSide && card.reviews.length > 0 && <CardReviews key={cardKey} reviews={card.reviews} settings={settings} />}
          <div className="explore__foot card-inbox__hints card-preview__foot">Preview · Esc to close</div>
        </div>
      </div>
    </div>
  )
}
