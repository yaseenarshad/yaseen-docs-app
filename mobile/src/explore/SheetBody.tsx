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
import { headingTarget } from '../page/headings'
import { openLink, type LinkDoor } from '../page/openLink'
import { boardKindOf, boardLabel } from '../drawing/boardFiles'
import type { SheetRoute } from './sheets'

/**
 * WHAT A SHEET SHOWS (YAZ-5472): a page or a card, read only, drawn by THE READER'S OWN CODE (`renderPage`, `drawCard`,
 * the card embeds, the pictures, the drawings), so a sheet looks as the page view does. A link in it opens ANOTHER
 * sheet on top (`openSheet`); a file (a PDF, a picture) opens as in the reader.
 */

const text = (content: string | Uint8Array) => (typeof content === 'string' ? content : new TextDecoder().decode(content))

/** The file's text from the phone's storage: undefined while it reads, null when it is not on the phone. Read again when a pass changes it. */
export function useFileText(path: string): string | null | undefined {
  const app = useApp()
  const { store, sync } = app.services
  const vault = app.vaultKey!
  const [value, setValue] = useState<string | null | undefined>(undefined)
  const [reads, setReads] = useState(0)
  useEffect(
    () =>
      sync.subscribe((event) => {
        if (event.type === 'changed' && event.vault === vault && (event.diff == null || event.diff.changed.includes(path))) setReads((n) => n + 1)
      }),
    [sync, vault, path],
  )
  useEffect(() => {
    let live = true
    void store.read(vault, path).then((file) => live && setValue(file === null ? null : text(file.content)))
    return () => {
      live = false
    }
  }, [store, vault, path, reads])
  return value
}

/**
 * A tap in a sheet's text, through the reader's ONE link door (`openLink`) with `click: 'explore'`: a page, a card or a
 * drawing (YAZ-5473: the reader's `tapOf` names a drawing file a drawing) opens in ANOTHER sheet on top; a heading of
 * this page lands there in the sheet; a file opens as in the reader; a missing page's link does nothing, as in the reader.
 */
export function useSheetTap(data: VaultData | null, say: (words: string) => void, click: LinkDoor['click'] | null = 'explore') {
  const app = useApp()
  const media = useVaultMedia()
  // `null` (a folder page full screen, YAZ-5460): the vault's own "Clicking a link" decides.
  const door: LinkDoor = { go: app.go, vaultKey: app.vaultKey, ...(click !== null && { click }) }
  const onTap = async (event: React.MouseEvent) => {
    if (data === null) return
    const tap = tapOf(event.target, data)
    if (tap === null) return void guardLink(event)
    event.preventDefault()
    if (tap.kind === 'go') openLink(door, tap.target)
    else if (tap.kind === 'heading') {
      const root = event.currentTarget as HTMLElement
      headingTarget(root, tap.heading)?.scrollIntoView?.({ block: 'start' })
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
export function SheetPage({ path, at, onDrawn }: { path: string; at?: string; onDrawn(): void }) {
  const app = useApp()
  const data = useVaultData()
  const content = useFileText(path)
  const [notice, setNotice] = useState<string | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const { door, onTap, media } = useSheetTap(data, setNotice)
  useMediaWatch(host, media)
  useDrawings(host, media)
  const title = titleOf(data, path)
  const [sameTitle, setSameTitle] = useState(false)
  const drawn = useRef<string | null>(null)

  useEffect(() => {
    const el = host.current
    if (el === null || data === null || typeof content !== 'string') return
    const key = `${data.version}\n${content}`
    if (drawn.current === key) return
    drawn.current = key
    let live = true
    void (async () => {
      // Drawn off the screen, then swapped in at once: a redraw never shrinks the page under the finger.
      const into = document.createElement('div')
      await renderPage(splitFrontmatter(content).body, pageLook(data, path), into, uiSlicer(), () => live)
      if (!live) return
      await fillCardEmbeds(into, data, app.services.store, door, () => live)
      if (!live) return
      el.replaceChildren(...into.childNodes)
      const head = el.firstElementChild
      // S2 (sweep1): the title hides before the card asked for is landed on (it leaves the flow; the page moves up).
      flushSync(() => setSameTitle(head?.tagName === 'H1' && head.textContent?.trim().toLowerCase() === title.trim().toLowerCase()))
      if (at !== undefined) el.querySelector(`[data-card-id="${at.replace(/["\\]/g, '\\$&')}"]`)?.scrollIntoView?.({ block: 'start' })
      onDrawn()
    })()
    return () => {
      live = false
      drawn.current = null
    }
    // `door` and `onDrawn` are the same doors at each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, data, path, at, title])

  return (
    <article className="reader explore-sheet__reader" aria-label={title}>
      <h2 className={sameTitle ? 'reader__title reader__title--same' : 'reader__title'}>{title}</h2>
      {notice !== null && (
        <p className="reader__notice" role="status">
          {notice}
        </p>
      )}
      {content === null && <p className="muted">{app.unit('This page is not on the phone.')}</p>}
      <div className="reader__body" ref={host} onClick={(e) => void onTap(e)} />
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
  const content = useFileText(path)
  const [notice, setNotice] = useState<string | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const { onTap, media } = useSheetTap(data, setNotice)
  useMediaWatch(host, media)
  const card = cardOfText(data, path, id, content)
  const record = data?.byPath[path]
  const reviewOn = data?.review.enabled === true
  const title = card === null ? (record?.cards?.find((c) => c.id?.toLowerCase() === id.toLowerCase())?.title ?? '') : card.title
  const head = card === null ? null : `${card.id ?? id}\n${card.title}\n${card.off}\n${reviewOn && card.notitle === true}\n${card.text}`

  useEffect(() => {
    const el = host.current
    if (el === null || data === null || card === null) return
    const body = document.createElement('div')
    body.className = 'card__body'
    body.append(drawCard(data, path, card.text))
    const parts = [cardHead({ id: card.id ?? id, title: card.title, off: card.off, notitle: reviewOn && card.notitle === true }), titleBand(card.title), body]
    el.replaceChildren(...parts.filter((part): part is HTMLElement => part !== null))
    el.classList.toggle('card--off', card.off)
    onText(card.text)
    onDrawn()
    // `head` holds what is drawn: a new read with the same card draws nothing again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, path, head])

  return (
    <article className="reader card-view explore-sheet__reader" aria-label={title === '' ? (card?.id ?? id) : title}>
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
    </article>
  )
}

/**
 * A DRAWING FILE ON ITS OWN (YAZ-5473), in a sheet or full screen: drawn by THE SAME CODE as a drawing in a page
 * (YAZ-5440): the reader draws `![[its name]]` from its own folder, so an Excalidraw drawing is drawn on the phone (it
 * fits the width; a tap opens it full screen, with pinch zoom), a `.drawio.svg` shows as the picture it is, and a plain
 * `.drawio` says "Open it on the Mac". Nothing is saved: the picture lives in memory while it shows.
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

/** A folder's page (YAZ-5460): its own chunk, with the Mac's view engine, loaded when one opens. */
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
  return route.kind === 'page' ? <SheetPage path={route.path} at={route.at} onDrawn={onDrawn} /> : <SheetCard path={route.path} id={route.id} onDrawn={onDrawn} onText={onText} />
}
