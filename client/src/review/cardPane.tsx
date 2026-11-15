/**
 * ONE card's body, as the card window (`explore/ExploreCard.tsx`, YAZ-4962) and a card file's tab
 * (`editor/CardFileView.tsx`, YAZ-5037) both show it: the card, everything shown — or, in Edit card, the card editor
 * (YAZ-5003, YAZ-5026) —, its strip (YAZ-5380, YAZ-5382: Reviews, Properties, Linked mentions and, in the tab, Embedded in). Also
 * the writes both make (Done, a ⋯ change of the card line, a review's delete: each ONE `transformFile` on the newest
 * bytes, by the card's ID), the ⋯ rows of the card, E, and the read again on each new index version of the file.
 * The heads are each one's own: the window's speaks of the page the card is on, the tab IS the card's file.
 */
import { previewCard } from '../editor/card/cardOpen'
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { editorViewCtx } from '@milkdown/kit/core'
import { cardBlock, EMPTY_CARD_LINE, withCardFix, withCardNext, withCardNoTitle, withCardOff, withCardTitle, withoutCardReviews, type CardReview } from '@shared/cardLine'
import { cardBacklinks, cardEmbedders } from '@shared/cardLinks'
import type { ReviewSettings } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import { createCrepe } from '../editor/createCrepe'
import { CrepeFeature } from '../editor/crepe'
import { features } from '../editor/featureConfig'
import { copyText } from '../editor/linkMenu'
import { isCardNode } from '../editor/card/cardBlockLine'
import { cardBlockViewAt, cardBlockViewOfDom } from '../editor/card/cardBlockView'
import type { CardTitleField } from '../editor/card/cardEditor'
import { freezeScroll, readSwapPlace, scrollerOf, showSwapPlace, type SwapPlace } from '../editor/pagePlace'
import { useIndexFeed } from '../editor/wikilink/useIndexFeed'
import { cardResolverOf, type WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import type { ExploreVault } from '../explore/ExplorePage'
import { pageLabel, pathTitles } from '../lib/pageLabel'
import type { MenuSection } from '../sidebar/menuSections'
import { askResetHistory } from '../editor/card/askResetHistory'
import { fileIconDecoration, IconsContext } from '../sidebar/FileIcon'
import { changeCardLine, changeCardTextIn, type CardAtPage } from './cardFile'
import { CardBody, CardStrip, type CardLinkDoors, type CardStripPart } from './cardParts'

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

/** P on a shown card (YAZ-5152): Preview. Not in a field, no modifier. */
export const isCardPreviewKey = (event: ReactKeyboardEvent): boolean =>
  !event.metaKey && !event.ctrlKey && !event.altKey && (event.key === 'p' || event.key === 'P') && !(event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]') !== null)

/** Preview a shown card (YAZ-5152), from `from`, as the Inbox reads it. */
export function previewCardOf(from: Element | null, path: string, card: CardAtPage): void {
  if (from === null) return
  previewCard(from, { path, id: card.id, text: card.text, title: card.title, notitle: card.notitle === true, reviews: card.reviews, properties: card.properties })
}

/** A ⋯ change of the card line (D13): `changeCardLine`'s change. */
export type CardLineChange = Parameters<typeof changeCardLine>[2]

/**
 * The writes of a shown card, each the app's own ONE `transformFile` by the card's ID on the newest bytes, then the
 * card read again (`read`). Done with the text it started from writes nothing. A failure is a notice.
 */
export function cardWrites(path: string, card: CardAtPage | null, read: () => void, onNotice: (message: string) => void, review?: ExploreVault['review']) {
  const failed = (what: string) => (err: unknown) => onNotice(`Can't ${what}: ${err instanceof Error ? err.message : String(err)}`)
  return {
    /**
     * Edit card's Done (YAZ-5003): the card's text by its ID and, when given, its `title` on its card line (YAZ-5308), in
     * one write; the rest of the file as it is on disk now. `onFail` after the notice (a card file tab's "Save failed",
     * YAZ-5102). A changed card marked Fix later loses the mark in the same write (YAZ-5097: the edit is the fix; it
     * asks nothing). No change: the mark stays.
     */
    editDone(text: string, after: () => void, onFail?: () => void, title?: string) {
      if (card === null) return
      const retitled = title !== undefined && title !== card.title ? title : undefined
      if (text.replace(/\n+$/, '') === card.text && retitled === undefined) return after()
      changeCardTextIn(path, card.id, text, card.index, retitled, card.fix === true).then(
        () => {
          read()
          after()
        },
        (err: unknown) => {
          failed('save the card')(err)
          onFail?.()
        },
      )
    },
    /** One write of the card's line; resolves when it is done (a failure is a notice). The strip's Properties wait for it (YAZ-5383). */
    changeLine(change: CardLineChange): Promise<void> {
      if (card === null || card.id === null) return Promise.resolve()
      return changeCardLine(path, card.id, change, card.index).then(() => read(), failed('change the card'))
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
 * The card's own ⋯ rows (D13): Put at top of Inbox (with `inbox`: the vault reviews), Archive, Fix later (YAZ-5097),
 * Title on the front; then Copy card ID and, with `link`, Copy card link (`[[ID]]`, YAZ-5037); then the caller's `more`
 * (the card file tab's "Turn into a page"); and LAST, alone, Reset history (YAZ-5376), which asks by typing
 * (`askResetHistory`). None of them for a card with no ID yet, but its copy rows once it has one.
 */
export function cardMenuSections(card: CardAtPage | null, id: string | null, changeLine: (change: CardLineChange) => void, onNotice: (message: string) => void, opts: { inbox: boolean; link: boolean; preview?: () => void; more?: MenuSection[] }): MenuSection[] {
  const rows: MenuSection[] = []
  // Preview (YAZ-5152): the card as the Inbox shows it, nothing saved.
  if (card !== null && opts.preview !== undefined) rows.push([{ id: 'preview', label: 'Preview', hint: 'P', onSelect: opts.preview }])
  if (card !== null && card.id !== null)
    rows.push([
      ...(opts.inbox ? [{ id: 'next', label: card.next ? 'Remove from top of Inbox' : 'Put at top of Inbox', onSelect: () => changeLine((l) => withCardNext(l, !card.next)) }] : []),
      // Chapter 11's tour (YAZ-5330): Archive card, then Unarchive card on the same row once the card is archived.
      { id: 'review-off', label: card.off ? 'Unarchive card' : 'Archive card', tour: card.off ? 'card-menu-unarchive' : 'card-menu-archive', onSelect: () => changeLine((l) => withCardOff(l, !card.off)) },
      { id: 'fix', label: card.fix === true ? 'Remove Fix later' : 'Fix later', onSelect: () => changeLine((l) => withCardFix(l, card.fix !== true)) },
      // ONE toggle row (YAZ-5030): the hint is the state now; a click turns it to the other.
      { id: 'title-front', label: 'Title on the front', hint: card.notitle === true ? 'Hide' : 'Show', onSelect: () => changeLine((l) => withCardNoTitle(l, card.notitle !== true)) },
    ])
  if (id !== null)
    rows.push([
      { id: 'copy-id', label: 'Copy card ID', hint: id, onSelect: () => copyText(id, 'card ID', onNotice, undefined, true) },
      ...(opts.link ? [{ id: 'copy-link', label: 'Copy card link', hint: `[[${id}]]`, tour: 'card-copy-link', onSelect: () => copyText(`[[${id}]]`, 'card link', onNotice, undefined, true) }] : []),
    ])
  rows.push(...(opts.more ?? []))
  if (card !== null && card.id !== null && card.reviews.length > 0) rows.push([{ id: 'reset', label: 'Reset history', danger: true, onSelect: () => askResetHistory(card.id, () => changeLine(withoutCardReviews)) }])
  return rows
}

interface CardPaneProps {
  card: CardAtPage
  /** The file the card is in: its images and links resolve against it. */
  path: string
  vault: ExploreVault
  editing: boolean
  /** Edit card's Done, with the card's text and its Title field's title (YAZ-5164 part 3). */
  onEditDone: (text: string, title: string) => void
  /** What Edit card selects as it opens (offsets in the card's text): a new card's "Title" (YAZ-5037). Absent: the caret at the end. */
  select?: { from: number; to: number }
  doors: CardLinkDoors
  /** A page in the strip's "Linked mentions" or "Embedded in". */
  onOpenPage: (path: string) => void
  /** Under the card: the card window's strip. */
  strip?: ReactNode
  /** The Reviews section's settings; absent: no Reviews. */
  reviews?: ReviewSettings
  onDeleteReview?: (review: CardReview) => void
  /** The strip's "Embedded in" part after Linked mentions (a card file's tab). */
  embeds?: boolean
  /** Edit card's Title field (`CardTitleField`): absent → `edit`. */
  titleField?: CardTitleField
  /** Read, the card's title band at its top (YAZ-5308 A3, `CardBand`); absent: none (the card window). */
  band?: ReactNode
  /** Read, the card's top bar above the band (YAZ-5392: a card file's tab, as a card in a page has it); absent: none. */
  head?: ReactNode
  /** The card's line write (`cardWrites().changeLine`): the strip's Properties edit through it (YAZ-5383). Absent: they read only. */
  onChangeLine?: (change: CardLineChange) => Promise<void>
  onNotice?: (message: string) => void
  /** The strip's open part, held by the caller (YAZ-5383: the card file tab's properties button opens Properties); absent: the strip holds it. */
  stripOpen?: CardStripPart | null
  onStripToggle?: (part: CardStripPart) => void
}

/** The card's body: the card or its editor, its strip (Reviews, Properties, Linked mentions and, in a tab, Embedded in: YAZ-5382), then the facts strip. */
export function CardPane({ card, path, vault, editing, onEditDone, select, doors, onOpenPage, strip, reviews, onDeleteReview, embeds = false, titleField = 'edit', band, head, onChangeLine, onNotice, stripOpen, onStripToggle }: CardPaneProps) {
  const swap = useCardSwap(editing)
  // The band shows the title (off the card line); the card is its text, its sides only (YAZ-5308).
  return (
    <>
      {(editing || swap.shown === 'edit') && (
        <div ref={swap.editorRef} className={`card-pane__editor${swap.shown === 'edit' ? '' : ' card-pane__incoming'}`}>
          <CardPaneEditor key={`${card.index}`} text={card.text} title={card.title} path={path} vault={vault} onDone={onEditDone} select={select} titleField={titleField} onUp={swap.editorUp} beforeDone={swap.beforeDone} />
        </div>
      )}
      {(!editing || swap.shown === 'read') && (
        <div ref={swap.readRef} className={`card card-screen${swap.shown === 'read' ? '' : ' card-pane__incoming'}`}>
          {head}
          {band}
          <CardBody text={card.text} path={path} vault={vault} doors={doors} />
          {swap.shown !== 'read' && <ReadCardUp onUp={swap.readUp} />}
        </div>
      )}
      {/* YAZ-5105 round 2: the Reviews strip right under the card, as Mochi's; then the card window's facts strip. */}
      {/* YAZ-5382: Linked mentions and, on a card file, Embedded in are parts of the strip, not sections under it. */}
      {reviews !== undefined && (
        <CardStrip
          reviews={card.reviews}
          settings={reviews}
          onDelete={onDeleteReview}
          open={stripOpen}
          onToggle={onStripToggle}
          properties={{
            values: card.properties ?? {},
            edit: onChangeLine === undefined ? undefined : { change: onChangeLine, root: vault.root, wikilinks: vault.wikilinks, path, readOnly: vault.readOnly === true, onNotice },
          }}
          pages={card.id === null ? undefined : { id: card.id, wikilinks: vault.wikilinks, onOpen: onOpenPage, embeds }}
        />
      )}
      {strip}
    </>
  )
}

/**
 * READ ⇄ EDIT CARD WITH NO JUMP AND NO FLASH (YAZ-5164, Yaseen: "every switch … must keep the same block at the same
 * spot", "it should just be so smooth"). The card on show stays until the other one is drawn under it, see-through
 * (`card-pane__incoming`), with the scroller held (`freezeScroll`: the editor's caret and focus would move it); then they
 * swap in one frame, the same line of the card at the same spot (`readSwapPlace`), else the card at the old card's spot. Edit card waits for the editor's card to open; Done waits for the
 * read card's text, which draws in an effect. The card file tab, Explore's card window and the card window all show cards
 * through here.
 */
function useCardSwap(editing: boolean): { shown: 'read' | 'edit'; editorUp: () => void; readUp: () => void; beforeDone: () => void; readRef: React.RefObject<HTMLDivElement | null>; editorRef: React.RefObject<HTMLDivElement | null> } {
  const readRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState<'read' | 'edit'>(editing ? 'edit' : 'read')
  /** The card box on show as a switch starts: its scroller and its spot, put back on the incoming card. */
  const held = useRef<{ scroller: Element; place: SwapPlace; thaw: () => void } | null>(null)
  /**
   * Done's place, read by the card editor just before it draws the card again (`CardHost.beforeDone`): by the time the
   * host's Done turns `editing` off (after its save), the editor's card already shows its read look, without the title
   * band the read card has, and its lines stand higher. The scroller is held from then on.
   */
  const early = useRef<{ scroller: Element; place: SwapPlace; thaw: () => void; timer: ReturnType<typeof setTimeout> } | null>(null)
  const dropEarly = () => {
    if (early.current === null) return
    clearTimeout(early.current.timer)
    early.current.thaw()
    early.current = null
  }
  const shownEditing = useRef(editing)
  if (shownEditing.current !== editing) {
    shownEditing.current = editing
    held.current?.thaw()
    const pre = !editing ? early.current : null
    if (pre !== null) {
      clearTimeout(pre.timer)
      early.current = null
      held.current = pre
    } else {
      dropEarly()
      const box = shown === 'read' ? readRef.current : (editorRef.current?.querySelector('.card') ?? null)
      const scroller = box === null ? null : scrollerOf(box)
      held.current = box === null || scroller === null ? null : { scroller, place: readSwapPlace(scroller, box), thaw: freezeScroll(scroller) }
    }
  }
  // The new card is on show: at the old card's spot, before it paints; the scroller is the person's again.
  useLayoutEffect(() => {
    const hold = held.current
    if (hold === null || (shown === 'edit') !== editing) return
    held.current = null
    hold.thaw()
    const box = shown === 'read' ? readRef.current : (editorRef.current?.querySelector('.card') ?? null)
    if (box !== null) showSwapPlace(hold.scroller, box, hold.place)
  }, [shown, editing])
  useEffect(
    () => () => {
      held.current?.thaw()
      dropEarly()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  return {
    shown,
    beforeDone: () => {
      dropEarly()
      const box = editorRef.current?.querySelector('.card') ?? null
      const scroller = box === null ? null : scrollerOf(box)
      if (box === null || scroller === null) return
      const thaw = freezeScroll(scroller)
      // A Done whose save fails keeps Edit card's state: the scroller is the person's again soon.
      early.current = { scroller, place: readSwapPlace(scroller, box), thaw, timer: setTimeout(dropEarly, EARLY_MS) }
    },
    editorUp: () => setShown((now) => (shownEditing.current ? 'edit' : now)),
    readUp: () => setShown((now) => (shownEditing.current ? now : 'read')),
    readRef,
    editorRef,
  }
}

/** How long Done's early place waits for the host's Done (its save) before the scroller is the person's again. */
const EARLY_MS = 3000

/** Tells its card it is drawn: after the read card's own effect drew its text (a child's effects run first). */
function ReadCardUp({ onUp }: { onUp: () => void }): null {
  const up = useRef(onUp)
  up.current = onUp
  useEffect(() => up.current(), [])
  return null
}

/** The page card's editor without the editing of blocks around it: the card block is all the document holds. */
const CARD_EDIT_FEATURES = { ...features, [CrepeFeature.BlockEdit]: false, [CrepeFeature.Toolbar]: false }

/**
 * Edit card (YAZ-5003): the page card's own view, in a small Crepe of the card block alone, with Edit card on at
 * once — the card editor (YAZ-5026) or Crepe's code block, its Done (button, Esc, ⌘↵). Done hands the text and the
 * title over. Made once per edit: the text and title it starts from are the card's when Edit card began, and a read
 * again under it (an outside write) does not touch them.
 */
function CardPaneEditor({ text, title, path, vault, onDone, select, titleField, onUp, beforeDone }: { text: string; title: string; path: string; vault: ExploreVault; onDone: (text: string, title: string) => void; select?: { from: number; to: number }; titleField: CardTitleField; onUp?: () => void; beforeDone?: () => void }) {
  const beforeRef = useRef(beforeDone)
  beforeRef.current = beforeDone
  const upRef = useRef(onUp)
  upRef.current = onUp
  const hostRef = useRef<HTMLDivElement>(null)
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  // The icons of the `[[` picker's rows and the pills (YAZ-5407): the sidebar's, as a page's editor draws them.
  const iconsHere = useContext(IconsContext)
  const icons = useRef(iconsHere)
  icons.current = iconsHere
  const start = useRef({ text, title, path, vault, select, titleField })
  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const { text, title, path, vault, select, titleField } = start.current
    const el = document.createElement('div')
    el.className = 'editor-instance'
    host.appendChild(el)
    const crepe = createCrepe({
      root: el,
      // The card with its title on its line: Edit card's Title field reads it there, as in a page.
      defaultValue: `${cardBlock(text, withCardTitle(EMPTY_CARD_LINE, title))}\n`,
      features: CARD_EDIT_FEATURES,
      wikilinks: vault.wikilinks,
      // The `[[` picker's pages and cards, as in a page (YAZ-5185): without it the picker had only "Create".
      wikilinkCandidates: vault.wikilinkCandidates,
      viewOnlyLinks: vault.viewOnlyLinks,
      linkLook: { icon: (target, folder) => fileIconDecoration(icons.current, target, folder) },
      image: { root: vault.root, pagePath: path },
      cards: { path, onEditDone: (t, next) => doneRef.current(t, next), beforeDone: () => beforeRef.current?.(), titleField },
      // Esc with the keyboard on the card's frame, not in its text (YAZ-5164): Done, as in its text; never a step out to
      // the sidebar from inside a card file, a card window or Explore.
      onEscape: () => {
        cardBlockViewOfDom(el.querySelector('.card'))?.done()
        return true
      },
    })
    let live = true
    void crepe.create().then(() => {
      if (!live) return
      const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
      let pos = -1
      view.state.doc.descendants((node, at) => {
        if (pos === -1 && isCardNode(node)) pos = at
        return pos === -1
      })
      if (pos >= 0) cardBlockViewAt(view, pos)?.edit(select)
      // Its card is open: a frame to draw it (the page's editor in the card), then it shows (YAZ-5164).
      requestAnimationFrame(() => live && upRef.current?.())
    })
    return () => {
      live = false
      void crepe.destroy()
      el.remove()
    }
  }, [])
  return <div ref={hostRef} className="explore-card__edit" data-explore-card-edit data-tour="card-editor" />
}

