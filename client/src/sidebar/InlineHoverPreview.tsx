/**
 * SHARED INLINE PREVIEW COMPONENTS (YAZ-6467):
 * Single rendering layer for inline cards (`<page>#<cardId>`) and inline Excalidraw drawings
 * (`<page>#drawing-<index>`) in both hover popovers (when `anchor` is supplied, portalled with
 * `PagePreview`/`BoardPreview` chrome) and inline/QuickLook containers (when `anchor` is omitted).
 *
 * Lazy-friendly: designed to be dynamically imported (like `PagePreview` and `BoardPreview`), and
 * calls `readInlineDrawingForPicture` which lazy-loads Excalidraw only when a drawing is rendered.
 */
import { useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { splitFrontmatter } from '@shared/frontmatterSplit'
import { drawingTitleOf, findInlineDrawings } from '@shared/inlineDrawing'
import type { InlineRef } from '@shared/inlineRef'
import type { DiagramDarkColors } from '@shared/types'
import { api } from '../api'
import { readInlineDrawingForPicture } from '../drawings/drawingScene'
import { desktopBoardPicture } from '../editor/card/boardPictureDesktop'
import { cardLook } from '../editor/card/cardLook'
import { renderCard, type CardLook } from '../editor/card/cardRender'
import { imageSrc, pageDirRel } from '../editor/image/imageSrc'
import type { WikilinkResolveSource } from '../editor/wikilink/linkResolve'
import type { ViewOnlyLinkSource } from '../editor/wikilink/viewOnlyLinkSource'
import { basename } from '../lib/paths'
import { createPreviewCache } from '../lib/previewCache'
import { createScenePreviewPng, visibleElements, type PreviewBounds } from '../lib/scenePreview'
import { useAppliedTheme } from '../lib/theme'
import { cardInContent, type CardAtPage } from '../review/cardRead'
import { fileIconDecoration, IconsContext } from './FileIcon'
import { PlaceName } from './PlaceName'
import { portalTarget, usePlacement, type PreviewAnchor, type PreviewShape } from './previewPlacement'
import './boardPreview.css'
import '../editor/card/card.css'
import './inlineHoverPreview.css'

/** Matches `BOARD_PREVIEW_BOUNDS` so inline drawing previews render at the same crisp resolution as standalone boards. */
export const INLINE_DRAWING_PREVIEW_BOUNDS: PreviewBounds = { maxWidth: 1200, maxHeight: 800, padding: 16 }
const INLINE_DRAWING_IMAGE_MAX_PX = Math.max(INLINE_DRAWING_PREVIEW_BOUNDS.maxWidth, INLINE_DRAWING_PREVIEW_BOUNDS.maxHeight)

const MARKDOWN_EXT_RE = /\.(?:md|markdown)$/i

/** Derives a human-readable parent page label from a path when the caller does not pass `place`. */
function pageBaseLabel(pagePath: string): string {
  return basename(pagePath).replace(MARKDOWN_EXT_RE, '')
}

/** Fast non-cryptographic 64-bit-ish hash (two 32-bit FNV-1a lanes) so cache keys stay compact. */
function hashSceneJson(text: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 ^= c
    h1 = Math.imul(h1, 0x01000193)
    h2 ^= c + (i & 0xff)
    h2 = Math.imul(h2, 0x01000193)
  }
  return `${(h1 >>> 0).toString(36)}-${(h2 >>> 0).toString(36)}`
}

interface PendingDrawingInput {
  root: string
  json: string
  theme: 'light' | 'dark'
}

const pendingDrawingInputs = new Map<string, PendingDrawingInput>()

async function drawInlineDrawingPreview(key: string): Promise<string> {
  const input = pendingDrawingInputs.get(key)
  pendingDrawingInputs.delete(key)
  if (input === undefined) throw new Error('missing inline drawing input')
  const { engine, appState, elements, files } = await readInlineDrawingForPicture(input.root, input.json, INLINE_DRAWING_IMAGE_MAX_PX)
  if (visibleElements(elements).length === 0) return ''
  return createScenePreviewPng(engine, { elements, appState: { ...appState, theme: input.theme }, files }, INLINE_DRAWING_PREVIEW_BOUNDS)
}

