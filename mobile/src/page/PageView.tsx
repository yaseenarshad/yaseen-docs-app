import { useEffect, useRef, useState } from 'react'
import { splitFrontmatter } from '@shared/frontmatter'
import { useApp } from '../app/AppState'
import { Frame } from '../screens/Frame'
import { setSearchNotice } from '../search/searchState'
import { useVaultData } from '../search/vaultData'
import { uiSlicer } from '../sync/yieldToUi'
import { useDrawings } from '../drawing/useDrawings'
import { useMediaWatch, useVaultMedia } from '../media/ui/useVaultMedia'
import { guardLink } from '../media/ui/safeLinks'
import { openFile } from '../media/ui/vaultMedia'
import { headingTarget, landOn } from './headings'
import { LinkedFrom } from './LinkedFrom'
import { openLink, type LinkDoor } from './openLink'
import { resolveSourceOf } from './pageLook'
import { useVaultLook } from './vaultLook'
import { usePageTools } from './PageTools'
import { PropertiesTab } from './PropertiesTab'
import { vaultName } from '../screens/Frame'
import { fillCardEmbeds, tapOf } from './pageDom'
import { pageLook } from './pageLook'
import { PageArrows, PageIdChip, pageIdOf } from './pageNav'
import { renderPage } from './pageRender'
import { PageComments, PageCommentsCount } from './comments/PageComments'
import { useTables } from './useTables'
import { shownText, useAnswers, useAnswersChanged } from '../cardMenu/useAnswers'
import { usePageCardMenu } from '../cardMenu/pageCardMenu'

/**
 * A PAGE, READ ONLY (YAZ-5079, 4C; decision 1: stage one reads pages). The page's text from the phone's storage, drawn
 * with no editor (`renderPage`), its cards and embedded cards in place, its pictures and sounds from 3D's media when they near the screen. No keyboard
 * opens here: there is nothing to edit in stage one.
 *
 * It follows the sync (3B's `changed` event, rows of the October record):
 *  - R3 the page changed: it draws again in place, at the same reading place.
 *  - R5 the page was deleted: back to the list, which says so.
 *  - R6 the page was renamed: it stays open, under the new path.
 */
/** YAZ-5211: where each page was read last (phone memory only), so Back shows a page at its place. */
const readingPlace = new Map<string, number>()

