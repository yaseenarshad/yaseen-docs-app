import { useMemo } from 'react'
import { useApp } from '../app/AppState'
import { runFolderView, type FolderModel } from './folderModel'
import { FolderTable } from './FolderTable'
import { FolderBoard, FolderCalendar, FolderCards } from './FolderCards'
import { calendarPlace } from '../store/calendarModePref'

/**
 * THE OPEN VIEW OF A FOLDER'S PAGE: the Mac's engine runs the view (`runFolderView`), and the phone draws it,
 * read only, made for a narrow screen. Above it, what the Mac's toolbar counts: the pages (and the folders) it shows.
 */
export function FolderViewPane({ model, index, vault }: { model: FolderModel; index: number; vault: string }) {
  const app = useApp()
  const run = useMemo(() => runFolderView(model, index, vault), [model, index, vault])
  const pages = run.result.total - run.result.folders
  const word = run.cards ? (pages === 1 ? 'card' : 'cards') : app.unit(pages === 1 ? 'page' : 'pages')
  const count = `${pages} ${word}${run.result.folders > 0 ? ` · ${run.result.folders} ${run.result.folders === 1 ? 'folder' : 'folders'}` : ''}`
  return (
    <div className="folder-view" role="tabpanel" aria-label={run.view.name} data-type={run.view.type}>
      {/* YAZ-5597: a calendar counts the pages its period shows of these ("12 of 930 pages"), over its header. */}
      {(run.view.type !== 'calendar' || run.result.total === 0) && <p className="folder-view__count">{count}</p>}
      {run.result.errors.length > 0 && <p className="reader__notice">{run.result.errors[0].message}</p>}
      <ViewBody run={run} place={calendarPlace(vault, model.dir, run.view.name)} />
    </div>
  )
}

function ViewBody({ run, place }: { run: ReturnType<typeof runFolderView>; place: string }) {
  if (run.result.total === 0) return <p className="muted folder-view__none">Nothing in this view.</p>
  switch (run.view.type) {
    case 'table':
      return <FolderTable run={run} />
    case 'board':
      return <FolderBoard run={run} />
    // The Mac's List view is a column of cards too.
    case 'cards':
    case 'list':
      return <FolderCards run={run} />
    case 'calendar':
      return <FolderCalendar run={run} place={place} />
    default:
      return <p className="muted folder-view__none">This view shows on the Mac.</p>
  }
}