const inlineDrawingPreviews = createPreviewCache(drawInlineDrawingPreview, {
  limit: 32,
  onEvict: (_key, value) => {
    if (value.startsWith('blob:') && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(value)
  },
})

/** Clears the in-memory inline drawing preview cache (primarily for tests). */
export function clearInlineDrawingPreviewCache(): void {
  pendingDrawingInputs.clear()
  inlineDrawingPreviews.clear()
}

interface AnchoredFrameProps {
  anchor: PreviewAnchor
  shape: PreviewShape
  className: string
  ariaLabel: string
  role: 'group' | 'status'
  ariaLive?: 'polite'
  dataTheme?: 'light' | 'dark'
  style?: CSSProperties
  children: ReactNode
}

function AnchoredPreviewFrame({ anchor, shape, className, ariaLabel, role, ariaLive, dataTheme, style, children }: AnchoredFrameProps) {
  const placement = usePlacement(anchor, shape)
  if (placement === null) return null
  return createPortal(
    <div
      className={className}
      data-theme={dataTheme}
      role={role}
      aria-live={ariaLive}
      aria-label={ariaLabel}
      style={{ ...style, ...placement }}
    >
      {children}
    </div>,
    portalTarget(anchor),
  )
}

interface RenderedCardSidesProps {
  text: string
  page: string
  root?: string
  wikilinks?: WikilinkResolveSource
  viewOnlyLinks?: ViewOnlyLinkSource
}

function RenderedCardSides({ text, page, root, wikilinks, viewOnlyLinks }: RenderedCardSidesProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const icons = useContext(IconsContext)
  const iconsRef = useRef(icons)
  iconsRef.current = icons

  useEffect(() => {
    const el = boxRef.current
    if (el === null) return
    if (text.trim() === '') {
      const empty = document.createElement('p')
      empty.className = 'card__empty'
      empty.textContent = 'Empty card'
      el.replaceChildren(empty)
      return
    }
    const place = root !== undefined && root !== '' ? { root, pagePath: page, boardPicture: desktopBoardPicture } : undefined
    let look: CardLook | undefined
    if (wikilinks !== undefined) {
      look = cardLook(wikilinks, viewOnlyLinks, place, { icon: (target, folder) => fileIconDecoration(iconsRef.current, target, folder) })
    } else if (place !== undefined) {
      look = { image: (src) => imageSrc(place.root, pageDirRel(place.root, place.pagePath), src) }
    }
    el.replaceChildren(renderCard(text, {}, look))
    return () => {
      el.replaceChildren()
    }
  }, [text, page, root, wikilinks, viewOnlyLinks])

  return <div ref={boxRef} className="card__body" />
}

export interface InlineCardHoverPreviewProps {
  /** Absolute path of the parent Markdown page containing the card. */
  page: string
  /** Card ID (`WIKI-123`). */
  cardId: string
  /** Optional 0-based card index fallback if `cardId` is not matched. */
  fallbackIndex?: number
  /** Optional display title override in the header (defaults to card title or `cardId`). */
  name?: string
  /** Parent page display label in the header (defaults to the page's basename without `.md`). */
  place?: string
  /** Vault root path (resolves card images, wikilinks, and board embeds). */
  root?: string
  /** Optional wikilink resolver for rendering live pills inside the card preview. */
  wikilinks?: WikilinkResolveSource
  /** Optional view-only link source paired with `wikilinks`. */
  viewOnlyLinks?: ViewOnlyLinkSource
  /** Vault text formatting CSS variables (`--text-size`, `--hN-*`). */
  textVars?: CSSProperties
  /** Optional quiet hint line under the header (e.g. "⌘-click to open"). */
  hint?: string
  /** When provided, renders as a portalled hover popover beside the anchor. When omitted, renders inline (e.g. for QuickLook). */
  anchor?: PreviewAnchor
  /** Explicit dark mode override (defaults to the app's applied theme). */
  dark?: boolean
  /** Dark-mode diagram colour preference (passed through for uniform preview props). */
  diagramDarkColors?: DiagramDarkColors
  /** Compact mode (omits the header when rendered inline, e.g. inside QuickLook). */
  compact?: boolean
  className?: string
}

type CardLoadState = { kind: 'loading' } | { kind: 'ready'; card: CardAtPage } | { kind: 'missing' } | { kind: 'error' }

/** Preview component for a single inline card inside a Markdown page (hover popover or QuickLook). */
export function InlineCardHoverPreview({
  page,
  cardId,
  fallbackIndex,
  name,
  place,
  root,
  wikilinks,
  viewOnlyLinks,
  textVars,
  hint,
  anchor,
  dark,
  compact = false,
  className,
}: InlineCardHoverPreviewProps) {
  const applied = useAppliedTheme()
  const isDark = dark === undefined ? applied === 'dark' : dark
  const [state, setState] = useState<CardLoadState>({ kind: 'loading' })

  useEffect(() => {
    let live = true
    setState({ kind: 'loading' })
    void api.readFile(page).then(
      ({ content }) => {
        if (!live) return
        const found =
          cardInContent(page, content, cardId || null, fallbackIndex ?? -1) ??
          (fallbackIndex !== undefined ? cardInContent(page, content, null, fallbackIndex) : null)
        setState(found === null ? { kind: 'missing' } : { kind: 'ready', card: found })
      },
      () => {
        if (live) setState({ kind: 'error' })
      },
    )
    return () => {
      live = false
    }
  }, [page, cardId, fallbackIndex])

  const displayName = name || (state.kind === 'ready' && state.card.title !== '' ? state.card.title : cardId || 'Card')
  const placeLabel = place ?? pageBaseLabel(page)
  const dataTheme = dark !== undefined ? (isDark ? 'dark' : 'light') : undefined
  const showHeader = anchor !== undefined || !compact
  const msgClass = anchor === undefined && compact ? 'editor-msg' : 'board-preview__msg'

  const content = (
    <>
      {showHeader && (
        <div className="board-preview__header" role="status">
          <span className="card-file-icon" aria-hidden />
          <span className="board-preview__name">{displayName}</span>
          {placeLabel !== '' && <PlaceName className="board-preview__folder" path={page} kind="page" label={placeLabel} />}
        </div>
      )}
      {hint !== undefined && <div className="board-preview__hint">{hint}</div>}
      <div className="inline-card-preview__body">
        {state.kind === 'ready' ? (
          <div className={`card inline-card-preview__card${state.card.off ? ' card--off' : ''}`}>
            {(state.card.id !== null || state.card.off) && (
              <div className="card__head">
                {state.card.id !== null && <span className="card__id">{state.card.id}</span>}
                {state.card.off && (
                  <span className="card__marks">
                    <span className="card__state">Archived</span>
                  </span>
                )}
              </div>
            )}
            {state.card.title !== '' && <div className="card-band">{state.card.title}</div>}
            <RenderedCardSides text={state.card.text} page={page} root={root} wikilinks={wikilinks} viewOnlyLinks={viewOnlyLinks} />
          </div>
        ) : (
          <p className={msgClass}>
            {state.kind === 'loading' ? 'Loading preview…' : state.kind === 'missing' ? 'Card not found' : 'Preview unavailable'}
          </p>
        )}
      </div>
    </>
  )

  const extra = `${compact ? ' inline-preview--compact' : ''}${className ? ` ${className}` : ''}`
  if (anchor !== undefined) {
    return (
      <AnchoredPreviewFrame
        anchor={anchor}
        shape="page"
        className={`board-preview page-preview inline-card-preview${extra}`}
        ariaLabel={`Preview of ${displayName}`}
        role="group"
        dataTheme={dataTheme}
        style={textVars}
      >
        {content}
      </AnchoredPreviewFrame>
    )
  }

  return (
    <div
      className={`inline-preview inline-card-preview${extra}`}
      data-theme={dataTheme}
      role="group"
      aria-label={`Preview of ${displayName}`}
      style={textVars}
    >
      {content}
    </div>
  )
}

export interface InlineDrawingHoverPreviewProps {
  /** Absolute path of the parent Markdown page containing the drawing. */
  page: string
  /** 0-based index of the ```` ```excalidraw ```` block inside the page. */
  index: number
  /** Optional drawing title override (defaults to the block's `<!-- drawing: title "…" -->` or `"Untitled drawing"`). */
  title?: string
  /** Parent page display label in the header (defaults to the page's basename without `.md`). */
  place?: string
  /** Vault root path (resolves referenced drawing images from `<root>/assets/`). */
  root?: string
  /** Optional quiet hint line under the header (e.g. "⌘-click to open"). */
  hint?: string
  /** When provided, renders as a portalled hover popover beside the anchor. When omitted, renders inline (e.g. for QuickLook). */
  anchor?: PreviewAnchor
  /** Explicit dark mode override (defaults to the app's applied theme). */
  dark?: boolean
  /** Dark-mode diagram colour preference (defaults to `'adapt'`). */
  diagramDarkColors?: DiagramDarkColors
  /** Compact mode (omits the header when rendered inline, e.g. inside QuickLook). */
  compact?: boolean
  className?: string
}

/** Preview component for a single inline Excalidraw drawing inside a Markdown page (hover popover or QuickLook). */
export function InlineDrawingHoverPreview({
  page,
  index,
  title,
  place,
  root = '',
  hint,
  anchor,
  dark,
  diagramDarkColors = 'adapt',
  compact = false,
  className,
}: InlineDrawingHoverPreviewProps) {
  const applied = useAppliedTheme()
  const theme: 'light' | 'dark' = dark === undefined ? applied : dark ? 'dark' : 'light'
  // undefined = still loading/drawing, '' = empty drawing, null = missing/broken/unreadable.
  const [picture, setPicture] = useState<string | null | undefined>(undefined)
  const [resolvedTitle, setResolvedTitle] = useState<string>('')
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setPicture(undefined)
    setResolvedTitle('')
    void api
      .readFile(page)
      .then(async ({ content, mtime }) => {
        if (!live) return
        const { body } = splitFrontmatter(content)
        const block = findInlineDrawings(body)[index]
        if (block === undefined) {
          setPicture(null)
          return
        }
        const blockTitle = drawingTitleOf(block.drawingLine)
        if (live && blockTitle !== '') setResolvedTitle(blockTitle)
        const cacheKey = [root, page, index, theme, diagramDarkColors, mtime ?? 0, block.json.length, hashSceneJson(block.json)].join('\n')
        if (inlineDrawingPreviews.peek(cacheKey) === undefined) {
          pendingDrawingInputs.set(cacheKey, { root, json: block.json, theme })
        }
        const rendered = await inlineDrawingPreviews.load(cacheKey)
        if (live) setPicture(rendered)
      })
      .catch(() => {
        if (live) setPicture(null)
      })
    return () => {
      live = false
    }
  }, [page, index, root, theme, diagramDarkColors])

  const displayTitle = title || resolvedTitle || 'Untitled drawing'
  const placeLabel = place ?? pageBaseLabel(page)
  const dataTheme = dark !== undefined ? theme : undefined
  const src = picture || null
  const message = picture === undefined ? 'Loading preview…' : picture === '' ? 'Empty drawing' : picture === null ? 'Preview unavailable' : null
  const showHeader = anchor !== undefined || !compact
  const inlineCompact = anchor === undefined && compact

  const content = (
    <>
      {showHeader && (
        <div className="board-preview__header">
          <span className="board-preview__name">{displayTitle}</span>
          {placeLabel !== '' && <PlaceName className="board-preview__folder" path={page} kind="page" label={placeLabel} />}
        </div>
      )}
      {hint !== undefined && <div className="board-preview__hint">{hint}</div>}
      <div className={inlineCompact ? 'inline-drawing-preview__body inline-drawing-preview__body--compact' : 'board-preview__body inline-drawing-preview__body'}>
        {src !== null && (
          <img
            className={inlineCompact ? 'quicklook__board' : `board-preview__img${loadedSrc === src ? ' board-preview__img--loaded' : ''}`}
            src={src}
            alt=""
            onLoad={() => setLoadedSrc(src)}
          />
        )}
        {message !== null && <p className={inlineCompact ? 'editor-msg' : 'board-preview__msg'}>{message}</p>}
      </div>
    </>
  )

  const extra = `${compact ? ' inline-preview--compact' : ''}${className ? ` ${className}` : ''}`
  if (anchor !== undefined) {
    return (
      <AnchoredPreviewFrame
        anchor={anchor}
        shape="board"
        className={`board-preview inline-drawing-preview${extra}`}
        ariaLabel={`Preview of ${displayTitle}`}
        role="status"
        ariaLive="polite"
        dataTheme={dataTheme}
      >
        {content}
      </AnchoredPreviewFrame>
    )
  }

  return (
    <div
      className={`inline-preview inline-drawing-preview${extra}`}
      data-theme={dataTheme}
      role="status"
      aria-live="polite"
      aria-label={`Preview of ${displayTitle}`}
    >
      {content}
    </div>
  )
}

