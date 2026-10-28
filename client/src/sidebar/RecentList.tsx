import { memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore, type MouseEvent } from 'react'
import { hasHoverPreview } from './hoverPreviewKinds'
import type { TreeResponse } from '@shared/types'
import { pageLabel, type PathTitles } from '../lib/pageLabel'
import { storage } from '../lib/storage'
import { FileIcon } from './FileIcon'
import { MAX_RECENTS, recentDays, recentFiles, timeOf, type RecentFile } from './recents'

type Log = Readonly<Record<string, number>>

/** Two save logs with the same files at the same times. */
function sameLog(a: Log, b: Log): boolean {
  if (a === b) return true
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((path) => a[path] === b[path])
}

/**
 * The save logs of `roots` (YAZ-3235 D1), live. Each app-state broadcast is a new copy of all the
 * state, so the snapshot keeps the SAME array until a log really changes: a tab click or a fold in
 * another window does not draw the list again. 500 entries per vault at most, so the compare stays small.
 */
function useEdits(roots: readonly string[]): readonly Log[] {
  const read = useMemo(() => {
    let held: readonly Log[] = []
    return (): readonly Log[] => {
      const next = roots.map((root) => storage.getEdits(root))
      if (next.length === held.length && next.every((log, i) => sameLog(log, held[i]))) return held
      return (held = next)
    }
  }, [roots])
  return useSyncExternalStore(storage.subscribe, read)
}

/** The ms from `now` to the next local midnight. */
const toMidnight = (now: Date): number => new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime()

/**
 * Today's date (`toDateString`), live (YAZ-3235 S16): a timer to the next midnight moves it, and so
 * does a focus of the window — a timer can fire late after the Mac sleeps. The same day sets the
 * same string, so React draws nothing.
 */
function useToday(): string {
  const [today, setToday] = useState(() => new Date().toDateString())
  useEffect(() => {
    const check = () => setToday(new Date().toDateString())
    const timer = window.setTimeout(check, toMidnight(new Date()) + 1000)
    window.addEventListener('focus', check)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('focus', check)
    }
  }, [today])
  return today
}

interface RecentListProps {
  /** The trees of the window's vaults: a logged file draws a row only while its vault's tree has it (S7, S22). */
  trees: ReadonlyMap<string, TreeResponse>
  /** The window's vaults: their save logs make one list (S14). */
  roots: readonly string[]
  /** The names of the pages (YAZ-2420 D14): a row shows its page's name, as a Files row does. */
  titles: PathTitles
  /** The open page: its row lights (S18). */
  activeFile: string | null
  /** A click (S19): App's `openCurrent`, as a click on a tree row — the preview tab. */
  onOpenFile: (path: string) => void
  /** A double-click (S19): App's `openKept`. */
  onKeepFile: (path: string) => void
  /** A ⌘-click (S19): App's `openBackground`. */
  onOpenFileBackground: (path: string) => void
  /** A right-click on a row (D7, S20): the Sidebar opens the one-row file menu, "Show in sidebar" first. */
  onMenu: (path: string, e: MouseEvent) => void
  /** The sidebar's hover preview (YAZ-3403): a note or board row previews beside the sidebar, as a Files row does. */
  onHoverFile?: (node: { path: string } | null) => void
}

/**
 * The Recents tab (YAZ-3235 D3 to D7): the files the app saved last, of every vault of the window,
 * newest first, under one heading per day. A click on a heading folds that day; the folds live while
 * the tab shows. Memo: App draws again on each app-state broadcast; the list draws only when its own
 * props, a save log or the day change.
 */
