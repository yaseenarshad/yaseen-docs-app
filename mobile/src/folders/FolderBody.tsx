import { useEffect, useMemo, useRef, useState } from 'react'
import { splitFrontmatter } from '@shared/frontmatter'
import { useApp } from '../app/AppState'
import { useVaultData } from '../search/vaultData'
import { uiSlicer } from '../sync/yieldToUi'
import { useDrawings } from '../drawing/useDrawings'
import { useMediaWatch } from '../media/ui/useVaultMedia'
import { openFile as openMediaFile } from '../media/ui/vaultMedia'
import { fillCardEmbeds } from '../page/pageDom'
import { pageLook } from '../page/pageLook'
import { renderPage } from '../page/pageRender'
import { useTables } from '../page/useTables'
import { vaultName } from '../screens/Frame'
import { openFile } from '../explore/openFile'
import { useFileText, useSheetTap } from '../explore/SheetBody'
import { boardKindOf } from '../drawing/boardFiles'
import { folderModel, type FolderModel } from './folderModel'
import { FolderViewPane } from './FolderViewPane'
import './folders.css'

/**
 * A FOLDER'S PAGE, READ ONLY (YAZ-5460), in a sheet or full screen: what the Mac's folder page shows for the folder, from
 * the vault (its `.folder.md` and the view keys in it; nothing of it is the Mac's own state):
 *  - its title and its own text (the `.folder.md`'s body), drawn by the reader;
 *  - its view tabs as the Mac lists them, the saved default view open first (a Page tab is the text above, so it has no
 *    tab here), and the open view under them (`FolderViewPane`);
 *  - Other files (YAZ-4597): the files in the folder that are not pages, then the pages and folders moved there.
 * A chunk of its own, with the Mac's view engine; the first load never carries it. Nothing here writes.
 */

/** The tab each folder showed last, while the app runs (the Mac keeps the open view tab for its session too). */
const lastTab = new Map<string, number>()

export default function FolderBody({ path, onDrawn, sheet = true }: { path: string; onDrawn?(): void; sheet?: boolean }) {
  const app = useApp()
  const data = useVaultData()
  const repo = vaultName(app.vault?.repo ?? '')
  const model = useMemo(() => (data === null ? null : folderModel(data, path, repo)), [data, path, repo])
  const key = `${app.vaultKey}\n${path}`
  const [tab, setTab] = useState<number | null>(lastTab.get(key) ?? null)
  const shown = model === null ? -1 : tab !== null && model.tabs.some((t) => t.index === tab) ? tab : model.start
  const choose = (index: number) => {
    lastTab.set(key, index)
    setTab(index)
  }
  const there = data === null || data.folders.some((f) => f.folder === path) || data.records.some((r) => r.folder === path || r.folder.startsWith(`${path}/`))
  return (
    <article className="reader folder-page" aria-label={model?.title ?? path}>
      <h2 className="reader__title">
        <span className="file-icon folder-page__icon" data-kind="folder" aria-hidden />
        {model?.title ?? path.slice(path.lastIndexOf('/') + 1)}
      </h2>
      {!there && <p className="muted">{app.unit('This folder is not in the vault.')}</p>}
      {model !== null && there && (
        <>
          <FolderText model={model} sheet={sheet} onDrawn={onDrawn} />
          {model.tabs.length > 0 && (
            <div className="folder-tabs" role="tablist" aria-label="Views">
              {model.tabs.map((t) => (
                <button key={t.index} type="button" role="tab" className="folder-tabs__tab" data-type={t.type} aria-selected={t.index === shown} onClick={() => choose(t.index)}>
                  <span className="folder-tabs__glyph" aria-hidden />
                  {t.name}
                </button>
              ))}
            </div>
          )}
          {shown !== -1 && <FolderViewPane key={shown} model={model} index={shown} vault={repo} />}
          <OtherFiles model={model} />
        </>
      )}
    </article>
  )
}

/** The folder's own text, its `.folder.md`'s body, drawn by the reader (its links, cards, pictures, tables). */
function FolderText({ model, sheet, onDrawn }: { model: FolderModel; sheet: boolean; onDrawn?(): void }) {
  const app = useApp()
  const content = useFileText(model.textPath)
  const host = useRef<HTMLDivElement>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const { door, onTap, media } = useSheetTap(model.data, setNotice, sheet ? 'explore' : null)
  useMediaWatch(host, media)
  useDrawings(host, media)
  useTables(host)
  const data = model.data
  const body = typeof content === 'string' ? splitFrontmatter(content).body.trim() : ''
  useEffect(() => {
    const el = host.current
    if (el === null) return
    if (body === '') {
      el.replaceChildren()
      if (content !== undefined) onDrawn?.()
      return
    }
    let live = true
    void (async () => {
      const into = document.createElement('div')
      await renderPage(body, pageLook(data, model.textPath), into, uiSlicer(), () => live)
      if (!live) return
      await fillCardEmbeds(into, data, app.services.store, door, () => live)
      if (!live) return
      // The folder's name is the page's title: a first heading that says it again is not drawn twice.
      const head = into.firstElementChild
      if (head?.tagName === 'H1' && head.textContent?.trim().toLowerCase() === model.title.trim().toLowerCase()) head.remove()
      el.replaceChildren(...into.childNodes)
      onDrawn?.()
    })()
    return () => {
      live = false
    }
    // `door` and `onDrawn` are the same doors at each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, data, model.textPath, model.title])
  return (
    <>
      {notice !== null && (
        <p className="reader__notice" role="status">
          {notice}
        </p>
      )}
      <div className="reader__body folder-page__text" ref={host} hidden={body === ''} onClick={(e) => void onTap(e)} />
    </>
  )
}

/** Other files (the Mac's tray, YAZ-4597): a tap opens a page, a folder's page, a drawing, or a file as the reader does. */
function OtherFiles({ model }: { model: FolderModel }) {
  const app = useApp()
  const [open, setOpen] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)
  const { media } = useSheetTap(model.data, setNotice)
  if (model.other.length === 0) return null
  const tap = async (path: string, type: string) => {
    if (type === 'page') return openFile(app, { kind: 'page', path })
    if (type === 'folder') return openFile(app, { kind: 'folder', path })
    if (boardKindOf(path) !== null) return openFile(app, { kind: 'drawing', path })
    const words = await openMediaFile(media, path)
    if (words !== null) setNotice(words)
  }
  return (
    <section className="folder-other" aria-label="Other files">
      <button type="button" className="folder-other__head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={`tree__chevron${open ? ' tree__chevron--open' : ''}`} aria-hidden />
        Other files <span className="folder-other__count">{model.other.length}</span>
      </button>
      {notice !== null && (
        <p className="reader__notice" role="status">
          {notice}
        </p>
      )}
      {open && (
        <ul className="folder-other__list">
          {model.other.map((f) => (
            <li key={`${f.type}\n${f.path}`}>
              <button type="button" className="folder-other__row" onClick={() => void tap(f.path, f.type)}>
                <span className="file-icon" data-kind={f.type === 'page' ? 'markdown' : f.type === 'folder' ? 'folder' : (boardKindOf(f.path) ?? 'file')} aria-hidden />
                <span className="folder-other__name">{f.name}</span>
                <span className="folder-other__type">{f.type === 'page' ? app.unit('Page') : f.type === 'folder' ? 'Folder' : f.type}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
