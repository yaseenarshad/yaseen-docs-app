/**
 * A card layer of the explore stack (YAZ-4962, D13): ONE note card of a page, read-only, with what review knows of it.
 *
 *  - Head: the card ID first, small and grey (a click copies it, D20) — its place in the page's card and the Inbox
 *    too —, then the card title (`cardTitle`, the layer's name, as every layer has one; "New note card" for an empty
 *    card), ↗, ⋯ and ×; the chip "Up next ×" after the ID while the card is at the top of the Inbox (YAZ-4999 D3). The
 *    ⋯ menu: Open page, Open page in a new tab, Put at top of Inbox / Remove from top of Inbox, Archive card / Unarchive card (YAZ-5046),
 *    Reset history (D13, the card line through `changeCardLine`, the app's own write), Copy card ID.
 *  - The card, everything shown (`renderNoteCard`), its pills and links live: a click opens the page on top, a bound
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
 * EDIT CARD (YAZ-5003): E on the card window (or the Inbox's E, which opens it so) shows the page card's own editor:
 * a small Crepe that holds the card block alone, with the card view's Edit card on (`noteCardView.ts`: Crepe's code
 * block, the card language). Done, Esc or ⌘↵ there writes the text into the page (`changeCardTextIn`, the app's own
 * write) and goes back to reading. A read-only vault blocks E here, as the page does.
 *
 * FROM THE INBOX (YAZ-5009, Yaseen: "e should go directly into edit mode ... then esc and or CMD enter should go back
 * to read only mode and then another CMD enter would take u back to inbox"): the Inbox's E opens the window in Edit
 * card at once, also in a read-only vault, with no "Allow edits?" box. The exception is this card's own write, for
 * this one edit: not the vault's timed allowance, and the rest of the vault stays locked. Done, Esc or ⌘↵ save and go
 * back to reading, locked again; then ⌘↵ (the stack) or Esc goes back to the Inbox at the same card and step.
 *
 * The card is read from its page (`readCardAt`: by ID, or by its place while it has none) and read again whenever the
 * index has a new version of the page: an answer in the Inbox or a delete elsewhere shows here at once.
 *
 * The body (the card or its editor, Reviews, "Linked mentions"), the writes and the card's ⋯ rows are the card
 * file tab's too (`review/cardPane.tsx`, YAZ-5037); the head and the strip speak of the page, and are the window's own.
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { cardState } from '@shared/cardSchedule'
import { cardTitle } from '@shared/cardText'
import type { GestureAction } from '@shared/keys'
import { withCardNext } from '@shared/cardLine'
import { readCardAt, type CardAtPage } from '../review/cardFile'
import { CardPane, cardMenuSections, cardWrites, isCardEditKey, onIndexVersion } from '../review/cardPane'
import { HoverTip } from '../components/HoverTip'
import { NoteCardFacts, NoteCardId, NoteCardNextChip } from '../review/noteCardParts'
import { HeadMore, useCompactHead } from './ExploreHeadMore'
import { keepFocus, type ExploreVault } from './ExploreNote'

interface ExploreCardProps {
  path: string
  cardId: string | null
  index: number
  /** Opened in Edit card (the Inbox's E, YAZ-5003): also in a read-only vault, for this one edit (YAZ-5009). Done reads. */
  startInEdit?: boolean
  /** Opened from the Inbox (YAZ-5009): ⌘↵ while reading goes back to the Inbox, so ↗ does not say ⌘↵. */
  fromInbox?: boolean
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

export function ExploreCard({ path, cardId, index, startInEdit = false, fromInbox = false, pageName, vault, onOpenPage, onOpenLink, onOpenTab, onOpenInTab, onNotice, onHeadDown, onHeadReset, onClose, active }: ExploreCardProps) {
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
  // Edit card (YAZ-5003): E blocks it in a read-only vault, as in the page. The Inbox's E opens it in any vault
  // (YAZ-5009): only this edit of this card; once it ends, the card reads, locked again.
  const [editing, setEditing] = useState(startInEdit)
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
  const editDone = (text: string) => writes.editDone(text, () => setEditing(false))
  /** E on the card window: Edit card (YAZ-5003), as the page's Edit card. Not in a field, not read only. */
  const onBodyKey = (event: React.KeyboardEvent) => {
    if (editing || card === null || vault.readOnly === true || !isCardEditKey(event)) return
    event.preventDefault()
    event.stopPropagation()
    setEditing(true)
  }
  const id = card?.id ?? cardId
  const title = card === null ? '' : cardTitle(card.text)

  return (
    <>
      <div
        ref={headRef}
        className="explore__head"
        onMouseDown={onHeadDown}
        onDoubleClick={onHeadReset}
      >
        {id !== null && <NoteCardId id={id} onNotice={onNotice} />}
        {card?.next === true && <NoteCardNextChip onRemove={card.id === null ? undefined : () => changeLine((l) => withCardNext(l, false))} />}
        <span ref={titleRef} className={`explore__title${title === '' ? ' note-card__title--empty' : ''}`}>
          {loaded.kind === 'loading' ? '' : title === '' ? 'New note card' : title}
        </span>
        {card?.notitle === true && <span className="note-card__state note-card__notitle">Hidden in review</span>}
        {/* ↗ folds into ⋯ in a narrow layer (YAZ-4986); the card ID, the title and × stay. */}
        <span className="explore__fold">
          <HoverTip text={fromInbox ? 'Open page in a new tab' : 'Open page in a new tab (⌘↵)'} data-fold-part="open">
            <button type="button" className="explore__button" onMouseDown={keepFocus} onClick={onOpenInTab} aria-label="Open page in a new tab">
              ↗
            </button>
          </HoverTip>
        </span>
        {/* ⋯ at every width (YAZ-4964 round 2, item 1): its rows are the card's own (D13), not only a narrow head's. */}
        <HeadMore
          always
          sections={() => [
            [
              { id: 'open-page', label: 'Open page', onSelect: () => onOpenPage(card?.index ?? index) },
              { id: 'open-tab', label: 'Open page in a new tab', ...(!fromInbox && { hint: '⌘↵' }), onSelect: onOpenInTab },
            ],
            ...cardMenuSections(card, id, changeLine, onNotice, { inbox: true, link: false }),
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
            doors={{ openLayer: onOpenLink, openTab: onOpenTab, onNotice }}
            onOpenPage={onOpenLink}
            strip={<NoteCardStrip card={card} pageName={pageName} vault={vault} onOpenPage={() => onOpenPage(card.index)} />}
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
 * (`NoteCardFacts`: the last answer, the next review and how far it is, the recall chance with its (i)). A card with
 * no review is "New"; an archived card (the line's `off`, YAZ-5046) says "Archived".
 */
function NoteCardStrip({ card, pageName, vault, onOpenPage }: { card: CardAtPage; pageName: string; vault: ExploreVault; onOpenPage: () => void }) {
  const settings = vault.review?.settings
  const isNew = settings !== undefined && cardState(card.reviews, settings).isNew
  return (
    <div className="note-card-strip">
      <button type="button" className="note-card-strip__page" onMouseDown={keepFocus} onClick={onOpenPage}>
        {pageName}
      </button>
      {card.off && <span className="note-card-strip__fact">Archived</span>}
      {isNew && <span className="note-card-strip__fact">New</span>}
      {settings !== undefined && !isNew && <NoteCardFacts reviews={card.reviews} settings={settings} />}
    </div>
  )
}
