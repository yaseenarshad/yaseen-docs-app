import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { cardInContent, type CardAtPage } from '@client/review/cardRead'
import { splitFrontmatter } from '@shared/frontmatter'
import { useApp } from '../app/AppState'
import { useVaultData, type VaultData } from '../search/vaultData'
import { uiSlicer } from '../sync/yieldToUi'
import { useDrawings } from '../drawing/useDrawings'
import { useMediaWatch, useVaultMedia } from '../media/ui/useVaultMedia'
import { guardLink } from '../media/ui/safeLinks'
import { openFile as openMediaFile } from '../media/ui/vaultMedia'
import { cardHead, titleBand } from '../media/ui/cardHead'
import { fillCardEmbeds, tapOf } from '../page/pageDom'
import { UNTITLED_CARD, drawCard, pageLook } from '../page/pageLook'
import { renderPage } from '../page/pageRender'
import { heldText, holdText } from '../page/heldText'
import { headingTarget, landOn } from '../page/headings'
import { attachFolds, revealFolds, type PageFolds } from '../page/folds'
import { pageOwnSwitch, wideTablesAttr } from '../page/pageSwitches'
import { effectiveSwitch, useMobileSettings } from '../page/mobileSettings'
import { stickHeadings } from '../page/stickyHeadings'
import { useCommentsPort } from '../page/comments/PageComments'
import { openLink, type LinkDoor } from '../page/openLink'
import { LinkedMentions } from '../page/LinkedMentions'
import { boardKindOf, boardLabel } from '../drawing/boardFiles'
import type { Answers } from '../answers/answers'
import { shownText, useAnswers, useAnswersChanged } from '../cardMenu/useAnswers'
import { usePageCardMenu } from '../cardMenu/pageCardMenu'
import { cardMoreButton } from '../cardMenu/moreButton'
import type { SheetRoute } from './sheets'

/**
 * WHAT A SHEET SHOWS: a page or a card, read only, drawn by THE READER'S OWN CODE (`renderPage`, `drawCard`,
 * the card embeds, the pictures, the drawings), so a sheet looks as the page view does. A link in it opens ANOTHER
 * sheet on top (`openSheet`); a file (a PDF, a picture) opens as in the reader.
 */

const text = (content: string | Uint8Array) => (typeof content === 'string' ? content : new TextDecoder().decode(content))

/**
 * The file's text from the phone's storage: undefined while it reads, null when it is not on the phone. Read again when
 * a pass changes it. With the vault's answer list (`answers`, YAZ-5548): the text as the phone shows it (`shownText`,
 * with the waiting card actions), read again when an action is added, so a card's ⋯ shows its change at once.
 */
export function useFileText(path: string, answers: Answers | null = null): string | null | undefined {
  const app = useApp()
  const { store, sync } = app.services
  const vault = app.vaultKey!
  // YAZ-5589: the text read ahead (`heldText.ts`): the panel opens with it drawn; the stored file is read again at once.
  const [value, setValue] = useState<string | null | undefined>(() => heldText(vault, path))
  const [reads, setReads] = useState(0)
  useEffect(
    () =>
      sync.subscribe((event) => {
        if (event.type === 'changed' && event.vault === vault && (event.diff == null || event.diff.changed.includes(path))) setReads((n) => n + 1)
      }),
    [sync, vault, path],
  )
  useAnswersChanged(answers, path, () => setReads((n) => n + 1))
  useEffect(() => {
    let live = true
    void shownText(store, vault, path, answers).then((content) => {
      if (!live) return
      setValue(content)
      if (typeof content === 'string') holdText(vault, path, content)
    })
    return () => {
      live = false
    }
  }, [store, vault, path, reads, answers])
  return value
}

/**
 * A tap in a sheet's text, through the reader's ONE link door (`openLink`) with `click: 'explore'`: a page, a card or a
 * drawing (the reader's `tapOf` names a drawing file a drawing) opens in ANOTHER sheet on top; a heading of
 * this page lands there in the sheet; a file opens as in the reader; a missing page's link does nothing, as in the reader.
 */
