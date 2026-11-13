/**
 * ONE card's body, as the card window (`explore/ExploreCard.tsx`, YAZ-4962) and a card file's tab
 * (`editor/CardFileView.tsx`, YAZ-5037) both show it: the card, everything shown — or, in Edit card, the card editor
 * (YAZ-5003, YAZ-5026) —, its Reviews (the history), "Linked mentions (n)" and, in the tab, "Embedded in (n)". Also
 * the writes both make (Done, a ⋯ change of the card line, a review's delete: each ONE `transformFile` on the newest
 * bytes, by the card's ID), the ⋯ rows of the card, E, and the read again on each new index version of the file.
 * The heads are each one's own: the window's speaks of the page the card is on, the tab IS the card's file.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { editorViewCtx } from '@milkdown/kit/core'
import { cardBlock, EMPTY_CARD_LINE, withCardNext, withCardNoTitle, withCardOff, withoutCardReviews, type CardReview } from '@shared/cardLine'
import { cardBacklinks, cardEmbedders } from '@shared/cardLinks'
import type { ReviewSettings } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import { createCrepe } from '../editor/createCrepe'
import { CrepeFeature } from '../editor/crepe'
import { features } from '../editor/featureConfig'
import { copyText } from '../editor/linkMenu'
import { isNoteCardNode } from '../editor/noteCard/noteCardLine'
import { noteCardViewAt } from '../editor/noteCard/noteCardView'
import { useIndexFeed } from '../editor/wikilink/useIndexFeed'
import { cardResolverOf, type WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import type { ExploreVault } from '../explore/ExploreNote'
import { pageLabel, pathTitles } from '../lib/pageLabel'
import type { MenuSection } from '../sidebar/menuSections'
import { changeCardLine, changeCardTextIn, type CardAtPage } from './cardFile'
import { NoteCardBody, NoteCardReviews, type NoteCardLinkDoors } from './noteCardParts'

/**
 * Runs `run` on each new version of `path` in the index (its mtime): an answer in the Inbox, an agent's write or a
 * delete elsewhere shows at once. The version the index holds now is the one already read. Returns the unsubscribe.
 */
export function onIndexVersion(wikilinks: WikilinkResolveSource, path: string, run: () => void): () => void {
  let seen = wikilinks.records.find((r) => r.path === path)?.mtime
  return wikilinks.subscribe(() => {
    const mtime = wikilinks.records.find((r) => r.path === path)?.mtime
    if (mtime === seen) return
    seen = mtime
    run()
  })
}

/** E, Edit card's key (YAZ-5003): no modifier, and not typed into a field. */
export const isCardEditKey = (event: ReactKeyboardEvent): boolean =>
  !event.metaKey && !event.ctrlKey && !event.altKey && (event.key === 'e' || event.key === 'E') && !(event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]') !== null)

/** A ⋯ change of the card line (D13): `changeCardLine`'s change. */
export type CardLineChange = Parameters<typeof changeCardLine>[2]

/**
 * The writes of a shown card, each the app's own ONE `transformFile` by the card's ID on the newest bytes, then the
 * card read again (`read`). Done with the text it started from writes nothing. A failure is a notice.
 */
export function cardWrites(path: string, card: CardAtPage | null, read: () => void, onNotice: (message: string) => void, review?: ExploreVault['review']) {
  const failed = (what: string) => (err: unknown) => onNotice(`Can't ${what}: ${err instanceof Error ? err.message : String(err)}`)
  return {
    /** Edit card's Done (YAZ-5003): the card's text by its ID, the rest of the file as it is on disk now. */
    editDone(text: string, after: () => void) {
      if (card === null) return
      if (text.replace(/\n+$/, '') === card.text) return after()
      changeCardTextIn(path, card.id, text, card.index).then(() => {
        read()
        after()
      }, failed('save the card'))
    },
    changeLine(change: CardLineChange) {
      if (card === null || card.id === null) return
      changeCardLine(path, card.id, change, card.index).then(() => read(), failed('change the card'))
    },
    /** The Reviews table's delete (with Undo in its notice); none for a card with no ID yet. */
    deleteReview:
      review === undefined || card === null || card.id === null
        ? undefined
        : (gone: CardReview) => {
            const id = card.id
            if (id !== null) void review.deleteReview(path, id, gone).then(() => read())
          },
  }
}

/**
 * The card's own ⋯ rows (D13): Put at top of Inbox (with `inbox`: the vault reviews), Archive, Title on the front,
 * Reset history; then Copy card ID and, with `link`, Copy card link (`[[ID]]`, YAZ-5037). None of them for a card with
 * no ID yet, but its copy rows once it has one.
 */
export function cardMenuSections(card: CardAtPage | null, id: string | null, changeLine: (change: CardLineChange) => void, onNotice: (message: string) => void, opts: { inbox: boolean; link: boolean }): MenuSection[] {
  const rows: MenuSection[] = []
  if (card !== null && card.id !== null)
    rows.push([
      ...(opts.inbox ? [{ id: 'next', label: card.next ? 'Remove from top of Inbox' : 'Put at top of Inbox', onSelect: () => changeLine((l) => withCardNext(l, !card.next)) }] : []),
      { id: 'review-off', label: card.off ? 'Unarchive card' : 'Archive card', onSelect: () => changeLine((l) => withCardOff(l, !card.off)) },
      // ONE toggle row (YAZ-5030): the hint is the state now; a click turns it to the other.
      { id: 'title-front', label: 'Title on the front', hint: card.notitle === true ? 'Hide' : 'Show', onSelect: () => changeLine((l) => withCardNoTitle(l, card.notitle !== true)) },
      ...(card.reviews.length === 0 ? [] : [{ id: 'reset', label: 'Reset history', danger: true, onSelect: () => changeLine(withoutCardReviews) }]),
    ])
  if (id !== null)
    rows.push([
      { id: 'copy-id', label: 'Copy card ID', hint: id, onSelect: () => copyText(id, 'card ID', onNotice, undefined, true) },
      ...(opts.link ? [{ id: 'copy-link', label: 'Copy card link', hint: `[[${id}]]`, onSelect: () => copyText(`[[${id}]]`, 'card link', onNotice, undefined, true) }] : []),
    ])
  return rows
}

