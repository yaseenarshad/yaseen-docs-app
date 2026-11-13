/**
 * A CARD FILE's tab (YAZ-5037): a `.md` file with `kind: card` (`shared/cardFileFormat.ts`) shows its card, not a page.
 * `Editor` routes here after its ONE read (`useFile`) and hands the file over: the tab reads nothing on open.
 *
 *  - The head: the folder path, the title (the card's first line), the card ID (a click copies it) and the state —
 *    "Archived", or with the vault's Review on "New" / "Due in 3 days", the "Up next" chip, "Hidden in review". Then
 *    Edit card (E) and ⋯. With Review off nothing asks you to review the card: no due state, no Inbox row, no Reviews.
 *  - The body is the card window's (`review/cardPane.tsx`): the card or the card editor, its Reviews, "Linked
 *    mentions (n)", and "Embedded in (n)". There is no "Open page": the tab is the card's file.
 *  - EDIT CARD (YAZ-5026) as in the card window: Done writes the card's text by its ID on the newest bytes, ONE
 *    `transformFile` (`changeCardTextIn`). A read-only vault or a `readonly: true` file has no Edit card; ⋯ and
 *    reviews still write, as reviews do in a locked page. A Done that changed the title then names the file after it
 *    (`onRetitle`, YAZ-5044 pick 1). A card New card just made opens in Edit card with "Title" selected.
 *  - A FILE THAT IS NOT VALID (`cardFileShape`) stays a card file: one notice at the top (`CardFileNotice`), and
 *    nothing is deleted. 2+ cards: "This card file holds 3 cards.", the first card under it (each one stays in review).
 *    Text outside the card: the notice, and that text below it, muted. No card: the notice, and the file's text.
 *  - ON DISK: the tab reads the file again on each new index version, as the card window does. A file that lost
 *    `kind: card` goes back to the page view (`onPage`, with the bytes just read); a second card is the notice above.
 */
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { NEW_CARD_TEXT, cardFileShape, isCardFileContent } from '@shared/cardFileFormat'
import { cardTitle } from '@shared/cardText'
import { splitFrontmatter } from '@shared/frontmatter'
import type { GestureAction } from '@shared/keys'
import { isNoteReadOnly } from '@shared/readOnly'
import { withCardNext, type CardReview } from '@shared/cardLine'
import type { ReviewSettings } from '@shared/reviews'
import type { FileResponse } from '@shared/types'
import { api, BridgeRequestError } from '../api'
import { CardReviewDoor } from '../review/cardReviewDoor'
import { cardInContent } from '../review/cardFile'
import { forgetNewCard, isNewCard } from '../review/newCardFile'
import { CardPane, cardMenuSections, cardWrites, isCardEditKey, onIndexVersion } from '../review/cardPane'
import { noteCardFacts, noteCardNextReview, NoteCardId, NoteCardNextChip } from '../review/noteCardParts'
import { useVaultReviewSettings } from '../review/useReviewSettings'
import type { ExploreVault } from '../explore/ExploreNote'
import { ContextMenu } from '../sidebar/ContextMenu'
import type { MenuSection } from '../sidebar/menuSections'
import { VaultReadOnly } from '../vault/readOnlyVault'
import { CardFileNotice } from './CardFileNotice'
import type { WikilinkCandidateSource } from './wikilink/wikilinkPicker'
import type { WikilinkResolveSource } from './wikilink/wikilinkPlugin'
import type { ViewOnlyLinkSource } from './wikilink/viewOnlyLinkSource'
import './cardFileView.css'

export interface CardFileViewProps {
  /** The file as the tab's one read gave it (`useFile`): a card file. */
  file: FileResponse
  root: string
  wikilinks: WikilinkResolveSource
  wikilinkCandidates?: WikilinkCandidateSource
  viewOnlyLinks?: ViewOnlyLinkSource
  /** A page in "Linked mentions" or "Embedded in". */
  onOpenFile: (path: string) => void
  /** A link in the card, by its gesture (YAZ-3936). Absent → `onOpenFile`. */
  onOpenLink?: (path: string, where?: GestureAction) => void
  /** A plain click on a link while the vault's "Clicking a link" says Explore (YAZ-4936). */
  onOpenExplore?: (path: string) => void
  exploreOnClick?: () => boolean
  onNotice?: (message: string) => void
  /** The file is no longer a card file (`kind: card` gone on disk): the page view, on the file just read. */
  onPage: (file: FileResponse) => void
  /** The title edit door (YAZ-2420 🔒 D16, App's): Done that changes the card's title names the file after it. Absent: no rename. */
  onRetitle?: (path: string, title: string, kind: 'file') => void
}

