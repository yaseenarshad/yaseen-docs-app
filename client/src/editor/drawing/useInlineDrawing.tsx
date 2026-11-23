/**
 * INLINE EXCALIDRAW STATE & ACTIONS (YAZ-5040 / YAZ-6120 / YAZ-6121 / YAZ-6132 / YAZ-6134):
 * owns the modal state, 150 KiB size nudge banner, 10 MiB hard limit guard, `/drawing` inline
 * insertion, ProseMirror save transactions, "Move to its own file", "Put back into this page"
 * confirmation, "Delete drawing" confirmation (`ConfirmSheet`), and "Open in tab" hooks so
 * `Editor.tsx` stays slim.
 */
import { useCallback, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { NodeSelection, type Transaction } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import {
  cleanDrawingLine,
  DRAWING_LANGUAGE,
  drawingTitleOf,
  EMPTY_INLINE_SCENE_JSON,
  findInlineDrawings,
  INLINE_DRAWING_WARN_BYTES,
  NEW_INLINE_DRAWING_LINE,
  utf8Bytes,
  withDrawingTitle,
} from '@shared/inlineDrawing'
import { splitFrontmatter } from '@shared/frontmatter'
import { MAX_FILE_BYTES } from '@shared/types'
import { ConfirmSheet } from '../../components/ConfirmSheet'
import type { InlineDrawingModalProps } from '../../drawings/DrawingModal'
import { copyText } from '../../lib/copyText'
import type { NoticeKind } from '../../lib/notice'
import { useUnit } from '../../vault/unitWord'
import { linkPath, type WikilinkResolveSource } from '../wikilink/wikilinkPlugin'
import type { ViewOnlyLinkSource } from '../wikilink/viewOnlyLinkSource'
import {
  drawingConvertFailure,
  drawingEmbeddersCount,
  inlineEmbedText,
  moveInlineDrawingToFile,
  putDrawingBackIntoPage,
} from './inlineDrawingConvert'
import { isInlineDrawingNode } from './inlineDrawingLine'
import {
  INLINE_DELETE_META,
  INLINE_MOVE_META,
  inlineDrawingIndexAt,
  type InlineDrawingDeps,
} from './inlineDrawingView'

export interface InlineDrawingHost {
  root: string
  path: string
  title: () => string
  disk: () => string
  getView: () => EditorView | null
  flushPage: () => void | Promise<unknown>
  wikilinks?: WikilinkResolveSource
  viewOnlyLinks?: ViewOnlyLinkSource
  allowFileAction: (root: string) => Promise<boolean>
  onNotice?: (message: string, kind?: NoticeKind) => void
  /** Opens the `index`-th (0-based) inline drawing block of this page in its own tab. */
  onOpenInTab?: (index: number, background: boolean) => void
}

export interface InlineDrawingModalState {
  key: string
  inline: InlineDrawingModalProps
  onClose: () => void
}

interface SheetPrompt {
  text: string
  confirmLabel: string
  danger?: boolean
  focusConfirm?: boolean
  go: () => void
}

/** Computes `<pagePath>:<1-based line>` of the `index`-th ```` ```excalidraw ```` opening fence, or `pagePath` if not yet on disk. */
export function inlineDrawingPathAtLine(pagePath: string, diskContent: string, index: number): string {
  const { frontmatter, body } = splitFrontmatter(diskContent)
  const block = findInlineDrawings(body)[index]
  if (block === undefined) return pagePath
  const fmLines = (frontmatter.match(/\n/g) ?? []).length
  return `${pagePath}:${fmLines + block.open + 1}`
}

/** Finds an inline drawing `code_block` at `preferredPos`, or by matching `expectedJson` if positions shifted. */
function findInlineNode(doc: ProseNode, preferredPos: number, expectedJson?: string): { pos: number; node: ProseNode } | null {
  const direct = preferredPos >= 0 && preferredPos <= doc.content.size ? doc.nodeAt(preferredPos) : null
  if (direct !== null && isInlineDrawingNode(direct)) return { pos: preferredPos, node: direct }
  if (expectedJson !== undefined) {
    let found: { pos: number; node: ProseNode } | null = null
    doc.descendants((node, pos) => {
      if (found === null && isInlineDrawingNode(node) && node.textContent === expectedJson) found = { pos, node }
      return found === null
    })
    if (found !== null) return found
  }
  return null
}

export function useInlineDrawing(host: InlineDrawingHost): {
  inlineProps: InlineDrawingDeps
  createInline: (view: EditorView) => void
  onPutDrawingBack: (target: string, options: string | null, inner: string, nth: number) => void
  modalProps: InlineDrawingModalState | null
  nudgeBanner: ReactNode
  confirmSheet: ReactNode
} {
  const unit = useUnit()
  const hostRef = useRef(host)
  hostRef.current = host
  const unitRef = useRef(unit)
  unitRef.current = unit

  const openSeq = useRef(0)
  const [openInline, setOpenInline] = useState<{ id: number; pos: number; index: number; json: string; title: string; autoFocusTitle?: boolean } | null>(null)
  const liveSession = useRef<{ pos: number; json: string } | null>(null)
  const [sizeNudge, setSizeNudge] = useState<{ pos: number; bytes: number } | null>(null)
  const [askSheet, setAskSheet] = useState<SheetPrompt | null>(null)
  const labelId = useId()

  const openEdit = useCallback((pos: number, json: string, autoFocusTitle = false) => {
    const view = hostRef.current.getView()
    const found = view !== null && !view.isDestroyed ? findInlineNode(view.state.doc, pos, json) : null
    const title = drawingTitleOf(found?.node.attrs.drawingLine)
    const index = view !== null && !view.isDestroyed && found !== null ? inlineDrawingIndexAt(view.state.doc, found.pos) : 0
    liveSession.current = { pos, json }
    setOpenInline({ id: ++openSeq.current, pos, index: Math.max(0, index), json, title, autoFocusTitle })
  }, [])

  const saveInlineTitle = useCallback((fallbackPos: number, nextTitle: string) => {
    const h = hostRef.current
    const view = h.getView()
    if (view === null || view.isDestroyed) return
    const session = liveSession.current
    const found = findInlineNode(view.state.doc, session?.pos ?? fallbackPos, session?.json)
    if (found === null) return
    const nextLine = withDrawingTitle(found.node.attrs.drawingLine, nextTitle)
    if (nextLine === (found.node.attrs.drawingLine ?? null)) return
    view.dispatch(view.state.tr.setNodeAttribute(found.pos, 'drawingLine', nextLine))
  }, [])

  const saveInlineDrawing = useCallback((fallbackPos: number, compactJson: string) => {
    const h = hostRef.current
    const view = h.getView()
    if (view === null || view.isDestroyed) return
    const session = liveSession.current
    const found = findInlineNode(view.state.doc, session?.pos ?? fallbackPos, session?.json)
    if (found === null) return

    const nextBytes = utf8Bytes(compactJson)
    const currentPageBytes = utf8Bytes(h.disk())
    const projectedBytes = Math.max(0, currentPageBytes - utf8Bytes(found.node.textContent)) + nextBytes
    if (projectedBytes > MAX_FILE_BYTES) {
      setSizeNudge({ pos: found.pos, bytes: nextBytes })
      throw new Error(unitRef.current('This page would exceed the 10 MB limit. Move this drawing to its own file to save.'))
    }

    if (found.node.textContent !== compactJson) {
      const tr = view.state.tr.replaceWith(found.pos + 1, found.pos + found.node.nodeSize - 1, view.state.schema.text(compactJson))
      view.dispatch(tr)
    }
    liveSession.current = { pos: found.pos, json: compactJson }

    if (nextBytes > INLINE_DRAWING_WARN_BYTES) {
      setSizeNudge({ pos: found.pos, bytes: nextBytes })
    } else {
      setSizeNudge((prev) => (prev !== null && prev.pos === found.pos ? null : prev))
    }
  }, [])

  const moveToFile = useCallback(async (pos: number, jsonOverride?: string) => {
    const h = hostRef.current
    if (!(await h.allowFileAction(h.root))) return
    const view = h.getView()
    if (view === null || view.isDestroyed) return
    const session = liveSession.current
    const found = findInlineNode(view.state.doc, pos, session?.json)
    if (found === null) return

    const sceneJson = jsonOverride ?? found.node.textContent
    const drawingLine = cleanDrawingLine(found.node.attrs.drawingLine)
    const drawingTitle = drawingTitleOf(drawingLine) || undefined
    const nameTaken = (name: string) => {
      const resolve = h.viewOnlyLinks?.resolve ?? h.wikilinks?.resolve ?? null
      return resolve === null || resolve(name) !== null
    }
    try {
      const result = await moveInlineDrawingToFile({
        root: h.root,
        pagePath: h.path,
        title: h.title(),
        drawingTitle,
        sceneJson,
        nameTaken,
      })
      const liveView = h.getView()
      if (liveView !== null && !liveView.isDestroyed) {
        const live = findInlineNode(liveView.state.doc, found.pos, found.node.textContent)
        if (live !== null) {
          const para = liveView.state.schema.nodes.paragraph?.create(null, liveView.state.schema.text(inlineEmbedText(result.target, drawingLine)))
          if (para !== undefined) {
            liveView.dispatch(liveView.state.tr.replaceWith(live.pos, live.pos + live.node.nodeSize, para).setMeta(INLINE_MOVE_META, true).setMeta('addToHistory', false))
          }
        }
      }
      setSizeNudge(null)
      liveSession.current = null
      setOpenInline(null)
      const movedName = result.target.split('/').pop()?.replace(/\.excalidraw$/i, '') ?? result.target
      h.onNotice?.(`Moved to "${movedName}"`)
    } catch (err) {
      h.onNotice?.(`Can't move the drawing: ${drawingConvertFailure(err)}`, 'error')
      if (jsonOverride !== undefined) throw err
    }
  }, [])

  const requestDelete = useCallback((pos: number) => {
    const h = hostRef.current
    const view = h.getView()
    const snapshot = view !== null && !view.isDestroyed ? findInlineNode(view.state.doc, pos) : null
    if (snapshot === null) return
    const expectedJson = snapshot.node.textContent
    setAskSheet({
      text: 'Delete this inline drawing? You can undo with Cmd+Z.',
      confirmLabel: 'Delete',
      danger: true,
      go: () => {
        const liveView = hostRef.current.getView()
        if (liveView === null || liveView.isDestroyed) return
        const live = findInlineNode(liveView.state.doc, pos, expectedJson)
        if (live === null) return
        liveView.dispatch(liveView.state.tr.delete(live.pos, live.pos + live.node.nodeSize).setMeta(INLINE_DELETE_META, true))
        setSizeNudge((prev) => (prev !== null && prev.pos === live.pos ? null : prev))
      },
    })
  }, [])

  const openInTabFromView = useCallback((index: number, background: boolean) => {
    void Promise.resolve(hostRef.current.flushPage()).then(() => {
      hostRef.current.onOpenInTab?.(index, background)
    })
  }, [])

  const copyPath = useCallback((index: number) => {
    const h = hostRef.current
    const text = inlineDrawingPathAtLine(h.path, h.disk(), index)
    copyText(text, 'path', (msg) => h.onNotice?.(msg))
  }, [])

  const createInline = useCallback((view: EditorView) => {
    const { state } = view
    const type = state.schema.nodes.code_block
    if (type === undefined) return
    const node = type.create({ language: DRAWING_LANGUAGE, drawingLine: NEW_INLINE_DRAWING_LINE }, state.schema.text(EMPTY_INLINE_SCENE_JSON))
    const { $from } = state.selection
    const replaceEmptyParagraph = $from.parent.type.name === 'paragraph' && $from.parent.content.size === 0 && $from.depth >= 1
    let tr: Transaction
    let pos: number
    if (replaceEmptyParagraph) {
      pos = $from.before()
      tr = state.tr.replaceWith(pos, $from.after(), node)
    } else {
      const start = state.selection.from
      tr = state.tr.replaceSelectionWith(node)
      pos = start
      let found = -1
      tr.doc.nodesBetween(Math.max(0, start - 2), Math.min(tr.doc.content.size, start + node.nodeSize + 2), (n, p) => {
        if (found === -1 && n === node) found = p
        return found === -1
      })
      if (found !== -1) pos = found
    }
    tr = tr.setSelection(NodeSelection.create(tr.doc, pos))
    view.dispatch(tr)
    openEdit(pos, EMPTY_INLINE_SCENE_JSON, true)
  }, [openEdit])

  const onPutDrawingBack = useCallback((target: string, options: string | null, inner: string, nth: number) => {
    const h = hostRef.current
    const boardPath = h.wikilinks !== undefined ? linkPath(target, h.wikilinks, h.viewOnlyLinks) : (h.viewOnlyLinks?.resolve?.(target) ?? null)
    if (boardPath === null) {
      h.onNotice?.("Can't put the drawing back: file not found.", 'error')
      return
    }
    const go = () => {
      void (async () => {
        const cur = hostRef.current
        if (!(await cur.allowFileAction(cur.root))) return
        try {
          await cur.flushPage()
          await putDrawingBackIntoPage({
            root: cur.root,
            pagePath: cur.path,
            boardPath,
            inner,
            nth,
            optionsText: options,
          })
          cur.onNotice?.(unitRef.current('Put back into this page'))
        } catch (err) {
          cur.onNotice?.(`Can't put the drawing back: ${drawingConvertFailure(err)}`, 'error')
        }
      })()
    }
    const others = drawingEmbeddersCount(h.wikilinks, boardPath, h.path, h.viewOnlyLinks)
    if (others === 0) return go()
    const msg =
      others === 1
        ? unitRef.current('1 other page embeds this drawing. Putting it back into this page will trash the .excalidraw file.')
        : unitRef.current(`${others} other pages embed this drawing. Putting it back into this page will trash the .excalidraw file.`)
    setAskSheet({ text: msg, confirmLabel: 'Put back', focusConfirm: true, go })
  }, [])

  const hasOpenInTab = host.onOpenInTab !== undefined

  const inlineProps = useMemo<InlineDrawingDeps>(
    () => ({
      root: host.root,
      pagePath: host.path,
      onEdit: openEdit,
      onMoveToFile: (pos) => void moveToFile(pos),
      onDelete: requestDelete,
      onOpenInTab: hasOpenInTab ? openInTabFromView : undefined,
      onCopyPath: copyPath,
    }),
    [host.root, host.path, openEdit, moveToFile, requestDelete, hasOpenInTab, openInTabFromView, copyPath],
  )

  const modalProps = useMemo<InlineDrawingModalState | null>(() => {
    if (openInline === null) return null
    return {
      key: `inline:${openInline.id}`,
      inline: {
        json: openInline.json,
        pagePath: host.path,
        index: openInline.index,
        title: openInline.title,
        autoFocusTitle: openInline.autoFocusTitle,
        onTitleChange: (nextTitle) => saveInlineTitle(openInline.pos, nextTitle),
        onSave: (compactJson) => saveInlineDrawing(openInline.pos, compactJson),
        onMoveToFile: (compactJson) => moveToFile(liveSession.current?.pos ?? openInline.pos, compactJson),
        onOpenInTab: hasOpenInTab
          ? async () => {
              const h = hostRef.current
              const view = h.getView()
              const session = liveSession.current
              const found = view !== null && !view.isDestroyed ? findInlineNode(view.state.doc, session?.pos ?? openInline.pos, session?.json) : null
              const index = view !== null && found !== null ? inlineDrawingIndexAt(view.state.doc, found.pos) : -1
              await h.flushPage()
              if (index >= 0) h.onOpenInTab?.(index, false)
            }
          : undefined,
      },
      onClose: () => {
        liveSession.current = null
        setOpenInline(null)
      },
    }
  }, [openInline, host.path, saveInlineDrawing, saveInlineTitle, moveToFile, hasOpenInTab])

  const nudgeBanner: ReactNode =
    sizeNudge === null ? null : (
      <div className="conflict-bar" role="status">
        <span>{unit(`This inline drawing is ${Math.round(sizeNudge.bytes / 1024)} KB. Move it to its own file to keep this page fast.`)}</span>
        <button type="button" onClick={() => void moveToFile(sizeNudge.pos)}>
          Move to its own file
        </button>
        <button type="button" onClick={() => setSizeNudge(null)}>
          Dismiss
        </button>
      </div>
    )

  const confirmSheet: ReactNode =
    askSheet === null ? null : (
      <ConfirmSheet
        labelId={labelId}
        text={askSheet.text}
        confirmLabel={askSheet.confirmLabel}
        danger={askSheet.danger}
        focusConfirm={askSheet.focusConfirm}
        onConfirm={() => {
          setAskSheet(null)
          askSheet.go()
        }}
        onCancel={() => setAskSheet(null)}
      />
    )

  return { inlineProps, createInline, onPutDrawingBack, modalProps, nudgeBanner, confirmSheet }
}