export function useSheetTap(data: VaultData | null, say: (words: string) => void, click: LinkDoor['click'] | null = 'explore') {
  const app = useApp()
  const media = useVaultMedia()
  // `null` (a folder page full screen): the vault's own "Clicking a link" decides.
  const door: LinkDoor = { go: app.go, vaultKey: app.vaultKey, ...(click !== null && { click }) }
  const onTap = async (event: React.MouseEvent) => {
    if (data === null) return
    const tap = tapOf(event.target, data)
    if (tap === null) return void guardLink(event)
    event.preventDefault()
    if (tap.kind === 'go') openLink(door, tap.target)
    else if (tap.kind === 'heading') {
      const root = event.currentTarget as HTMLElement
      const target = headingTarget(root, tap.heading)
      if (target !== null) revealFolds(target)
      target?.scrollIntoView?.({ block: 'start' })
    } else if (tap.kind === 'none') return
    else {
      const words = await openMediaFile(media, tap.path)
      if (words !== null) say(words)
    }
  }
  return { door, onTap, media }
}

export function titleOf(data: VaultData | null, path: string): string {
  if (boardKindOf(path) !== null) return drawingTitle(path)
  return data?.byPath[path]?.title ?? path.slice(path.lastIndexOf('/') + 1).replace(/\.(md|markdown)$/i, '')
}

