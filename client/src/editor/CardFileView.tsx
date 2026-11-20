/**
 * A CARD FILE's tab (YAZ-5037): a `.md` file with `kind: card` (`shared/cardFileFormat.ts`) shows its card, not a page.
 * `Editor` routes here after its ONE read (`useFile`) and hands the file over: the tab reads nothing on open.
 *
 *  - ONE TITLE SPOT (YAZ-5392, Yaseen's Q46 on YAZ-5308: "model the exact same UI on the cards page itself"): the card
 *    shows as a card in a page does. Above it the folder path only, no big page title. In the card: the top bar (the
 *    card ID, a click copies it; the marks every card head has (`cardHeadMarks`, YAZ-5915) — "Archived", or with the
 *    vault's Review on "New" / "Due in 3 days" and the title rule ("Title always (default)"), "To fix"; the "Up next"
 *    chip; Edit card (E); ⋯), the title band, the sides. With Review off nothing asks
 *    you to review the card: no due state, no Inbox row, no Reviews.
 *  - The body is the card window's (`review/cardPane.tsx`): the card or the card editor, its Reviews, "Linked
 *    mentions (n)", and "Embedded in (n)". There is no "Open page": the tab is the card's file.
 *  - EDIT CARD (YAZ-5026) as in the card window: Done writes the card's text by its ID on the newest bytes, ONE
 *    `transformFile` (`changeCardTextIn`). In a read-only vault or a `readonly: true` file, Edit card (E, the button)
 *    asks first, as typing in a locked page does, and opens at once after "Allow edits" (YAZ-5145 round 2); ⋯ and
 *    reviews still write, as reviews do in a locked page. A card New card just made opens in Edit card (YAZ-5101).
 *  - THE TITLE (YAZ-5104, YAZ-5308 decision D) is the card's, on its card line, and the card's text never holds it:
 *    the band's title is the page's own `PageTitle`, read from the index, so a click edits it as on a page. Enter (or a
 *    click away) writes the card line's title and renames the file through App's title edit door (`onRetitle`, which
 *    asks first as a page's title does); Esc goes back. While the tab is read only, the title is too: a click on it shows the "Read only"
 *    chip's card, "This card is Read only. Press Enter to allow edits." (YAZ-5141), and once allowed the title edits.
 *    The band is the card's only title. Edit card's band shows it, with no field: read, the band renames the file too.
 *  - A FILE THAT IS NOT VALID (`cardFileShape`) stays a card file: one notice at the top (`CardFileNotice`), and
 *    nothing is deleted. 2+ cards: "This card file holds 3 cards.", the first card under it (each one stays in review).
 *    Text outside the card: the notice, and that text below it, muted. No card: the notice, and the file's text.
 *  - THE CONVERT ACTIONS (YAZ-5037 phase 5, `review/cardConvert.ts`), in a vault with IDs and on a file that is not
 *    `readonly: true`: ⋯ › Turn into a page; the notice's fixes, "Split into 3 card files", "Move into the card", and
 *    with no card "Make a card from the text" and "Turn into a page". The vault's Read only asks first.
 *  - THE TOP BAR (YAZ-5102): a page's bar, from the same `StatusChips` — the cog, the zoom, the "Read only" chip while the
 *    vault or the file is read only, Sync and Saved. The chip turns Read only off as on a page: a time choice unlocks
 *    this tab (`useTimedUnlock`; the vault's lock stays in its file), "Turn Read only off" writes the file's own switch.
 *    While locked, Edit card asks first; at the unlock's end an open Edit card is Done first, then the tab locks. The
 *    cog has what applies to a card: "Read only", "Card width" and "Position" (YAZ-5871 D4: the file's own `page-width`
 *    and `page-position`; Default follows Settings › Cards › Card look › Card width and Appearance › Page position), and the counts.
 *    A page's other rows (line numbers, folding, the table of contents, the code and table widths, "Turn into a card
 *    file", …) and Collapse all are not there: a card has none of them.
 *  - ⌘F (YAZ-5378): the page's find bar, over the title and the card as the tab shows them (`cardFind.ts`, the page's
 *    own card search), the Edit card editor's text while it is open. Its fold menu (YAZ-5970) is a page's: the card
 *    page's own `find-folds` key, else Settings › Editor › Find, and folded card sides follow it.
 *  - COMMENTS (YAZ-5466): the page's one comments block (`CommentsSection`, the file's front matter `comments`), under the
 *    card and its strip, where a page has it: write, reply, edit your own, resolve, delete, the order setting. `comments`
 *    is the file's (decision D): it stays in the front matter beside `kind: card`, never on the card line, never a card
 *    property. Comments are not edits (YAZ-5466 Q56): while the tab is Read only, a comment write goes
 *    through with no "Allow edits?", never unlocks the tab and never touches the card part.
 *  - ON DISK: the tab reads the file again on each new index version, as the card window does. A file that lost
 *    `kind: card` goes back to the page view (`onPage`, with the bytes just read); a second card is the notice above.
 */
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { cardFileShape, isCardFileContent } from '@shared/cardFileFormat'
import { splitFrontmatter } from '@shared/frontmatter'
import { fileKind } from '@shared/fileKind'
import type { HotkeyOverrides } from '@shared/hotkeyBindings'
import type { GestureAction } from '@shared/keys'
import { isPageReadOnly, setPageReadOnly } from '@shared/readOnly'
import { tellReadOnlyEdit } from './readOnlyEdit'
import { withCardNext } from '@shared/cardLine'
import { DEFAULT_SETTINGS, isCardWidth, type CommentsOrder, type ContentPosition, type ContentWidth, type DiagramDarkColors, type FileResponse, type GithubSyncStatus, type OutsideChangeGlow, type ZoomStep } from '@shared/types'
import { readPagePosition, readPageWidth, writePagePosition, writePageWidth } from '@shared/pageSwitches'
import { cardTextWidth, columnStart, positionOf, widthOf } from '../lib/contentWidth'
import { storage } from '../lib/storage'
import { CommentsSection } from '../comments/CommentsSection'
import type { SaveStatus } from '../lib/autosave'
import { transformFile } from '../views/writeProperty'
import { api, BridgeRequestError } from '../api'
import { CardReviewDoor } from '../review/cardReviewDoor'
import { cardInContent } from '../review/cardFile'
import { forgetNewCard, isNewCard } from '../review/newCardFile'
import { CardPane, cardWrites, isCardEditKey, isCardPreviewKey, onIndexVersion, previewCardOf } from '../review/cardPane'
import { useTransientCardWidth } from '../review/inboxCardWidth'
import { CardBand, CardId, CardNextChip, type CardStripPart } from '../review/cardParts'
import { cardHeadMarks } from '../review/cardHeadMarks'
import { PropertiesIcon } from '../views/view/icons'
import { useVaultReviewSettings } from '../review/useReviewSettings'
import type { ExploreVault } from '../explore/ExplorePage'
import { usePathTitles, pageLabel } from '../lib/pageLabel'
import type { AnchorRect } from '../sidebar/previewPlacement'
import { CardPreviewHost, useCardPreview, type PreviewScope } from '../tabs/cardPreview'
import { ImageModal } from './image/ImageModal'
import type { GalleryImage } from './image/imageOptions'
import { linkOpenHint } from './linkGesture'
import type { WikilinkHover } from './wikilink/wikilinkHover'
import { ContextMenu } from '../sidebar/ContextMenu'
import { cardMarksOf, cardMenuSections } from '../review/cardMenuView'
import type { MenuSection } from '../sidebar/menuSections'
import { VaultReadOnly } from '../vault/readOnlyVault'
import { CardFileNotice } from './CardFileNotice'
import { stepZoomByKey, useKeptZoom } from './DocumentZoom'
import { cardBlockViewOfDom } from './card/cardBlockView'
import { PageSettings } from './PageSettings'
import { readCardSides, writeCardSides, type CardSides } from '@shared/pageSwitches'
import { tellCardFoldChange } from './card/cardFold'
import { PageTitle } from './PageTitle'
import { TitleRowControls } from './PageFrame'
import { StatusChips } from './StatusChips'
import { useTimedUnlock } from './useTimedUnlock'
import { ZOOM_EVENT } from './zoomRequest'
import { runConvert } from './useCardConvert'
import type { WikilinkCandidateSource } from './wikilink/wikilinkPicker'
import type { WikilinkResolveSource } from './wikilink/wikilinkPlugin'
import type { ViewOnlyLinkSource } from './wikilink/viewOnlyLinkSource'
import './cardFileView.css'
import { useUnit } from '../vault/unitWord'
import { PlaceName } from '../sidebar/PlaceName'
import { dirname } from '../lib/paths'
import { FindBar } from './find/FindBar'
import { createFindChannel } from './find/findChannel'
import { createCardFinder } from './find/cardFind'
import { tourEvent } from '../course/tourBus'
import { readFindFolds, readOutsideGlow, writeFindFolds, writeOutsideGlow } from '@shared/pageSwitches'
import type { FindFolds } from '@shared/types'
import { useReviewOn } from '../review/useReviewSettings'
import { OutsideChangesBar } from './external/OutsideChangesBar'
import { useCardFileGlow } from './card/useCardFileGlow'

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
  /** A background-tab open for a link in the card (D2). Absent → `onOpenLink(p, 'backgroundTab')`. */
  onOpenLinkBackground?: (path: string) => void
  /** A plain click on a link while the vault's "Clicking a link" says Explore (YAZ-4936). */
  onOpenExplore?: (path: string) => void
  exploreOnClick?: () => boolean
  /** Where an unresolved `[[link]]` click or `[[` Create puts a new page, bound to the card file's path (D2). */
  newPageFolderFor?: (path: string) => string
  /** Link hover preview on resolved pills and Markdown links (D2). */
  hoverLinks?: boolean
  previewScope?: (path: string) => PreviewScope
  diagramDarkColors?: DiagramDarkColors
  hotkeys?: HotkeyOverrides
  onNotice?: (message: string) => void
  /** The file is no longer a card file (`kind: card` gone on disk): the page view, on the file just read. */
  onPage: (file: FileResponse) => void
  /** The title edit door (YAZ-2420 🔒 D16, App's): the band's title edit writes the card line's title and names the file after it (YAZ-5104, YAZ-5392). Absent: the title is read only. */
  onRetitle?: (path: string, title: string, kind: 'file') => void
  /** The tab's own convert ended (YAZ-5037 phase 5: Turn into a page): the editor reads the file again, with no notice. */
  onReread?: () => void
  /** The top bar's sync chip (YAZ-5102), as a page's: App's `useGithubSync`. */
  sync?: GithubSyncStatus | null
  onSyncNow?: () => void
  /** The comments' order (YAZ-5466): the app's one setting, as a page's block reads it. Absent: no comments block. */
  commentsOrder?: CommentsOrder
  onChangeCommentsOrder?: (order: CommentsOrder) => void
  /** Settings › Appearance › Content width and Page position, and Settings › Cards › Card look › Card width (YAZ-5871 D4): the cog's Defaults. Absent → the app's settings now. */
  contentWidth?: ContentWidth
  contentPosition?: ContentPosition
  cardWidth?: number | null
  /** Settings › Outside changes glow (YAZ-5925): how long an outside change of the card glows; the cog's row overrides it. */
  outsideChangeGlow?: OutsideChangeGlow
  /** Settings › Editor › Find (YAZ-5970): what ⌘F does with folds; the card page's own `find-folds` key wins. */
  findFolds?: FindFolds
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

