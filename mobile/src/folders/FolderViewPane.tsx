import { useMemo, useState } from 'react'
import { useApp } from '../app/AppState'
import { allFoldKeys, foldSpot, MAX_FOLD_KEYS, readFolds, writeFolds } from '../store/folderFolds'
import { runFolderView, type FolderModel } from './folderModel'
import { FolderTable } from './FolderTable'
import { FolderBoard, FolderCalendar, FolderCards } from './FolderCards'

/**
 * THE OPEN VIEW OF A FOLDER'S PAGE: the Mac's engine runs the view (`runFolderView`), and the phone draws it,
 * read only, made for a narrow screen. Above it, what the Mac's toolbar counts: the pages (and the folders) it shows.
 * YAZ-5598: a grouped table's folded groups (this phone's, `folderFolds.ts`), and after the count the Mac's toolbar
 * toggle: Collapse all groups, or Expand all groups when every group is folded (a 44 px tap).
 */
export function FolderViewPane({ model, index, vault }: { model: FolderModel; index: number; vault: string }) {
  const app = useApp()
  const run = useMemo(() => runFolderView(model, index, vault), [model, index, vault])
  const pages = run.result.total - run.result.folders
  const word = run.cards ? (pages === 1 ? 'card' : 'cards') : app.unit(pages === 1 ? 'page' : 'pages')
  const spot = foldSpot(vault, model.dir, run.view.name)
  const [folds, setFolds] = useState(() => ({ spot, keys: readFolds(spot) }))
  // Another view or folder (the pane is kept): its own folds.
  const folded = folds.spot === spot ? folds.keys : readFolds(spot)
  const fold = (keys: readonly string[]) => {
    writeFolds(spot, keys)
    setFolds({ spot, keys: [...keys] })
  }
  const groupKeys = run.view.type === 'table' ? allFoldKeys(run.groups) : []
  const allKeys = groupKeys.length > MAX_FOLD_KEYS ? [] : groupKeys
  const allFolded = allKeys.length > 0 && allKeys.every((k) => folded.includes(k))
  const count = `${pages} ${word}${run.result.folders > 0 ? ` · ${run.result.folders} ${run.result.folders === 1 ? 'folder' : 'folders'}` : ''}`
  return (
    <div className="folder-view" role="tabpanel" aria-label={run.view.name} data-type={run.view.type}>
      <p className="folder-view__count">
        {count}
        {allKeys.length > 0 && (
          <button type="button" className="folder-view__fold" aria-label={allFolded ? 'Expand all groups' : 'Collapse all groups'} title={allFolded ? 'Expand all groups' : 'Collapse all groups'} onClick={() => fold(allFolded ? [] : allKeys)}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d={allFolded ? 'M4.5 4 8 7l3.5-3M4.5 9 8 12l3.5-3' : 'M4.5 7 8 4l3.5 3M4.5 12 8 9l3.5 3'} />
            </svg>
          </button>
        )}
      </p>
      {run.result.errors.length > 0 && <p className="reader__notice">{run.result.errors[0].message}</p>}
      <ViewBody run={run} folded={folded} onFold={(k) => fold(folded.includes(k) ? folded.filter((x) => x !== k) : [...folded, k])} />
    </div>
  )
}

function ViewBody({ run, folded, onFold }: { run: ReturnType<typeof runFolderView>; folded: readonly string[]; onFold: (key: string) => void }) {
  if (run.result.total === 0) return <p className="muted folder-view__none">Nothing in this view.</p>
  switch (run.view.type) {
    case 'table':
      return <FolderTable run={run} folded={folded} onFold={onFold} />
    case 'board':
      return <FolderBoard run={run} />
    // The Mac's List view is a column of cards too.
    case 'cards':
    case 'list':
      return <FolderCards run={run} />
    case 'calendar':
      return <FolderCalendar run={run} />
    default:
      return <p className="muted folder-view__none">This view shows on the Mac.</p>
  }
}