export interface InlineRefPreviewProps {
  /** Parsed inline card or inline drawing reference. */
  inlineRef: InlineRef
  /** Optional display name override (card name or drawing title). */
  name?: string
  /** Optional drawing title override (takes precedence over `name` for drawings). */
  title?: string
  /** Parent page display label in the header (defaults to the page's basename without `.md`). */
  place?: string
  /** Vault root path. */
  root?: string
  /** Optional wikilink resolver (for inline card previews). */
  wikilinks?: WikilinkResolveSource
  /** Optional view-only link source (for inline card previews). */
  viewOnlyLinks?: ViewOnlyLinkSource
  /** Vault text formatting CSS variables (`--text-size`, `--hN-*`, for inline card previews). */
  textVars?: CSSProperties
  /** Optional quiet hint line under the header. */
  hint?: string
  /** When provided, renders as a portalled hover popover beside the anchor. When omitted, renders inline (e.g. for QuickLook). */
  anchor?: PreviewAnchor
  /** Explicit dark mode override (defaults to the app's applied theme). */
  dark?: boolean
  /** Dark-mode diagram colour preference. */
  diagramDarkColors?: DiagramDarkColors
  /** Compact mode (omits the header when rendered inline, e.g. inside QuickLook). */
  compact?: boolean
  /** Optional 0-based card index fallback when `inlineRef.kind === 'card'`. */
  fallbackIndex?: number
  className?: string
}

