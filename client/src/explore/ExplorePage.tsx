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
 */
import { UnitContext, useVaultUnit } from '../vault/unitWord'
import { usePageId } from '../search/showIds'
import { Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { fileKind } from '@shared/fileKind'
import { splitFrontmatter } from '@shared/frontmatter'
import { readPageSwitches, type PageSwitches } from '@shared/pageSwitches'
import type { CommentsOrder } from '@shared/types'
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
import { KeyCaps } from '../keys/KeyCaps'

/** The vault the page is in: what its links resolve against. */
export interface ExploreVault {
  root: string
  wikilinks: WikilinkResolveSource
  wikilinkCandidates: WikilinkCandidateSource
  /** The vault's catalog of files that are no pages: a board embed and a link to a drawing resolve through it. */
  viewOnlyLinks?: ViewOnlyLinkSource
  /** The vault's Read only (YAZ-4939): E asks with the timed "Allow edits" box before the layer edits. */
  readOnly?: boolean
  /** The vault's card review (YAZ-4962): the card window's strip and Reviews table read the settings; its delete writes. */
  review?: { settings: ReviewSettings; deleteReview: (path: string, id: string, review: CardReview) => Promise<void> }
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
  /** A link in the page to a page of the window's vaults: a page goes on top of the stack; another file opens in a tab. */
  onOpenLink: (path: string) => void
  /**
   * The editor of a page, with `openLink` as its link door (App's `renderPageEditor` with the stack's door).
   * `unlocked`: a timed "Allow edits" of this layer runs, so the vault's Read only does not lock the editor (YAZ-4939).
   */
  renderEditor: (path: string, openLink: (path: string) => void, unlocked: boolean) => ReactNode
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
  /** The card to land on once the page shows (YAZ-4962): its place among the page's cards. */
  card?: number
  /** The Inbox's E (YAZ-5145): once the layer edits, the card opens in Edit card, one time: the one at `card` of a page, else the card file's. */
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
      <button type="button" className="explore__step" title="Previous search result (← or ⌘⌥↑)" aria-label="Previous search result" disabled={!steps.prev} onMouseDown={keepFocus} onClick={() => steps.onStep(-1)}>
        ‹
      </button>
      <span className="explore__count">{steps.place === 0 ? '' : `${steps.place}/${steps.count}`}</span>
      <button type="button" className="explore__step" title="Next search result (→ or ⌘⌥↓)" aria-label="Next search result" disabled={!steps.next} onMouseDown={keepFocus} onClick={() => steps.onStep(1)}>
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

/** A read-only Crepe goes: out of the page at once, destroyed once it is up. */
function retire({ crepe, el, up }: { crepe: ReturnType<typeof createCrepe>; el: HTMLElement; up: Promise<void> }): void {
  el.remove()
  void up.then(() => crepe.destroy())
}

/** The page editor's features minus the two that exist to edit blocks (the preview panel's set). */
const readFeatures = { ...features, [CrepeFeature.BlockEdit]: false, [CrepeFeature.Toolbar]: false }

type Content = { kind: 'loading' } | { kind: 'body'; body: string; switches: PageSwitches } | { kind: 'empty' } | { kind: 'gone' }

export function ExplorePage({ path, mode, gone = 0, title, idInTitle = false, vault, style, onOpenLink, renderEditor, createFolder, onFileAction, linkActions, onNotice, onToggleEdit, editAsk = 0, leaveAsk = 0, card, editCard = false, fromInbox = false, steps, onHeadDown, onHeadReset, zoom, onZoom, commentsOrder, onChangeCommentsOrder, onOpenInTab, onHeadMenu, pageMenu, onClose, active }: ExplorePageProps) {
  // The layer's vault's word for a page (YAZ-4938), for its own words and for every panel inside it.
  const unit = useVaultUnit(vault.root)
  const pageId = usePageId(idInTitle ? vault.wikilinks : undefined, path)
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
    const again = rereading.current
    rereading.current = false
    if (!again) setContent({ kind: 'loading' })
    // A save of this page still on its way (an editor's flush, YAZ-3685 F5) lands first: the read sees the typed text.
    Promise.resolve(savedFirst(path))
      .then(() => api.readFile(path))
      .then(
      (file) => {
        if (!live) return
        readRef.current = file.content
        const body = splitFrontmatter(file.content).body
        const switches = readPageSwitches(file.content)
        setContent((prev) =>
          body.trim() === '' ? { kind: 'empty' } : prev.kind === 'body' && prev.body === body && JSON.stringify(prev.switches) === JSON.stringify(switches) ? prev : { kind: 'body', body, switches },
        )
      },
      () => live && setContent({ kind: 'gone' }),
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

  const body = mode === 'read' && content.kind === 'body' ? content.body : null
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
          : { settings: () => doors.current.review?.settings ?? DEFAULT_REVIEW_SETTINGS, deleteReview: (p, id, r) => doors.current.review?.deleteReview(p, id, r) ?? Promise.resolve() },
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
      setReady(crepe)
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
      const target = scope?.querySelectorAll<HTMLElement>('.card')[card]
      if (target !== undefined) {
        landed.current = true
        landOn(target)
        return
      }
      if (++tries <= 40) timer = setTimeout(tick, 16)
    }
    tick()
    return () => clearTimeout(timer)
  }, [card, mode, ready])

  // The Inbox's E (YAZ-5145, Yaseen: "e would edit the card"; round 2: "it should take you directly into the card
  // edit"): once the layer edits (at once, or after "Allow edits?" in a Read only vault), the card opens in Edit card —
  // a card in a page (`card`) as its own Edit card button does, a card file's view by its own Edit card button. One
  // time: Done, Esc and a later edit are the page's as always. The editor mounts a tick later: ask a few frames.
  const cardEdited = useRef(false)
  useEffect(() => {
    if (!editCard || cardEdited.current || mode !== 'edit') return
    let tries = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = () => {
      const scope = editBodyRef.current
      const view = card === undefined ? null : cardBlockViewOfDom(scope?.querySelectorAll<HTMLElement>('.card')[card] ?? null)
      const fileEdit = card === undefined ? (scope?.querySelector<HTMLButtonElement>('[data-card-file-edit]') ?? null) : null
      if ((view !== null && view.view.editable) || fileEdit !== null) {
        cardEdited.current = true
        if (view !== null) view.edit()
        else fileEdit?.click()
        return
      }
      if (++tries <= 40) timer = setTimeout(tick, 16)
    }
    tick()
    return () => clearTimeout(timer)
  }, [editCard, card, mode])

  /** The saved text for the comment stream (round 1, item 3): what was read, until the block's own write moves it. */
  const file = content.kind === 'body' || content.kind === 'empty' ? { path, content: readRef.current } : null

  // The top layer's body takes the focus, so E and Esc work with no click; a layer uncovered again takes it back.
  useEffect(() => {
    if (active && mode === 'read') bodyRef.current?.focus()
  }, [active, mode])

  const page = fileKind(path) === 'markdown'
  // The vault's Read only (YAZ-4939): the layer edits only while its own timed unlock runs. At zero, or on Lock now,
  // an editing layer goes back to reading (its editor's save first, as Done does).
  const locked = vault.readOnly === true
  const leave = useRef({ mode, onToggleEdit })
  leave.current = { mode, onToggleEdit }
  const unlock = useTimedUnlock(() => {
    if (leave.current.mode === 'edit') leave.current.onToggleEdit()
  })
  const unlocked = locked && unlock.until !== null
  const [asking, setAsking] = useState(false)
  /** E and Edit: edit, or ask first while the vault locks the layer. */
  const edit = () => (locked && !unlocked ? setAsking(true) : onToggleEdit())
  const editRef = useRef(edit)
  editRef.current = edit
  useEffect(() => {
    if (editAsk > 0) editRef.current()
  }, [editAsk])
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
  const chip = locked && (
    // A press in the chip or its box is not the head's drag, and a double click is not its reset.
    <span className="explore__lock" data-fold-part="chip" onMouseDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <ReadOnlyChip
        asking={asking}
        onAsk={() => setAsking(true)}
        onAllow={(choice) => {
          setAsking(false)
          unlock.allow(choice)
          if (mode === 'read') onToggleEdit()
        }}
        onCancel={() => setAsking(false)}
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
  return (
    <UnitContext.Provider value={unit}>
      <div
        ref={headRef}
        className="explore__head"
        onMouseDown={onHeadDown}
        onDoubleClick={onHeadReset}
        onContextMenu={(e) => {
          e.preventDefault()
          onHeadMenu(e.clientX, e.clientY)
        }}
      >
        <span ref={titleRef} className="explore__title" title={path}>
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
          {foldAll !== false && (
            <span className="explore__part" data-fold-part="fold-all">
              {foldAll}
            </span>
          )}
          {/* No "Reading" label (YAZ-4944): reading is the normal state; "Edit E" says what you can do. */}
          {mode === 'read' ? (
            <>
              {page && chip}
              {page && (
                <button type="button" className="explore__button" data-fold-part="edit" onClick={edit} title={unit('Edit this page here (E)')}>
                  Edit<kbd>E</kbd>
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
              <button type="button" className="explore__button" data-fold-part="edit" onClick={leaveEdit} title={locked ? 'Save, lock again and read (Esc or ⌘↵)' : 'Back to reading (Esc or ⌘↵)'}>
                {/* The keys in words (YAZ-5035): "Done Esc Cmd + Enter". The title keeps the symbols, as a menu does. */}
                Done
                <KeyCaps keys="esc" />
                <KeyCaps keys="⌘↵" />
              </button>
            </>
          )}
          <button type="button" className="explore__button" data-fold-part="open" onClick={onOpenInTab} title={fromInbox ? 'Open in a tab and close the stack' : 'Open in a tab and close the stack (⌘↵)'} aria-label="Open in a tab">
            ↗
          </button>
        </span>
        <HeadMore sections={moreSections} />
        <button type="button" className="explore__button" onClick={onClose} title="Close this layer (Esc)" aria-label="Close this layer">
          ×
        </button>
      </div>
      {mode === 'edit' ? (
        <div ref={editBodyRef} className="explore__body explore__body--edit" style={bodyStyle}>
          {/* Keyed by the path: a step while editing saves this page and mounts the editor on the next (the body div stays, with the keyboard). */}
          <Fragment key={path}>{renderEditor(path, onOpenLink, unlocked)}</Fragment>
        </div>
      ) : (
        <div ref={bodyRef} className="explore__body" style={bodyStyle} tabIndex={-1} data-explore-read>
          <FindBar channel={findChannel} scope="page" hostRef={bodyRef} />
          <div ref={mountRef} className="explore__mount" />
          {content.kind === 'gone' && <p className="editor-msg">Can&apos;t read &quot;{title}&quot; — it is no longer there</p>}
          {content.kind === 'empty' && <p className="editor-msg">{unit('Empty page')}</p>}
          {/* The page's right-click menu (item 7): the text rows (Copy, Copy as; no Cut or Paste while reading), then the page menu. */}
          {ready !== null && <PageMenu view={editorViewOf(ready)} extra={pageMenu} reading />}
          {/* Under the page, as in its tab (round 1, item 3): the comment stream, then "Linked mentions"; a mention opens on top. */}
          {file !== null && (
            <div className="explore__under">
              <CommentsSection file={file} order={commentsOrder} onChangeOrder={onChangeCommentsOrder} root={root} />
              <BacklinksSection path={path} source={wikilinks} openCurrent={onOpenLink} />
            </div>
          )}
        </div>
      )}
    </UnitContext.Provider>
  )
}
