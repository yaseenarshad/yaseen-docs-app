/**
 * A page layer of the explore stack (YAZ-2571). It opens for READING: the saved text in the read-only render the
 * preview panel uses (`useReadOnlyPage`'s Crepe, read only, no caret), with the page's links live: a click on a
 * `[[link]]` or a Markdown link to a page opens that page in a layer on top (`onOpenLink`); a link to a drawing, a
 * PDF or the web goes where it always goes. **E** or the Edit button turns the SAME layer into the editor: the
 * folder pages' mini window editor (App's `renderPageEditor`), so saving, renames and conflicts are the app's own.
 * In edit a link opens a layer on top too. The head's ↗ opens the page in a tab, as ⌘↵ does.
 * In a Read only vault (YAZ-4939) the head shows the page tab's "Read only" chip: E and Edit open its timed "Allow
 * edits" box, and only a choice in it edits. The unlock is THIS layer's (`useTimedUnlock`); the editor is told the
 * vault's lock is off for it while the unlock runs. At zero, or on "Lock now", the layer saves and reads again.
 * E EDITS THE THING YOU LOOK AT (YAZ-5145 round 3, the Decision of Q38), in one press: on a CARD FILE each edit opens
 * its Edit card, and after "Allow edits?" too, as the choice goes on to edit the layer (no second E); on a page, cards
 * or not, E edits the page, never a card. The Inbox's E on a card in a page opens that card's Edit card, one time.
 * EDIT WHERE YOU ARE (YAZ-5164, Yaseen: "it should keep me and maintain the scroll of where I am, so that way I can just
 * start editing wherever I am"). The reading Crepe and the editor are two views, with other things above the text, so a
 * scroll px would land elsewhere: going into edit, the layer reads its place in the TEXT (`readPagePlace`) and hands it
 * to the editor as a page view (`PageView.top`), as a duplicated tab starts where its source stood, with the caret in
 * view and the folds it showed. A card's Edit card while reading edits the layer as E does ("Allow edits?" first in a
 * Read only vault) and opens THAT card, kept where it is on screen: unlock, then continue.
 * ONE PAGE SHAPE EVERYWHERE (YAZ-5164 Option A, Yaseen: "what you see is what you get, both in a tab and an explorer").
 * The layer draws the page tab's frame (`PageFrame`) in read and in edit: the title and Properties in the page (read
 * only while reading; a click on the title renames, "Allow edits?" first in a Read only vault), the page's own 48 px
 * sides. The editor has no row of its own here: its cog, Read only chip, Sync and Saved stand in the head
 * (`HeadChipsSlot`), as the fold-all and zoom do. A CARD FILE is one card frame in read and in edit: the card file's own
 * view (`CardFileView` through the editor) in both, E its Edit card, Done its Done. Nothing on screen moves on a switch.
 * THE HEAD'S TITLE (Q50, Yaseen: "left the title at the top in the explore, so that way when you scroll down you can
 * still see what page you're on"): a slot of fixed height, see-through while the page's title (a card file's title
 * band) is in view; it fades in once that scrolls out of view, and out when it comes back. Opacity only: the head
 * never changes height.
 */
