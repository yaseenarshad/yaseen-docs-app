/**
 * Paste a path, get a link (YAZ-3609). A pasted absolute path or `yaseendocs://` link to a file or
 * folder of THIS vault becomes the link the `[[` picker writes for it: a page's or folder's id, else
 * its vault spelling (`[[report.pdf]]`). Both are vault-relative, so they work on every Mac. A file
 * no tab can show gets a relative Markdown link, which opens in its default app (YAZ-1311). A path
 * in ANOTHER vault of the window gets a relative Markdown link too (D15), which opens in a tab (D14).
 * The same `path → row` map tells a Markdown link's click which targets open in a tab (D8).
 * Read through a ctx slice, like `imageOptionsCtx`: `clipboardPaste` has no options of its own.
 */
import { parserCtx } from '@milkdown/kit/core'
import { createSlice, type Ctx } from '@milkdown/kit/ctx'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'
import { closeHistory } from '@milkdown/kit/prose/history'
import { Slice } from '@milkdown/kit/prose/model'
import { AddMarkStep, ReplaceStep } from '@milkdown/kit/prose/transform'
import { EXTERNAL_EDIT_META } from './external/applyExternalMarkdown'
import type { EditorView } from '@milkdown/kit/prose/view'
import { linkSchema } from '@milkdown/kit/preset/commonmark'
import { isBoardTarget, newEmbed, newEmbedAlt } from '@shared/embedOptions'
import { inCellOrPage } from './table/cellBlocks'
import { cardCheckOf } from './drawing/boardEmbedScan'
import { fileKind } from '@shared/fileKind'
import { inVault, linkFor, nameOf, pastedPath, relativeHref, vaultHref, type PathPasteOptions } from './pathLinks'

// The pure half moved to its own file (YAZ-5153), so the card screens load without the editor; its names stay here too.
export { hrefPath, hrefTarget, linkFor, pastedPath, vaultHref, type PathPasteOptions } from './pathLinks'

export const pathPasteCtx = createSlice<PathPasteOptions | null>(null, 'mdapp-path-paste')

/**
 * A link set in the link box (or "Add link…") or pasted with the absolute path of a file or folder of a
 * vault in this window (D16) is stored relative to this page, as a paste of a path writes it: it keeps
 * working on another Mac where the vaults keep their layout. Only the links that this change SETS are
 * read (YAZ-3649): never a link that an outside edit (an agent, another app) wrote, and never an older
 * link that the caret types inside. Milkdown's paste carries no meta, so a link that text brings counts
 * as set only when its line held no link to that address before: typing inside a link repeats one.
 */
export const relativeLinks = $prose((ctx) => new Plugin({
  key: new PluginKey('mdapp-relative-links'),
  appendTransaction: (trs, before, state) => {
    const options = ctx.get(pathPasteCtx)
    // Not an outside edit, and not an undo or a redo (`history$`): ⌘Z after "Remove link" puts the link back as it was (YAZ-3658).
    if (options === null || before.doc === state.doc || trs.some((tr) => tr.getMeta(EXTERNAL_EDIT_META) !== undefined || tr.getMeta('history$') !== undefined)) return null
    const type = linkSchema.type(ctx)
    // The hrefs this change sets: an added link mark (the link box), or the links a paste brings.
    const set = new Set<string>()
    for (const tr of trs) {
      tr.steps.forEach((step, i) => {
        if (step instanceof AddMarkStep && step.mark.type === type) set.add(step.mark.attrs.href as string)
        if (!(step instanceof ReplaceStep)) return
        const doc = tr.docs[i]!
        const line = new Set<string>()
        doc.resolve(Math.min(step.from, doc.content.size)).parent.descendants((node) => {
          const mark = type.isInSet(node.marks)
          if (mark !== undefined) line.add(mark.attrs.href as string)
        })
        step.slice.content.descendants((node) => {
          const href = type.isInSet(node.marks)?.attrs.href as string | undefined
          if (href !== undefined && !line.has(href)) set.add(href)
        })
      })
    }
    const absolute = [...set].filter((href) => typeof href === 'string' && /^(file:|\/|[A-Za-z]:[\\/])/i.test(href))
    if (absolute.length === 0) return null
    const start = before.doc.content.findDiffStart(state.doc.content)
    const end = before.doc.content.findDiffEnd(state.doc.content)
    if (start === null || end === null) return null
    const tr = state.tr
    state.doc.nodesBetween(start, Math.max(start, end.b), (node, pos) => {
      const mark = node.isText ? type.isInSet(node.marks) : undefined
      const href = mark?.attrs.href
      const path = typeof href === 'string' && absolute.includes(href) ? vaultHref(href, options) : null
      if (mark === undefined || path === null) return
      tr.addMark(pos, pos + node.nodeSize, type.create({ ...mark.attrs, href: relativeHref(options.pagePath, path) }))
    })
    return tr.docChanged ? tr : null
  },
}))

