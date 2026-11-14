/**
 * A CARD FILE's tab (YAZ-5037): a `.md` file with `kind: card` (`shared/cardFileFormat.ts`) shows its card, not a page.
 * `Editor` routes here after its ONE read (`useFile`) and hands the file over: the tab reads nothing on open.
 *
 *  - The head: the folder path, the title, the card ID (a click copies it) and the state —
 *    "Archived", or with the vault's Review on "New" / "Due in 3 days", the "Up next" chip, "Hidden in review". Then
 *    Edit card (E) and ⋯. With Review off nothing asks you to review the card: no due state, no Inbox row, no Reviews.
 *  - The body is the card window's (`review/cardPane.tsx`): the card or the card editor, its Reviews, "Linked
 *    mentions (n)", and "Embedded in (n)". There is no "Open page": the tab is the card's file.
 *  - EDIT CARD (YAZ-5026) as in the card window: Done writes the card's text by its ID on the newest bytes, ONE
 *    `transformFile` (`changeCardTextIn`). A read-only vault or a `readonly: true` file has no Edit card; ⋯ and
 *    reviews still write, as reviews do in a locked page. A card New card just made opens in Edit card (YAZ-5101).
 *  - THE TITLE (YAZ-5044 decision A, YAZ-5104) is the file's `title`, as a page's, and the card's text never holds it:
 *    the big title is the page's own `PageTitle`, read from the index, so a click edits it as on a page. Enter (or a
 *    click away) writes `title` and renames the file through App's title edit door (`onRetitle`, which asks first as a
 *    page's title does); Esc goes back. While the tab is read only, the title is too.
 *  - A FILE THAT IS NOT VALID (`cardFileShape`) stays a card file: one notice at the top (`CardFileNotice`), and
 *    nothing is deleted. 2+ cards: "This card file holds 3 cards.", the first card under it (each one stays in review).
 *    Text outside the card: the notice, and that text below it, muted. No card: the notice, and the file's text.
 *  - THE CONVERT ACTIONS (YAZ-5037 phase 5, `review/cardConvert.ts`), in a vault with IDs and on a file that is not
 *    `readonly: true`: ⋯ › Turn into a page; the notice's fixes, "Split into 3 card files", "Move into the card", and
 *    with no card "Make a card from the text" and "Turn into a page". The vault's Read only asks first.
 *  - THE TOP BAR (YAZ-5102): a page's bar, from the same `StatusChips` — the cog, the zoom, the "Read only" chip while the
 *    vault or the file is read only, Sync and Saved. The chip turns Read only off as on a page: a time choice unlocks
 *    this tab (`useTimedUnlock`; the vault's lock stays in its file), "Turn Read only off" writes the file's own switch.
 *    While locked there is no Edit card; at the unlock's end an open Edit card is Done first, then the tab locks. The
 *    cog has what applies to a card: "Read only" and the counts. A page's rows (line numbers, folding, the table of
 *    contents, the widths, "Turn into a card file", …) and Collapse all are not there: a card has none of them.
 *  - ON DISK: the tab reads the file again on each new index version, as the card window does. A file that lost
 *    `kind: card` goes back to the page view (`onPage`, with the bytes just read); a second card is the notice above.
 */
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { cardFileShape, isCardFileContent } from '@shared/cardFileFormat'
import { splitFrontmatter } from '@shared/frontmatter'
import type { GestureAction } from '@shared/keys'
import { isNoteReadOnly, setNoteReadOnly } from '@shared/readOnly'
import { withCardNext, type CardReview } from '@shared/cardLine'
import type { ReviewSettings } from '@shared/reviews'
import type { FileResponse, GithubSyncStatus, ZoomStep } from '@shared/types'
import type { SaveStatus } from '../lib/autosave'
import { transformFile } from '../views/writeProperty'
import { api, BridgeRequestError } from '../api'
import { CardReviewDoor } from '../review/cardReviewDoor'
import { cardInContent } from '../review/cardFile'
import { forgetNewCard, isNewCard } from '../review/newCardFile'
import { CardPane, cardMenuSections, cardWrites, isCardEditKey, onIndexVersion } from '../review/cardPane'
import { noteCardFacts, noteCardNextReview, NoteCardId, NoteCardNextChip } from '../review/noteCardParts'
import { useVaultReviewSettings } from '../review/useReviewSettings'
import type { ExploreVault } from '../explore/ExploreNote'
import { usePathTitles } from '../lib/pageLabel'
import { ContextMenu } from '../sidebar/ContextMenu'
import type { MenuSection } from '../sidebar/menuSections'
import { VaultReadOnly } from '../vault/readOnlyVault'
import { CardFileNotice } from './CardFileNotice'
import { stepZoomByKey } from './DocumentZoom'
import { noteCardViewOfDom } from './noteCard/noteCardView'
import { PageSettings } from './PageSettings'
import { PageTitle } from './PageTitle'
import { StatusChips } from './StatusChips'
import { useTimedUnlock } from './useTimedUnlock'
import { ZOOM_EVENT } from './zoomRequest'
import { runConvert } from './useCardConvert'
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
  /** The title edit door (YAZ-2420 🔒 D16, App's): the big title's edit writes `title` and names the file after it (YAZ-5104). Absent: the title is read only. */
  onRetitle?: (path: string, title: string, kind: 'file') => void
  /** The tab's own convert ended (YAZ-5037 phase 5: Turn into a page): the editor reads the file again, with no notice. */
  onReread?: () => void
  /** The top bar's sync chip (YAZ-5102), as a page's: App's `useGithubSync`. */
  sync?: GithubSyncStatus | null
  onSyncNow?: () => void
}

