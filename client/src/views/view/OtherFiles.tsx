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
 *  - HOVER (YAZ-4601 demo 13C): resting on a line opens the sidebar's hover panel beside it (`useCardPreview`), as a
 *    row of the views does, under "Preview rows on hover": a drawing's or diagram's picture, a text file's top with its
 *    colours, a moved note's top, a picture, a PDF's first page (13R; one rule, `hasHoverPreview`).
 */
import { useMemo, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { BOARD_TYPE_NAME } from '@shared/fileKind'
import type { DiagramDarkColors, FileKind, IndexRecord, TreeNode } from '@shared/types'
import { FileIcon } from '../../sidebar/FileIcon'
import { useLatestTrees } from '../../lib/pageLabel'
import { formatBytes, formatDateTime } from '../../lib/format'
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

/** The files directly in `dir` that are not notes (D44, D45), off a Files tree of `root`. A subfolder's files are its own page's. */
export function folderFiles(tree: readonly TreeNode[], root: string, dir: string): OtherFileLine[] {
  if (dir === root) return filesIn(tree)
  for (const node of tree) {
    if (node.type !== 'dir') continue
    if (node.path === dir) return filesIn(node.children)
    if (dir.startsWith(`${node.path}/`)) return folderFiles(node.children, root, dir)
  }
  return []
}

/** A moved note as a line. */
export const noteLine = (record: IndexRecord): OtherFileLine => ({ path: record.path, name: record.title, type: TYPE_NAME.markdown, size: record.size, mtime: record.mtime, note: true })

/** The tray's collapsed marker in the page's collapsed-groups entry. */
const CLOSED = 'other-files'

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

export function OtherFiles({ root, dir, notes, onOpen, onOpenBackground, onNotice, onMoveBack, onTakeRow, hoverPreview = false, previewScope, diagramDarkColors = 'adapt' }: OtherFilesProps) {
  const roots = useMemo(() => [root], [root])
  const [tree] = useLatestTrees(roots)
  // The hover panel (demo 13C): the tray's own dwell and panel, beside the line under the pointer; a line is found again by its path.
  const listRef = useRef<HTMLUListElement>(null)
  const { store: hoverStore, hoverCard, leaveCard } = useCardPreview(hoverPreview, (path) => listRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`) ?? null)
  const files = useMemo(() => (tree === null ? [] : folderFiles(tree.tree, root, dir)), [tree, root, dir])
  const lines = useMemo(() => [...files, ...notes.map(noteLine)], [files, notes])
  const key = `${dir}::`
  const [open, setOpen] = useState(() => !storage.getViewGroups(root, key).includes(CLOSED))
  const [over, setOver] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; line: OtherFileLine } | null>(null)

  const toggle = (): void => {
    setOpen(!open)
    storage.setViewGroups(root, key, open ? [CLOSED] : [])
  }
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

  return (
    <section className={`other-files${over ? ' other-files--drop' : ''}`} aria-label="Other files" {...drop}>
      <div className="other-files__header">
        <button type="button" className="view-group__toggle" aria-expanded={open} aria-label="Toggle Other files" onClick={toggle}>
          <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m4 6 4 4 4-4" />
          </svg>
        </button>
        <span className="other-files__title">Other files</span>
        <span className="other-files__count">{lines.length}</span>
      </div>
      {open &&
        (lines.length === 0 ? (
          <p className="other-files__empty">No other files. Drag a row here to move its note out of the views.</p>
        ) : (
          <ul className="other-files__list" ref={listRef}>
            {lines.map((line) => (
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
          </ul>
        ))}
      <CardPreviewHost store={hoverStore} cardOf={(_, path) => ({ root: null, name: lines.find((l) => l.path === path)?.name ?? '' })} scopeOf={previewScope} diagramDarkColors={diagramDarkColors} />
      {menu !== null && (
        <PageContextMenu
          x={menu.x}
          y={menu.y}
          path={menu.line.path}
          title={menu.line.name}
          onOpen={onOpen}
          onOpenBackground={onOpenBackground}
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