/** A web, mail or phone link pasted over words in one block (D7): the words become that link, in one undo step. */
export function pasteUrlOverWords(view: EditorView, ctx: Ctx, text: string): boolean {
  const href = text.trim()
  const { empty, from, to, $from, $to } = view.state.selection
  if (empty || $from.parent !== $to.parent || !/^(https?:\/\/|mailto:|tel:)\S+$/i.test(href)) return false
  view.dispatch(closeHistory(view.state.tr).addMark(from, to, linkSchema.type(ctx).create({ href })).setMeta('paste', true))
  return true
}

/** Why a pasted path stayed text (D6). Only for a file the app can open, so a path in prose stays quiet. */
function noticeWhy(path: string, options: PathPasteOptions): void {
  const name = nameOf(path)
  if (options.onNotice === undefined || fileKind(name) === null) return
  const known = inVault(path, options) || options.candidatesOf?.(path) != null
  options.onNotice(known ? `Can't find ${name} yet, so it stays a path` : `${name} is not in a vault open in this window, so it stays a path`)
}

/** The most lines a paste may have to be read as paths. */
const MAX_PATHS = 500

/** Pastes `text` as links when every line is a link of this vault; false leaves the paste to the text handlers. */
export function pastePathLinks(view: EditorView, ctx: Ctx, options: PathPasteOptions, text: string): boolean {
  // Code keeps its text (P15): a `[[link]]` in code is no link.
  if (view.state.selection.$from.marks().some((mark) => mark.type.spec.code === true)) return false
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
  // A paste this long is no list of paths: it goes on as text, unread.
  if (lines.length > MAX_PATHS) return false
  // Several paths (D4): each one a bullet, or the whole paste stays text.
  const links = lines.map((line) => {
    const path = pastedPath(line)
    return path === null ? null : linkFor(path, options)
  })
  if (links.length === 0 || links.includes(null)) {
    const path = lines.length === 1 ? pastedPath(lines[0]!) : null
    if (path !== null) noticeWhy(path, options)
    return false
  }
  if (links.length > 1) {
    const tr = closeHistory(view.state.tr).deleteSelection()
    // A header cell or a heading holds no list (YAZ-3631, YAZ-3818 D7): there the links go on the line, one space
    // apart. A body cell holds lists (YAZ-3818 D1), so there they are bullets, as in the page (D11).
    const $at = tr.selection.$from
    const noList = $at.parent.type.name === 'heading' || Array.from({ length: $at.depth }, (_, d) => $at.node(d).type.name).includes('table_header')
    if (noList) {
      view.dispatch(tr.replaceSelection(Slice.maxOpen(ctx.get(parserCtx)(links.join(' ')).content)).setMeta('paste', true).scrollIntoView())
      return true
    }
    const list = ctx.get(parserCtx)(links.map((link) => `- ${link}`).join('\n')).content
    // The bullets start on a line of their own: a line with text splits first. In a bullet they are its
    // siblings (the slice opens into the list); elsewhere they are a list of their own (a closed slice).
    const inList = tr.selection.$from.node(-1).type.name === 'list_item'
    if (tr.selection.$from.parent.content.size > 0) tr.split(tr.selection.from, inList ? 2 : 1)
    view.dispatch(tr.replaceSelection(inList ? Slice.maxOpen(list) : new Slice(list, 0, 0)).setMeta('paste', true).scrollIntoView())
    return true
  }
  const link = links[0]!
  // Pasted over words (D3): they become the link's text, `[[YAZ-12|the plan]]`, in one undo step.
  const { empty, from, to: end } = view.state.selection
  const words = empty ? '' : view.state.doc.textBetween(from, end)
  if (/^[^\n[\]|]+$/.test(words)) {
    const labelled = Slice.maxOpen(ctx.get(parserCtx)(link.startsWith('[[') ? link.replace(/\]\]$/, `|${words}]]`) : link.replace(/^\[(?:\\.|[^\]])*\]/, `[${words}]`)).content)
    view.dispatch(closeHistory(view.state.tr).replaceSelection(labelled).setMeta('paste', true).scrollIntoView())
    return true
  }
  // Two undo steps of their own: the path goes in first, so ⌘Z after the paste gives the path back, and
  // the next ⌘Z takes the paste away and leaves the typing before it (YAZ-3636).
  const raw = lines[0]!.trim()
  view.dispatch(closeHistory(view.state.tr).insertText(raw).setMeta('paste', true).setMeta('uiEvent', 'paste'))
  const to = view.state.selection.from
  const slice = Slice.maxOpen(ctx.get(parserCtx)(link).content)
  view.dispatch(closeHistory(view.state.tr).replace(to - raw.length, to, slice).scrollIntoView())
  // A drawing or a diagram can be an embed too (YAZ-4829 D8): `!` before the link as it is written. A `[[link]]` stays
  // text under the host's decorations; a Markdown link parses as the image node (another vault, 2B). So can a card
  // (YAZ-5037): a link that names one (a card file's) becomes the card's embed by its ID, `![[GEO-140]]`.
  // Not in a table cell: embeds there are out of scope (the checker's round 1).
  const path = pastedPath(raw)
  const card = link.startsWith('[[') ? (cardCheckOf(view.state)?.cardOf(link.slice(2, -2)) ?? null) : null
  // A new embed's view starts locked (YAZ-2571 round 7): `![[x|locked]]`, or `![name|locked](href)` into another vault.
  const embedText = () => (card !== null ? `![[${card.id}]]` : link.startsWith('[[') ? newEmbed(link.slice(2, -2)) : `!${link.replace(/^\[((?:\\.|[^\]])*)\]/, (_, name: string) => `[${newEmbedAlt(name)}]`)}`)
  const embed = (card !== null || (path !== null && isBoardTarget(path))) && !inCellOrPage(view.state.doc.resolve(to - raw.length)) ? Slice.maxOpen(ctx.get(parserCtx)(embedText()).content) : undefined
  // No chip after a paste over words (K5): ⌘Z gives the words back.
  if (empty) offerKeepAsPath(view, to - raw.length, to - raw.length + slice.size, raw, embed)
  return true
}

