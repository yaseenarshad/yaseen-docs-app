/**
 * THE OTHER FILES TRAY (YAZ-4597, D43-D46): a collapsible section at the foot of a folder page, under every view tab,
 * because it belongs to the folder.
 *
 *  - ITS LINES (D44, D45): the files directly in the folder that are not notes — off the window's Files tree, which
 *    lists every file; the index has only notes — then the notes moved there (`other_files`). Each line has the
 *    sidebar's icon, a type, the size and the modified date. The header counts them.
 *  - OPENING (D46): a click opens the file in this tab, through the app's opener for its kind (PDF, image, drawing,
 *    diagram, code); ⌘-click opens a background tab. The right-click is the views' row menu (`PageContextMenu`): Open,
 *    Open in new tab, Copy path, Reveal in Finder, and on a moved note "Move back to the table".
 *  - DRAG (D46): a view row dropped on the tray moves there (a row drag sets `text/plain` to its path, `groupDrag.ts`);
 *    a moved note dragged onto the view body moves back (`trayBackTarget`). No moves while the page is read only (D36).
 *  - OPEN OR CLOSED: per folder page, with the views' collapsed groups (`storage.getViewGroups`), under the page's own
 *    `<folder>::` key, which a folder rename carries.
 *  - A WHOLE SUBFOLDER (YAZ-4747 OF3): a folder moved here is one line with a chevron, closed at first. Open, it shows
 *    its subfolders (each with its own chevron), then its files, indented, in the Files tree's order. Which folders
 *    are open is kept with the tray's own open state. Its right-click has "Move back to the table" (OF4); a line
 *    inside it has the plain menu.
 *  - HOVER (YAZ-4601 demo 13C): resting on a line opens the sidebar's hover panel beside it (`useCardPreview`), as a
 *    row of the views does, under "Preview rows on hover": a drawing's or diagram's picture, a text file's top with its
 *    colours, a moved note's top, a picture, a PDF's first page (13R; one rule, `hasHoverPreview`).
 */