interface CardPaneProps {
  card: CardAtPage
  /** The file the card is in: its images and links resolve against it. */
  path: string
  vault: ExploreVault
  editing: boolean
  /** Edit card's Done, with the card's text. */
  onEditDone: (text: string) => void
  /** What Edit card selects as it opens (offsets in the card's text): a new card's "Title" (YAZ-5037). Absent: the caret at the end. */
  select?: { from: number; to: number }
  doors: NoteCardLinkDoors
  /** A page in "Linked mentions" or "Embedded in". */
  onOpenPage: (path: string) => void
  /** Under the card: the card window's strip. */
  strip?: ReactNode
  /** The Reviews section's settings; absent: no Reviews. */
  reviews?: ReviewSettings
  onDeleteReview?: (review: CardReview) => void
  /** "Embedded in (n)" after the mentions (a card file's tab). */
  embeds?: boolean
}

/** The card's body: the card or its editor, the strip, its Reviews, "Linked mentions" and, in a tab, "Embedded in". */
export function CardPane({ card, path, vault, editing, onEditDone, select, doors, onOpenPage, strip, reviews, onDeleteReview, embeds = false }: CardPaneProps) {
  return (
    <>
      {editing ? (
        <NoteCardEditor key={`${card.index}`} text={card.text} path={path} vault={vault} onDone={onEditDone} select={select} />
      ) : (
        <div className="note-card note-card-screen">
          <NoteCardBody text={card.text} path={path} vault={vault} doors={doors} />
        </div>
      )}
      {strip}
      {reviews !== undefined && <NoteCardReviews reviews={card.reviews} settings={reviews} onDelete={onDeleteReview} />}
      {card.id !== null && <NoteCardPages which="links" id={card.id} wikilinks={vault.wikilinks} onOpen={onOpenPage} />}
      {embeds && card.id !== null && <NoteCardPages which="embeds" id={card.id} wikilinks={vault.wikilinks} onOpen={onOpenPage} />}
    </>
  )
}

/** The page card's editor without the editing of blocks around it: the card block is all the document holds. */
const CARD_EDIT_FEATURES = { ...features, [CrepeFeature.BlockEdit]: false, [CrepeFeature.Toolbar]: false }

/**
 * Edit card (YAZ-5003): the page card's own view, in a small Crepe of the card block alone, with Edit card on at
 * once — the card editor (YAZ-5026) or Crepe's code block, its Done (button, Esc, ⌘↵). Done hands the text over.
 * Made once per edit: the text it starts from is the card's when Edit card began, and a read again under it (an
 * outside write) does not touch it.
 */
function NoteCardEditor({ text, path, vault, onDone, select }: { text: string; path: string; vault: ExploreVault; onDone: (text: string) => void; select?: { from: number; to: number } }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  const start = useRef({ text, path, vault, select })
  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const { text, path, vault, select } = start.current
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
      if (pos >= 0) noteCardViewAt(view, pos)?.edit(select)
    })
    return () => {
      live = false
      void crepe.destroy()
      el.remove()
    }
  }, [])
  return <div ref={hostRef} className="explore-card__edit" data-explore-card-edit />
}

const PAGES = {
  links: { label: 'Linked mentions', none: 'No page links to this card yet.', of: cardBacklinks, className: 'note-card-backlinks' },
  embeds: { label: 'Embedded in', none: 'No page embeds this card yet.', of: cardEmbedders, className: 'note-card-backlinks card-file__embeds' },
} as const

/**
 * "Linked mentions (n)" of a card (YAZ-5030): the pages whose links name the card's ID (`cardBacklinks`); "Embedded in
 * (n)" (YAZ-5037): the pages whose `![[…]]` names it (`cardEmbedders`). From the index, live with it; each row is the
 * page's name, and a click opens it. Open while there are any.
 */
function NoteCardPages({ which, id, wikilinks, onOpen }: { which: keyof typeof PAGES; id: string; wikilinks: WikilinkResolveSource; onOpen: (path: string) => void }) {
  const { label, none, of, className } = PAGES[which]
  const feed = useIndexFeed(wikilinks)
  const pages = useMemo((): IndexRecord[] => {
    const resolve = feed.resolve === null ? null : cardResolverOf(wikilinks)
    return resolve === null ? [] : of(feed.records, id, resolve)
  }, [feed, id, wikilinks, of])
  const titles = pathTitles(feed.records, feed.folders)
  const [open, setOpen] = useState<boolean | null>(null)
  const shown = open ?? pages.length > 0
  return (
    <section className={className}>
      <button type="button" className="backlinks__header" aria-expanded={shown} onClick={() => setOpen(!shown)} onMouseDown={(e) => e.preventDefault()}>
        <svg className="backlinks__chevron" width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m4 6 4 4 4-4" />
        </svg>
        <span className="backlinks__title">
          {label} <span className="backlinks__count">({pages.length})</span>
        </span>
      </button>
      {shown && (
        <ul className="note-card-backlinks__list">
          {pages.length === 0 ? (
            <li className="note-card-backlinks__none">{none}</li>
          ) : (
            pages.map((page) => (
              <li key={page.path}>
                <button type="button" className="note-card-strip__page note-card-backlinks__page" onMouseDown={(e) => e.preventDefault()} onClick={() => onOpen(page.path)}>
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
