/**
 * A card layer of the explore stack (YAZ-4962, D13): ONE card of a page, read-only, with what review knows of it.
 *
 *  - Head: the card ID first, small and grey (a click copies it, D20) — its place in the page's card and the Inbox
 *    too —, then the card title (off its card line, YAZ-5308; the layer's name,
 *    as every layer has one; "Untitled card" for a card with none; a click renames it, YAZ-5164 part 3, and the card below
 *    never repeats it), ↗, ⋯ and ×; the chip "Up next ×" after the ID while the card is at the top of the Inbox (YAZ-4999 D3). The
 *    ⋯ menu: Open page, Open page in a new tab, Put at top of Inbox / Remove from top of Inbox, Archive card / Unarchive card (YAZ-5046),
 *    Reset history (D13, the card line through `changeCardLine`, the app's own write), Copy card ID.
 *  - The card, everything shown (`renderCard`), its pills and links live: a click opens the page on top, a bound
 *    gesture (⌘-click) a tab.
 *  - The strip: the page's name (a click opens the page on top, landed on the card), then one calm line of words
 *    (YAZ-5032): "Last: Remembered · Next review Apr 28, 2027 (in 183 days) · 99% you remember it now", the recall
 *    chance with a small (i) (idea 11). A card with no review says "New".
 *  - "4 Reviews": the full table, closed until asked for (the strip says the state; D13 "a footer lets the table
 *    expand"), a bin on each row (`deleteReview`, with Undo in its notice).
 *  - TITLE ON THE FRONT (YAZ-5030): the ⋯ row "Title on the front" (Show / Hide, the card line's `notitle`); while Hide,
 *    the head says "Hidden in review" after the title, quietly. The window shows the title either way.
 *  - "Linked mentions (n)" (YAZ-5030): the pages that link to the card (`[[WIKI-512]]`), from the index; a click opens
 *    the page on top.
 *
 * EDIT CARD (YAZ-5003): E on the card window shows the page card's own editor: a small Crepe that holds the card block
 * alone, with the card view's Edit card on (`cardBlockView.ts`: Crepe's code block, the card language). Done, Esc or ⌘↵
 * there writes the text into the page (`changeCardTextIn`, the app's own write) and goes back to reading. A read-only
 * vault blocks E here, as the page does.
 *
 * WHO OPENS IT: a page's card (its ⋯ › Open card, ⌘↵ on it; `CARD_OPEN`). The Inbox no longer does (YAZ-5145): its O
 * and E open Explore's own page layer, the view Explore opens for the same card.
 *
 * The card is read from its page (`readCardAt`: by ID, or by its place while it has none) and read again whenever the
 * index has a new version of the page: an answer in the Inbox or a delete elsewhere shows here at once.
 *
 * The body (the card or its editor, Reviews, "Linked mentions"), the writes and the card's ⋯ rows are the card
 * file tab's too (`review/cardPane.tsx`, YAZ-5037); the head and the strip speak of the page, and are the window's own.
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { cardState } from '@shared/cardSchedule'
import type { GestureAction } from '@shared/keys'
import { withCardNext, withCardTitle } from '@shared/cardLine'
import { readCardAt, type CardAtPage } from '../review/cardFile'
import { UNTITLED_CARD } from '../editor/card/cardTitle'
import type { CardPlace } from '../editor/card/cardOpen'
import { CardPane, cardMenuSections, cardWrites, isCardEditKey, isCardPreviewKey, onIndexVersion, previewCardOf } from '../review/cardPane'
import { HoverTip } from '../components/HoverTip'
import { CardFacts, CardId, CardNextChip } from '../review/cardParts'
import { HeadMore, useCompactHead } from './ExploreHeadMore'
import { keepFocus, type ExploreVault } from './ExplorePage'
import { useUnit } from '../vault/unitWord'
import { PageTitle } from '../editor/PageTitle'

const NO_TITLES: ReadonlyMap<string, string> = new Map()

interface ExploreCardProps {
  path: string
  cardId: string | null
  index: number
  /** The page's name, for the strip. */
  pageName: string
  vault: ExploreVault
  /** The page on top, landed on this card (the strip's page name): by its ID, as it is now. */
  onOpenPage: (card: CardPlace) => void
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
  const unit = useUnit()
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
    const unsubscribe = onIndexVersion(wikilinks, path, () => {
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
  // Edit card (YAZ-5003): E blocks it in a read-only vault, as in the page.
  const [editing, setEditing] = useState(false)
  // Out of Edit card, the body takes the keyboard, so the stack hears the next Esc or ⌘↵ (YAZ-5009 round 2). After the
  // commit, not in Done: the card's Done gives the keyboard back to its own editor, which this commit removes; the
  // keyboard would then fall to `document.body`, out of the stack.
  const wasEditing = useRef(editing)
  useEffect(() => {
    if (wasEditing.current && !editing) bodyRef.current?.focus({ preventScroll: true })
    wasEditing.current = editing
  }, [editing])
  const writes = cardWrites(path, card, read, onNotice, review)
  const changeLine = writes.changeLine
  // A card file's title is its file's: its tab renames it, so here it stays as it is.
  const editDone = (text: string, next: string) => writes.editDone(text, () => setEditing(false), undefined, card?.cardFile === true ? undefined : next)
  /** E on the card window: Edit card (YAZ-5003), as the page's Edit card. Not in a field, not read only. */
  const preview = () => card !== null && previewCardOf(bodyRef.current, path, card)
  const onBodyKey = (event: React.KeyboardEvent) => {
    // P (YAZ-5152): Preview, as the Inbox shows the card; nothing saved.
    if (!editing && card !== null && isCardPreviewKey(event)) {
      event.preventDefault()
      event.stopPropagation()
      return preview()
    }
    if (editing || card === null || vault.readOnly === true || !isCardEditKey(event)) return
    event.preventDefault()
    event.stopPropagation()
    setEditing(true)
  }
  const id = card?.id ?? cardId
  const title = card?.title ?? ''

  return (
    <>
      <div
        ref={headRef}
        className="explore__head"
        onMouseDown={onHeadDown}
        onDoubleClick={onHeadReset}
      >
        {id !== null && <CardId id={id} onNotice={onNotice} />}
        {card?.next === true && <CardNextChip onRemove={card.id === null ? undefined : () => changeLine((l) => withCardNext(l, false))} />}
        <span ref={titleRef} className={`explore__title${title === '' ? ' card__title--empty' : ''}`}>
          {/* The page title's own component (YAZ-5164 part 3), as a card file's tab and a card in a page: a click renames
              the card, its card line (YAZ-5308). A read-only vault, or a card file's card, shows it only. */}
          {card !== null && (
            <PageTitle
              path={path}
              titles={NO_TITLES}
              text={title}
              placeholder={UNTITLED_CARD}
              readOnly={vault.readOnly === true || card.cardFile === true}
              locked={false}
              onRetitle={(next) => changeLine((l) => withCardTitle(l, next))}
            />
          )}
        </span>
        {card?.notitle === true && <span className="card__state card__notitle">Hidden in review</span>}
        {/* ↗ folds into ⋯ in a narrow layer (YAZ-4986); the card ID, the title and × stay. */}
        <span className="explore__fold">
          <HoverTip text="Open page in a new tab (⌘↵)" data-fold-part="open">
            <button type="button" className="explore__button" onMouseDown={keepFocus} onClick={onOpenInTab} aria-label={unit('Open page in a new tab')}>
              ↗
            </button>
          </HoverTip>
        </span>
        {/* ⋯ at every width (YAZ-4964 round 2, item 1): its rows are the card's own (D13), not only a narrow head's. */}
        <HeadMore
          always
          sections={() => [
            [
              { id: 'open-page', label: unit('Open page'), onSelect: () => onOpenPage(card === null ? { id: cardId, index } : { id: card.id, index: card.index }) },
              { id: 'open-tab', label: unit('Open page in a new tab'), hint: '⌘↵', onSelect: onOpenInTab },
            ],
            ...cardMenuSections(card, id, changeLine, onNotice, { inbox: true, link: false, preview }),
          ]}
        />
        <HoverTip text="Close (Esc)">
          <button type="button" className="explore__button" onMouseDown={keepFocus} onClick={onClose} aria-label="Close this layer">
            ×
          </button>
        </HoverTip>
      </div>
      <div ref={bodyRef} className="explore__body explore__body--card" tabIndex={-1} data-explore-card onKeyDown={onBodyKey}>
        {loaded.kind === 'gone' && <p className="editor-msg">This card is no longer there</p>}
        {card !== null && (
          <CardPane
            card={card}
            path={path}
            vault={vault}
            editing={editing}
            onEditDone={editDone}
            titleReadOnly={card.cardFile === true}
            doors={{ openLayer: onOpenLink, openTab: onOpenTab, onNotice }}
            onOpenPage={onOpenLink}
            strip={<CardStrip card={card} pageName={pageName} vault={vault} onOpenPage={() => onOpenPage({ id: card.id, index: card.index })} />}
            reviews={review?.settings}
            onDeleteReview={writes.deleteReview}
          />
        )}
      </div>
    </>
  )
}

/**
 * The strip under the card (D13, idea 11; YAZ-5032): the page, then what review knows as one calm line of words
 * (`CardFacts`: the last answer, the next review and how far it is, the recall chance with its (i)). A card with
 * no review is "New"; an archived card (the line's `off`, YAZ-5046) says "Archived".
 */
function CardStrip({ card, pageName, vault, onOpenPage }: { card: CardAtPage; pageName: string; vault: ExploreVault; onOpenPage: () => void }) {
  const settings = vault.review?.settings
  const isNew = settings !== undefined && cardState(card.reviews, settings).isNew
  return (
    <div className="card-strip">
      <button type="button" className="card-strip__page" onMouseDown={keepFocus} onClick={onOpenPage}>
        {pageName}
      </button>
      {card.off && <span className="card-strip__fact">Archived</span>}
      {isNew && <span className="card-strip__fact">New</span>}
      {settings !== undefined && !isNew && <CardFacts reviews={card.reviews} settings={settings} />}
    </div>
  )
}
