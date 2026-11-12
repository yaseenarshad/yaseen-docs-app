/**
 * A card layer of the explore stack (YAZ-4962, D13): ONE note card of a page, read-only, with what review knows of it.
 *
 *  - Head: the card title (`cardTitle`), the card ID small and grey (a click copies it, D20), ⋯ and ×, as every layer.
 *  - The card, everything shown (`renderNoteCard`), its pills and links live: a click opens the page on top, a bound
 *    gesture (⌘-click) a tab.
 *  - The strip: the page's name (a click opens the page on top, landed on the card), the last answer, the wait, the
 *    next due date and the recall chance ("83%", idea 11). A card with no review says "New", never empty numbers.
 *  - "Reviews (n)": the full table with a delete on each row (`deleteReview`).
 *
 * The card is read from its page (`readCardAt`: by ID, or by its place while it has none) and read again whenever the
 * index has a new version of the page: an answer in the Inbox or a delete elsewhere shows here at once.
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { answerLabel, cardState, recallChance } from '@shared/cardSchedule'
import { cardTitle } from '@shared/cardText'
import type { GestureAction } from '@shared/keys'
import { readCardAt, type CardAtPage } from '../review/cardFile'
import { NoteCardBody, NoteCardId, NoteCardReviews, noteCardDate, noteCardWait } from '../review/noteCardParts'
import { copyText } from '../editor/linkMenu'
import { HeadMore, useCompactHead } from './ExploreHeadMore'
import { keepFocus, type ExploreVault } from './ExploreNote'

interface ExploreCardProps {
  path: string
  cardId: string | null
  index: number
  /** The page's name, for the strip. */
  pageName: string
  vault: ExploreVault
  /** The page on top, landed on the card at `index` (the strip's page name). */
  onOpenPage: (index: number) => void
  /** A page link in the card: on top. */
  onOpenLink: (path: string) => void
  /** A bound gesture on a link (⌘-click): a tab. */
  onOpenTab: (path: string, where: GestureAction) => void
  /** ⌘↵ and ⋯'s row: the card's page in a tab, and the stack closes. */
  onOpenInTab: () => void
  onNotice: (message: string) => void
  onHeadDown?: (event: ReactMouseEvent) => void
  onHeadReset?: (event: ReactMouseEvent) => void
  onClose: () => void
  active: boolean
}

type Loaded = { kind: 'loading' } | { kind: 'card'; card: CardAtPage } | { kind: 'gone' }