const NO_CANDIDATES: WikilinkCandidateSource = { candidates: [], subscribe: () => () => undefined }
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

export function CardFileView({ file, root, wikilinks, wikilinkCandidates, viewOnlyLinks, onOpenFile, onOpenLink, onOpenExplore, exploreOnClick, onNotice = quiet, onPage, onRetitle, onReread, sync, onSyncNow }: CardFileViewProps) {
  const path = file.path
  const [content, setContent] = useState<string | null>(file.content)
  /** "Turn into a page" runs: the file losing `kind: card` is this tab's own doing, and says nothing. */
  const turning = useRef(false)
  const onPageRef = useRef<(next: FileResponse) => void>(onPage)
  onPageRef.current = (next) => (turning.current && onReread !== undefined ? onReread() : onPage(next))

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
  const titles = usePathTitles(wikilinks)
  const settings = useVaultReviewSettings(root)
  const reviewOn = settings?.enabled === true
  const door = useContext(CardReviewDoor)
  const vaultScope = useContext(VaultReadOnly)
  const vaultLocked = vaultScope.on
  /** The file's own switch (`readonly: true`) or the vault's: the top bar's "Read only" chip shows while this is true. */
  const diskReadOnly = content !== null && isNoteReadOnly(content)
  const lockedBase = diskReadOnly || vaultLocked
  // A card New card just made (YAZ-5037) opens in Edit card, one time only.
  const [fresh] = useState(() => isNewCard(path))
  useEffect(() => forgetNewCard(path), [path])
  const [editing, setEditing] = useState(fresh)
  const editingRef = useRef(editing)
  editingRef.current = editing
  const bodyRef = useRef<HTMLDivElement>(null)
  /** This tab's timed "Allow edits" (YAZ-4939, YAZ-5102): at its end an open Edit card is Done first, then the tab locks. */
  const unlock = useTimedUnlock(() => {
    if (!editingRef.current) return
    noteCardViewOfDom(bodyRef.current?.querySelector('[data-explore-card-edit] .note-card') ?? null)?.done()
  })
  const locked = lockedBase && unlock.until === null
  const canEdit = card !== null && content !== null && !locked
  const vault = useMemo(
    (): ExploreVault => ({ root, wikilinks, wikilinkCandidates: wikilinkCandidates ?? NO_CANDIDATES, viewOnlyLinks, readOnly: locked, review: door === null || settings === undefined ? undefined : { settings, deleteReview: door.deleteReview } }),
    [root, wikilinks, wikilinkCandidates, viewOnlyLinks, locked, door, settings],
  )
  const wasEditing = useRef(editing)
  useEffect(() => {
    // Out of Edit card the tab takes the keyboard back, so E edits again.
    if (wasEditing.current && !editing) bodyRef.current?.focus({ preventScroll: true })
    wasEditing.current = editing
  }, [editing])

  const writes = cardWrites(path, card, read, onNotice, vault.review)
  /** The top bar's save chip (YAZ-5102): Edit card's Done is the card file's one save; ⋯'s writes land at once. */
  const [save, setSave] = useState<SaveStatus>('saved')
  /** This tab's text size (YAZ-5102), as a page's: per tab, never stored. ⌘+ / ⌘− / ⌘0 with the focus in the tab. */
  const [zoom, setZoom] = useState(100)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const present = content !== null
  useEffect(() => {
    const section = bodyRef.current?.closest('.editor')
    if (!section) return
    const onZoom = (event: Event) => {
      event.preventDefault()
      const step = (event as CustomEvent<ZoomStep>).detail
      setZoom(step === 0 ? 100 : (stepZoomByKey(zoomRef.current, step) ?? zoomRef.current))
    }
    section.addEventListener(ZOOM_EVENT, onZoom)
    return () => section.removeEventListener(ZOOM_EVENT, onZoom)
  }, [present])
  /** The chip's "Allow edits?" box is open; gone once Read only is. */
  const [asking, setAsking] = useState(false)
  useEffect(() => {
    if (!lockedBase) setAsking(false)
  }, [lockedBase])
  /** The cog's row and the chip's "Turn Read only off": the file's own `readonly` key, on the newest bytes. */
  const setReadOnly = (on: boolean) =>
    void transformFile(path, (text) => setNoteReadOnly(text, on)).then(read, (err: unknown) => onNotice(`Read only could not change: ${err instanceof Error ? err.message : String(err)}`))
  const giveKeysBack = () => bodyRef.current?.focus({ preventScroll: true })
  /** Done: the card's text, its sides only (YAZ-5044: the title is the file's `title`, never in the text). */
  const editDone = (text: string) => {
    setSave('saving')
    writes.editDone(
      text,
      () => {
        setSave('saved')
        setEditing(false)
      },
      () => setSave('error'),
    )
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
  const notice = shapeNotice(shape.problem, shape.cards.length)
  const outside = [shape.before, shape.after].filter((text) => text !== '')
  const state = card === null ? null : card.off ? 'Archived' : !reviewOn || settings === undefined ? null : cardDue(card.reviews, settings)
  // The convert actions (YAZ-5037 phase 5): only in a vault with IDs (D8), never on a `readonly: true` file. Each is a
  // file action: the vault's Read only asks first. The tab reads the file again on the next index version.
  const converts = wikilinks.ids && !isNoteReadOnly(content)
  const convert = (failure: string, action: Parameters<typeof runConvert>[4]) => void runConvert(root, vaultScope.allowFileAction, onNotice, failure, action)
  const toPage = () => {
    turning.current = true
    void runConvert(root, vaultScope.allowFileAction, onNotice, 'turn the card file into a page', (a) => a.turnIntoPage(path)).then((done) => {
      if (done) onReread?.()
      else turning.current = false
    })
  }
  const sections = (): MenuSection[] => [
    ...cardMenuSections(card, id, writes.changeLine, onNotice, { inbox: reviewOn, link: true }),
    ...(converts ? [[{ id: 'to-page', label: 'Turn into a page', onSelect: toPage }]] : []),
  ]
  const fixes =
    !converts ? null : shape.problem === 'many' ? (
      <button type="button" onClick={() => convert('split the card file', (a) => a.splitIntoCardFiles(path))}>
        Split into {shape.cards.length} card files
      </button>
    ) : shape.problem === 'outside' ? (
      <button type="button" onClick={() => convert('move the text into the card', (a) => a.moveIntoCard(path))}>
        Move into the card
      </button>
    ) : shape.problem === 'none' ? (
      <>
        <button type="button" onClick={() => convert('make a card from the text', (a) => a.makeCardFromText(path))}>
          Make a card from the text
        </button>
        <button type="button" onClick={toPage}>
          Turn into a page
        </button>
      </>
    ) : null

  // The chip's box and the cog's row, as a page's: a time choice unlocks this tab; "Turn Read only off" writes the file's
  // own switch, and is not there while the vault's lock would keep the card locked anyway.
  const readOnlyChip = !lockedBase
    ? null
    : {
        asking,
        onAsk: () => setAsking(true),
        onAllow: (choice: Parameters<typeof unlock.allow>[0]) => {
          setAsking(false)
          unlock.allow(choice)
        },
        onCancel: () => setAsking(false),
        onTurnOff: diskReadOnly && !vaultLocked ? () => (setAsking(false), setReadOnly(false)) : undefined,
        editingUntil: unlock.until,
        onLock: unlock.lock,
        onReturn: giveKeysBack,
      }
  const cardText = card?.text ?? ''

  return (
    <>
      <StatusChips zoom={zoom} onZoom={setZoom} readOnly={readOnlyChip} sync={sync} onSyncNow={onSyncNow} save={save}>
        <PageSettings readOnly={lockedBase} onToggleReadOnly={() => (lockedBase ? (unlock.until !== null ? unlock.lock() : setAsking(true)) : setReadOnly(true))} readText={() => cardText} />
      </StatusChips>
      {notice !== null && <CardFileNotice text={notice}>{fixes}</CardFileNotice>}
      <div ref={bodyRef} className="card-file" tabIndex={-1} data-card-file data-card-file-body onKeyDown={onKeyDown} style={{ '--document-zoom': zoom / 100 } as CSSProperties}>
        <div className="card-file__page">
          <header className="card-file__head">
            <div className="card-file__path">{folderOf(root, path)}</div>
            <div className="card-file__title-row">
              <PageTitle path={path} titles={titles} readOnly={locked || onRetitle === undefined} onRetitle={(title) => onRetitle?.(path, title, 'file')} onArrowDown={giveKeysBack} />
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
