/**
 * A card layer of the explore stack (YAZ-4962, D13): ONE note card of a page, read-only, with what review knows of it.
 *
 *  - Head: the card ID first, small and grey (a click copies it, D20) — its place in the page's card and the Inbox
 *    too —, then the card title (`cardTitle`, the layer's name, as every layer has one; "New note card" for an empty
 *    card), ↗, ⋯ and ×; the chip "Up next ×" after the ID while the card is at the top of the Inbox (YAZ-4999 D3). The
 *    ⋯ menu: Open page, Open page in a new tab, Put at top of Inbox / Remove from top of Inbox, Turn review off / on,
 *    Reset history (D13, the card line through `changeCardLine`, the app's own write), Copy card ID.
 *  - The card, everything shown (`renderNoteCard`), its pills and links live: a click opens the page on top, a bound
 *    gesture (⌘-click) a tab.
 *  - The strip: the page's name (a click opens the page on top, landed on the card), then each fact with a quiet label:
 *    Last answer, Interval, Due, Recall ("83%", idea 11). A card with no review says "New", with no label.
 *  - "Reviews (n)": the full table, closed until asked for (the strip says the state; D13 "a footer lets the table
 *    expand"), a delete on each row (`deleteReview`, with Undo in its notice).
 *
 * EDIT CARD (YAZ-5003): E on the card window (or the Inbox's E, which opens it so) shows the page card's own editor:
 * a small Crepe that holds the card block alone, with the card view's Edit card on (`noteCardView.ts`: Crepe's code
 * block, the card language). Done, Esc or ⌘↵ there writes the text into the page (`changeCardTextIn`, the app's own
 * write) and goes back to reading; opened in Edit card (from the Inbox), the layer closes: back to the Inbox at the
 * same card and step. A read-only vault blocks Edit card, as the page does: E does nothing.
 *
 * The card is read from its page (`readCardAt`: by ID, or by its place while it has none) and read again whenever the
 * index has a new version of the page: an answer in the Inbox or a delete elsewhere shows here at once.
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { answerLabel, cardState, recallChance } from '@shared/cardSchedule'
import { cardTitle } from '@shared/cardText'
import type { GestureAction } from '@shared/keys'
import { cardBlock, EMPTY_CARD_LINE, withCardNext, withCardOff, withoutCardReviews, type CardReview } from '@shared/cardLine'
import { editorViewCtx } from '@milkdown/kit/core'
import { changeCardLine, changeCardTextIn, readCardAt, type CardAtPage } from '../review/cardFile'
import { createCrepe } from '../editor/createCrepe'
import { CrepeFeature } from '../editor/crepe'
import { features } from '../editor/featureConfig'
import { isNoteCardNode } from '../editor/noteCard/noteCardLine'
import { noteCardViewAt } from '../editor/noteCard/noteCardView'
import { HoverTip } from '../components/HoverTip'
import { NoteCardBody, NoteCardId, NoteCardNextChip, NoteCardReviews, noteCardDate, noteCardDue, noteCardOverdue, noteCardWait } from '../review/noteCardParts'
import { copyText } from '../editor/linkMenu'
import { HeadMore, useCompactHead } from './ExploreHeadMore'
import { keepFocus, type ExploreVault } from './ExploreNote'

interface ExploreCardProps {
  path: string
  cardId: string | null
  index: number
  /** Opened in Edit card (the Inbox's E, YAZ-5003): Done saves and closes the layer. */
  startInEdit?: boolean
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

export function ExploreCard({ path, cardId, index, startInEdit = false, pageName, vault, onOpenPage, onOpenLink, onOpenTab, onOpenInTab, onNotice, onHeadDown, onHeadReset, onClose, active }: ExploreCardProps) {
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
  // Edit card (YAZ-5003): blocked in a read-only vault, as in the page.
  const [editing, setEditing] = useState(startInEdit && !vault.readOnly)
  const editDone = (text: string) => {
    if (card === null) return
    const after = () => {
      if (startInEdit) return onClose()
      setEditing(false)
      bodyRef.current?.focus({ preventScroll: true })
    }
    if (text.replace(/\n+$/, '') === card.text) return after()
    changeCardTextIn(path, card.id, text, card.index).then(
      () => {
        read()
        after()
      },
      (err: unknown) => onNotice(`Can't save the card: ${err instanceof Error ? err.message : String(err)}`),
    )
  }
  /** E on the card window: Edit card (YAZ-5003), as the page's Edit card. Not in a field, not read only. */
  const onBodyKey = (event: React.KeyboardEvent) => {
    if (editing || card === null || vault.readOnly === true || event.metaKey || event.ctrlKey || event.altKey || (event.key !== 'e' && event.key !== 'E')) return
    if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]') !== null) return
    event.preventDefault()
    event.stopPropagation()
    setEditing(true)
  }
  const id = card?.id ?? cardId
  const title = card === null ? '' : cardTitle(card.text)
  const deleteReview =
    review === undefined || card === null || card.id === null
      ? undefined
      : (gone: CardReview) => {
          const cardIdNow = card.id
          if (cardIdNow !== null) void review.deleteReview(path, cardIdNow, gone).then(() => read())
        }
  /** A ⋯ change of the card line (D13): a write of the file as the app's own, then the card read again. */
  const changeLine = (change: Parameters<typeof changeCardLine>[2]) => {
    if (card === null || card.id === null) return
    changeCardLine(path, card.id, change, card.index).then(
      () => read(),
      (err: unknown) => onNotice(`Can't change the card: ${err instanceof Error ? err.message : String(err)}`),
    )
  }

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
        {/* ↗ folds into ⋯ in a narrow layer (YAZ-4986); the card ID, the title and × stay. */}
        <span className="explore__fold">
          <HoverTip text="Open page in a new tab (⌘↵)" data-fold-part="open">
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
              { id: 'open-tab', label: 'Open page in a new tab', hint: '⌘↵', onSelect: onOpenInTab },
            ],
            ...(card === null || card.id === null
              ? []
              : [
                  [
                    { id: 'next', label: card.next ? 'Remove from top of Inbox' : 'Put at top of Inbox', onSelect: () => changeLine((l) => withCardNext(l, !card.next)) },
                    { id: 'review-off', label: card.off ? 'Turn review on' : 'Turn review off', onSelect: () => changeLine((l) => withCardOff(l, !card.off)) },
                    ...(card.reviews.length === 0 ? [] : [{ id: 'reset', label: 'Reset history', danger: true, onSelect: () => changeLine(withoutCardReviews) }]),
                  ],
                ]),
            ...(id === null ? [] : [[{ id: 'copy-id', label: 'Copy card ID', hint: id, onSelect: () => copyText(id, 'card ID', onNotice, undefined, true) }]]),
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
          <>
            {editing ? (
              <NoteCardEditor key={`${card.index}`} text={card.text} path={path} vault={vault} onDone={editDone} />
            ) : (
              <div className="note-card note-card-screen">
                <NoteCardBody text={card.text} path={path} vault={vault} doors={{ openLayer: onOpenLink, openTab: onOpenTab, onNotice }} />
              </div>
            )}
            <NoteCardStrip card={card} pageName={pageName} vault={vault} onOpenPage={() => onOpenPage(card.index)} />
            {review !== undefined && <NoteCardReviews reviews={card.reviews} settings={review.settings} onDelete={deleteReview} />}
          </>
        )}
      </div>
    </>
  )
}