import { UnitContext, useVaultUnit } from '../vault/unitWord'
import { usePageId } from '../search/showIds'
import { Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { fileKind } from '@shared/fileKind'
import { splitFrontmatter } from '@shared/frontmatter'
import { isCardFileContent } from '@shared/cardFileFormat'
import { readPageSwitches, type PageSwitches } from '@shared/pageSwitches'
import type { CommentsOrder, PageView, PropertiesResponse } from '@shared/types'
import type { CardReview } from '@shared/cardLine'
import { DEFAULT_REVIEW_SETTINGS, type ReviewSettings } from '@shared/reviews'
import { api } from '../api'
import { CommentsSection } from '../comments/CommentsSection'
import { createCrepe, editorViewOf } from '../editor/createCrepe'
import { DocumentZoom, stepZoom } from '../editor/DocumentZoom'
import { CrepeFeature } from '../editor/crepe'
import { features } from '../editor/featureConfig'
import { FindBar } from '../editor/find/FindBar'
import { createFindChannel } from '../editor/find/findChannel'
import { FoldAllButton } from '../editor/FoldAllButton'
import { copyText, type LinkActions } from '../editor/linkMenu'
import { PageMenu } from '../editor/pageMenu'
import { PageFrame } from '../editor/PageFrame'
import { PageTitle } from '../editor/PageTitle'
import { FrontmatterPanel } from '../editor/FrontmatterPanel'
import { HeadChipsSlot, LAYER_ESCAPE } from '../editor/StatusChips'
import { usePathTitles } from '../lib/pageLabel'
import { FOLDS_CHANGED_EVENT, nextDocumentFold, setAllDocumentFolds } from '../editor/outline/foldAllHotkeys'
import type { MenuSection } from '../sidebar/menuSections'
import { hrefTarget } from '../editor/pathPaste'
import type { WikilinkCandidateSource } from '../editor/wikilink/wikilinkPicker'
import type { WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import type { ViewOnlyLinkSource } from '../editor/wikilink/viewOnlyLinkSource'
import { fileIconDecoration, IconsContext } from '../sidebar/FileIcon'
import { BacklinksSection } from '../links/BacklinksSection'
import { savedFirst } from '../lib/renameContinuity'
import { storage } from '../lib/storage'
import { editingLabel, ReadOnlyChip } from '../editor/ReadOnlyChip'
import { useTimedUnlock } from '../editor/useTimedUnlock'
import { HeadMore, useCompactHead } from './ExploreHeadMore'
import { landOn } from '../editor/toc/tocMotion'
import { cardBlockViewOfDom } from '../editor/card/cardBlockView'
import { pageCardIn, type CardPlace } from '../editor/card/cardOpen'
import { recordAt } from '../editor/card/embedCard'
import { keepPlace, readPagePlace, showPagePlace, type PagePlace } from '../editor/pagePlace'
import { readPageViewOf } from '../lib/pageView'
import { READ_ONLY_EDIT, ReadOnlyEditEvent } from '../editor/readOnlyEdit'
import type { BeforeVaultLock } from '../vault/readOnlyVault'
import { KeyLabel } from '../keys/KeyLabel'
import { DONE_KEYS, withKeys } from '@shared/keyLabel'

/** The vault the page is in: what its links resolve against. */
export interface ExploreVault {
  root: string
  wikilinks: WikilinkResolveSource
  wikilinkCandidates: WikilinkCandidateSource
  /** The vault's catalog of files that are no pages: a board embed and a link to a drawing resolve through it. */
  viewOnlyLinks?: ViewOnlyLinkSource
  /** The vault's Read only (YAZ-4939): E asks with the timed "Allow edits" box before the layer edits. False while the vault's unlock runs (YAZ-5581). */
  readOnly?: boolean
  /** The vault's relock (YAZ-5581): an editing layer goes back to reading first. Stable. */
  beforeLock?: BeforeVaultLock
  /** The vault's card review (YAZ-4962): the card window's strip and Reviews table read the settings; its delete writes. */
  review?: { settings: ReviewSettings; deleteReview: (path: string, id: string, review: CardReview) => Promise<void> }
}

/** The page frame's doors from App (YAZ-5164 Option A): the vault's property declarations and the title's rename. */
export interface PageFrameDoors {
  properties?: PropertiesResponse | null
  onRetitle: (title: string) => void
}

interface ExplorePageProps {
  path: string
  mode: 'read' | 'edit'
  /** Bumped by the stack when the page was deleted under the layer: read again, and say it is gone. */
  gone?: number
  title: string
  /** YAZ-4940: the vault's "Show IDs in the title"; On draws the page's ID after the title, small and muted. */
  idInTitle?: boolean
  vault: ExploreVault
  /** The text formatting of the page's vault (`--text-size` and the heading variables), as every page layer wears it. */
  style?: CSSProperties
  /** The page frame's doors (YAZ-5164): absent, the reading title does not rename and Properties have no types. */
  frame?: PageFrameDoors
  /** A link in the page to a page of the window's vaults: a page goes on top of the stack; another file opens in a tab. */
  onOpenLink: (path: string) => void
  /**
   * The editor of a page, with `openLink` as its link door (App's `renderPageEditor` with the stack's door).
   * `unlocked`: a timed "Allow edits" of this layer runs, so the vault's Read only does not lock the editor (YAZ-4939).
   * `start`: where the reading layer stood as it went into edit (YAZ-5164), read by the editor as it mounts.
   */
  renderEditor: (path: string, openLink: (path: string) => void, unlocked: boolean, start?: PageView) => ReactNode
  /** Where a bare unresolved `[[link]]` makes its page (App's `newPageFolderFor`), root-relative. */
  createFolder: (sourcePath: string) => string
  /** App's read-only door (YAZ-4985): a link to a missing page asks it before the page is made. Absent: the page is made. */
  onFileAction?: (root: string) => Promise<boolean>
  linkActions?: LinkActions
  onNotice: (message: string) => void
  /** Edit (reading) / Done (editing): the layer's mode flips; E and Esc reach it too (`ExploreStack`). */
  onToggleEdit: () => void
  /** Bumped by the stack's E in a Read only vault (YAZ-4939): the layer asks first, or edits while its unlock runs. */
  editAsk?: number
  /** Bumped by ⌘↵ in edit (YAZ-4988): save, lock again at once while the timed unlock runs (Lock now), and read. */
  leaveAsk?: number
  /** The card to land on once the page shows (YAZ-4962): found by its ID (YAZ-5164, `pageCardIn`), its index only while it has none. */
  card?: CardPlace
  /** The Inbox's E on a card in a page (YAZ-5145): once the layer edits, the card at `card` opens in Edit card, one time. A card file's opens by itself (round 3). */
  editCard?: boolean
  /** Opened by the Inbox (YAZ-5145): ⌘↵ while reading goes back to it, so ↗ does not say ⌘↵. */
  fromInbox?: boolean
  /**
   * ‹ › (round 3): the page's place among the rows of the search under it ("2/3"), whether a step each way exists,
   * and the step. A page opened from a link has no search under it, so no ‹ ›.
   */
  steps?: LayerSteps
  /** The head's drag (round 3): the layer moves with the pointer; a double click puts it back in its stack place. */
  onHeadDown?: (event: ReactMouseEvent) => void
  onHeadReset?: (event: ReactMouseEvent) => void
  /** The zoom of every page layer (round 4): the page zoom's pill in the head, and `--document-zoom` on the body, as a page tab's scroller carries it. */
  zoom: number
  onZoom: (zoom: number) => void
  /** The comment stream's order (YAZ-1515), the setting, and its toggle: as every page layer has them. */
  commentsOrder: CommentsOrder
  onChangeCommentsOrder: (order: CommentsOrder) => void
  onOpenInTab: () => void
  /** The page menu (round 1, items 6 and 7): a right-click on the head opens it at the pointer; in the text it follows the text menu. */
  onHeadMenu: (x: number, y: number) => void
  pageMenu: () => MenuSection[]
  onClose: () => void
  /** This layer is the top one: the body takes the focus, so E and Esc are heard. */
  active: boolean
}

/** ‹ n/m › of a layer opened from a search (round 3): its place among the rows, whether a step each way exists, the step. */
export interface LayerSteps {
  place: number
  count: number
  prev: boolean
  next: boolean
  onStep: (dir: -1 | 1) => void
}

/** A press on a head button keeps the keyboard where it is (the reading body, the editor, the board). */
export const keepFocus = (event: ReactMouseEvent) => event.preventDefault()

/** ‹ n/m › in a layer's head (a page's, a board's: YAZ-4943). */
export function ExploreSteps({ steps }: { steps: LayerSteps }) {
  return (
    <span className="explore__steps" data-fold-part="steps">
      <button type="button" className="explore__step" title={withKeys('Previous search result', '← / ⌘⌥↑')} aria-label="Previous search result" disabled={!steps.prev} onMouseDown={keepFocus} onClick={() => steps.onStep(-1)}>
        ‹
      </button>
      <span className="explore__count">{steps.place === 0 ? '' : `${steps.place}/${steps.count}`}</span>
      <button type="button" className="explore__step" title={withKeys('Next search result', '→ / ⌘⌥↓')} aria-label="Next search result" disabled={!steps.next} onMouseDown={keepFocus} onClick={() => steps.onStep(1)}>
        ›
      </button>
    </span>
  )
}

/** ⋯'s ‹ › rows in a folded head (YAZ-4956): the place as a heading, then the two steps. */
export function stepRows(steps: LayerSteps): MenuSection {
  return [
    ...(steps.place === 0 ? [] : [{ id: 'place', label: `Result ${steps.place}/${steps.count}`, heading: true as const, onSelect: () => {} }]),
    { id: 'previous', label: 'Previous result', hint: '←', disabled: !steps.prev, onSelect: () => steps.onStep(-1) },
    { id: 'next', label: 'Next result', hint: '→', disabled: !steps.next, onSelect: () => steps.onStep(1) },
  ]
}

/** ⋯'s last rows (YAZ-4956): ↗, and the ID's copy when the head shows one. */
export function openRows(onOpenInTab: () => void, pageId: string | undefined, onNotice: (message: string) => void): MenuSection {
  return [
    { id: 'open-tab', label: 'Open in a tab', hint: '⌘↵', onSelect: onOpenInTab },
    ...(pageId === undefined ? [] : [{ id: 'copy-id', label: 'Copy ID', hint: pageId, onSelect: () => copyText(pageId, 'ID', onNotice, undefined, true) }]),
  ]
}

/** How long a page that left the index waits before it is read again and said gone (YAZ-4990): a save through a temporary file is back by then. */
export const GONE_CHECK_MS = 300

/** How many frames (16 ms) an edit layer waits for its editor to mount a card's Edit card: a cold editor can take a while. */
const EDITOR_TRIES = 120

/** A read-only Crepe goes: out of the page at once, destroyed once it is up. */
function retire({ crepe, el, up }: { crepe: ReturnType<typeof createCrepe>; el: HTMLElement; up: Promise<void> }): void {
  el.remove()
  void up.then(() => crepe.destroy())
}

/** The page editor's features minus the two that exist to edit blocks (the preview panel's set). */
const readFeatures = { ...features, [CrepeFeature.BlockEdit]: false, [CrepeFeature.Toolbar]: false }

type Content = { kind: 'loading' } | { kind: 'body'; body: string; switches: PageSwitches } | { kind: 'empty' } | { kind: 'gone' }

export function ExplorePage({ path, mode, gone = 0, title, idInTitle = false, vault, style, frame, onOpenLink, renderEditor, createFolder, onFileAction, linkActions, onNotice, onToggleEdit, editAsk = 0, leaveAsk = 0, card, editCard = false, fromInbox = false, steps, onHeadDown, onHeadReset, zoom, onZoom, commentsOrder, onChangeCommentsOrder, onOpenInTab, onHeadMenu, pageMenu, onClose, active }: ExplorePageProps) {
  // The layer's vault's word for a page (YAZ-4938), for its own words and for every panel inside it.
  const unit = useVaultUnit(vault.root)
  const pageId = usePageId(idInTitle ? vault.wikilinks : undefined, path)
  const titles = usePathTitles(vault.wikilinks)
  const bodyRef = useRef<HTMLDivElement>(null)
  // A head narrower than it needs folds into ⋯ (YAZ-4956).
  const headRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLSpanElement>(null)
  useCompactHead(headRef, titleRef)
  /** Where the read-only Crepe mounts: its own box ABOVE the comment stream and the mentions, as the page tab stacks them. */
  const mountRef = useRef<HTMLDivElement>(null)
  const [content, setContent] = useState<Content>({ kind: 'loading' })
  /** The read-only Crepe once it is up, for the fold-all button (round 1, item 4); null while loading or editing. */
  const [ready, setReady] = useState<ReturnType<typeof createCrepe> | null>(null)
  /**
   * The body on show (YAZ-5164: "it should just be so smooth", no flash). A switch of `mode` mounts the other body
   * UNDER the one on show, see-through (`explore__body--incoming`), and the old one stays until the new one is up at the
   * same place in the text: the reading Crepe once it is built and placed, the editor once it answers its page view
   * (`readPageViewOf`). Then both swap in one frame.
   */
  const [shown, setShown] = useState<'read' | 'edit'>(mode)
  /**
   * Back from the editor (YAZ-5164), the text read before it is old: the editor saved. The reading Crepe waits for the
   * read again, so it is built once, from the saved text, and placed once (a Crepe of the old text was built, then thrown
   * away by the read's "loading", and the next one opened at the top).
   */
  const [stale, setStale] = useState(false)
  const icons = useContext(IconsContext)
  /** ⌘F in the reading layer finds in THIS page (check 11): the page's own find plugin on this Crepe, and its bar. */
  const findChannel = useMemo(() => createFindChannel(), [])
  // The doors, read at click time: a layer's Crepe is built once, and the stack's callbacks may change identity.
  const doors = useRef({ onOpenLink, createFolder, onFileAction, linkActions, onNotice, review: vault.review })
  doors.current = { onOpenLink, createFolder, onFileAction, linkActions, onNotice, review: vault.review }

  /** The whole file as read, frontmatter included: the comment stream's truth. */
  const readRef = useRef('')
  /**
   * Bumped when the index says this page changed (YAZ-4990, the small version): the layer reads it again in place, with
   * no "loading" between. `rereading` says the next read is such a read again.
   */
  const [reread, setReread] = useState(0)
  const rereading = useRef(false)
  // Reading: the saved text, read once per mount (the preview panel's rule). Back from edit, it is read again: the editor
  // saved. Again when the page changes on disk (YAZ-4990): the same text keeps the same Crepe.
  useEffect(() => {
    if (mode !== 'read') return
    let live = true
    // A reading Crepe still on show (a switch to edit taken back before the editor was up) is read again in place.
    const again = rereading.current || shownCrepe.current !== null
    rereading.current = false
    if (!again) setContent({ kind: 'loading' })
    // A save of this page still on its way (an editor's flush, YAZ-3685 F5) lands first: the read sees the typed text.
    Promise.resolve(savedFirst(path))
      .then(() => api.readFile(path))
      .then(
      (file) => {
        if (!live) return
        readRef.current = file.content
        setStale(false)
        const body = splitFrontmatter(file.content).body
        const switches = readPageSwitches(file.content)
        setContent((prev) =>
          body.trim() === '' ? { kind: 'empty' } : prev.kind === 'body' && prev.body === body && JSON.stringify(prev.switches) === JSON.stringify(switches) ? prev : { kind: 'body', body, switches },
        )
      },
      () => {
        if (!live) return
        setStale(false)
        setContent({ kind: 'gone' })
      },
    )
    return () => {
      live = false
    }
  }, [path, mode, gone, reread])
  // The page changes outside this layer while it reads (YAZ-4990): an agent, a sync, another tab, the Inbox. The index
  // says so (the card layer's way, `ExploreCard`): a new mtime or size of this page reads it again; another page's
  // change does nothing. A page that leaves the index is read again after a short wait: deleted, the layer says it is
  // gone; a save through a temporary file (delete, then create) is back by then and reads as a change.
  const { wikilinks: indexOfVault } = vault
  useEffect(() => {
    if (mode !== 'read') return
    const recordOf = () => indexOfVault.records.find((r) => r.path === path)
    let seen = recordOf()
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = indexOfVault.subscribe(() => {
      const now = recordOf()
      const same = now === seen || (now !== undefined && seen !== undefined && now.mtime === seen.mtime && now.size === seen.size)
      seen = now
      if (same) return
      clearTimeout(timer)
      timer = setTimeout(
        () => {
          rereading.current = true
          setReread((n) => n + 1)
        },
        now === undefined ? GONE_CHECK_MS : 0,
      )
    })
    return () => {
      off()
      clearTimeout(timer)
    }
  }, [mode, path, indexOfVault])

  /**
   * A card file (YAZ-5164 Option A: one card frame in read and in edit): the index says so, or the text the layer read
   * (a card file just made). It shows the card file's own view in both modes; no reading Crepe is built for it.
   */
  const cardFile = fileKind(path) === 'markdown' && (recordAt(indexOfVault.records, path)?.kind === 'card' || (content.kind === 'body' && isCardFileContent(readRef.current)))
  // The reading Crepe stays while it is on show, under an editor that is not up yet (YAZ-5164).
  const body = !cardFile && (mode === 'read' || shown === 'read') && !stale && content.kind === 'body' ? content.body : null
  const switches = content.kind === 'body' ? content.switches : undefined
  // The vault's three parts, not the object: App hands a new object each render, and the Crepe is built once per body.
  const { root, wikilinks, wikilinkCandidates, viewOnlyLinks } = vault
  /**
   * The folds of the page (YAZ-4990): kept here, so a Crepe built again for the new text of the SAME page opens with
   * them (the fold plugins' seed, by their keys). A step to another page starts with none.
   */
  const folds = useRef({ path, outline: new Set<string>() as ReadonlySet<string>, heading: new Set<string>() as ReadonlySet<string> })
  /** The Crepe on show while the next one for the same page is built (YAZ-4990): it goes in the same frame the new one shows. */
  const shownCrepe = useRef<{ path: string; crepe: ReturnType<typeof createCrepe>; el: HTMLElement; up: Promise<void> } | null>(null)
  /** Where the editor stood as the layer went back to reading (YAZ-5164): put back once the reading Crepe is up, one time. */
  const back = useRef<{ path: string; top: PagePlace } | null>(null)
  /** The stop of that place, kept while the reading Crepe still draws (round 2); it ends at the person's first scroll. */
  const keeping = useRef<(() => void) | null>(null)
  useEffect(() => () => keeping.current?.(), [])
  useEffect(() => {
    const parent = mountRef.current
    const prev = shownCrepe.current
    // Another page, or no text to show: the old Crepe goes now, as before.
    if (prev !== null && (body === null || parent === null || prev.path !== path)) {
      shownCrepe.current = null
      retire(prev)
      setReady(null)
    }
    if (body === null || parent === null) return
    if (folds.current.path !== path) folds.current = { path, outline: new Set(), heading: new Set() }
    const el = document.createElement('div')
    el.className = 'editor-instance'
    // The same page read again (YAZ-4990): built out of sight, under the one on show, and swapped when it is up.
    const swap = shownCrepe.current
    if (swap !== null) el.style.cssText = 'position: absolute; inset: 0 0 auto 0; visibility: hidden; pointer-events: none'
    if (switches?.['guide-lines'] !== undefined) el.dataset.guideLines = switches['guide-lines'] ? 'on' : 'off'
    if (switches?.folding !== undefined) el.dataset.folding = switches.folding ? 'on' : 'off'
    if (switches?.['bullet-threading'] !== undefined) el.dataset.threading = switches['bullet-threading'] ? 'on' : 'off'
    parent.appendChild(el)
    const foldingOn = switches?.folding ?? storage.getSettings().foldingOnByDefault
    const open = (target: string) => doors.current.onOpenLink(target)
    const place = { root, pagePath: path, candidates: wikilinkCandidates }
    const crepe = createCrepe({
      root: el,
      defaultValue: body,
      features: readFeatures,
      wikilinks,
      foldingOn: () => foldingOn,
      find: findChannel,
      // A board embed, a link to a drawing or a PDF: the vault's view-only catalog, as in the page tab (else "Missing drawing").
      viewOnlyLinks,
      // The pills' icons, and a board embed as its window, read only (round 1, item 2): what the page tab draws.
      linkLook: { icon: (target, folder) => fileIconDecoration(icons, target, folder) },
      boardEmbeds: { root },
      // The page's links, live (the read-only rule: a plain click opens, YAZ-3879 point 6). An unresolved link is made first, as everywhere.
      wikilinkNav: { ...doors.current.linkActions, root, createFolder: () => doors.current.createFolder(path), openCurrent: open, openNewTab: open, openBackground: open, onNotice: (m) => doors.current.onNotice(m), allowFileAction: (vault) => doors.current.onFileAction?.(vault) ?? Promise.resolve(true) },
      markdownLinkNav: {
        ...doors.current.linkActions,
        open: (href) => api.shell.openLink({ href, sourcePath: path }),
        inApp: (href) => hrefTarget(href, place),
        openPath: open,
        onNotice: (m) => doors.current.onNotice(m),
      },
      // Pictures resolve against the page's folder, as in its page (YAZ-1656).
      image: { root, pagePath: path },
      // "Reviews (n)" under each card (YAZ-5000): the card window's table; its delete writes the file, as there.
      cardReviews:
        doors.current.review === undefined
          ? undefined
          : { settings: () => doors.current.review?.settings ?? DEFAULT_REVIEW_SETTINGS, deleteReview: (p, id, r) => doors.current.review?.deleteReview(p, id, r) ?? Promise.resolve(), vault: () => ({ root, wikilinks }) },
      // The folds, kept for a read again of this page (YAZ-4990).
      folding: { seedCollapsedKeys: () => folds.current.outline, onCollapsedKeysChange: (keys) => (folds.current = { ...folds.current, outline: new Set(keys) }) },
      headingFolding: { seedCollapsedKeys: () => folds.current.heading, onCollapsedKeysChange: (keys) => (folds.current = { ...folds.current, heading: new Set(keys) }) },
    })
    let live = true
    const mine = { path, crepe, el, up: Promise.resolve() }
    mine.up = crepe.create().then(() => {
      crepe.setReadonly(true)
      if (!live) return
      // The swap (YAZ-4990): the old Crepe out and the new one in, and the scroll place put back, in one task: no frame
      // shows the page empty or at another place.
      const scroller = bodyRef.current
      const top = scroller?.scrollTop ?? 0
      if (swap !== null && shownCrepe.current === swap) retire(swap)
      el.style.cssText = ''
      if (scroller !== null && scroller.scrollTop !== top) scroller.scrollTop = top
      shownCrepe.current = mine
      // Back from edit (YAZ-5164): at the block the editor had at its top; once more a frame later, when the blocks above have drawn.
      const from = back.current
      if (from !== null && from.path === path && scroller !== null) {
        back.current = null
        // Again while the blocks above still draw (card embeds, pictures), until the person scrolls (round 2).
        keeping.current?.()
        keeping.current = keepPlace(scroller, () => live && showPagePlace(editorViewOf(crepe), scroller, from.top))
      }
      setReady(crepe)
      setShown('read')
    })
    return () => {
      live = false
      // A Crepe on show stays until the next one is up (or the next run takes it away); one never shown goes now.
      if (shownCrepe.current !== mine) retire(mine)
    }
    // `icons` is read at each link draw; a change of the icon rules redraws no preview (the preview panel's rule).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, switches, path, root, wikilinks, wikilinkCandidates, viewOnlyLinks, findChannel])

  // The layer closes: the Crepe on show goes with it (declared after the Crepe's effect, so its cleanup runs last).
  useEffect(
    () => () => {
      if (shownCrepe.current !== null) retire(shownCrepe.current)
      shownCrepe.current = null
    },
    [],
  )

  // The fold-all button (round 1, item 4): the page tab's own button and command on this layer's Crepe.
  const subscribeFolds = useCallback(
    (changed: () => void) => {
      if (ready === null) return () => {}
      const dom = editorViewOf(ready).dom
      dom.addEventListener(FOLDS_CHANGED_EVENT, changed)
      return () => dom.removeEventListener(FOLDS_CHANGED_EVENT, changed)
    },
    [ready],
  )
  const foldAll = ready !== null && mode === 'read' && (
    <FoldAllButton
      read={() => (ready === null ? 'none' : nextDocumentFold(editorViewOf(ready).state))}
      run={(collapse) => {
        if (ready === null) return
        const view = editorViewOf(ready)
        setAllDocumentFolds(collapse)(view.state, view.dispatch)
      }}
      subscribe={subscribeFolds}
      keys={{ collapse: 'page.foldAll', expand: 'page.unfoldAll' }}
    />
  )
  // Land on the card the layer opened for (YAZ-4962: the Inbox's O and E, the card window's page name), once: the
  // outline's landing (`landOn`). Reading: once the read-only Crepe is up. Editing: the editor mounts a tick later, so
  // ask a few frames until its card is there.
  const landed = useRef(false)
  const editBodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (card === undefined || landed.current || (mode === 'read' && ready === null)) return
    let tries = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = () => {
      const scope = mode === 'read' ? mountRef.current : editBodyRef.current
      const target = pageCardIn(scope, card)
      if (target !== null) {
        landed.current = true
        landOn(target)
        return
      }
      if (++tries <= 40) timer = setTimeout(tick, 16)
    }
    tick()
    return () => clearTimeout(timer)
  }, [card, mode, ready])

  // E edits the thing you look at (YAZ-5145, Yaseen: "e would edit the card"; round 3, Q38: "if you're opening a card
  // file. Then it makes sense that if you're editing, you're going to edit the card"). Each time the layer goes into
  // edit — E, Edit, or the choice in "Allow edits?" that goes on to edit it — a card file opens its Edit card, by its
  // own button, as the card file tab's E does. The index says it is one, or the text the layer read (a card file just
  // made, Move to its own file, before the index has it). The Inbox's E on a card in a page (`editCard`, `card`): that
  // card, as its own Edit card does, one time. A page alone edits as a page. The editor mounts a tick later: ask a few frames.
  const pageCardAsked = useRef<CardPlace | null>(editCard && card !== undefined ? card : null)
  const cardOpened = useRef(false)
  useEffect(() => {
    if (mode !== 'edit') {
      cardOpened.current = false
      return
    }
    if (cardOpened.current) return
    const pageCard = pageCardAsked.current ?? undefined
    if (pageCard === undefined && recordAt(indexOfVault.records, path)?.kind !== 'card' && !isCardFileContent(readRef.current)) return
    let tries = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = () => {
      const scope = editBodyRef.current
      const view = pageCard === undefined ? null : cardBlockViewOfDom(pageCardIn(scope, pageCard))
      const fileEdit = pageCard === undefined ? (scope?.querySelector<HTMLButtonElement>('[data-card-file-edit]') ?? null) : null
      if ((view !== null && view.view.editable) || fileEdit !== null) {
        cardOpened.current = true
        pageCardAsked.current = null
        if (view !== null) view.edit()
        else fileEdit?.click()
        return
      }
      if (++tries <= EDITOR_TRIES) timer = setTimeout(tick, 16)
    }
    tick()
    return () => clearTimeout(timer)
    // The path and the index are read when the layer goes into edit: a step while editing keeps the editor as it is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, mode])

  /** The saved text for the comment stream (round 1, item 3): what was read, until the block's own write moves it. */
  const file = content.kind === 'body' || content.kind === 'empty' ? { path, content: readRef.current } : null

  // The editor is up (YAZ-5164): it answers its page view once its start view is applied, so it is at the reading
  // layer's place. Then it shows, in the same frame the reading body goes. A view with no page view (a card file's) shows
  // after a short wait, as before.
  useEffect(() => {
    if (mode !== 'edit' || shown === 'edit') return
    let frames = 0
    let id = 0
    const tick = () => {
      const host = editBodyRef.current?.querySelector('.editor-host')
      if (readPageViewOf(host) !== undefined || editBodyRef.current?.querySelector('[data-card-file-edit]') != null || ++frames > EDITOR_TRIES) {
        setShown('edit')
        return
      }
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [mode, shown])
  // Nothing to build (an empty page, a page gone): the reading body shows at once.
  useEffect(() => {
    if (mode === 'read' && shown !== 'read' && (content.kind === 'empty' || content.kind === 'gone')) setShown('read')
  }, [mode, shown, content.kind])

  // The top layer's body takes the focus, so E and Esc work with no click; a layer uncovered again takes it back.
  // Again once the reading body is on show (YAZ-5164): the editor it replaced had the keyboard until then.
  useEffect(() => {
    if (active && mode === 'read') bodyRef.current?.focus({ preventScroll: true })
  }, [active, mode, shown])
  // A card file's body takes it (its E, P and ⌘F are its own), once its view is up.
  useEffect(() => {
    if (!active || !cardFile || mode !== 'read') return
    let tries = 0
    let id = 0
    const tick = () => {
      const own = editBodyRef.current?.querySelector<HTMLElement>('[data-card-file-body]')
      if (own != null) {
        if (!own.contains(document.activeElement)) own.focus({ preventScroll: true })
        return
      }
      // Until its view is up, the body holds the keyboard, so E and Esc are heard.
      if (tries === 0 && !(editBodyRef.current?.contains(document.activeElement) ?? true)) editBodyRef.current?.focus({ preventScroll: true })
      if (++tries <= EDITOR_TRIES) id = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(id)
  }, [active, cardFile, mode])

  const page = fileKind(path) === 'markdown'
  // The vault's Read only (YAZ-4939): the layer edits only while its own timed unlock runs. At zero, or on Lock now,
  // an editing layer goes back to reading (its editor's save first, as Done does).
  const locked = vault.readOnly === true
  const leave = useRef({ mode, onToggleEdit })
  leave.current = { mode, onToggleEdit }
  const unlock = useTimedUnlock(() => {
    if (leave.current.mode === 'edit') leave.current.onToggleEdit()
  }, vault.beforeLock)
  const unlocked = locked && unlock.until !== null
  const [asking, setAsking] = useState(false)
  /** E and Edit: edit, or ask first while the vault locks the layer. */
  const edit = () => (locked && !unlocked ? setAsking(true) : onToggleEdit())
  const editRef = useRef(edit)
  editRef.current = edit
  useEffect(() => {
    if (editAsk > 0) editRef.current()
  }, [editAsk])

  // A card's Edit card while reading (YAZ-5164): the reading Crepe refuses it (`tellReadOnlyEdit` from the card itself;
  // its title's rename and typing come from inside and stay refused). The layer edits as E does, and once it edits,
  // that card opens in Edit card (`pageCardAsked`), kept where it is on screen (`pinned`). Cancel drops it.
  const pinned = useRef<HTMLElement | null>(null)
  /** A click on the locked title while reading (YAZ-5164 Option A): its rename, run once "Allow edits?" unlocks the layer. */
  const titleAsked = useRef<(() => void) | null>(null)
  useEffect(() => {
    const body = cardFile ? editBodyRef.current : bodyRef.current
    if (mode !== 'read' || body === null) return
    const onAttempt = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null
      // The title (the page's, a card file's band): ask, then rename. The layer stays reading.
      if (target?.closest('.page-title') != null && event instanceof ReadOnlyEditEvent && event.resume !== undefined) {
        titleAsked.current = event.resume
        editRef.current()
        return
      }
      // A card file's Edit card and E: the layer asks, then edits, and E edits the thing you look at: its Edit card.
      if (cardFile) return editRef.current()
      const own = target instanceof HTMLElement && target.matches('[data-page-card]') ? target : null
      if (own === null) return
      const cards = [...(mountRef.current?.querySelectorAll<HTMLElement>('[data-page-card]') ?? [])]
      pageCardAsked.current = { id: own.dataset.cardId ?? null, index: cards.indexOf(own) }
      pinned.current = own
      editRef.current()
    }
    body.addEventListener(READ_ONLY_EDIT, onAttempt)
    return () => body.removeEventListener(READ_ONLY_EDIT, onAttempt)
  }, [mode, cardFile])
  // A card file (YAZ-5164 Option A): its Edit card IS the layer's edit. Done (the head's, Esc, ⌘↵) closes the Edit card
  // with its own Done, and the card's own Done (its button, Esc in it) takes the layer back to reading; an Edit card
  // opened in the card (its button, its E) takes the layer to edit. One card frame, one state.
  const modeNow = useRef(mode)
  modeNow.current = mode
  /** Back to reading while the Edit card is still opening (a quick E then Esc): it is closed once it is open. */
  const closing = useRef(false)
  useEffect(() => {
    if (!cardFile || mode !== 'read') return
    let tries = 0
    let id = 0
    const tick = () => {
      const host = editBodyRef.current?.querySelector('[data-explore-card-edit]') ?? null
      const card = host?.querySelector('.card') ?? null
      closing.current = host !== null
      if (host === null) return
      if (card?.classList.contains('card--editing') === true) {
        cardBlockViewOfDom(card)?.done()
        return
      }
      if (++tries <= EDITOR_TRIES) id = requestAnimationFrame(tick)
    }
    tick()
    return () => {
      cancelAnimationFrame(id)
      closing.current = false
    }
  }, [cardFile, mode])
  useEffect(() => {
    const scope = editBodyRef.current
    if (!cardFile || scope === null) return
    const open = () => scope.querySelector('[data-explore-card-edit]') !== null
    let was = open()
    const observer = new MutationObserver(() => {
      const now = open()
      if (now === was) return
      was = now
      // The Edit card a quick Esc closed is gone: a later one is the person's again.
      if (!now) closing.current = false
      if (now === (modeNow.current === 'edit') || (now && closing.current)) return
      if (now) cardOpened.current = true
      leave.current.onToggleEdit()
    })
    observer.observe(scope, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [cardFile])
  /**
   * Where the reading layer stood as it went into edit (YAZ-5164), for the editor's start: read in the render that turns
   * the layer to edit, while the reading Crepe is still on screen. Only for this path: a step while editing starts the
   * next page as before. Null while nothing is drawn (still loading): the editor starts as before.
   */
  const start = useRef<{ path: string; view: PageView } | null>(null)
  const shownMode = useRef(mode)
  if (shownMode.current !== mode) {
    shownMode.current = mode
    start.current = mode === 'edit' ? readStart() : null
    // Only from an editor on show: a switch taken back before it was up left the reading Crepe where it was.
    back.current = null
    if (mode === 'read' && shown === 'edit' && !cardFile) {
      readBack()
      setStale(true)
    }
    pinned.current = null
  }
  /**
   * The same handoff in reverse (YAZ-5164): Esc or Done, and the reading layer opens where the editor stood. Read in the
   * render that turns the layer to reading, while the editor is still on screen (its page view, `readPageViewOf`): its
   * folds seed the reading Crepe, and its place in the text is put back once that Crepe is up (`back`).
   */
  function readBack(): void {
    const view = readPageViewOf(editBodyRef.current?.querySelector('.editor-host'))
    back.current = view?.top === undefined ? null : { path, top: view.top }
    if (view === undefined) return
    const keys = view.folds.filter((k) => !k.startsWith('lock:'))
    folds.current = { path, outline: new Set(keys.filter((k) => !k.startsWith('h:'))), heading: new Set(keys.filter((k) => k.startsWith('h:'))) }
  }
  function readStart(): { path: string; view: PageView } | null {
    const scroller = bodyRef.current
    if (ready === null || scroller === null) return null
    const place = readPagePlace(editorViewOf(ready), scroller, pinned.current ?? undefined)
    if (place === null) return null
    // The folds the layer shows (and the page's rows locked open, which it keeps), so the text above lays out the same.
    const locks = storage.getFolds(root, path).filter((k) => k.startsWith('lock:'))
    const shown = folds.current.path === path ? [...folds.current.outline, ...folds.current.heading] : []
    return {
      path,
      view: { top: { pos: place.pos, offset: place.offset }, selection: { anchor: place.caret, head: place.caret }, scrollTop: scroller.scrollTop, zoomKey: null, folds: [...locks, ...shown], magnification: 100 },
    }
  }
  /**
   * Leaving edit: ⌘↵ (YAZ-4988), and Esc and Done too (YAZ-4997: Yaseen wants Esc to go back to read only). Lock now while
   * the unlock runs (it saves and reads, `useTimedUnlock`'s `beforeLock`), else Done; the next E asks again.
   */
  const leaveEdit = () => {
    if (unlocked) unlock.lock()
    else if (mode === 'edit') onToggleEdit()
  }
  const leaveRef = useRef(leaveEdit)
  leaveRef.current = leaveEdit
  useEffect(() => {
    if (leaveAsk > 0) leaveRef.current()
  }, [leaveAsk])
  // Esc in the editor's text (YAZ-5164): the editor hands it here, the layer goes back to reading.
  useEffect(() => {
    const own = editBodyRef.current
    if (own === null || mode !== 'edit') return
    const onEscape = () => leaveRef.current()
    own.addEventListener(LAYER_ESCAPE, onEscape)
    return () => own.removeEventListener(LAYER_ESCAPE, onEscape)
  }, [mode, shown, cardFile])
  const chip = locked && (
    // A press in the chip or its box is not the head's drag, and a double click is not its reset.
    <span className="explore__lock" data-fold-part="chip" onMouseDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <ReadOnlyChip
        asking={asking}
        onAsk={() => setAsking(true)}
        onAllow={(choice) => {
          setAsking(false)
          unlock.allow(choice)
          // A click on the title asked (YAZ-5164): its rename goes on, the layer still reading.
          const rename = titleAsked.current
          titleAsked.current = null
          if (rename !== null) return rename()
          if (mode === 'read') onToggleEdit()
        }}
        onCancel={() => {
          setAsking(false)
          titleAsked.current = null
          // A card's Edit card that asked (YAZ-5164) does not wait for a later E: E edits the page.
          if (mode === 'read') {
            pageCardAsked.current = null
            pinned.current = null
          }
        }}
        editingUntil={unlock.until}
        onLock={unlock.lock}
        lockKeys
        // Back to the reading layer after Cancel or Esc (YAZ-4997 round 2), so E and Esc are heard again; a choice opens
        // the editor, which takes the caret itself.
        onReturn={() => {
          if (mode === 'read') bodyRef.current?.focus({ preventScroll: true })
        }}
      />
    </span>
  )
  /** Where the editor's chips stand (YAZ-5164 Option A): the head's slot, once it is drawn. */
  const [chipsSlot, setChipsSlot] = useState<HTMLElement | null>(null)
  /**
   * The head's title (Q50): shown while the page's own title (`.page-header`; a card file's title band) is out of view,
   * above the top of the body on show. Read on each scroll of the body and each change in it, at most once a frame.
   */
  const [titleOut, setTitleOut] = useState(false)
  useEffect(() => {
    const scope = cardFile || shown === 'edit' ? editBodyRef.current : bodyRef.current
    if (scope == null) return
    let frameId = 0
    const check = () => {
      frameId = 0
      const own = [...scope.querySelectorAll<HTMLElement>('.page-header, .card-band')].find((el) => !el.hidden && el.closest('.card-pane__incoming') === null && el.getClientRects().length > 0)
      if (own === undefined) return
      setTitleOut(own.getBoundingClientRect().bottom <= scope.getBoundingClientRect().top)
    }
    const soon = () => {
      if (frameId === 0) frameId = requestAnimationFrame(check)
    }
    check()
    soon()
    scope.addEventListener('scroll', soon, true)
    const observer = new MutationObserver(soon)
    observer.observe(scope, { childList: true, subtree: true })
    return () => {
      cancelAnimationFrame(frameId)
      scope.removeEventListener('scroll', soon, true)
      observer.disconnect()
    }
  }, [cardFile, shown, ready, path])
  /** The text formatting of the vault, and the zoom as the page tab's scroller carries it (`--document-zoom`, app.css): the same rules scale the page's content. */
  const bodyStyle = { ...style, '--document-zoom': zoom / 100 } as CSSProperties
  /** ⋯ of a folded head (YAZ-4956): what the folded parts do, built when the menu opens. */
  const moreSections = (): MenuSection[] => {
    const view = ready !== null && mode === 'read' ? editorViewOf(ready) : null
    const fold = view === null ? null : nextDocumentFold(view.state)
    const zoomIn = stepZoom(zoom, 1)
    const zoomOut = stepZoom(zoom, -1)
    const pageRows: MenuSection = [
      ...(fold === null ? [] : [{ id: 'fold-all', label: fold === 'expand' ? 'Expand all' : 'Collapse all', disabled: fold === 'none', onSelect: () => view !== null && setAllDocumentFolds(fold === 'collapse')(view.state, view.dispatch) }]),
      ...(!page || !locked ? [] : unlocked ? [{ id: 'lock', label: 'Lock now', hint: unlock.until === null ? undefined : editingLabel(unlock.until, Date.now()), onSelect: unlock.lock }] : mode === 'read' ? [{ id: 'allow', label: 'Allow edits…', onSelect: () => setAsking(true) }] : []),
      ...(!page ? [] : mode === 'read' ? [{ id: 'edit', label: 'Edit', hint: 'E', onSelect: edit }] : [{ id: 'done', label: 'Done', hint: 'esc', onSelect: leaveEdit }]),
    ]
    return [
      steps === undefined ? [] : stepRows(steps),
      [
        { id: 'zoom', label: `Zoom ${zoom}%`, heading: true, onSelect: () => {} },
        { id: 'zoom-in', label: 'Zoom in', hint: '⌘+', disabled: zoomIn === null, onSelect: () => zoomIn !== null && onZoom(zoomIn) },
        { id: 'zoom-out', label: 'Zoom out', hint: '⌘−', disabled: zoomOut === null, onSelect: () => zoomOut !== null && onZoom(zoomOut) },
        { id: 'zoom-reset', label: 'Zoom to 100%', hint: '⌘0', disabled: zoom === 100, onSelect: () => onZoom(100) },
      ],
      pageRows,
      openRows(onOpenInTab, pageId, onNotice),
    ]
  }
  /** The page frame's header (YAZ-5164 Option A): the tab's title and Properties, read only while reading. */
  const lockedNow = locked && !unlocked
  const header = (
    <>
      <PageTitle path={path} titles={titles} readOnly={frame === undefined || lockedNow} locked={lockedNow} id={pageId} onNotice={onNotice} onRetitle={(next) => frame?.onRetitle(next)} onArrowDown={() => bodyRef.current?.focus({ preventScroll: true })} />
      {file !== null && <FrontmatterPanel file={{ ...file, mtime: 0 }} root={root} properties={frame?.properties} wikilinks={wikilinks} readOnly onNotice={onNotice} />}
    </>
  )
  /** The editor, made only where it shows: the reading layer makes none. */
  const editor = () => <Fragment key={path}>{renderEditor(path, onOpenLink, unlocked, start.current?.path === path ? start.current.view : undefined)}</Fragment>
  return (
    <UnitContext.Provider value={unit}>
      <div
        ref={headRef}
        className="explore__head"
        data-title-shown={titleOut || undefined}
        data-layer-lock={lockedNow || undefined}
        onMouseDown={onHeadDown}
        onDoubleClick={onHeadReset}
        onContextMenu={(e) => {
          e.preventDefault()
          onHeadMenu(e.clientX, e.clientY)
        }}
      >
        {/* The head's title (Q50): see-through while the page's own title is in view, faded in once it scrolls away. */}
        <span ref={titleRef} className="explore__title" title={path} aria-hidden={!titleOut || undefined}>
          {title}
        </span>
        {pageId !== undefined && <span className="explore__id">{pageId}</span>}
        {/* The parts a narrow layer folds into ⋯ one by one (YAZ-4956, YAZ-4986: `data-fold-part`, `FOLD_ORDER`); the
            title, the ID and × stay. `display: contents`, so a wide head is laid out as before. */}
        <span className="explore__fold">
          {steps !== undefined && <ExploreSteps steps={steps} />}
          {/* The page zoom's pill (round 4): one value for every page layer; a press on it is the pill's, not a drag. */}
          <span className="explore__part" data-fold-part="zoom">
            <DocumentZoom value={zoom} onChange={onZoom} />
          </span>
          {/* The page's own chips (YAZ-5164 Option A): the editor's fold-all, cog, Read only chip, Sync and Saved, here
              and not in a row over the page. Shown once the editor is on show: never two fold-all buttons at once. */}
          <span ref={setChipsSlot} className="explore__part explore__chips" data-fold-part={cardFile || shown === 'edit' ? 'chips' : undefined} hidden={!cardFile && shown !== 'edit'} onMouseDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} />
          {foldAll !== false && shown === 'read' && !cardFile && (
            <span className="explore__part" data-fold-part="fold-all">
              {foldAll}
            </span>
          )}
          {/* No "Reading" label (YAZ-4944): reading is the normal state; "Edit (E)" says what you can do. */}
          {mode === 'read' ? (
            <>
              {page && chip}
              {page && (
                <button type="button" className="explore__button" data-fold-part="edit" onClick={edit} title={withKeys(unit('Edit this page here'), 'E')}>
                  <KeyLabel action="Edit" keys="E" />
                </button>
              )}
            </>
          ) : (
            <>
              {/* In a Read only vault the chip says it: "Editing · 0:58" with Lock now. */}
              {chip || (
                <span className="explore__mode" data-fold-part="chip">
                  Editing
                </span>
              )}
              {/* Done (item 5): back to reading, as Esc and ⌘↵ (YAZ-4988) do; the page saved as you typed. In a Read only vault all three lock again at once (YAZ-4997). */}
              <button type="button" className="explore__button" data-fold-part="edit" onClick={leaveEdit} title={withKeys(locked ? 'Save, lock again and read' : 'Back to reading', DONE_KEYS)}>
                {/* The app's hotkey label (YAZ-5332): "Done (Esc / Cmd+Enter)". */}
                <KeyLabel action="Done" keys={DONE_KEYS} />
              </button>
            </>
          )}
          <button type="button" className="explore__button" data-fold-part="open" onClick={onOpenInTab} title={fromInbox ? 'Open in a tab and close the stack' : withKeys('Open in a tab and close the stack', '⌘↵')} aria-label="Open in a tab">
            ↗
          </button>
        </span>
        <HeadMore sections={moreSections} />
        <button type="button" className="explore__button" onClick={onClose} title="Close this layer (Esc)" aria-label="Close this layer">
          ×
        </button>
      </div>
      {/* Both bodies while a switch is under way (YAZ-5164): the incoming one see-through under the one on show. A card
          file has one body: its own view, in read and in Edit card. */}
      <HeadChipsSlot.Provider value={chipsSlot}>
        <div className="explore__bodies">
          {cardFile ? (
            <div ref={editBodyRef} className="explore__body explore__body--frame explore__body--card-file" style={bodyStyle} tabIndex={-1}>
              {editor()}
            </div>
          ) : (
            <>
              {(mode === 'edit' || shown === 'edit') && (
                <div ref={editBodyRef} className={`explore__body explore__body--frame explore__body--edit${shown === 'edit' ? '' : ' explore__body--incoming'}`} style={bodyStyle}>
                  {/* Keyed by the path: a step while editing saves this page and mounts the editor on the next (the body div stays, with the keyboard). */}
                  {editor()}
                </div>
              )}
              {(mode === 'read' || shown === 'read') && (
                <>
                  {/* The page tab's frame (YAZ-5164 Option A), read only: the same title, Properties, sides and blocks as the editor's. */}
                  <PageFrame ref={bodyRef} className={`explore__body explore__body--read${shown === 'read' ? '' : ' explore__body--incoming'}`} style={bodyStyle} tabIndex={-1} data-explore-read="" header={header}>
                    <div ref={mountRef} className="editor-mount" />
                    {content.kind === 'gone' && <p className="editor-msg">Can&apos;t read &quot;{title}&quot; — it is no longer there</p>}
                    {content.kind === 'empty' && <p className="editor-msg">{unit('Empty page')}</p>}
                    {/* Under the page, as in its tab (round 1, item 3): the comment stream, then "Linked mentions"; a mention opens on top. */}
                    {file !== null && (
                      <>
                        <CommentsSection file={file} order={commentsOrder} onChangeOrder={onChangeCommentsOrder} root={root} />
                        <BacklinksSection path={path} source={wikilinks} openCurrent={onOpenLink} />
                      </>
                    )}
                  </PageFrame>
                  {/* ⌘F over the top of the page, as in the tab. */}
                  <FindBar channel={findChannel} scope="page" hostRef={bodyRef} />
                  {/* The page's right-click menu (item 7): the text rows (Copy, Copy as; no Cut or Paste while reading), then the page menu. */}
                  {ready !== null && <PageMenu view={editorViewOf(ready)} extra={pageMenu} reading />}
                </>
              )}
            </>
          )}
        </div>
      </HeadChipsSlot.Provider>
    </UnitContext.Provider>
  )
}