/** A page in a sheet. `onDrawn`: its text is on the screen (the sheet then puts back a kept scroll place). */
export function SheetPage({ path, at, heading, onDrawn }: { path: string; at?: string; heading?: string; onDrawn(): void }) {
  const app = useApp()
  const data = useVaultData()
  const answers = useAnswers()
  const content = useFileText(path, answers)
  const [notice, setNotice] = useState<string | null>(null)
  const host = useRef<HTMLDivElement>(null)
  // YAZ-5548: a card's ⋯ in a sheet opens the full page's card menu (the same component), and writes the same way.
  const cardMenu = usePageCardMenu(host, { path, answers, upNext: data?.review.enabled === true })
  const { door, onTap, media } = useSheetTap(data, setNotice)
  useMediaWatch(host, media)
  useDrawings(host, media)
  const title = titleOf(data, path)
  const [sameTitle, setSameTitle] = useState(false)
  const drawn = useRef<string | null>(null)
  const landed = useRef(false)
  // YAZ-5568: a panel folds as the page does (the page's `folding: false` too); its folds last while it is open.
  const folds = useRef<PageFolds | null>(null)
  useEffect(() => () => folds.current?.destroy(), [])
  // YAZ-5592: the vault's mobile settings; a page's own `folding` / `sticky-headings` wins.
  const vaultMobile = useMobileSettings(data, useCommentsPort()).settings
  const own = (key: 'folding' | 'sticky-headings' | 'fit-tables') => (typeof content === 'string' ? pageOwnSwitch(content, key) : undefined)
  const foldingOn = effectiveSwitch(own('folding'), vaultMobile?.folding ?? true)
  const stickyOn = effectiveSwitch(own('sticky-headings'), vaultMobile?.stickyHeadings ?? true)
  // YAZ-5658: Wide tables as the page's.
  const wideTables = wideTablesAttr(effectiveSwitch(own('fit-tables'), vaultMobile?.fitTables ?? false))
  // YAZ-5591: the stuck headings of the panel, in its own scroller.
  const stuckLayer = useRef<HTMLDivElement>(null)
  const hasText = typeof content === 'string'
  useEffect(() => {
    const el = host.current
    const layer = stuckLayer.current
    const scroller = el?.closest<HTMLElement>('.explore-sheet__body')
    if (!stickyOn || !hasText || el == null || layer === null || scroller == null) return
    return stickHeadings(scroller, el, layer, { title })
  }, [stickyOn, hasText, path, title])
  // YAZ-5591: the panel draws at once, never waiting for `.yaseendocs/mobile.json` (the last values read, else both on);
  // when the file's values come, the fold arrows just switch here, on the page as drawn (no redraw, no jump).
  const foldingRef = useRef(foldingOn)
  foldingRef.current = foldingOn
  useEffect(() => {
    const el = host.current
    if (el === null || drawn.current === null || (folds.current !== null) === foldingOn) return
    const kept = folds.current?.folded() ?? []
    folds.current?.destroy()
    folds.current = foldingOn ? attachFolds(el, { title, initial: kept }) : null
    folds.current?.apply()
  }, [foldingOn, title])

  useEffect(() => {
    const el = host.current
    if (el === null || data === null || typeof content !== 'string') return
    const key = `${data.version}\n${content}`
    if (drawn.current === key) return
    drawn.current = key
    let live = true
    void (async () => {
      // Drawn off the screen, then swapped in at once: a redraw never shrinks the page under the finger.
      // YAZ-5589: a first draw with no place to land on goes straight in, in the panel's first frame (its text read
      // ahead, the renderer warm), with its title as it stays; its embedded cards fill in place after.
      const direct = el.childNodes.length === 0 && at === undefined && heading === undefined
      const into = direct ? el : document.createElement('div')
      await renderPage(splitFrontmatter(content).body, pageLook(data, path), into, uiSlicer(), () => live)
      if (!live) return
      if (!direct) {
        await fillCardEmbeds(into, data, app.services.store, door, () => live)
        if (!live) return
        el.replaceChildren(...into.childNodes)
      }
      const kept = folds.current?.folded() ?? []
      folds.current?.destroy()
      folds.current = foldingRef.current ? attachFolds(el, { title, initial: kept }) : null
      folds.current?.apply()
      const head = el.firstElementChild
      // S2 (sweep1): the title hides before the card asked for is landed on (it leaves the flow; the page moves up).
      flushSync(() => setSameTitle(head?.tagName === 'H1' && head.textContent?.trim().toLowerCase() === title.trim().toLowerCase()))
      const card = at === undefined ? null : el.querySelector<HTMLElement>(`[data-card-id="${at.replace(/["\\]/g, '\\$&')}"]`)
      if (card !== null) {
        revealFolds(card)
        card.scrollIntoView?.({ block: 'start' })
      }
      onDrawn()
      // A link that named a heading (`[[Long notes#Part 40]]`) lands on it in the sheet, as full screen.
      // Only the first drawing, at the top (not a sheet drawn again at its kept place): a new version keeps the place.
      const scroller = el.closest<HTMLElement>('.explore-sheet__body')
      const target = heading === undefined || landed.current || (scroller?.scrollTop ?? 0) > 0 ? null : headingTarget(el, heading)
      landed.current = true
      if (target !== null) landOn(target, scroller)
      if (direct) await fillCardEmbeds(el, data, app.services.store, door, () => live)
    })()
    return () => {
      live = false
      drawn.current = null
    }
    // `door` and `onDrawn` are the same doors at each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, data, path, at, heading, title])

  return (
    <article className="reader explore-sheet__reader" aria-label={title}>
      <h2 className={sameTitle ? 'reader__title reader__title--same' : 'reader__title'}>{title}</h2>
      {notice !== null && (
        <p className="reader__notice" role="status">
          {notice}
        </p>
      )}
      {content === null && <p className="muted">{app.unit('This page is not on the phone.')}</p>}
      {/* YAZ-5591: the layer of stuck headings (copies), zero height. */}
      <div ref={stuckLayer} className="reader__stuck" aria-hidden="true" />
      <div className="reader__body" data-wide-tables={wideTables} ref={host} onClick={(e) => void onTap(e)} />
      {/* The end of the page, the full page's own component; a row opens another panel (the sheet's door). */}
      {data !== null && content !== undefined && <LinkedMentions path={path} data={data} store={app.services.store} door={door} />}
      {cardMenu}
    </article>
  )
}

/** The card of `path` with `id` (a card file shows its first card), from its file's text. */
export function cardOfText(data: VaultData | null, path: string, id: string, content: string | null | undefined): CardAtPage | null {
  if (typeof content !== 'string') return null
  return cardInContent(path, content, id, -1) ?? (data?.byPath[path]?.kind === 'card' ? cardInContent(path, content, null, 0) : null)
}

/** A card in a sheet: the card box of the card view (its head, its title band, the card), read only. */
export function SheetCard({ path, id, onDrawn, onText }: { path: string; id: string; onDrawn(): void; onText(text: string): void }) {
  const app = useApp()
  const data = useVaultData()
  const answers = useAnswers()
  const content = useFileText(path, answers)
  const [notice, setNotice] = useState<string | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const { onTap, media } = useSheetTap(data, setNotice)
  useMediaWatch(host, media)
  const card = cardOfText(data, path, id, content)
  const record = data?.byPath[path]
  const reviewOn = data?.review.enabled === true
  // YAZ-5548: the card's own ⋯ at the right of its head, as the full card view's (YAZ-5527), with the same menu.
  const cardMenu = usePageCardMenu(host, { path, answers, upNext: reviewOn })
  const title = card === null ? (record?.cards?.find((c) => c.id?.toLowerCase() === id.toLowerCase())?.title ?? '') : card.title
  const head = card === null ? null : `${card.id ?? id}\n${card.title}\n${card.off}\n${card.notitle === true}\n${card.titleAt ?? ''}\n${card.fix === true}\n${card.reviews.length}\n${reviewOn}\n${data?.review.titleAt}\n${card.text}`

  useEffect(() => {
    const el = host.current
    if (el === null || data === null || card === null) return
    const body = document.createElement('div')
    body.className = 'card__body'
    body.append(drawCard(data, path, card.text))
    const top = cardHead({ id: card.id ?? id, title: card.title, off: card.off, notitle: card.notitle, titleAt: card.titleAt ?? null, fix: card.fix === true, reviews: card.reviews }, data.review)
    // Only a card with its own ID: it is what the actions write by.
    if (top !== null && card.id !== null) top.append(cardMoreButton(card.id, card.title))
    if (card.id !== null) el.dataset.cardId = card.id
    else delete el.dataset.cardId
    const parts = [top, titleBand(card.title), body]
    el.replaceChildren(...parts.filter((part): part is HTMLElement => part !== null))
    el.classList.toggle('card--off', card.off)
    onText(card.text)
    onDrawn()
    // `head` holds what is drawn: a new read with the same card draws nothing again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, path, head])

  return (
    <article className="reader explore-sheet__reader" aria-label={title === '' ? (card?.id ?? id) : title}>
      <h2 className="reader__title reader__title--same">
        {title === '' ? UNTITLED_CARD : title}
        <span className="card-view__id"> · {card?.id ?? id}</span>
      </h2>
      {notice !== null && (
        <p className="reader__notice" role="status">
          {notice}
        </p>
      )}
      {content === null && <p className="muted">This card is not on the phone.</p>}
      {typeof content === 'string' && card === null && <p className="muted">{`Missing card · ${id}`}</p>}
      <div className="card card-view__card" ref={host} hidden={card === null} onClick={(e) => void onTap(e)} />
      {cardMenu}
    </article>
  )
}

/**
 * A DRAWING FILE ON ITS OWN, in a sheet or full screen: drawn by THE SAME CODE as a drawing in a page
 *: the reader draws `![[its name]]` from its own folder, so an Excalidraw drawing is drawn on the phone (it
 * fits the width; a tap opens it full screen, with pinch zoom), a `.drawio.svg` shows as the picture it is, and a plain
 * `.drawio` is drawn by draw.io's own viewer, with a page picker for several pages. Nothing is saved: the picture lives in memory while it shows.
 */
export function DrawingBody({ path, onDrawn }: { path: string; onDrawn(): void }) {
  const app = useApp()
  const data = useVaultData()
  const host = useRef<HTMLDivElement>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const { onTap, media } = useSheetTap(data, setNotice)
  useMediaWatch(host, media)
  useDrawings(host, media)
  const name = path.slice(path.lastIndexOf('/') + 1)
  const ready = data !== null
  useEffect(() => {
    const el = host.current
    if (el === null || data === null) return
    let live = true
    void renderPage(`![[${name}]]`, pageLook(data, path), el, uiSlicer(), () => live).then(() => live && onDrawn())
    return () => {
      live = false
    }
    // Drawn once for its path; a new version of the vault's data does not draw it again (the picture stays).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, path])
  const there = data === null || data.files.includes(path)
  return (
    <article className="reader explore-drawing" aria-label={drawingTitle(path)}>
      <h2 className="reader__title">{drawingTitle(path)}</h2>
      {notice !== null && (
        <p className="reader__notice" role="status">
          {notice}
        </p>
      )}
      {!there && <p className="muted">{app.unit('This drawing is not in the vault.')}</p>}
      <div className="reader__body" ref={host} hidden={!there} onClick={(e) => void onTap(e)} />
    </article>
  )
}

/** A drawing file's name, as its tree row says it. */
export const drawingTitle = (path: string): string => boardLabel(path.slice(path.lastIndexOf('/') + 1))

/** A folder's page: its own chunk, with the Mac's view engine, loaded when one opens. */
const FolderBody = lazy(() => import('../folders/FolderBody'))

/** The sheet's body for its route. */
export function SheetContent({ route, onDrawn, onText }: { route: SheetRoute; onDrawn(): void; onText(text: string): void }) {
  if (route.kind === 'folder')
    return (
      <Suspense fallback={<div className="reader" aria-busy="true" />}>
        <FolderBody path={route.path} onDrawn={onDrawn} />
      </Suspense>
    )
  if (route.kind === 'drawing') return <DrawingBody path={route.path} onDrawn={onDrawn} />
  return route.kind === 'page' ? <SheetPage path={route.path} at={route.at} heading={route.heading} onDrawn={onDrawn} /> : <SheetCard path={route.path} id={route.id} onDrawn={onDrawn} onText={onText} />
}