import { Fragment, useMemo, useRef, useState, type CSSProperties, type ReactNode, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { BOARD_TYPE_NAME } from '@shared/fileKind'
import { folderSettingsPath, type DiagramDarkColors, type FileKind, type IndexRecord, type TreeNode } from '@shared/types'
import { FileIcon } from '../../sidebar/FileIcon'
import { useLatestTrees } from '../../lib/pageLabel'
import { formatBytes, formatDateTime } from '../../lib/format'
import { basename } from '../../lib/paths'
import { storage } from '../../lib/storage'
import { CardPreviewHost, useCardPreview, type PreviewScope } from '../../tabs/cardPreview'
import { PageContextMenu } from './PageContextMenu'

/** One line of the tray. */
export interface OtherFileLine {
  path: string
  name: string
  type: string
  size: number
  mtime: number
  /** A note moved here (D44): it moves back to the table. */
  note: boolean
}

const TYPE_NAME: Record<FileKind, string> = { markdown: 'Note', text: 'Text', pdf: 'PDF', image: 'Image', drawing: BOARD_TYPE_NAME.drawing, diagram: BOARD_TYPE_NAME.diagram }

/** The files in `nodes` that are not notes, in the tree's order. */
const filesIn = (nodes: readonly TreeNode[]): OtherFileLine[] =>
  nodes.flatMap((n) => (n.type === 'file' && n.kind !== 'markdown' ? [{ path: n.path, name: n.name, type: n.kind === null ? 'File' : TYPE_NAME[n.kind], size: n.size, mtime: n.mtime, note: false }] : []))

/** What `dir` holds in a Files tree of `root`: its children, or none when the tree does not list it. */
export function folderNodes(tree: readonly TreeNode[], root: string, dir: string): readonly TreeNode[] {
  if (dir === root) return tree
  for (const node of tree) {
    if (node.type !== 'dir') continue
    if (node.path === dir) return node.children
    if (dir.startsWith(`${node.path}/`)) return folderNodes(node.children, root, dir)
  }
  return []
}

/** The files directly in `dir` that are not notes (D44, D45), off a Files tree of `root`. A subfolder's files are its own page's. */
export const folderFiles = (tree: readonly TreeNode[], root: string, dir: string): OtherFileLine[] => filesIn(folderNodes(tree, root, dir))

/** A line inside a moved folder (YAZ-4747 OF3): every file, a note too (named without `.md`, as the sidebar names it), typed as the tray types them. */
const nodeLine = (node: Extract<TreeNode, { type: 'file' }>): OtherFileLine => ({ path: node.path, name: node.kind === 'markdown' ? node.name.replace(/\.md$/i, '') : node.name, type: node.kind === null ? 'File' : TYPE_NAME[node.kind], size: node.size, mtime: node.mtime, note: false })

/** A folder's lines, subfolders first (OF3): each `dir` node, then each file, in the tree's order within each. */
const byFoldersFirst = (nodes: readonly TreeNode[]): TreeNode[] => [...nodes.filter((n) => n.type === 'dir'), ...nodes.filter((n) => n.type === 'file')]

/** A moved note as a line. */
export const noteLine = (record: IndexRecord): OtherFileLine => ({ path: record.path, name: record.title, type: TYPE_NAME.markdown, size: record.size, mtime: record.mtime, note: true })

/** The tray's collapsed marker in the page's collapsed-groups entry. */
const CLOSED = 'other-files'
/**
 * The most lines the tray mounts at once (YAZ-4921 check 27): a 3,000-file root built a 30,000-node list on one paint. The
 * tray has no scroll box of its own to window in, so past this a "Show all N files" row mounts the rest on a click. The
 * count above the list reads every line; a moved folder's lines are not counted against it.
 */
export const OTHER_FILES_LIMIT = 200
/** An open folder's marker in the same entry (YAZ-4747 OF3): folders start closed. */
const OPEN_DIR = 'other-files-open:'

/** The note being dragged out of the tray, between its dragstart and its drop or dragend. */
let fromTray: string | null = null
/** The tray drag's own payload (YAZ-4635 P2), `ViewTabs`' `VIEW_TAB_MIME` idiom: never `text/plain`, which the Page tab's editor would insert as text on a drop. */
const TRAY_NOTE_MIME = 'application/x-yaseen-tray-note'

/** The view body as a drop target for a note dragged out of the tray (D46). Nothing while the page takes no moves. */
export function trayBackTarget(onMoveBack: ((path: string) => void) | null): Record<string, unknown> {
  if (onMoveBack === null) return {}
  return {
    onDragOver: (e: ReactDragEvent) => {
      if (fromTray === null) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    },
    onDrop: (e: ReactDragEvent) => {
      const path = fromTray
      if (path === null) return
      e.preventDefault()
      fromTray = null
      onMoveBack(path)
    },
  }
}

export interface OtherFilesProps {
  root: string
  /** The folder page's directory. */
  dir: string
  /** The notes moved here, in `other_files` order. */
  notes: readonly IndexRecord[]
  /** The subfolders moved here (YAZ-4747), in `other_files` order; "Move back to the table" takes a folder's directory. */
  folders?: readonly { dir: string; name: string }[]
  onOpen: (path: string) => void
  onOpenBackground?: (path: string) => void
  onNotice?: (message: string) => void
  /** "Move back to the table"; null while the page is read only (D36). */
  onMoveBack: ((path: string) => void) | null
  /** A dragged view row dropped here; null while the page is read only. The host checks the path is one of its notes. */
  onTakeRow: ((path: string) => void) | null
  /** "Preview rows on hover" (demo 13C): resting on a line shows the sidebar's panel beside it. Off = no dwell. */
  hoverPreview?: boolean
  /** What the hover panel needs of the page's vault: App's `boardPreviewScope`. No scope, no hover panel. */
  previewScope?: (path: string) => PreviewScope
  diagramDarkColors?: DiagramDarkColors
}

const NO_FOLDERS: readonly { dir: string; name: string }[] = []

export function OtherFiles({ root, dir, notes, folders = NO_FOLDERS, onOpen, onOpenBackground, onNotice, onMoveBack, onTakeRow, hoverPreview = false, previewScope, diagramDarkColors = 'adapt' }: OtherFilesProps) {
  const roots = useMemo(() => [root], [root])
  const [tree] = useLatestTrees(roots)
  // The hover panel (demo 13C): the tray's own dwell and panel, beside the line under the pointer; a line is found again by its path.
  const listRef = useRef<HTMLUListElement>(null)
  const { store: hoverStore, hoverCard, leaveCard } = useCardPreview(hoverPreview, (path) => listRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`) ?? null)
  const files = useMemo(() => (tree === null ? [] : folderFiles(tree.tree, root, dir)), [tree, root, dir])
  const lines = useMemo(() => [...files, ...notes.map(noteLine)], [files, notes])
  const key = `${dir}::`
  // One stored entry: the tray's closed marker, and each open folder's (OF3).
  const [marks, setMarks] = useState(() => storage.getViewGroups(root, key))
  const open = !marks.includes(CLOSED)
  const [over, setOver] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; line: OtherFileLine; folder?: boolean } | null>(null)
  // "Show all N files": for this folder; another folder's tray starts at the limit again.
  const [allFor, setAllFor] = useState<string | null>(null)
  const shown = allFor === dir || lines.length <= OTHER_FILES_LIMIT ? lines : lines.slice(0, OTHER_FILES_LIMIT)

  const flip = (mark: string): void => {
    const next = marks.includes(mark) ? marks.filter((m) => m !== mark) : [...marks, mark]
    setMarks(next)
    storage.setViewGroups(root, key, next)
  }
  const toggle = (): void => flip(CLOSED)
  const onClick = (e: ReactMouseEvent, path: string): void => {
    if (e.metaKey && onOpenBackground !== undefined) onOpenBackground(path)
    else onOpen(path)
  }
  const drop =
    onTakeRow === null
      ? {}
      : {
          onDragOver: (e: ReactDragEvent) => {
            // A note of the tray's own is no drop; any other drag must carry a path (`text/plain`).
            if (fromTray !== null || (e.dataTransfer != null && !e.dataTransfer.types.includes('text/plain'))) return
            e.preventDefault()
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
            setOver(true)
          },
          onDragLeave: (e: ReactDragEvent) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
          },
          onDrop: (e: ReactDragEvent) => {
            setOver(false)
            if (fromTray !== null) return
            e.preventDefault()
            const path = e.dataTransfer?.getData('text/plain') ?? ''
            if (path !== '') onTakeRow(path)
          },
        }

  /**
   * A folder's line and, while it is open, its lines below it (OF3), each `depth` steps in. `moved` = the folder that was
   * moved here: its right-click moves it back. A folder line opens and closes on a click of its chevron or its name.
   */
  const folderLines = (node: { path: string; name: string }, depth: number, moved: boolean): ReactNode => {
    const mark = `${OPEN_DIR}${node.path}`
    const opened = marks.includes(mark)
    const children = opened && tree !== null ? byFoldersFirst(folderNodes(tree.tree, root, node.path)) : []
    return (
      <Fragment key={node.path}>
        <li
          className="other-files__line other-files__line--folder"
          data-path={node.path}
          style={{ '--other-files-depth': depth } as CSSProperties}
          onContextMenu={(e) => {
            e.preventDefault()
            setMenu({ x: e.clientX, y: e.clientY, line: { path: node.path, name: node.name, type: 'Folder', size: 0, mtime: 0, note: moved }, folder: true })
          }}
        >
          <button type="button" className="other-files__name" title={node.path} aria-expanded={opened} onClick={() => flip(mark)}>
            <svg className="other-files__chevron" width={12} height={12} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m6 4 4 4-4 4" />
            </svg>
            <FileIcon path={node.path} folder />
            <span>{node.name}</span>
          </button>
          <span className="other-files__type">Folder</span>
          <span className="other-files__size" />
          <span className="other-files__date" />
        </li>
        {children.map((child) => (child.type === 'dir' ? folderLines({ path: child.path, name: child.name }, depth + 1, false) : fileLine(nodeLine(child), depth + 1)))}
      </Fragment>
    )
  }
  /** A file inside a moved folder (OF3): it opens and previews as a tray line does; its right-click is the plain menu. */
  const fileLine = (line: OtherFileLine, depth: number): ReactNode => (
    <li
      key={line.path}
      className="other-files__line"
      data-path={line.path}
      style={{ '--other-files-depth': depth } as CSSProperties}
      onMouseEnter={() => hoverCard(line.path, line.path)}
      onMouseLeave={() => leaveCard(line.path)}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY, line })
      }}
    >
      <button type="button" className="other-files__name" title={line.path} onClick={(e) => onClick(e, line.path)}>
        <FileIcon path={line.path} />
        <span>{line.name}</span>
      </button>
      <span className="other-files__type">{line.type}</span>
      <span className="other-files__size">{formatBytes(line.size)}</span>
      <span className="other-files__date">{formatDateTime(line.mtime)}</span>
    </li>
  )

  return (
    <section className={`other-files${over ? ' other-files--drop' : ''}`} aria-label="Other files" {...drop}>
      <div className="other-files__header">
        <button type="button" className="view-group__toggle" aria-expanded={open} aria-label="Toggle Other files" onClick={toggle}>
          <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m4 6 4 4 4-4" />
          </svg>
        </button>
        <span className="other-files__title">Other files</span>
        <span className="other-files__count">{folders.length + lines.length}</span>
      </div>
      {open &&
        (lines.length + folders.length === 0 ? (
          <p className="other-files__empty">No other files. Drag a row here to move its note out of the views.</p>
        ) : (
          <ul className="other-files__list" ref={listRef}>
            {folders.map((f) => folderLines({ path: f.dir, name: f.name }, 0, true))}
            {shown.map((line) => (
              <li
                key={line.path}
                className="other-files__line"
                data-path={line.path}
                onMouseEnter={() => hoverCard(line.path, line.path)}
                onMouseLeave={() => leaveCard(line.path)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({ x: e.clientX, y: e.clientY, line })
                }}
                {...(line.note && onMoveBack !== null
                  ? {
                      draggable: true,
                      onDragStart: (e: ReactDragEvent) => {
                        fromTray = line.path
                        e.dataTransfer?.setData(TRAY_NOTE_MIME, line.path)
                        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
                      },
                      onDragEnd: () => {
                        fromTray = null
                      },
                    }
                  : {})}
              >
                <button type="button" className="other-files__name" title={line.path} onClick={(e) => onClick(e, line.path)}>
                  <FileIcon path={line.path} />
                  <span>{line.name}</span>
                </button>
                <span className="other-files__type">{line.type}</span>
                <span className="other-files__size">{formatBytes(line.size)}</span>
                <span className="other-files__date">{formatDateTime(line.mtime)}</span>
              </li>
            ))}
            {shown.length < lines.length && (
              <li className="other-files__more-line">
                <button type="button" className="other-files__more" onClick={() => setAllFor(dir)}>
                  Show all {lines.length} files
                </button>
              </li>
            )}
          </ul>
        ))}
      <CardPreviewHost store={hoverStore} cardOf={(_, path) => ({ root: null, name: lines.find((l) => l.path === path)?.name ?? basename(path) })} scopeOf={previewScope} diagramDarkColors={diagramDarkColors} />
      {menu !== null && (
        <PageContextMenu
          x={menu.x}
          y={menu.y}
          // A folder line is its folder, as a folder row is (YAZ-4579 D32): Copy path and Reveal name the directory.
          path={menu.folder === true ? folderSettingsPath(menu.line.path) : menu.line.path}
          title={menu.line.name}
          onOpen={menu.folder === true ? undefined : onOpen}
          onOpenBackground={menu.folder === true ? undefined : onOpenBackground}
          onNotice={onNotice}
          onClose={() => setMenu(null)}
          extra={
            menu.line.note && onMoveBack !== null
              ? [
                  <button
                    key="back"
                    type="button"
                    className="ctx-menu__item"
                    role="menuitem"
                    onClick={() => {
                      setMenu(null)
                      onMoveBack(menu.line.path)
                    }}
                  >
                    Move back to the table
                  </button>,
                ]
              : undefined
          }
        />
      )}
    </section>
  )
}
