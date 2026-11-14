import { useEffect, useRef, useState } from 'react'
import { splitFrontmatter } from '@shared/frontmatter'
import { useApp } from '../app/AppState'
import { Frame, vaultName } from '../screens/Frame'
import { setSearchNotice } from '../search/searchState'
import { useVaultData } from '../search/vaultData'
import { uiSlicer } from '../sync/yieldToUi'
import { useMediaWatch, useVaultMedia } from '../media/ui/useVaultMedia'
import { openFile } from '../media/ui/vaultMedia'
import { fillCardEmbeds, tapOf } from './pageDom'
import { pageLook } from './pageLook'
import { renderPage } from './pageRender'

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
export default function PageView({ path: opened, at }: { path: string; at?: string }) {
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

  // The text, from storage only.
  useEffect(() => {
    let live = true
    void store.read(vault, path).then((file) => {
      if (!live) return
      setText(file === null ? null : typeof file.content === 'string' ? file.content : new TextDecoder().decode(file.content))
    })
    return () => {
      live = false
    }
  }, [store, vault, path, reads])

  // Draw it, in slices; again when the text or the vault's index changes, at the same reading place (R3).
  const drawn = useRef<{ text: string; version: number } | null>(null)
  useEffect(() => {
    const el = host.current
    if (el === null || data === null || typeof text !== 'string') return
    if (drawn.current !== null && drawn.current.text === text && drawn.current.version === data.version) return
    let live = true
    const scroller = el.closest('.screen')
    const top = scroller?.scrollTop ?? 0
    const first = drawn.current === null
    drawn.current = { text, version: data.version }
    void (async () => {
      await renderPage(splitFrontmatter(text).body, pageLook(data, path), el, uiSlicer(), () => live)
      if (!live) return
      const head = el.firstElementChild
      setSameTitle(head?.tagName === 'H1' && head.textContent?.trim().toLowerCase() === title.trim().toLowerCase())
      if (scroller !== null && !first) scroller.scrollTop = top
      if (first && at !== undefined) el.querySelector(`[data-card-id="${at.replace(/["\\]/g, '\\$&')}"]`)?.scrollIntoView?.({ block: 'start' })
      await fillCardEmbeds(el, data, store, app.go, () => live)
    })()
    return () => {
      live = false
      drawn.current = null
    }
  }, [text, data, path, at, store, app.go, title])

  const onTap = async (event: React.MouseEvent) => {
    if (data === null) return
    const tap = tapOf(event.target, data)
    if (tap === null) return
    event.preventDefault()
    if (tap.kind === 'go') app.go(tap.action)
    else if (tap.kind === 'missing') setNotice(tap.text)
    else setNotice(await openFile(media, tap.path))
  }

  const gone = text === null && data !== null
  return (
    <Frame title={app.vault === null ? title : vaultName(app.vault.repo)} back={() => app.go({ type: 'back' })} tabs>
      <article className="reader" aria-label={title}>
        <h2 className={sameTitle ? 'reader__title reader__title--same' : 'reader__title'}>{title}</h2>
        {notice !== null && (
          <p className="reader__notice" role="status">
            {notice}
          </p>
        )}
        {gone && <p className="muted">{record === undefined ? app.unit('This page is not on the phone.') : app.unit('This page is too large to show on the phone. Open it on the Mac.')}</p>}
        {/* The page's text: drawn by `renderPage`, which cleans it first. A tap on a link opens what it names. */}
        <div className="reader__body" ref={host} onClick={(e) => void onTap(e)} />
      </article>
    </Frame>
  )
}