/** The page card's editor without the editing of blocks around it: the card block is all the document holds. */
const CARD_EDIT_FEATURES = { ...features, [CrepeFeature.BlockEdit]: false, [CrepeFeature.Toolbar]: false }

/**
 * Edit card in the card window (YAZ-5003): the page card's own view, in a small Crepe of the card block alone, with
 * Edit card on at once — Crepe's code block, the card language, its Done (button, Esc, ⌘↵). Done hands the text over.
 * Made once per edit: the text it starts from is the card's when Edit card began.
 */
function NoteCardEditor({ text, path, vault, onDone }: { text: string; path: string; vault: ExploreVault; onDone: (text: string) => void }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  const start = useRef({ text, path, vault })
  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const { text, path, vault } = start.current
    const el = document.createElement('div')
    el.className = 'editor-instance'
    host.appendChild(el)
    const crepe = createCrepe({
      root: el,
      defaultValue: `${cardBlock(text, EMPTY_CARD_LINE)}\n`,
      features: CARD_EDIT_FEATURES,
      wikilinks: vault.wikilinks,
      viewOnlyLinks: vault.viewOnlyLinks,
      image: { root: vault.root, notePath: path },
      noteCards: { path, onEditDone: (t) => doneRef.current(t) },
    })
    let live = true
    void crepe.create().then(() => {
      if (!live) return
      const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
      let pos = -1
      view.state.doc.descendants((node, at) => {
        if (pos === -1 && isNoteCardNode(node)) pos = at
        return pos === -1
      })
      if (pos >= 0) noteCardViewAt(view, pos)?.edit()
    })
    return () => {
      live = false
      void crepe.destroy()
      el.remove()
    }
  }, [])
  return <div ref={hostRef} className="explore-card__edit" data-explore-card-edit />
}

/**
 * The strip under the card (D13, idea 11): the page, then what review knows, each said once with a quiet label in the
 * reader's words. A card with no review is "New"; a card with review off says so.
 */
function NoteCardStrip({ card, pageName, vault, onOpenPage }: { card: CardAtPage; pageName: string; vault: ExploreVault; onOpenPage: () => void }) {
  const settings = vault.review?.settings
  const facts: { key: string; label?: string; text: string }[] = []
  if (card.off) facts.push({ key: 'off', text: 'Review off' })
  if (settings !== undefined) {
    const state = cardState(card.reviews, settings)
    const last = state.lastReview === null ? null : card.reviews.filter((r) => r.at === state.lastReview).at(-1)
    if (state.isNew || last == null) facts.push({ key: 'new', text: 'New' })
    else {
      const now = Date.now()
      const chance = recallChance(card.reviews, settings, now)
      facts.push({ key: 'last', label: 'Last answer', text: `${answerLabel(last.rating, settings)}, ${noteCardDate(Date.parse(last.at), now)}` })
      facts.push({ key: 'wait', label: 'Interval', text: noteCardWait(state.interval) })
      // The table's words (YAZ-4964 look by eye round 2, item 7): "Overdue · Oct 17" says it alone; else "Due" and the date.
      if (state.due !== null) facts.push(noteCardOverdue(state.due, now) ? { key: 'due', text: noteCardDue(state.due, now) } : { key: 'due', label: 'Due', text: noteCardDate(state.due, now) })
      if (chance !== null) facts.push({ key: 'recall', label: 'Recall', text: `${Math.round(chance * 100)}%` })
    }
  }
  return (
    <div className="note-card-strip">
      <button type="button" className="note-card-strip__page" onMouseDown={keepFocus} onClick={onOpenPage}>
        {pageName}
      </button>
      {facts.map((f) => (
        <span key={f.key} className="note-card-strip__fact">
          {f.label !== undefined && <span className="note-card-strip__label">{f.label}</span>}
          {f.text}
        </span>
      ))}
    </div>
  )
}