/**
 * Where the pasted pill ends on screen (YAZ-4904): the last drawn piece of the link between `from` and `to`. The
 * link's syntax (`[[`, `]]`, a hidden folder or ending) is `display: none`, so `coordsAtPos(to)` measured a hidden
 * node, got a zero rect, and put the chip at the window's top left corner. A DOM range over the link reads the boxes
 * of its drawn pieces only: the text, a title widget. `coordsAtPos` stays the fallback when nothing is drawn.
 */
function pillEnd(view: EditorView, from: number, to: number): { left: number; bottom: number } {
  const start = view.domAtPos(from, 1)
  const end = view.domAtPos(to, 1)
  const range = document.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.height > 0)
  const last = rects[rects.length - 1]
  if (last === undefined) {
    const at = view.coordsAtPos(to)
    return { left: at.left, bottom: at.bottom }
  }
  // A piece's box comes before its text in the list, and the text sits inside the box's padding: the chip goes
  // after the furthest right box on the pill's last line.
  let left = last.right
  let bottom = last.bottom
  for (const rect of rects) {
    if (rect.bottom <= last.top || rect.top >= last.bottom) continue
    left = Math.max(left, rect.right)
    bottom = Math.max(bottom, rect.bottom)
  }
  return { left, bottom }
}

/** The one open chip's close, or null. A new chip or a closing editor closes it (`closePathChip`). */
let openChip: (() => void) | null = null

/** Closes the "Keep as path" chip, if one is open: its editor is going away. */
export const closePathChip = (): void => openChip?.()

/**
 * The small "Keep as path" chip under a pasted link (D2), with "Embed" beside it for a drawing or a diagram (YAZ-4829
 * D8): `embed` is the link with its `!`. Each button is one undo step of its own, so ⌘Z gives the pill back. The next
 * key, click outside or scroll closes it.
 */
function offerKeepAsPath(view: EditorView, from: number, to: number, raw: string, embed?: Slice): void {
  closePathChip()
  const pasted = view.state.doc
  const chip = document.createElement('div')
  chip.className = 'ctx-menu ctx-menu--editor path-paste-chip'
  const keep = document.createElement('button')
  keep.type = 'button'
  keep.className = 'ctx-menu__item'
  keep.textContent = 'Keep as path'
  chip.appendChild(keep)
  if (embed !== undefined) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'ctx-menu__item'
    button.textContent = 'Embed'
    button.addEventListener('mousedown', (event) => event.preventDefault())
    button.addEventListener('click', () => {
      if (view.state.doc === pasted) view.dispatch(closeHistory(view.state.tr).replace(from, to, embed).scrollIntoView())
      close()
    })
    chip.appendChild(button)
  }
  const close = () => {
    openChip = null
    chip.remove()
    document.removeEventListener('mousedown', onDown, true)
    window.removeEventListener('keydown', close, true)
    document.removeEventListener('scroll', close, true)
  }
  const onDown = (event: MouseEvent) => {
    if (!(event.target instanceof Node && chip.contains(event.target))) close()
  }
  keep.addEventListener('mousedown', (event) => event.preventDefault())
  keep.addEventListener('click', () => {
    // Only over the paste as it was: an edit since then has closed the chip already.
    if (view.state.doc === pasted) view.dispatch(view.state.tr.insertText(raw, from, to))
    close()
  })
  view.dom.parentElement?.appendChild(chip)
  // Kept inside the window, as the link menu is (`linkMenu.ts` `openMenuAt`).
  const at = pillEnd(view, from, to)
  chip.style.left = `${Math.max(0, Math.min(at.left, window.innerWidth - chip.offsetWidth))}px`
  chip.style.top = `${Math.max(0, Math.min(at.bottom + 4, window.innerHeight - chip.offsetHeight))}px`
  openChip = close
  document.addEventListener('mousedown', onDown, true)
  window.addEventListener('keydown', close, true)
  document.addEventListener('scroll', close, true)
}