export default function PageView({ path: opened, at, heading }: { path: string; at?: string; heading?: string }) {
  const app = useApp()
  const { store, sync } = app.services
  const vault = app.vaultKey!
  const data = useVaultData()
  const [path, setPath] = useState(opened)
  const [text, setText] = useState<string | null | undefined>(undefined)
  const [reads, setReads] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  /** The page's first block is a heading with its title: the reader's own title is not drawn a second time. */
  const [sameTitle, setSameTitle] = useState(false)
  const host = useRef<HTMLDivElement>(null)
  const media = useVaultMedia()
  // Pictures and sounds come as they near the screen; a new piece or an embedded card is watched too.
  useMediaWatch(host, media)
  // YAZ-5440: its drawings, drawn on the phone when they near the screen; nothing is saved.
  useDrawings(host, media)
  // YAZ-5471: its wide tables: the shadows at their sides, and ⤢ to open one full screen.
  useTables(host)

  // YAZ-5455: the vault's own look (link pills, heading sizes) and its "Clicking a link", for the link door.
  const look = useVaultLook(store, data)
  const door: LinkDoor = { go: app.go, vaultKey: app.vaultKey, click: look?.click }
  const doorRef = useRef(door)
  doorRef.current = door
  // YAZ-5456: "⋯" → Find in page, Headings (each a lazy chunk).
  const tools = usePageTools(host)
  // YAZ-5504: each card's ⋯ (the card actions); the page reads its cards as the phone shows them (with waiting actions).
  const answers = useAnswers()
  useAnswersChanged(answers, path, () => setReads((n) => n + 1))
  const cardMenu = usePageCardMenu(host, { path, answers, upNext: data?.review.enabled === true })
  const record = data?.byPath[path]
  const title = record?.title ?? path.slice(path.lastIndexOf('/') + 1).replace(/\.(md|markdown)$/i, '')

  // R3, R5, R6 from the sync's diff of the open vault.
  useEffect(
    () =>
      sync.subscribe((event) => {
        if (event.type !== 'changed' || event.vault !== vault) return
        const diff = event.diff
        if (diff === undefined || diff === null) return setReads((n) => n + 1)
        if (diff.removed.includes(path)) {
          setSearchNotice(`"${title}" was deleted.`)
          app.go({ type: 'back' })
          return
        }
        const renamed = diff.renamed.find((r) => r.from === path)
        if (renamed !== undefined) setPath(renamed.to)
        else if (diff.changed.includes(path)) setReads((n) => n + 1)
      }),
    [sync, vault, path, title, app],
  )

  // The text, from storage, with the answer list's waiting actions (YAZ-5504: a card's change shows at once).
  useEffect(() => {
    let live = true
    void shownText(store, vault, path, answers).then((content) => {
      if (live) setText(content)
    })
    return () => {
      live = false
    }
  }, [store, vault, path, reads, answers])

  // Draw it, in slices; again when the text or the vault's index changes, at the same reading place (R3).
  const drawn = useRef<{ text: string; version: number; look: object } | null>(null)
  const everDrawn = useRef(false)
  useEffect(() => {
    const el = host.current
    if (el === null || data === null || typeof text !== 'string' || look === undefined) return
    if (drawn.current !== null && drawn.current.text === text && drawn.current.version === data.version && drawn.current.look === look) return
    resolveSourceOf(data).setLook(look.pills, vaultName(app.vault?.repo ?? ''))
    let live = true
    const scroller = el.closest('.screen')
    const top = scroller?.scrollTop ?? 0
    // The first draw of this view (a redraw after R3 keeps the place it had).
    const first = !everDrawn.current
    everDrawn.current = true
    drawn.current = { text, version: data.version, look }
    void (async () => {
      // YAZ-5436: a REDRAW (the sync changed the page or the vault) is drawn off the screen, its cards in place, then
      // swapped in at once. Before, the page shrank to its first slice under the finger, the scroll place jumped, and
      // the embedded cards came again one by one: the page "hung" while the person scrolled.
      const into = first ? el : document.createElement('div')
      await renderPage(splitFrontmatter(text).body, pageLook(data, path), into, uiSlicer(), () => live)
      if (!live) return
      if (!first) {
        await fillCardEmbeds(into, data, store, doorRef.current, () => live)
        if (!live) return
        el.replaceChildren(...into.childNodes)
      }
      const head = el.firstElementChild
      setSameTitle(head?.tagName === 'H1' && head.textContent?.trim().toLowerCase() === title.trim().toLowerCase())
      if (scroller !== null && !first) scroller.scrollTop = top
      // YAZ-5211: back on a page read before, at its reading place (a card asked for by `at` comes first).
      if (scroller !== null && first && at === undefined && heading === undefined) scroller.scrollTop = readingPlace.get(`${vault}\n${path}`) ?? 0
      // YAZ-5455: a link that named a heading (`[[Page#Goals]]`) lands on it; one the page lacks opens it at its top.
      if (first && heading !== undefined) {
        const target = headingTarget(el, heading)
        if (target !== null) landOn(target)
        else if (scroller !== null) scroller.scrollTop = 0
      }
      if (first && at !== undefined) el.querySelector(`[data-card-id="${at.replace(/["\\]/g, '\\$&')}"]`)?.scrollIntoView?.({ block: 'start' })
      if (first) await fillCardEmbeds(el, data, store, doorRef.current, () => live)
    })()
    return () => {
      live = false
      drawn.current = null
    }
  }, [text, data, look, path, at, heading, store, app.go, app.vault, title])

  // YAZ-5211: the reading place of this page, kept as the person scrolls.
  useEffect(() => {
    const scroller = host.current?.closest('.screen')
    if (scroller == null) return
    const keep = () => readingPlace.set(`${vault}\n${path}`, scroller.scrollTop)
    scroller.addEventListener('scroll', keep, { passive: true })
    return () => scroller.removeEventListener('scroll', keep)
  }, [vault, path])

  const onTap = async (event: React.MouseEvent) => {
    if (data === null) return
    const tap = tapOf(event.target, data)
    // Any other link: the web opens Safari, the app's window stays (YAZ-5243).
    if (tap === null) return void guardLink(event)
    event.preventDefault()
    // A link to this same page (`[[This page#Goals]]`) lands here: it opens no second copy of the page.
    const self = tap.kind === 'go' && tap.target.kind === 'page' && tap.target.path === path ? tap.target : null
    if (self !== null) {
      const target = self.heading === undefined || host.current === null ? null : headingTarget(host.current, self.heading)
      if (target !== null) landOn(target)
      else host.current?.closest('.screen')?.scrollTo?.({ top: 0 })
    } else if (tap.kind === 'go') openLink(door, tap.target)
    // YAZ-5455: a heading of this page lands there; a missing page's link does nothing.
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
        {/* YAZ-5478: the comment count, at the top right of the column; a tap goes to the comments at the end. */}
        {typeof text === 'string' && <PageCommentsCount text={text} />}
        <h2 className={sameTitle ? 'reader__title reader__title--same' : 'reader__title'}>{title}</h2>
        {notice !== null && (
          <p className="reader__notice" role="status">
            {notice}
          </p>
        )}
        {gone && <p className="muted">{record === undefined ? app.unit('This page is not on the phone.') : app.unit('This page is too large to show on the phone. Open it on the Mac.')}</p>}
        {/* The page's text: drawn by `renderPage`, which cleans it first. A tap on a link opens what it names. */}
        <div className="reader__body" ref={host} onClick={(e) => void onTap(e)} />
        {/* YAZ-5461: the page's comments, and its Comment button (`comments/`). */}
        {typeof text === 'string' && <PageComments path={path} text={text} />}
        {tools.sheet}
        {cardMenu}
        <PropertiesTab record={record} data={data} door={door} />
        {data !== null && text !== undefined && <LinkedFrom path={path} data={data} store={store} door={door} />}
      </article>
    </Frame>
  )
}