/** Unified preview wrapper that dispatches on `inlineRef.kind === 'card' | 'drawing'`. */
export function InlineRefPreview({
  inlineRef,
  name,
  title,
  place,
  root,
  wikilinks,
  viewOnlyLinks,
  textVars,
  hint,
  anchor,
  dark,
  diagramDarkColors,
  compact,
  fallbackIndex,
  className,
}: InlineRefPreviewProps) {
  if (inlineRef.kind === 'card') {
    return (
      <InlineCardHoverPreview
        page={inlineRef.page}
        cardId={inlineRef.id}
        fallbackIndex={fallbackIndex}
        name={name}
        place={place}
        root={root}
        wikilinks={wikilinks}
        viewOnlyLinks={viewOnlyLinks}
        textVars={textVars}
        hint={hint}
        anchor={anchor}
        dark={dark}
        diagramDarkColors={diagramDarkColors}
        compact={compact}
        className={className}
      />
    )
  }
  return (
    <InlineDrawingHoverPreview
      page={inlineRef.page}
      index={inlineRef.index}
      title={title ?? name}
      place={place}
      root={root}
      hint={hint}
      anchor={anchor}
      dark={dark}
      diagramDarkColors={diagramDarkColors}
      compact={compact}
      className={className}
    />
  )
}

export default InlineRefPreview