export function ExploreCard({ path, cardId, index, pageName, vault, onOpenPage, onOpenLink, onOpenTab, onOpenInTab, onNotice, onHeadDown, onHeadReset, onClose, active }: ExploreCardProps) {
  const headRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLSpanElement>(null)
  useCompactHead(headRef, titleRef)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' })
  /** The ID the card has once read: a card with none when the layer opened keeps being found by it after the sweep gives one. */
  const idRef = useRef(cardId)
  const { wikilinks } = vault

  const read = useCallback(() => {
    let live = true
    readCardAt(path, idRef.current, index).then(
      (card) => {
        if (!live) return
        if (card === null) return setLoaded({ kind: 'gone' })
        if (card.id !== null) idRef.current = card.id
        setLoaded({ kind: 'card', card })
      },
      () => live && setLoaded({ kind: 'gone' }),
    )
    return () => {
      live = false
    }
  }, [path, index])

  // Read on open, and again on each new version of the page in the index (its mtime): the strip and the table stay live.
  useEffect(() => {
    let cancel = read()
    let seen = wikilinks.records.find((r) => r.path === path)?.mtime
    const unsubscribe = wikilinks.subscribe(() => {
      const mtime = wikilinks.records.find((r) => r.path === path)?.mtime
      if (mtime === seen) return
      seen = mtime
      cancel()
      cancel = read()
    })
    return () => {
      cancel()
      unsubscribe()
    }
  }, [read, path, wikilinks])

  useEffect(() => {
    if (active) bodyRef.current?.focus({ preventScroll: true })
  }, [active])

  const review = vault.review
  const card = loaded.kind === 'card' ? loaded.card : null
  const id = card?.id ?? cardId
  const title = card === null ? '' : cardTitle(card.text)
  const deleteReview =
    review === undefined || card === null || card.id === null
      ? undefined
      : (at: string) => {
          const cardIdNow = card.id
          if (cardIdNow !== null) void review.deleteReview(path, cardIdNow, at).then(() => read())
        }

  return (
    <>
      <div
        ref={headRef}
        className="explore__head"
        onMouseDown={onHeadDown}
        onDoubleClick={onHeadReset}
      >
        <span ref={titleRef} className={`explore__title${title === '' ? ' note-card__title--empty' : ''}`} title={path}>
          {loaded.kind === 'loading' ? '' : title === '' ? 'Note card' : title}
        </span>
        {id !== null && <NoteCardId id={id} onNotice={onNotice} />}
        <span className="explore__fold">
          <button type="button" className="explore__button" onMouseDown={keepFocus} onClick={onOpenInTab} title="Open the page in a tab and close the stack (⌘↵)" aria-label="Open the page in a tab">
            ↗
          </button>
        </span>
        <HeadMore
          sections={() => [
            [
              { id: 'open-page', label: 'Open the page', onSelect: () => onOpenPage(card?.index ?? index) },
              { id: 'open-tab', label: 'Open the page in a tab', hint: '⌘↵', onSelect: onOpenInTab },
              ...(id === null ? [] : [{ id: 'copy-id', label: 'Copy card ID', hint: id, onSelect: () => copyText(id, 'card ID', onNotice, undefined, true) }]),
            ],
          ]}
        />
        <button type="button" className="explore__button" onMouseDown={keepFocus} onClick={onClose} title="Close this layer (Esc)" aria-label="Close this layer">
          ×
        </button>
      </div>
      <div ref={bodyRef} className="explore__body explore__body--card" tabIndex={-1} data-explore-card>
        {loaded.kind === 'gone' && <p className="editor-msg">This card is no longer there</p>}
        {card !== null && (
          <>
            <div className="note-card note-card-screen">
              <NoteCardBody text={card.text} path={path} vault={vault} doors={{ openLayer: onOpenLink, openTab: onOpenTab, onNotice }} />
            </div>
            <NoteCardStrip card={card} pageName={pageName} vault={vault} onOpenPage={() => onOpenPage(card.index)} />
            {review !== undefined && <NoteCardReviews reviews={card.reviews} settings={review.settings} onDelete={deleteReview} defaultOpen />}
          </>
        )}
      </div>
    </>
  )
}

/**
 * The strip under the card (D13, idea 11): the page, then what review knows, each said once. A card with no review is
 * "New"; a card with review off says so.
 */
function NoteCardStrip({ card, pageName, vault, onOpenPage }: { card: CardAtPage; pageName: string; vault: ExploreVault; onOpenPage: () => void }) {
  const settings = vault.review?.settings
  const facts: { key: string; text: string; title?: string }[] = []
  if (card.off) facts.push({ key: 'off', text: 'Review off' })
  if (settings !== undefined) {
    const state = cardState(card.reviews, settings)
    const last = card.reviews.length === 0 ? null : [...card.reviews].sort((a, b) => (a.at < b.at ? -1 : 1)).at(-1)!
    if (state.isNew || last === null) facts.push({ key: 'new', text: 'New' })
    else {
      const now = Date.now()
      const chance = recallChance(card.reviews, settings, now)
      facts.push({ key: 'last', text: answerLabel(last.rating, settings), title: `Last answer, ${noteCardDate(Date.parse(last.at), now)}` })
      facts.push({ key: 'wait', text: noteCardWait(state.interval), title: 'The wait the last answer set' })
      if (state.due !== null) facts.push({ key: 'due', text: `Due ${noteCardDate(state.due, now)}`, title: 'The next review' })
      if (chance !== null) facts.push({ key: 'recall', text: `${Math.round(chance * 100)}%`, title: 'The chance you remember it now' })
    }
  }
  return (
    <div className="note-card-strip">
      <button type="button" className="note-card-strip__page" title="Open the page at this card" onMouseDown={keepFocus} onClick={onOpenPage}>
        {pageName}
      </button>
      {facts.map((f) => (
        <span key={f.key} className="note-card-strip__fact" title={f.title}>
          {f.text}
        </span>
      ))}
    </div>
  )
}