const NO_CANDIDATES: WikilinkCandidateSource = { candidates: [], subscribe: () => () => undefined }
/** A new card's "Title", selected as Edit card opens (offsets in the card's text). */
const NEW_CARD_TITLE = { from: 0, to: NEW_CARD_TEXT.length }
const quiet = (): void => undefined

/** The notice of a card file that is not valid, or null for a valid one. */
function shapeNotice(problem: ReturnType<typeof cardFileShape>['problem'], count: number): string | null {
  if (problem === 'many') return `This card file holds ${count} cards.`
  if (problem === 'outside') return 'This card file has text outside the card.'
  if (problem === 'none') return 'This card file has no card.'
  return null
}

/** The folder the file is in, root-relative ("Geography / Europe"); the vault's own name at its top. */
function folderOf(root: string, path: string): string {
  const base = root.replace(/\/+$/, '')
  const rel = path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path
  const folder = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
  return folder === '' ? base.slice(base.lastIndexOf('/') + 1) : folder.split('/').join(' / ')
}

export function CardFileView({ file, root, wikilinks, wikilinkCandidates, viewOnlyLinks, onOpenFile, onOpenLink, onOpenExplore, exploreOnClick, onNotice = quiet, onPage, onRetitle }: CardFileViewProps) {
  const path = file.path
  const [content, setContent] = useState<string | null>(file.content)
  const onPageRef = useRef(onPage)
  onPageRef.current = onPage

  /** Reads the file again: a card file shows; one that lost its mark goes to the page view; a deleted one says so. */
  const read = useCallback(() => {
    let live = true
    api.readFile(path).then(
      (next) => {
        if (!live) return
        if (isCardFileContent(next.content)) setContent(next.content)
        else onPageRef.current(next)
      },
      (err: unknown) => {
        if (live && err instanceof BridgeRequestError && err.code === 'NOT_FOUND') setContent(null)
      },
    )
    return () => {
      live = false
    }
  }, [path])
  // The one read is the editor's; then again on each new version of the file in the index.
  useEffect(() => {
    let cancel = quiet
    const unsubscribe = onIndexVersion(wikilinks, path, () => {
      cancel()
      cancel = read()
    })
    return () => {
      cancel()
      unsubscribe()
    }
  }, [read, path, wikilinks])

  const shape = useMemo(() => (content === null ? null : cardFileShape(splitFrontmatter(content).body)), [content])
  const card = useMemo(() => (content === null ? null : cardInContent(path, content, null, 0)), [content, path])
  const settings = useVaultReviewSettings(root)
  const reviewOn = settings?.enabled === true
  const door = useContext(CardReviewDoor)
  const vaultLocked = useContext(VaultReadOnly).on
  const canEdit = card !== null && content !== null && !vaultLocked && !isNoteReadOnly(content)
  const vault = useMemo(
    (): ExploreVault => ({ root, wikilinks, wikilinkCandidates: wikilinkCandidates ?? NO_CANDIDATES, viewOnlyLinks, readOnly: vaultLocked, review: door === null || settings === undefined ? undefined : { settings, deleteReview: door.deleteReview } }),
    [root, wikilinks, wikilinkCandidates, viewOnlyLinks, vaultLocked, door, settings],
  )
  // A card New card just made (YAZ-5037) opens in Edit card, its "Title" selected so typing replaces it: one time only.
  const [fresh] = useState(() => isNewCard(path))
  useEffect(() => forgetNewCard(path), [path])
  const [editing, setEditing] = useState(fresh)
  const bodyRef = useRef<HTMLDivElement>(null)
  const wasEditing = useRef(editing)
  useEffect(() => {
    // Out of Edit card the tab takes the keyboard back, so E edits again.
    if (wasEditing.current && !editing) bodyRef.current?.focus({ preventScroll: true })
    wasEditing.current = editing
  }, [editing])

  const writes = cardWrites(path, card, read, onNotice, vault.review)
  /**
   * Done (YAZ-5044 pick 1): the card's text, then — when its title changed — the file's name follows the title through
   * the title edit door, which asks before renaming as a page's title does. The placeholder "Title" and an empty title
   * name nothing (`<id>.md` stays), and nor does a card with no ID yet.
   */
  const editDone = (text: string) => {
    const title = cardTitle(text)
    const named = onRetitle !== undefined && card !== null && card.id !== null && title !== '' && title !== NEW_CARD_TEXT && title !== cardTitle(card.text)
    writes.editDone(text, () => {
      setEditing(false)
      if (named) onRetitle(path, title, 'file')
    })
  }
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (editing || !canEdit || !isCardEditKey(event)) return
    event.preventDefault()
    event.stopPropagation()
    setEditing(true)
  }
  const doors = {
    openLayer: (to: string) => (exploreOnClick?.() === true && onOpenExplore !== undefined ? onOpenExplore(to) : (onOpenLink ?? onOpenFile)(to)),
    openTab: (to: string, where: GestureAction) => (onOpenLink === undefined ? onOpenFile(to) : onOpenLink(to, where)),
    onNotice,
  }

  if (content === null || shape === null) return <p className="editor-msg">This card file is no longer there</p>
  const id = card?.id ?? null
  const title = card === null ? path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '') : cardTitle(card.text)
  const notice = shapeNotice(shape.problem, shape.cards.length)
  const outside = [shape.before, shape.after].filter((text) => text !== '')
  const state = card === null ? null : card.off ? 'Archived' : !reviewOn || settings === undefined ? null : cardDue(card.reviews, settings)
  const sections = (): MenuSection[] => [
    ...cardMenuSections(card, id, writes.changeLine, onNotice, { inbox: reviewOn, link: true }),
    // Phase 5 (YAZ-5037): "Turn into a page" goes here, as its own last section.
  ]

  return (
    <>
      {notice !== null && <CardFileNotice text={notice} />}
      <div ref={bodyRef} className="card-file" tabIndex={-1} data-card-file data-card-file-body onKeyDown={onKeyDown}>
        <div className="card-file__page">
          <header className="card-file__head">
            <div className="card-file__path">{folderOf(root, path)}</div>
            <div className="card-file__title-row">
              <h1 className={`card-file__title${title === '' ? ' card-file__title--empty' : ''}`}>{title === '' ? 'New card' : title}</h1>
              {canEdit && !editing && (
                <button type="button" className="card-file__button" data-card-file-edit onMouseDown={(e) => e.preventDefault()} onClick={() => setEditing(true)}>
                  Edit card <kbd>E</kbd>
                </button>
              )}
              <CardFileMore sections={sections} />
            </div>
            <div className="card-file__facts">
              {id !== null && <NoteCardId id={id} onNotice={onNotice} />}
              {state !== null && <span className="card-file__state">{state}</span>}
              {reviewOn && card?.next === true && <NoteCardNextChip onRemove={() => writes.changeLine((l) => withCardNext(l, false))} />}
              {reviewOn && card?.notitle === true && <span className="note-card__state note-card__notitle">Hidden in review</span>}
            </div>
          </header>
          {outside.length > 0 && (
            <div className="card-file__outside">
              {outside.map((text, i) => (
                <p key={i}>{text}</p>
              ))}
            </div>
          )}
          {card !== null && (
            <CardPane
              card={card}
              path={path}
              vault={vault}
              editing={editing && canEdit}
              onEditDone={editDone}
              select={fresh && card.text === NEW_CARD_TEXT ? NEW_CARD_TITLE : undefined}
              doors={doors}
              onOpenPage={onOpenFile}
              reviews={reviewOn ? settings : undefined}
              onDeleteReview={writes.deleteReview}
              embeds
            />
          )}
        </div>
      </div>
    </>
  )
}

/** The head's state words for a card in review: "New", or "Due in 3 days" / "Due today" / "Due 2 days ago". */
function cardDue(reviews: readonly CardReview[], settings: ReviewSettings, now = Date.now()): string {
  const facts = noteCardFacts(reviews, settings, now)
  if (facts === null) return 'New'
  return `Due ${noteCardNextReview(facts.due, facts.inSteps, now).when}`
}

/** The tab's ⋯ and its menu (the card's rows), built when it opens. */
function CardFileMore({ sections }: { sections: () => MenuSection[] }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  return (
    <>
      <button
        type="button"
        className="card-file__button card-file__more"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={at !== null}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          if (at !== null) return setAt(null)
          const box = e.currentTarget.getBoundingClientRect()
          setAt({ x: box.left, y: box.bottom + 4 })
        }}
      >
        ⋯
      </button>
      {at !== null && <ContextMenu x={at.x} y={at.y} sections={sections()} onClose={() => setAt(null)} />}
    </>
  )
}