export function CardFileView({ file, root, wikilinks, wikilinkCandidates, viewOnlyLinks, onOpenFile, onOpenLink, onOpenLinkBackground, onOpenExplore, exploreOnClick, newPageFolderFor, hoverLinks = false, previewScope, diagramDarkColors = 'adapt', hotkeys, onNotice = quiet, onPage, onRetitle, onReread, sync, onSyncNow, commentsOrder, onChangeCommentsOrder, contentWidth, contentPosition, cardWidth, outsideChangeGlow = DEFAULT_SETTINGS.outsideChangeGlow, findFolds = DEFAULT_SETTINGS.findFolds }: CardFileViewProps) {
  const unit = useUnit()
  const path = file.path
  const [content, setContent] = useState<string | null>(file.content)
  /** "Turn into a page" runs: the file losing `kind: card` is this tab's own doing, and says nothing. */
  const turning = useRef(false)
  const onPageRef = useRef<(next: FileResponse) => void>(onPage)
  onPageRef.current = (next) => (turning.current && onReread !== undefined ? onReread() : onPage(next))
  /** YAZ-5925 (D2b): an outside write of the card lights its words, and the page's bar counts it. */
  const bodyRef = useRef<HTMLDivElement>(null)
  const pageGlow = useMemo(() => (content === null ? null : readOutsideGlow(content)), [content])
  const glow = useCardFileGlow(path, content === null ? null : (cardInContent(path, content, null, 0)?.text ?? null), pageGlow ?? outsideChangeGlow, bodyRef)
  const glowSeen = useRef(glow.seen)
  glowSeen.current = glow.seen

  /** Reads the file again: a card file shows; one that lost its mark goes to the page view; a deleted one says so. */
  const read = useCallback(() => {
    let live = true
    api.readFile(path).then(
      (next) => {
        if (!live) return
        if (!isCardFileContent(next.content)) return onPageRef.current(next)
        glowSeen.current(cardInContent(path, next.content, null, 0)?.text ?? null, next.mtime)
        setContent(next.content)
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
  const [openImage, setOpenImage] = useState<{ images: GalleryImage[]; index: number } | null>(null)
  const hotkeysRef = useRef(hotkeys)
  hotkeysRef.current = hotkeys
  const linkAt = useRef<{ path: string; rect: AnchorRect; editable: boolean } | null>(null)
  const linkPreview = useCardPreview(hoverLinks, (p) => (linkAt.current?.path === p ? linkAt.current.rect : null))
  const [linkHover] = useState<WikilinkHover>(() => ({
    onHover: (p, rect, editable) => {
      linkAt.current = { path: p, rect, editable }
      linkPreview.hoverCard(p, p)
    },
    onLeave: () => {
      if (linkAt.current !== null) linkPreview.leaveCard(linkAt.current.path)
      linkAt.current = null
    },
  }))
  const linkCard = (_: string, p: string): { root: string | null; name: string; hint?: string } => ({
    root: null,
    name: pageLabel(p, false, titles),
    hint: linkOpenHint(hotkeysRef.current, linkAt.current?.editable ?? true, exploreOnClick?.() === true && fileKind(p) === 'markdown'),
  })
  const settings = useVaultReviewSettings(root)
  const reviewOn = settings?.enabled === true
  const door = useContext(CardReviewDoor)
  /** An Explore layer's page controls (YAZ-5974): on the card's top line. Null in a tab. */
  const titleRowControls = useContext(TitleRowControls)
  const vaultScope = useContext(VaultReadOnly)
  const vaultLocked = vaultScope.on
  /** The file's own switch (`readonly: true`) or the vault's: the top bar's "Read only" chip shows while this is true. */
  const diskReadOnly = content !== null && isPageReadOnly(content)
  const lockedBase = diskReadOnly || vaultLocked
  // A card New card just made (YAZ-5037) opens in Edit card, one time only.
  const [fresh] = useState(() => isNewCard(path))
  useEffect(() => forgetNewCard(path), [path])
  // The course's guided tour (YAZ-5123): a card file opened in a tab.
  useEffect(() => tourEvent('card-file-open', path), [path])
  const [editing, setEditing] = useState(fresh)
  const editingRef = useRef(editing)
  editingRef.current = editing
  // ⌘F (YAZ-5378): the page's bar and channel, over the card as the tab shows it (`createCardFinder`); Esc gives the keys back.
  const findChannel = useMemo(() => createFindChannel(), [])
  useEffect(() => createCardFinder(findChannel, () => bodyRef.current, () => bodyRef.current?.focus({ preventScroll: true })), [findChannel])
  /** This tab's timed "Allow edits" (YAZ-4939, YAZ-5102): at its end an open Edit card is Done first, then the tab locks. */
  const unlock = useTimedUnlock(() => {
    if (!editingRef.current) return
    cardBlockViewOfDom(bodyRef.current?.querySelector('[data-explore-card-edit] .card') ?? null)?.done()
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
  /** This tab's text size (YAZ-5102), as a page's: per tab, never stored; in the mini window, the window's (YAZ-5607). ⌘+ / ⌘− / ⌘0 with the focus in the tab. */
  const [zoom, setZoom] = useKeptZoom(100)
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
  /** The strip's open part (YAZ-5383): the top-right properties button opens Properties. */
  const [stripPart, setStripPart] = useState<CardStripPart | null>(null)
  useEffect(() => {
    if (!lockedBase) setAsking(false)
  }, [lockedBase])
  /** The cog's row and the chip's "Turn Read only off": the file's own `readonly` key, on the newest bytes. */
  const setReadOnly = (on: boolean) =>
    void transformFile(path, (text) => setPageReadOnly(text, on)).then(read, (err: unknown) => onNotice(`Read only could not change: ${err instanceof Error ? err.message : String(err)}`))
  /**
   * The cog's "Card width" and "Position" (YAZ-5871 D4): the card file's own `page-width` and `page-position`, on the
   * newest bytes. `null` removes the key: the card follows Settings › Cards › Card look › Card width and Appearance › Page position.
   */
  const setOwnKey = (row: string, change: (text: string) => string) =>
    void transformFile(path, change).then(read, (err: unknown) => onNotice(`${row} could not change: ${err instanceof Error ? err.message : String(err)}`))
  /**
   * YAZ-5904: this card page's "Card sides" (the cog), its own `card-sides` key, on the newest bytes. The key sets the
   * card's fold on the tab (`data-card-sides`); Default follows Settings › Cards › Card look › Card sides on card pages (Q1).
   */
  const cardSides = content === null ? null : readCardSides(content)
  useEffect(() => tellCardFoldChange(), [cardSides])
  const setCardSides = (sides: CardSides | null) =>
    void transformFile(path, (text) => writeCardSides(text, sides)).then(read, (err: unknown) => onNotice(`Card sides could not change: ${err instanceof Error ? err.message : String(err)}`))
  const giveKeysBack = () => bodyRef.current?.focus({ preventScroll: true })
  /**
   * ⌘F's fold menu (YAZ-5970), as a page's (YAZ-4787): the card page's own `find-folds` key in its front matter, as its
   * other own keys are, else Settings › Editor › Find. Its words name card sides while the vault's cards are on.
   */
  const ownFindFolds = content === null ? null : readFindFolds(content)
  useEffect(() => findChannel.setFolds(ownFindFolds ?? findFolds), [findChannel, ownFindFolds, findFolds])
  const cardsOn = useReviewOn(root)
  const findFoldsMenu = { own: ownFindFolds, app: findFolds, cards: cardsOn, cardPage: true, onChange: (folds: FindFolds | null) => setOwnKey('Find folded bullets', (text) => writeFindFolds(text, folds)) }
  /** The cog's "Outside changes glow" (YAZ-5925, D3): this file's own key, on the newest bytes; null follows Settings. */
  const changeGlow = (next: OutsideChangeGlow | null) =>
    void transformFile(path, (text) => writeOutsideGlow(text, next)).then(read, (err: unknown) => onNotice(`Outside changes glow could not change: ${err instanceof Error ? err.message : String(err)}`))
  /** Done: the card's text, plus any title change through App's title edit door (`onRetitle`, YAZ-6040). */
  const editDone = (text: string, nextTitle?: string) => {
    setSave('saving')
    const trimmed = nextTitle?.trim()
    const renamed = trimmed !== undefined && trimmed !== '' && trimmed !== (card?.title ?? '') && onRetitle !== undefined
    writes.editDone(
      text,
      () => {
        setSave('saved')
        setEditing(false)
        tourEvent('card-edit-done', path)
        if (renamed) void onRetitle(path, trimmed, 'file')
      },
      () => setSave('error'),
    )
  }
  /**
   * Edit card (E, the button): at once, or, while the tab is locked by Read only, an edit attempt that carries itself
   * (YAZ-5145 round 2): the chip's card shows, and once the person allows edits, Edit card opens with no second E.
   */
  const startEdit = () => {
    // The guided tour (YAZ-5123) hears Edit card each time it opens.
    const open = () => {
      setEditing(true)
      tourEvent('card-edit-open', path)
    }
    if (canEdit) return open()
    if (card !== null && content !== null && lockedBase && bodyRef.current !== null) tellReadOnlyEdit(bodyRef.current, 'card', open)
  }
  const preview = () => card !== null && previewCardOf(bodyRef.current, path, card)
  const onKeyDown = (event: ReactKeyboardEvent) => {
    // P (YAZ-5152): Preview, as the Inbox shows the card; nothing saved.
    if (!editing && card !== null && isCardPreviewKey(event)) {
      event.preventDefault()
      event.stopPropagation()
      return preview()
    }
    if (editing || card === null || !isCardEditKey(event)) return
    if (!canEdit && !lockedBase) return
    event.preventDefault()
    event.stopPropagation()
    startEdit()
  }
  const doors = {
    openLayer: (to: string) => (exploreOnClick?.() === true && onOpenExplore !== undefined ? onOpenExplore(to) : (onOpenLink ?? onOpenFile)(to)),
    openTab: (to: string, where: GestureAction) =>
      where === 'backgroundTab' && onOpenLinkBackground !== undefined
        ? onOpenLinkBackground(to)
        : onOpenLink === undefined
          ? onOpenFile(to)
          : onOpenLink(to, where),
    onNotice,
  }

  if (content === null || shape === null) return <p className="editor-msg">This card file is no longer there</p>
  const id = card?.id ?? null
  const notice = shapeNotice(shape.problem, shape.cards.length)
  const outside = [shape.before, shape.after].filter((text) => text !== '')
  // The convert actions (YAZ-5037 phase 5): only in a vault with IDs (D8), never on a `readonly: true` file. Each is a
  // file action: the vault's Read only asks first. The tab reads the file again on the next index version.
  const converts = wikilinks.ids && !isPageReadOnly(content)
  const convert = (failure: string, action: Parameters<typeof runConvert>[4]) => void runConvert(root, vaultScope.allowFileAction, onNotice, failure, action)
  const toPage = () => {
    turning.current = true
    void runConvert(root, vaultScope.allowFileAction, onNotice, 'turn the card file into a page', (a) => a.turnIntoPage(path)).then((done) => {
      if (done) onReread?.()
      else turning.current = false
    })
  }
  // The one card menu (YAZ-5697 round 2): a card file's rows of it; Turn into a page asks first (it rewrites and renames
  // the file, and no Undo takes it back).
  const sections = (): MenuSection[] =>
    cardMenuSections({ marks: cardMarksOf(card), path, upNext: reviewOn, copyId: id, copyLink: true, reset: true, unit, change: (c) => void writes.changeLine(c), onNotice, preview: card === null ? undefined : preview, toPage: converts ? toPage : undefined })
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
  // The card's width and position (YAZ-5871 D4): its own keys, else Card width (Same as pages is Content width) and Page position.
  const app = storage.getSettings()
  const appCardWidth = cardWidth !== undefined ? cardWidth : app?.cardWidth
  const defaultWidth: ContentWidth = isCardWidth(appCardWidth) ? appCardWidth : widthOf(contentWidth ?? app?.contentWidth)
  const appPosition = positionOf(contentPosition ?? app?.contentPosition)
  const ownWidth = readPageWidth(content)
  const ownPosition = readPagePosition(content)
  const width = ownWidth ?? defaultWidth
  const effectivePos = ownPosition ?? appPosition
  // YAZ-6054: one-time in-memory drag-to-resize edges (resets to default when closed/reopened).
  const dragWidth = useTransientCardWidth(bodyRef, bodyRef, path, effectivePos !== 'left', 48)
  // YAZ-6053: let `--card-text-width` (from Settings or vault card-look.json) expand `.card-file__page` past narrow
  // page `--content-text-width`, while preserving own-page `page-width` and transient drag overrides.
  const fileStyle: CSSProperties = {
    '--document-zoom': zoom / 100,
    '--column-start': columnStart(effectivePos, width),
    ...(dragWidth.width !== null
      ? { '--card-text-width': `${dragWidth.width}px`, '--content-max-width': `calc(${dragWidth.width}px + 130px)` }
      : ownWidth !== null
        ? { '--card-text-width': cardTextWidth(ownWidth), '--content-max-width': `calc(${cardTextWidth(ownWidth)} + 96px)` }
        : { '--content-max-width': 'calc(max(var(--content-text-width), var(--card-text-width) + 34px) + 96px)' }),
  } as unknown as CSSProperties
  const propertyCount = Object.keys(card?.properties ?? {}).length
  const propertiesLabel = propertyCount > 0 ? `Properties (${propertyCount})` : 'Properties'

  return (
    <>
      <StatusChips zoom={zoom} onZoom={setZoom} readOnly={readOnlyChip} sync={sync} onSyncNow={onSyncNow} save={save}>
        {/* YAZ-5383 (Q45): the properties button, where a page has it, opens the card's strip on Properties: one place for them. */}
        {card !== null && reviewOn && (
          <button
            type="button"
            className="frontmatter-panel__header card-file__properties"
            aria-expanded={stripPart === 'properties'}
            aria-label={propertiesLabel}
            title={propertiesLabel}
            onClick={() => {
              setStripPart((part) => (part === 'properties' ? null : 'properties'))
              requestAnimationFrame(() => bodyRef.current?.querySelector('.card-reviews--strip')?.scrollIntoView?.({ block: 'nearest' }))
            }}
          >
            <PropertiesIcon />
            {propertyCount > 0 && <span className="frontmatter-panel__count">{propertyCount}</span>}
          </button>
        )}
        <PageSettings readOnly={lockedBase} onToggleReadOnly={() => (lockedBase ? (unlock.until !== null ? unlock.lock() : setAsking(true)) : setReadOnly(true))} cardSides={cardSides} onChangeCardSides={setCardSides} cardSidesSetting="Card sides on card pages" readText={() => cardText}
          // YAZ-5871 D4: the card's own width and position, saved in the card file. Default follows Card width and Page position.
          pageWidth={ownWidth} appContentWidth={defaultWidth} pageWidthLabel="Card width" pageWidthSettings="Cards › Card look › Card width" onChangePageWidth={(next) => setOwnKey('Card width', (text) => writePageWidth(text, next))}
          pagePosition={ownPosition} appContentPosition={appPosition} onChangePagePosition={(next) => setOwnKey('Position', (text) => writePagePosition(text, next))} outsideGlow={pageGlow} appGlow={outsideChangeGlow} onChangeOutsideGlow={changeGlow} />
      </StatusChips>
      <OutsideChangesBar channel={glow.channel} onKeep={() => changeGlow('until-checked')} />
      <FindBar channel={findChannel} scope="page" hostRef={bodyRef} folds={findFoldsMenu} />
      {notice !== null && <CardFileNotice text={notice}>{fixes}</CardFileNotice>}
      <div ref={bodyRef} className="card-file" tabIndex={-1} data-card-file data-card-file-body data-card-sides={cardSides ?? undefined} data-fold-scope={path} onKeyDown={onKeyDown} style={fileStyle}>
        <div className="card-file__page">
          {/* YAZ-5392: above the card, the folder path only. The title lives in the card's band, as in a page. YAZ-5402: the folder icon says it is a folder. */}
          {titleRowControls === null ? (
            <PlaceName className="card-file__path" path={dirname(path)} kind="folder" label={folderOf(root, path)} />
          ) : (
            // In an Explore layer (YAZ-5974): the page controls on the card's top line, right of the folder path.
            <div className="card-file__top">
              <PlaceName className="card-file__path" path={dirname(path)} kind="folder" label={folderOf(root, path)} />
              {titleRowControls}
            </div>
          )}
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
              onChangeLine={writes.changeLine}
              onNotice={onNotice}
              stripOpen={stripPart}
              onStripToggle={(part) => setStripPart((open) => (open === part ? null : part))}
              embeds
              fold
              glow={glow.body}
              createFolder={newPageFolderFor === undefined ? undefined : () => newPageFolderFor(path)}
              openExplore={onOpenExplore}
              exploreClick={exploreOnClick}
              wikilinkHover={previewScope === undefined ? undefined : linkHover}
              hotkeys={hotkeys}
              onOpenImage={setOpenImage}
              onEdgeDrag={dragWidth.startDrag}
              onEdgeReset={dragWidth.reset}
              titleField={!locked && onRetitle !== undefined ? 'edit' : 'show'}
              head={
                <div className="card__head">
                  {id !== null && <CardId id={id} onNotice={onNotice} />}
                  {/* The quiet marks after the ID (YAZ-5915): every card head's, from one helper. */}
                  <span className="card__marks">
                    {cardHeadMarks(card, settings).map((mark) => (
                      <span key={mark.kind} className={mark.kind === 'state' ? `${mark.className} card-file__state` : mark.className}>
                        {mark.text}
                      </span>
                    ))}
                  </span>
                  {reviewOn && card.next === true && <CardNextChip onRemove={() => writes.changeLine((l) => withCardNext(l, false))} />}
                  {(canEdit || lockedBase) && (
                    <button type="button" className="card__edit" data-card-file-edit data-tour="card-edit" onMouseDown={(e) => e.preventDefault()} onClick={startEdit}>
                      Edit card
                    </button>
                  )}
                  <CardFileMore sections={sections} />
                </div>
              }
              band={
                // The title band (YAZ-5308 A3), the one title spot: the page title's own component, read from the index.
                // A click renames the card line's title and the file through App's title edit door (`onRetitle`).
                <CardBand>
                  <PageTitle path={path} titles={titles} readOnly={locked || onRetitle === undefined} locked={locked && 'card'} onRetitle={(title) => onRetitle?.(path, title, 'file')} onArrowDown={giveKeysBack} />
                </CardBand>
              }
            />
          )}
        </div>
        {/* YAZ-5466: the page's comments block, under the card and its strip; the file's front matter is its store. Round 3:
            it sits where a page has it, in the scroller after the column (as after `.editor-instance`), in its own
            column: the page's left edge, width and room above, never the card's width. */}
        {commentsOrder !== undefined && onChangeCommentsOrder !== undefined && <CommentsSection file={{ path, content }} order={commentsOrder} onChangeOrder={onChangeCommentsOrder} root={root} />}
      </div>
      {previewScope !== undefined && <CardPreviewHost store={linkPreview.store} cardOf={linkCard} scopeOf={previewScope} diagramDarkColors={diagramDarkColors} />}
      {openImage !== null && <ImageModal key={openImage.images[openImage.index].src} images={openImage.images} index={openImage.index} onClose={() => setOpenImage(null)} />}
    </>
  )
}

/** The tab's ⋯ and its menu (the card's rows), built when it opens. */
function CardFileMore({ sections }: { sections: () => MenuSection[] }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  return (
    <>
      <button
        type="button"
        className="card__more"
        data-tour="card-menu"
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
