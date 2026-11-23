/**
 * Per-drawing horizontal alignment helpers (YAZ-6354):
 * - `syncAlignAttr` keeps `data-align="left|center|right"` in sync on `.board-embed` DOM elements.
 * - `positionMenuRow` builds the `Position ▸` flyout (`App default`, `Left`, `Center`, `Right` with `✓` on active).
 * - `drawingPositionRows` is the 6-dot block handle menu `RowProvider` for inline drawings and lone board embeds.
 */
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import { optionsSuffix, parseEmbedOptions, type EmbedAlign, type EmbedOptions } from '@shared/embedOptions'
import { drawingTitleOf, formatDrawingLine } from '@shared/inlineDrawing'
import type { MenuRow, RowProvider } from '../blockHandleMenu'
import { tablerIcon, type TablerIcon } from '../table/tableIcons'
import { boardCheckOf, boardEmbedsIn, cardCheckOf, type BoardEmbedMatch } from './boardEmbedScan'
import { drawingOptionsOf, isInlineDrawingNode } from './inlineDrawingLine'

const EMPTY_OPTIONS: EmbedOptions = { width: null, height: null, view: null, locked: false, page: null, align: null, rest: [] }

const POSITION_CHOICES: ReadonlyArray<{ label: string; value: EmbedAlign | null; icon?: TablerIcon }> = [
  { label: 'App default', value: null },
  { label: 'Left', value: 'left', icon: 'alignLeft' },
  { label: 'Center', value: 'center', icon: 'alignCenter' },
  { label: 'Right', value: 'right', icon: 'alignRight' },
]

/** Syncs `data-align` on a `.board-embed` element; removes it when `align` is null/undefined (App default). */
export function syncAlignAttr(dom: HTMLElement, align: EmbedAlign | null | undefined): void {
  if (align === 'left' || align === 'center' || align === 'right') dom.dataset.align = align
  else delete dom.dataset.align
}

/** Returns a copy of `current` (or empty defaults) with `align` set. */
export function withAlign(current: EmbedOptions | null, align: EmbedAlign | null): EmbedOptions {
  return { ...(current ?? EMPTY_OPTIONS), align }
}

const alignIcon = (name: TablerIcon) => (): SVGElement => {
  const svg = tablerIcon(name)()
  svg.setAttribute('width', '14')
  svg.setAttribute('height', '14')
  return svg
}

/** Builds the `Position ▸` flyout row (`App default`, `Left`, `Center`, `Right`) with Tabler icons and `✓` on the active choice. */
export function positionMenuRow(current: EmbedAlign | null, onPick: (align: EmbedAlign | null) => void, group?: string): MenuRow {
  const parentIcon: TablerIcon = current === 'center' ? 'alignCenter' : current === 'right' ? 'alignRight' : 'alignLeft'
  return {
    label: 'Position',
    icon: alignIcon(parentIcon),
    ...(group === undefined ? {} : { group }),
    run: () => {},
    children: [
      POSITION_CHOICES.map((choice) => ({
        label: choice.label,
        ...(choice.icon === undefined ? {} : { icon: alignIcon(choice.icon) }),
        hint: current === choice.value ? '✓' : undefined,
        run: () => onPick(choice.value),
      })),
    ],
  }
}

/** Updates `align` on the inline drawing `code_block` at `pos` while preserving its title and other options. */
export function setInlineDrawingAlign(view: EditorView, pos: number, align: EmbedAlign | null): void {
  if (!view.editable) return
  const node = view.state.doc.nodeAt(pos)
  if (!isInlineDrawingNode(node)) return
  const next = withAlign(drawingOptionsOf(node!), align)
  const line = formatDrawingLine(next, drawingTitleOf(node!.attrs.drawingLine))
  if (line === (node!.attrs.drawingLine ?? null)) return
  view.dispatch(view.state.tr.setNodeAttribute(pos, 'drawingLine', line))
}

/** Updates `align` on a board embed (`![[...excalidraw]]` or `![[...drawio]]`) while preserving alias and other options. */
export function setBoardEmbedAlign(view: EditorView, match: BoardEmbedMatch, align: EmbedAlign | null): void {
  if (!view.editable) return
  const current = match.options === null ? null : parseEmbedOptions(match.options)
  const next = withAlign(current, align)
  const from = match.optionsAt ?? match.to - 2
  const suffix = optionsSuffix(next)
  if (view.state.doc.textBetween(from, match.to - 2) === suffix) return
  view.dispatch(view.state.tr.insertText(suffix, from, match.to - 2))
}

type DrawingTarget =
  | { kind: 'inline'; pos: number; node: ProseNode }
  | { kind: 'embed'; paraPos: number; embed: BoardEmbedMatch }

function loneBoardEmbedAt(view: EditorView, paraPos: number, paragraph: ProseNode): BoardEmbedMatch | null {
  if (paragraph.type.name !== 'paragraph' || paragraph.childCount !== 1) return null
  const embed = boardEmbedsIn(paragraph, paraPos, boardCheckOf(view.state))[0]
  if (embed === undefined || embed.from !== paraPos + 1 || embed.to !== paraPos + 1 + paragraph.content.size) return null
  const cards = cardCheckOf(view.state)
  const page = embed.target.split('#')[0]!.trim()
  if (cards !== undefined && (cards.cardOf(page) !== null || cards.isMissing(page))) return null
  return embed
}

function drawingTargetAt(view: EditorView, pos: number): DrawingTarget | null {
  const { doc } = view.state
  if (pos < 0 || pos >= doc.content.size) return null
  const node = doc.nodeAt(pos)
  if (node === null) return null
  if (isInlineDrawingNode(node)) return { kind: 'inline', pos, node }
  if (node.type.name === 'paragraph') {
    const embed = loneBoardEmbedAt(view, pos, node)
    return embed === null ? null : { kind: 'embed', paraPos: pos, embed }
  }
  if (node.type.name === 'list_item' && node.firstChild !== null) {
    const childPos = pos + 1
    if (isInlineDrawingNode(node.firstChild)) return { kind: 'inline', pos: childPos, node: node.firstChild }
    if (node.firstChild.type.name === 'paragraph') {
      const embed = loneBoardEmbedAt(view, childPos, node.firstChild)
      return embed === null ? null : { kind: 'embed', paraPos: childPos, embed }
    }
  }
  return null
}

/** 6-dot block handle menu `RowProvider`: adds `Position ▸` for inline drawings and lone board embeds. */
export const drawingPositionRows: RowProvider = (view, target) => {
  if (!view.editable) return []
  const at = target.inside >= 0 ? target.inside : target.pos
  const hit = drawingTargetAt(view, at)
  if (hit === null) return []
  if (hit.kind === 'inline') {
    const current = drawingOptionsOf(hit.node)?.align ?? null
    return [positionMenuRow(current, (align) => setInlineDrawingAlign(view, hit.pos, align), 'position')]
  }
  const current = (hit.embed.options === null ? null : parseEmbedOptions(hit.embed.options))?.align ?? null
  return [
    positionMenuRow(
      current,
      (align) => {
        const para = view.state.doc.nodeAt(hit.paraPos)
        if (para === null) return
        const live = loneBoardEmbedAt(view, hit.paraPos, para)
        if (live !== null && live.target === hit.embed.target) setBoardEmbedAlign(view, live, align)
      },
      'position',
    ),
  ]
}
