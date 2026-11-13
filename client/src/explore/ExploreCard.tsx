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
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { cardState } from '@shared/cardSchedule'
import { cardTitle } from '@shared/cardText'
import type { GestureAction } from '@shared/keys'
import { cardBlock, EMPTY_CARD_LINE, withCardNext, withCardNoTitle, withCardOff, withoutCardReviews, type CardReview } from '@shared/cardLine'
import { cardBacklinks } from '@shared/cardLinks'
import type { IndexRecord } from '@shared/types'
import { useIndexFeed } from '../editor/wikilink/useIndexFeed'
import { cardResolverOf } from '../editor/wikilink/wikilinkPlugin'
import { pageLabel, pathTitles } from '../lib/pageLabel'
import { editorViewCtx } from '@milkdown/kit/core'
import { changeCardLine, changeCardTextIn, readCardAt, type CardAtPage } from '../review/cardFile'
import { createCrepe } from '../editor/createCrepe'
import { CrepeFeature } from '../editor/crepe'
import { features } from '../editor/featureConfig'
import { isNoteCardNode } from '../editor/noteCard/noteCardLine'
import { noteCardViewAt } from '../editor/noteCard/noteCardView'
import { HoverTip } from '../components/HoverTip'
import { NoteCardBody, NoteCardFacts, NoteCardId, NoteCardNextChip, NoteCardReviews } from '../review/noteCardParts'
import { copyText } from '../editor/linkMenu'
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
  const editDone = (text: string) => {
    if (card === null) return
    const after = () => setEditing(false)
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
            ...(card === null || card.id === null
              ? []
              : [
                  [
                    { id: 'next', label: card.next ? 'Remove from top of Inbox' : 'Put at top of Inbox', onSelect: () => changeLine((l) => withCardNext(l, !card.next)) },
                    { id: 'review-off', label: card.off ? 'Turn review on' : 'Turn review off', onSelect: () => changeLine((l) => withCardOff(l, !card.off)) },
                    // ONE toggle row (YAZ-5030): the hint is the state now; a click turns it to the other.
                    { id: 'title-front', label: 'Title on the front', hint: card.notitle === true ? 'Hide' : 'Show', onSelect: () => changeLine((l) => withCardNoTitle(l, card.notitle !== true)) },
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
            {card.id !== null && <NoteCardBacklinks id={card.id} vault={vault} onOpen={onOpenLink} />}
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
 * "Linked mentions (n)" of a card (YAZ-5030): the pages whose links name the card's ID, from the index (`cardBacklinks`),
 * live with it; each row is the page's name, and a click opens the page on top. Open while there are any.
 */
function NoteCardBacklinks({ id, vault, onOpen }: { id: string; vault: ExploreVault; onOpen: (path: string) => void }) {
  const { wikilinks } = vault
  const feed = useIndexFeed(wikilinks)
  const pages = useMemo((): IndexRecord[] => {
    const resolve = feed.resolve === null ? null : cardResolverOf(wikilinks)
    return resolve === null ? [] : cardBacklinks(feed.records, id, resolve)
  }, [feed, id, wikilinks])
  const titles = pathTitles(feed.records, feed.folders)
  const [open, setOpen] = useState<boolean | null>(null)
  const shown = open ?? pages.length > 0
  return (
    <section className="note-card-backlinks">
      <button type="button" className="backlinks__header" aria-expanded={shown} onClick={() => setOpen(!shown)} onMouseDown={(e) => e.preventDefault()}>
        <svg className="backlinks__chevron" width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m4 6 4 4 4-4" />
        </svg>
        <span className="backlinks__title">
          Linked mentions <span className="backlinks__count">({pages.length})</span>
        </span>
      </button>
      {shown && (
        <ul className="note-card-backlinks__list">
          {pages.length === 0 ? (
            <li className="note-card-backlinks__none">No page links to this card yet.</li>
          ) : (
            pages.map((page) => (
              <li key={page.path}>
                <button type="button" className="note-card-strip__page note-card-backlinks__page" onMouseDown={keepFocus} onClick={() => onOpen(page.path)}>
                  {pageLabel(page.path, false, titles)}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </section>
  )
}

/**
 * The strip under the card (D13, idea 11; YAZ-5032): the page, then what review knows as one calm line of words
 * (`NoteCardFacts`: the last answer, the next review and how far it is, the recall chance with its (i)). A card with
 * no review is "New"; a card with review off says so.
 */
function NoteCardStrip({ card, pageName, vault, onOpenPage }: { card: CardAtPage; pageName: string; vault: ExploreVault; onOpenPage: () => void }) {
  const settings = vault.review?.settings
  const isNew = settings !== undefined && cardState(card.reviews, settings).isNew
  return (
    <div className="note-card-strip">
      <button type="button" className="note-card-strip__page" onMouseDown={keepFocus} onClick={onOpenPage}>
        {pageName}
      </button>
      {card.off && <span className="note-card-strip__fact">Review off</span>}
      {isNew && <span className="note-card-strip__fact">New</span>}
      {settings !== undefined && !isNew && <NoteCardFacts reviews={card.reviews} settings={settings} />}
    </div>
  )
}
