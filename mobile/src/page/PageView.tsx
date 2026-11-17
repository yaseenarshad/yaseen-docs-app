import { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { splitFrontmatter } from '@shared/frontmatter'
import { useApp } from '../app/AppState'
import type { VaultStore } from '../store'
import { Frame } from '../screens/Frame'
import { setSearchNotice } from '../search/searchState'
import { useVaultData, vaultDataFor, type VaultData } from '../search/vaultData'
import { readAheadPaths } from '../explore/openReady'
import { heldText, holdText } from './heldText'
import { uiSlicer } from '../sync/yieldToUi'
import { useDrawings } from '../drawing/useDrawings'
import { useMediaWatch, useVaultMedia } from '../media/ui/useVaultMedia'
import { guardLink } from '../media/ui/safeLinks'
import { openFile } from '../media/ui/vaultMedia'
import { headingTarget, landingTop, landOn } from './headings'
import { LinkedMentions } from './LinkedMentions'
import { openLink, type LinkDoor } from './openLink'
import { resolveSourceOf } from './pageLook'
import { loadVaultLook, useVaultLook } from './vaultLook'
import { usePageTools } from './PageTools'
import { usePageProperties } from './PageProperties'
import { vaultName } from '../screens/Frame'
import { fillCardEmbeds, tapOf } from './pageDom'
import { pageLook } from './pageLook'
import { PageArrows, PageIdChip, folderStops, neighbours, pageIdOf, vaultOrder } from './pageNav'
import { renderPage, warmRenderer } from './pageRender'
import { markSections, pageOwnSwitch, pageSwitchAttrs, wideTablesAttr } from './pageSwitches'
import { effectiveSwitch, primeMobileSettings, useMobileSettings } from './mobileSettings'
import { usePageSettingRow } from './pageSettingRow'
import { FIT_TABLES_KEY, STICKY_HEADINGS_KEY } from '../comments/settingWrite'
import { stickHeadings } from './stickyHeadings'
import { attachFolds, revealFolds, type PageFolds } from './folds'
import { moveFolds, readFolds, writeFolds } from '../store/foldPref'
import { PageComments, PageCommentsCount, useCommentsPort } from './comments/PageComments'
import { hasUnsentDraft } from './comments/unsentDrafts'
import { useTaskTicks } from './taskTicks'
import { useTables } from './useTables'
import { shownText, useAnswers, useAnswersChanged } from '../cardMenu/useAnswers'
import { usePageCardMenu } from '../cardMenu/pageCardMenu'

/**
 * A PAGE, READ ONLY (4C; decision 1: stage one reads pages). The page's text from the phone's storage, drawn
 * with no editor (`renderPage`), its cards and embedded cards in place, its pictures and sounds from 3D's media when they near the screen. No keyboard
 * opens here: there is nothing to edit in stage one.
 *
 * It follows the sync (3B's `changed` event, rows of the October record):
 *  - R3 the page changed: it draws again in place, at the same reading place.
 *  - R5 the page was deleted: back to the list, which says so. N8 (sweep1): unless its comment box holds words not sent:
 *    then the page stays as it is, with them, and says it was deleted, so they can be copied.
 *  - R6 the page was renamed: it stays open, under the new path.
 */
/** Where each page was read last (phone memory only), so Back shows a page at its place. */
const readingPlace = new Map<string, number>()

/** YAZ-5589: the strips' chunk once loaded (read ahead with the reader): a page's strips then mount in its first frame. */
let stripsChunk: typeof import('./cardStrip/pageStrips') | null = null
const loadStrips = () => import('./cardStrip/pageStrips').then((m) => (stripsChunk = m))

/**
 * YAZ-5589: what any page needs to draw in the same frame as the tap, read ahead once the app is idle
 * (`explore/openReady.ts`): the vault's data and look, its mobile settings, the renderer's warm-up, the strips' chunk
 * (Review on).
 */
export async function warmPage(store: VaultStore, vault: string, repoName: string): Promise<VaultData> {
  const data = await vaultDataFor(store, vault, repoName)
  await Promise.all([loadVaultLook(store, data), primeMobileSettings(store, vault)])
  await warmRenderer(pageLook(data, ''), uiSlicer())
  if (data.review.enabled) await loadStrips().catch(() => null)
  return data
}

/**
 * YAZ-5589: everything a page (or a card file, or a panel) needs to draw in the same frame as the tap, read ahead
 * (`openReady.ts`, the Today button): the reader warm (`warmPage`) and the page's stored text (`heldText.ts`).
 */
export async function primePage(store: VaultStore, vault: string, repoName: string, path: string): Promise<void> {
  const [, text] = await Promise.all([warmPage(store, vault, repoName), shownText(store, vault, path, null)])
  if (typeof text === 'string') holdText(vault, path, text)
}

/** The pages a tap on this page opens next: its arrows' pages, then its first links (read ahead once it is drawn). */
const AHEAD_LINKS = 12
function nextPaths(el: HTMLElement, data: VaultData, path: string): string[] {
  const near = neighbours(folderStops(vaultOrder(data).pages, path.slice(0, Math.max(0, path.lastIndexOf('/')))), { kind: 'page', path })
  const out = new Set<string>()
  for (const stop of [near?.after, near?.before]) if (stop != null && (stop.route.kind === 'page' || stop.route.kind === 'card')) out.add(stop.route.path)
  for (const a of el.querySelectorAll<HTMLElement>('[data-open="page"][data-path], [data-open="card"][data-path]')) {
    if (out.size >= AHEAD_LINKS + 2) break
    if (a.dataset.path !== path) out.add(a.dataset.path!)
  }
  return [...out]
}

export default function PageView({ path: opened, at, heading }: { path: string; at?: string; heading?: string }) {
  const app = useApp()
  const { store, sync } = app.services
  const vault = app.vaultKey!
  const data = useVaultData()
  const [path, setPath] = useState(opened)
  const [text, setText] = useState<string | null | undefined>(() => heldText(vault, opened))
  const [reads, setReads] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  /** The page's first block is a heading with its title: the reader's own title is not drawn a second time. */
  const [sameTitle, setSameTitle] = useState(false)
  /** Then the box right after that heading, where the page's properties open (each draw puts a new one). */
  const [propsSlot, setPropsSlot] = useState<HTMLElement | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const media = useVaultMedia()
  // Pictures and sounds come as they near the screen; a new piece or an embedded card is watched too.
  useMediaWatch(host, media)
  // Its drawings, drawn on the phone when they near the screen; nothing is saved.
  useDrawings(host, media)
  // The vault's own look (link pills, heading sizes) and its "Clicking a link", for the link door.
  const look = useVaultLook(store, data)
  // Its wide tables: the shadows at their sides, and ⤢ to open one full screen; YAZ-5487: the calendar look
  // from the vault's table-look.json.
  useTables(host, look?.table ?? null)
  const door: LinkDoor = { go: app.go, vaultKey: app.vaultKey, click: look?.click }
  const doorRef = useRef(door)
  doorRef.current = door
  // A tap on a task's box ticks it in the file, on the comments' safe path.
  // A tick that settled (also with no write: the Mac's state won) reads the stored file again.
  const commentsPort = useCommentsPort()
  const ticks = useTaskTicks(host, path, text, commentsPort, setNotice, () => setReads((n) => n + 1))
  const ticksRef = useRef(ticks)
  ticksRef.current = ticks
  // Each card's ⋯ (the card actions); the page reads its cards as the phone shows them (with waiting actions).
  const answers = useAnswers()
  useAnswersChanged(answers, path, () => setReads((n) => n + 1))
  const cardMenu = usePageCardMenu(host, { path, answers, upNext: data?.review.enabled === true })
  const record = data?.byPath[path]
  const title = record?.title ?? path.slice(path.lastIndexOf('/') + 1).replace(/\.(md|markdown)$/i, '')
  // The page's own Guide lines and Section indent, from its frontmatter (`pageSwitches.ts`).
  const switches = useMemo(() => (typeof text === 'string' ? pageSwitchAttrs(text) : {}), [text])
  const sectionIndent = switches['data-section-indent'] === 'true'
  // YAZ-5592: the vault's mobile settings (`.yaseendocs/mobile.json`, with this phone's changes not sent yet).
  const vaultMobile = useMobileSettings(data, commentsPort).settings
  // YAZ-5568: the Mac's folding: the page's own `folding: true | false`, else the vault's (on by default); the folds kept
  // on this phone, by vault and path. "Folding on this page" (⋯) writes the page's own key (`pageSettingRow.ts`).
  const own = (key: 'folding' | 'sticky-headings' | 'fit-tables') => (typeof text === 'string' ? pageOwnSwitch(text, key) : undefined)
  const folding = usePageSettingRow(commentsPort, path, 'folding', effectiveSwitch(own('folding'), vaultMobile?.folding ?? true), 'Folding', setNotice)
  const foldingOn = folding.on
  // YAZ-5591: sticky headings, the page's own `sticky-headings: true | false` (the phone's own key), else the vault's.
  const sticky = usePageSettingRow(commentsPort, path, STICKY_HEADINGS_KEY, effectiveSwitch(own('sticky-headings'), vaultMobile?.stickyHeadings ?? true), 'Sticky headings', setNotice)
  const stickyOn = sticky.on
  // YAZ-5658: Wide tables, the page's own `fit-tables: true | false` (none: Mobile Vault Default), else the vault's.
  const wide = usePageSettingRow(commentsPort, path, FIT_TABLES_KEY, own('fit-tables') ?? null, 'Wide tables', setNotice)
  const fitTables = effectiveSwitch(wide.on ?? undefined, vaultMobile?.fitTables ?? false)
  const folds = useRef<PageFolds | null>(null)
  const [foldsNow, setFoldsNow] = useState<PageFolds | null>(null)
  useEffect(() => {
    const el = host.current
    if (el === null || !foldingOn) return
    const made = attachFolds(el, { title, initial: readFolds(vault, path), onChange: (keys) => writeFolds(vault, path, keys) })
    folds.current = made
    setFoldsNow(made)
    // The page is on the screen already (a page whose `folding` came back on): its arrows now.
    made.apply()
    return () => {
      made.destroy()
      if (folds.current === made) folds.current = null
      setFoldsNow(null)
    }
  }, [vault, path, title, foldingOn])
  // "⋯" → Find in page, Headings (each a lazy chunk), Collapse all; YAZ-5498: the full title when the top bar cuts it.
  const writable = typeof text === 'string' && commentsPort !== null
  const tools = usePageTools(host, { title, path, folds: foldsNow, folding: writable ? folding : null, sticky: writable ? sticky : null, wide: writable ? wide : null })
  // The Mac's properties chip at the right of the title; the rows open under it, in the page.
  const props = usePageProperties({ path, record, data, door, slot: sameTitle ? propsSlot : null })

  // R3, R5, R6 from the sync's diff of the open vault.
  const deletedWithDraft = useRef(false)
  const deletedNotice = useRef<string | null>(null)
  useEffect(
    () =>
      sync.subscribe((event) => {
        if (event.type !== 'changed' || event.vault !== vault) return
        const diff = event.diff
        // N8 (sweep1): the page is gone, but its comment box holds words: it stays as it is drawn, with them.
        // Sweep3 N-2: until the Mac brings it back: then it reads the file again (the text effect resumes).
        if (deletedWithDraft.current) {
          if (diff === undefined || diff === null || diff.added.includes(path) || diff.changed.includes(path)) setReads((n) => n + 1)
          return
        }
        if (diff === undefined || diff === null) return setReads((n) => n + 1)
        if (diff.removed.includes(path)) {
          if (hasUnsentDraft(path)) {
            deletedWithDraft.current = true
            const words = `"${title}" was deleted on the Mac. Your comment is not sent: copy it before you leave this page.`
            deletedNotice.current = words
            setNotice(words)
            return
          }
          setSearchNotice(`"${title}" was deleted.`)
          app.go({ type: 'back' })
          return
        }
        const renamed = diff.renamed.find((r) => r.from === path)
        if (renamed !== undefined) {
          moveFolds(vault, path, renamed.to)
          setPath(renamed.to)
        }
        else if (diff.changed.includes(path)) setReads((n) => n + 1)
      }),
    [sync, vault, path, title, app],
  )

  // The text, from storage, with the answer list's waiting actions (a card's change shows at once).
  useEffect(() => {
    let live = true
    void shownText(store, vault, path, answers).then((content) => {
      if (!live) return
      // N8: a page deleted while its comment box held words keeps the text it showed.
      if (deletedWithDraft.current && content === null) return
      // Sweep3 N-2: the file is back at its path: the page follows the vault again, and its notice goes.
      if (deletedWithDraft.current) {
        deletedWithDraft.current = false
        const words = deletedNotice.current
        deletedNotice.current = null
        setNotice((n) => (n === words ? null : n))
      }
      setText(content)
      if (typeof content === 'string') holdText(vault, path, content)
      // The same text as the page on the screen draws nothing again; its boxes still show the
      // file (a settled tick's box kept the tap's state).
      if (typeof content === 'string' && drawn.current?.text === content) ticksRef.current.paint()
    })
    return () => {
      live = false
    }
  }, [store, vault, path, reads, answers])

  // Draw it, in slices; again when the text or the vault's index changes, at the same reading place (R3).
  const drawn = useRef<{ text: string; version: number; look: object } | null>(null)
  // The strips under the page's cards (each its own React root), unmounted when the page draws again or closes.
  const strips = useRef<(() => void) | null>(null)
  useEffect(() => () => strips.current?.(), [])
  const everDrawn = useRef(false)
  useEffect(() => {
    const el = host.current
    // YAZ-5591: never waits for the vault's mobile settings: the last values read (else both on) draw at once, and the
    // file's values, when read, switch the fold arrows and the stuck headings on the page as drawn (their own effects).
    if (el === null || data === null || typeof text !== 'string' || look === undefined) return
    if (drawn.current !== null && drawn.current.text === text && drawn.current.version === data.version && drawn.current.look === look) return
    resolveSourceOf(data).setLook(look.pills, vaultName(app.vault?.repo ?? ''))
    let live = true
    const scroller = el.closest<HTMLElement>('.screen')
    const top = scroller?.scrollTop ?? 0
    // The first draw of this view (a redraw after R3 keeps the place it had).
    const first = !everDrawn.current
    everDrawn.current = true
    drawn.current = { text, version: data.version, look }
    void (async () => {
      // A REDRAW (the sync changed the page or the vault) is drawn off the screen, its cards in place, then
      // swapped in at once. Before, the page shrank to its first slice under the finger, the scroll place jumped, and
      // the embedded cards came again one by one: the page "hung" while the person scrolled.
      const into = first ? el : document.createElement('div')
      // YAZ-5568: each slice of a long page gets its arrows and its folds as it comes (a section runs across slices).
      const slicer = uiSlicer()
      const slice = first ? async () => (folds.current?.scan(), await slicer()) : slicer
      await renderPage(splitFrontmatter(text).body, { ...pageLook(data, path), tables: look.table }, into, slice, () => live)
      if (!live) return
      markSections(into, sectionIndent)
      if (!first) {
        await fillCardEmbeds(into, data, store, doorRef.current, () => live)
        if (!live) return
        el.replaceChildren(...into.childNodes)
      }
      ticksRef.current.paint()
      folds.current?.apply()
      const head = el.firstElementChild
      // S2 (sweep1): the reader's own title hides NOW when the page's H1 says it (`--same` takes it out of the flow, and
      // the page moves up by its height). A landing measured before React drew that put the heading under the top bar.
      const same = head?.tagName === 'H1' && head.textContent?.trim().toLowerCase() === title.trim().toLowerCase()
      // The properties open under the title: here, under the page's own heading.
      let slot: HTMLElement | null = null
      if (same && head !== null) {
        slot = document.createElement('div')
        slot.className = 'page-props__slot'
        head.after(slot)
      }
      flushSync(() => {
        setSameTitle(same)
        setPropsSlot(slot)
      })
      if (scroller !== null && !first) scroller.scrollTop = top
      // Back on a page read before, at its reading place (a card asked for by `at` comes first).
      if (scroller !== null && first && at === undefined && heading === undefined) scroller.scrollTop = readingPlace.get(`${vault}\n${path}`) ?? 0
      // A link that named a heading (`[[Page#Goals]]`) lands on it; one the page lacks opens it at its top.
      const target = !first ? null : heading !== undefined ? headingTarget(el, heading) : at !== undefined ? el.querySelector<HTMLElement>(`[data-card-id="${at.replace(/["\\]/g, '\\$&')}"]`) : null
      if (first && heading !== undefined) {
        if (target !== null) landOn(target)
        else if (scroller !== null) scroller.scrollTop = 0
      }
      if (first && at !== undefined && target !== null) {
        // A card in a folded part: its folds open first.
        revealFolds(target)
        target.scrollIntoView?.({ block: 'start' })
      }
      const landed = scroller?.scrollTop
      if (first) await fillCardEmbeds(el, data, store, doorRef.current, () => live)
      if (!live) return
      // S2: the cards above it are drawn now and pushed it down: the same landing again, unless the person scrolled.
      if (target !== null && scroller !== null && scroller.scrollTop === landed) {
        if (heading !== undefined) scroller.scrollTop = landingTop(scroller, target)
        else target.scrollIntoView?.({ block: 'start' })
      }
      // Under each card and card embed, the Mac's strip (Reviews, Properties), closed; Review off: none.
      strips.current?.()
      strips.current = null
      if (data.review.enabled && el.querySelector('.card.page-card, .card.card-embed') !== null) {
        // YAZ-5589: with the chunk read ahead, the strips mount now, in the page's first frame (no jump under the cards).
        const { mountPageStrips } = stripsChunk ?? (await loadStrips())
        if (!live) return
        flushSync(() => void (strips.current = mountPageStrips(el, data, doorRef.current, { path, text })))
      }
      // YAZ-5589: what a tap here opens next (the arrows' pages, the first links) is read ahead once the app is idle.
      if (first) {
        const ahead = () => live && void readAheadPaths(vault, nextPaths(el, data, path))
        if (typeof requestIdleCallback === 'function') requestIdleCallback(ahead, { timeout: 1500 })
        else setTimeout(ahead, 300)
      }
    })()
    return () => {
      live = false
      drawn.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, data, look, path, at, heading, store, app.go, app.vault, title, sectionIndent])

  // The reading place of this page, kept as the person scrolls.
  useEffect(() => {
    const scroller = host.current?.closest('.screen')
    if (scroller == null) return
    const keep = () => readingPlace.set(`${vault}\n${path}`, scroller.scrollTop)
    scroller.addEventListener('scroll', keep, { passive: true })
    return () => scroller.removeEventListener('scroll', keep)
  }, [vault, path])

  // YAZ-5591: the stuck headings, in their layer just before the body, while sticky headings are on.
  const stuckLayer = useRef<HTMLDivElement>(null)
  const hasText = typeof text === 'string'
  useEffect(() => {
    const el = host.current
    const layer = stuckLayer.current
    const scroller = el?.closest<HTMLElement>('.screen')
    if (!stickyOn || !hasText || el == null || layer === null || scroller == null) return
    return stickHeadings(scroller, el, layer, { title })
  }, [stickyOn, hasText, path, title])

  const onTap = async (event: React.MouseEvent) => {
    if (data === null) return
    const tap = tapOf(event.target, data)
    // Any other link: the web opens Safari, the app's window stays.
    if (tap === null) return void guardLink(event)
    event.preventDefault()
    // A link to this same page (`[[This page#Goals]]`) lands here: it opens no second copy of the page.
    const self = tap.kind === 'go' && tap.target.kind === 'page' && tap.target.path === path ? tap.target : null
    if (self !== null) {
      const target = self.heading === undefined || host.current === null ? null : headingTarget(host.current, self.heading)
      if (target !== null) landOn(target)
      else host.current?.closest('.screen')?.scrollTo?.({ top: 0 })
    } else if (tap.kind === 'go') openLink(door, tap.target)
    // A heading of this page lands there; a missing page's link does nothing.
    else if (tap.kind === 'heading') {
      const target = host.current === null ? null : headingTarget(host.current, tap.heading)
      if (target !== null) landOn(target)
    } else if (tap.kind === 'none') return
    else setNotice(await openFile(media, tap.path))
  }

  const gone = text === null && data !== null
  const pageId = pageIdOf(data, record)
  return (
    <Frame
      title={title}
      back={() => app.go({ type: 'back' })}
      gear
      tabs
      reader
      kind="page"
      tools={tools.button}
      notice={tools.bar}
      chip={pageId !== null && <PageIdChip id={pageId} path={path} />}
      foot={<PageArrows data={data} at={{ kind: 'page', path }} go={app.go} noun="page" />}
    >
      <article className="reader" aria-label={title} style={look?.style}>
        {/* The properties chip, at the right of the title (before the count, so it is the rightmost). */}
        {props.toggle}
        {/* The comment count, at the top right of the column; a tap goes to the comments at the end. */}
        {typeof text === 'string' && <PageCommentsCount text={text} />}
        <h2 className={sameTitle ? 'reader__title reader__title--same' : 'reader__title'}>{title}</h2>
        {props.rows}
        {notice !== null && (
          <p className="reader__notice" role="status">
            {notice}
          </p>
        )}
        {gone && <p className="muted">{record === undefined ? app.unit('This page is not on the phone.') : app.unit('This page is too large to show on the phone. Open it on the Mac.')}</p>}
        {/* The page's text: drawn by `renderPage`, which cleans it first. A tap on a link opens what it names. */}
        {/* YAZ-5591: the layer of stuck headings (copies; the headings are in the body), zero height. */}
        <div ref={stuckLayer} className="reader__stuck" aria-hidden="true" />
        <div className="reader__body" {...switches} data-folding={foldingOn ? undefined : 'off'} data-wide-tables={wideTablesAttr(fitTables)} ref={host} onClick={(e) => void onTap(e)} />
        {/* The page's comments, and its Comment button (`comments/`). */}
        {typeof text === 'string' && <PageComments path={path} text={text} />}
        {tools.sheet}
        {cardMenu}
        {data !== null && text !== undefined && <LinkedMentions path={path} data={data} store={store} door={door} />}
      </article>
    </Frame>
  )
}