export const RecentList = memo(function RecentList({ trees, roots, titles, activeFile, onOpenFile, onKeepFile, onOpenFileBackground, onMenu, onHoverFile }: RecentListProps) {
  const edits = useEdits(roots)
  const today = useToday()
  const files = useMemo(() => recentFiles(trees, roots, edits), [trees, roots, edits])
  const days = useMemo(() => recentDays(files, new Date()), [files, today]) // eslint-disable-line react-hooks/exhaustive-deps -- a new day draws the headings again (S16)
  // The days folded shut (D5): all open at mount, never stored. By date, so a fold stays when "Today" becomes "Yesterday".
  const [shut, setShut] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = useCallback(
    (key: string) =>
      setShut((was) => {
        const next = new Set(was)
        if (!next.delete(key)) next.add(key)
        return next
      }),
    [],
  )

  if (files.length === 0) {
    // A tree still on its way: the list cannot say yet which logged files are there.
    if (!roots.every((root) => trees.has(root))) return <p className="sidebar__msg">Loading…</p>
    return <p className="sidebar__msg">Files you edit show here.</p>
  }
  return (
    <>
      {/* The tree's row styles, but no tree for the keys: the sidebar's arrow keys walk `.tree__row[data-path]` rows only, so these rows are buttons that Tab reaches. */}
      <ul className="tree" aria-label="Recents">
        {days.map((day) => {
          const open = !shut.has(day.key)
          return (
            <li key={day.key}>
              <button type="button" className="tree__row recents__day" aria-expanded={open} onClick={() => toggle(day.key)}>
                <span className={`tree__chevron${open ? ' tree__chevron--open' : ''}`} />
                <span className="tree__label">{day.label}</span>
              </button>
              {open && (
                <ul className="tree">
                  {day.files.map((file) => (
                    <RecentRow key={file.path} file={file} active={file.path === activeFile} titles={titles} onOpenFile={onOpenFile} onKeepFile={onKeepFile} onOpenFileBackground={onOpenFileBackground} onMenu={onMenu} onHoverFile={onHoverFile} />
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
      {/* The limit (D3, S21): the 200 newest files show, and a line says so. */}
      {files.length === MAX_RECENTS && <p className="sidebar__msg">Showing the {MAX_RECENTS} newest files.</p>}
    </>
  )
})

interface RecentRowProps extends Pick<RecentListProps, 'titles' | 'onOpenFile' | 'onKeepFile' | 'onOpenFileBackground' | 'onMenu' | 'onHoverFile'> {
  file: RecentFile
  active: boolean
}

/** One file (D6, S18): its page name, and the time of its save on the right; the path is the tooltip. */
function RecentRow({ file, active, titles, onOpenFile, onKeepFile, onOpenFileBackground, onMenu, onHoverFile }: RecentRowProps) {
  const { path, edited } = file
  // A board or note row's hover handlers, as a Files row's (YAZ-3403): pointer and focus alike. The item's `data-path`
  // puts a Files window's floating panel level with the row (`previewRowRect`); the button has none, for the keys.
  const hover = onHoverFile === undefined || !hasHoverPreview(path) ? {} : { onMouseEnter: () => onHoverFile({ path }), onMouseLeave: () => onHoverFile(null), onFocus: () => onHoverFile({ path }), onBlur: () => onHoverFile(null) }
  return (
    <li data-path={path}>
      <button
        type="button"
        className={'tree__row' + (active ? ' tree__row--active' : '')}
        style={{ paddingLeft: 26 }}
        title={path}
        // As a Files row (S19): a click previews, ⌘ opens a background tab, the second click of a double-click keeps the tab.
        onClick={(e) => (e.metaKey ? onOpenFileBackground(path) : onOpenFile(path))}
        onDoubleClick={(e) => {
          if (!e.metaKey) onKeepFile(path)
        }}
        onContextMenu={(e) => onMenu(path, e)}
        {...hover}
      >
        {/* The file's icon, as its Files row has it (YAZ-3440 D11). */}
        <span className="tree__label">
          <FileIcon path={path} />
          {pageLabel(path, false, titles)}
        </span>
        <span className="tree__count">{timeOf(edited)}</span>
      </button>
    </li>
  )
}
