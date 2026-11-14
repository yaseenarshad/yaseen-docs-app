/**
 * Board embeds in the page (YAZ-4827 2A; was the drawing preview of YAZ-878): `![[CloudFront.drawio|640x360 view=…]]`
 * and `![[Sketch.excalidraw]]` show as a WINDOW into the board (`embed/types.ts`, the window is 1B's, in a lazy chunk).
 *
 * DECORATIONS ONLY (🔒 the locked editor contract): the embed stays PLAIN TEXT in the document — no schema node, no
 * serializer, no node view — so round trip stays byte-identical (`roundtrip.test.ts`). The pair, as before:
 *   - `Decoration.inline` over the whole match with `drawing-embed__syntax` (CSS `display: none`); its spec names the
 *     embed (`boardEmbed`), which ⌘F reads to leave the hidden text out (item 15),
 *   - `Decoration.widget` at the match START (`side: -1`) holding the window's box, `contenteditable="false"`.
 *     `stopEvent` gives the window every event in it: ProseMirror and the link plugins (click, menu, hover) see none.
 *
 * ONLY board targets (`.excalidraw`, `.drawio`, `boardEmbedTarget`) and, with `cards`, an ID that names a card (YAZ-5037,
 * `card/cardEmbed.ts`: the card's box in the same widget) or names nothing ("Missing card"): every other embed and
 * every link passes through. The host's check (`isBoard`, on the plugin's spec) says yes to all three, so the scan,
 * the caret, ⌘F, the fold and "Add line" treat a card's box as a board's window; `cardOf` (on the spec too) tells the
 * card from the board for the link menu and the paste chip.
 *
 * THE TYPING PATH (D1): a key or a caret move can only change the embeds of the textblocks it touched. The set is
 * mapped and only those blocks are scanned again — the wikilink plugin's `updateDecorations` rule. A block with no
 * `![[` costs one `includes`. `boardEmbedStats` counts the blocks scanned, for the count test.
 *
 * IDENTITY: each embed gets an id when the host first sees it, and the id moves with the text. A block scanned again
 * gives each embed the id of the old embed of the same target, in order. The widget key is `board:<id>`, never the
 * options, so a view write keeps the same DOM and the same window (`handle.update`).
 *
 * WINDOW: the box is drawn at once, at the window's first height, and the window mounts as soon as its chunk is there
 * (`mountInBox`, shared with the image host): the window watches the screen itself before it makes a picture. The
 * widget's `destroy` destroys the window. A save flush writes a view still waiting first (`flushBoardWindows`, A8).
 *
 * SELECTION: the whole embed selected (a TextSelection of exactly its text) is the window selected (`setSelected`).
 * Only a selection strictly inside it, which "Edit link" alone puts there (`idLinkCaret.ts` steps the caret over an
 * embed), shows the raw text. A click on the window selects the embed. Typing replaces it (it is text); ⌘Z brings it
 * back. Escape first deselects it (item 20); Shift+1 fits the board (D10).
 *
 * WRITES (D4): the window's `onOptions` → one `insertText` over the options part only (after the last `|`, which keeps
 * an alias before it, or a new `|…` before `]]`), `addToHistory: false`, only in an editable page, only when the text differs. The embed is found
 * again from the CURRENT doc at the widget's live position, and its target must still be the same: no stale position.
 */
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, TextSelection, type EditorState, type Selection, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { optionsSuffix, parseEmbedOptions, type EmbedOptions } from '@shared/embedOptions'
import { fileKind } from '@shared/fileKind'
import type { MenuRow } from '../blockHandleMenu'
import { BOX_BROKEN_CLASS, menuRowOf, mountInBox, onFlush } from '../embed/hostWindow'
import type { BoardRef, BoardWindowHandle, OpenHow } from '../embed/types'
import { linkMenuRows, openMenuAt, type LinkMenu } from '../linkMenu'
import { embedFolds, toggleOutlineFold } from '../outline/outlineFolding'
import { inCellOrPage } from '../table/cellBlocks'
import { OPEN_ID_LINK } from '../wikilink/idLinkCaret'
import { viewOnlyLinkTarget, type ViewOnlyLinkSource } from '../wikilink/viewOnlyLinkSource'
import { linkPath, missingId, type LinkLook, type WikilinkResolveSource } from '../wikilink/wikilinkPlugin'
import { boardEmbedAt, boardEmbedKey, boardEmbedsIn, embedRevealed, type BoardEmbedMatch, type CardCheck } from './boardEmbedScan'
import { boardEmbedName, hasIdEmbed, isIdTarget, type BoardCheck } from './boardEmbedText'
import { isBoardTarget } from '@shared/embedOptions'
import { embedCard, loadCardEmbed, type CardEmbedDoors, type CardEmbedHandle } from '../card/embedCard'
import './boardEmbed.css'

export { boardEmbedKey }

export const BOARD_EMBED_SYNTAX_CLASS = 'drawing-embed__syntax'
/** The window's box, here and on a board image node (`imageView.ts`): the hover card and the click plugins skip it. */
export const BOARD_EMBED_CLASS = 'board-embed'
/** Set on a view write (D4): not the user's typing, not an undo step. */
export const BOARD_VIEW_META = 'mdapp-board-view'
/** The resolver changed and the page has an id embed (YAZ-4920): every textblock is scanned again, the ids kept. */
const BOARD_RESCAN = 'mdapp-board-rescan'

export interface BoardEmbedOptions {
  /** The vault root the boards load from. */
  root: string
  /** The one resolve source of the page's links: a target's path, re-read when it changes. */
  source: WikilinkResolveSource
  viewOnly?: ViewOnlyLinkSource
  /** The pill's icon (`LinkLook.icon`). Absent → the kind's plain icon. */
  look?: LinkLook
  /** Opens the board as a click on its pill does (`wikilinkFollower`). Absent → a double-click opens nothing. */
  follow?: (inner: string, how: OpenHow) => void
  /** The pill rows of the embed's link (`linkMenuOf`, with no edit and no remove). Absent → no menu. */
  linkMenu?: (inner: string) => LinkMenu
  /** "Edit in a popup" for a drawing (D7): Editor's `DrawingModal`. Absent → no row. */
  onEditInPopup?: (target: string) => void
  /** Card embeds (YAZ-5037): the page card's doors. Absent (the card editor, a vault with no cards) → `![[GEO-140]]` stays text. */
  cards?: CardEmbedDoors
}

/**
 * The text between the brackets of the one embed `paragraph` holds, when that embed stands alone on its line in the
 * file (YAZ-5037 phase 5, "Put back into this page"): a paragraph of the page itself, or one after the first of a list
 * item (an indented line under it). Null for anything else: words around it, a list item's first line, a quote, a cell.
 */
function loneEmbedOf(paragraph: ProseNode, parent: ProseNode | null, index: number): string | null {
  if (paragraph.type.name !== 'paragraph' || parent === null) return null
  if (parent.type.name !== 'doc' && !(parent.type.name === 'list_item' && index > 0)) return null
  return /^!\[\[([^\]\n]+)\]\]$/.exec(paragraph.textContent.trim())?.[1] ?? null
}

/** The card box's chunk would not load (YAZ-5037): one quiet line in its place, as a window's "Can't show …". */
function cantShowCard(box: HTMLElement): void {
  box.classList.add(BOX_BROKEN_CLASS)
  box.textContent = "Can't show this card"
}

/** Counts, for the typing tests: the textblocks scanned, and the fold passes over every mount (A9), since the start. */
export const boardEmbedStats = { blocksScanned: 0, foldPasses: 0 }

/** What a widget knows of its embed. */
interface EmbedFact {
  id: number
  target: string
  options: string | null
  /** In a table cell (or a cell note): out of scope, so the window shows as its pill line, never live. */
  cell: boolean
}

/** A cell's embed is its pill line (the folded look) with no arrow; any other starts open, its bullet's fold to come. */
const firstFold = (cell: boolean) => ({ foldable: false, folded: cell })

const parseOptions = (text: string | null): EmbedOptions | null => (text === null ? null : parseEmbedOptions(text))

/** One mounted box: its widget's DOM, its live position, and the window once the chunk is there. */
interface Mount {
  id: number
  dom: HTMLElement
  getPos: () => number | undefined
  target: string
  options: string | null
  handle: BoardWindowHandle | null
  /** A card's embed (YAZ-5037) in place of a window: never a `handle`. */
  isCard: boolean
  /** The card's box once its chunk is there. */
  card: CardEmbedHandle | null
  refKey: string
  selected: boolean
  fold: { foldable: boolean; folded: boolean }
  cell: boolean
}

export function createBoardEmbed(opts: BoardEmbedOptions) {
  return $prose(() => {
    let nextId = 1
    /** Embeds scanned since the last view update: their window hears the new options. */
    const pending = new Map<number, EmbedFact>()
    const mounts = new Map<HTMLElement, Mount>()
    const byId = new Map<number, Mount>()
    let closeMenu = () => {}
    /** An id embed's card (YAZ-5037), or null: none, or no card embeds here. */
    const cardOf = (target: string) => (opts.cards === undefined ? null : embedCard(target, opts.source, opts.viewOnly))
    /** An id embed the host draws as "Missing card" (YAZ-5037): an ID of this vault that names nothing. */
    const isMissing = (target: string): boolean => opts.cards !== undefined && missingId(target, opts.source) !== undefined
    /** A card's box, a missing card's line, or a window: what an id embed is drawn as. */
    const isCardEmbed = (target: string): boolean => cardOf(target) !== null || isMissing(target)
    /**
     * An id link's kind (YAZ-4920): the id resolves to a board file — or, with `cards`, to a card or to nothing (YAZ-5037).
     * The scan, the find, the caret and the menus ask it.
     */
    const isBoard: BoardCheck = (target) => {
      const path = linkPath(target, opts.source, opts.viewOnly)
      return (path !== null && isBoardTarget(path)) || isCardEmbed(target)
    }
    /** The page has shown an id-shaped embed (resolved or not): the resolver's next change scans the page again. */
    let sawIdEmbed = false

    /** One textblock's decorations; `idFor` gives each embed its id (inherited, or new). */
    const decorateBlock = (out: Decoration[], doc: ProseNode, block: ProseNode, pos: number, sel: Selection, idFor: (target: string) => number): void => {
      boardEmbedStats.blocksScanned++
      if (!sawIdEmbed && hasIdEmbed(block.textContent)) sawIdEmbed = true
      const found = boardEmbedsIn(block, pos, isBoard)
      const cell = found.length > 0 && inCellOrPage(doc.resolve(pos + 1))
      for (const m of found) {
        if (embedRevealed(sel, m.from, m.to)) continue
        const fact: EmbedFact = { id: idFor(m.target), target: m.target, options: m.options, cell }
        pending.set(fact.id, fact)
        out.push(Decoration.inline(m.from, m.to, { class: BOARD_EMBED_SYNTAX_CLASS }, { boardEmbed: fact.id }))
        out.push(
          Decoration.widget(m.from, (view, getPos) => boxFor(view, getPos, fact), {
            key: `board:${fact.id}`,
            side: -1,
            board: fact,
            ignoreSelection: true,
            stopEvent: () => true,
            destroy: (node) => unmount(node as HTMLElement),
          }),
        )
      }
    }

    const fresh = () => nextId++

    const build = (state: EditorState): DecorationSet => {
      const out: Decoration[] = []
      state.doc.descendants((node, pos) => {
        if (node.type.name === 'code_block') return false
        if (!node.isTextblock) return true
        decorateBlock(out, state.doc, node, pos, state.selection, fresh)
        return false
      })
      return out.length === 0 ? DecorationSet.empty : DecorationSet.create(state.doc, out)
    }

    /** The blocks given scanned again: each embed keeps its id (`olds`), so its window stays. */
    const refresh = (set: DecorationSet, doc: ProseNode, blocks: ReadonlyMap<number, ProseNode>, sel: Selection): DecorationSet => {
      const stale: Decoration[] = []
      const out: Decoration[] = []
      for (const [pos, block] of blocks) {
        const old = set.find(pos, pos + block.nodeSize)
        stale.push(...old)
        if (block.type.name === 'code_block') continue
        // The old embeds of this block, in order: each new one of the same target takes the first unused id.
        const olds = old.filter((d) => d.spec.board !== undefined).sort((a, b) => a.from - b.from).map((d) => d.spec.board as EmbedFact)
        const idFor = (target: string) => {
          const i = olds.findIndex((f) => f.target === target)
          return i < 0 ? fresh() : olds.splice(i, 1)[0]!.id
        }
        decorateBlock(out, doc, block, pos, sel, idFor)
      }
      return stale.length === 0 && out.length === 0 ? set : set.remove(stale).add(doc, out)
    }

    /** Every textblock scanned again (YAZ-4920: the resolver changed, so an id embed may be a board now, or no more). */
    const rescan = (set: DecorationSet, state: EditorState): DecorationSet => {
      const blocks = new Map<number, ProseNode>()
      state.doc.descendants((node, pos) => {
        if (!node.isTextblock) return true
        blocks.set(pos, node)
        return false
      })
      return refresh(set, state.doc, blocks, state.selection)
    }

    /** The touched blocks only (see the module doc); the wikilink plugin's ranges, exactly. */
    const update = (set: DecorationSet, tr: Transaction, oldState: EditorState, state: EditorState): DecorationSet => {
      const { doc } = state
      const ranges: [number, number][] = [
        [tr.mapping.map(oldState.selection.from, -1), tr.mapping.map(oldState.selection.to, 1)],
        [state.selection.from, state.selection.to],
      ]
      if (tr.docChanged) {
        set = set.map(tr.mapping, doc)
        tr.mapping.maps.forEach((map, i) => {
          const later = tr.mapping.slice(i + 1)
          map.forEach((_a, _b, from, to) => ranges.push([later.map(from, -1), later.map(to, 1)]))
        })
        const diffStart = oldState.doc.content.findDiffStart(doc.content)
        if (diffStart !== null) ranges.push([diffStart, oldState.doc.content.findDiffEnd(doc.content)!.b])
      }
      const blocks = new Map<number, ProseNode>()
      for (const [a, b] of ranges) {
        doc.nodesBetween(Math.max(0, Math.min(a, b) - 1), Math.min(doc.content.size, Math.max(a, b) + 1), (node, pos) => {
          if (!node.isTextblock) return true
          blocks.set(pos, node)
          return false
        })
      }
      return refresh(set, doc, blocks, state.selection)
    }

    // ---- the windows ----

    const refOf = (target: string): BoardRef => {
      const page = target.split('#')[0]!.trim()
      const viewOnlyTarget = opts.viewOnly !== undefined && viewOnlyLinkTarget(target) !== null
      const ready = viewOnlyTarget ? opts.viewOnly!.resolve !== null : opts.source.resolve !== null
      // Before the index lands nothing is known: the target as written (vault-relative) is the best guess.
      const path = linkPath(target, opts.source, opts.viewOnly) ?? (ready ? null : page)
      const icon = path === null || opts.look === undefined ? undefined : opts.look.icon(path, false)
      // An id link's kind and name are its file's (YAZ-4920); a name embed's are its own text.
      const file = isIdTarget(page) && path !== null ? path : target
      return { root: opts.root, path, kind: fileKind(file.split('#')[0]!.trim()) === 'diagram' ? 'diagram' : 'drawing', name: boardEmbedName(file), vault: null, ...(icon === undefined ? {} : { icon }) }
    }
    const keyOf = (ref: BoardRef) => `${ref.path ?? ''}|${JSON.stringify(ref.icon ?? null)}`

    /** The embed a mount stands for, in the CURRENT doc: at its widget's live position, with the same target. */
    const matchOf = (view: EditorView, mount: Mount): BoardEmbedMatch | null => {
      const pos = mount.getPos()
      const m = pos === undefined ? null : boardEmbedAt(view.state.doc, pos, 'start', isBoard)
      return m !== null && m.target === mount.target ? m : null
    }

    const writeOptions = (view: EditorView, mount: Mount, next: EmbedOptions): void => {
      if (!view.editable || mount.isCard) return
      const m = matchOf(view, mount)
      if (m === null) return
      // After the alias, if any (`x.drawio|My name|640x360`): only the options part changes.
      const from = m.optionsAt ?? m.to - 2
      const suffix = optionsSuffix(next)
      if (view.state.doc.textBetween(from, m.to - 2) === suffix) return
      view.dispatch(view.state.tr.insertText(suffix, from, m.to - 2).setMeta('addToHistory', false).setMeta(BOARD_VIEW_META, true))
    }

    const select = (view: EditorView, mount: Mount): void => {
      const m = matchOf(view, mount)
      if (m === null) return
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, m.from, m.to)))
      view.focus()
    }

    const fold = (view: EditorView, mount: Mount): void => {
      const pos = mount.getPos()
      const entry = pos === undefined ? undefined : embedFolds(view.state).get(pos)
      if (entry !== undefined) toggleOutlineFold(entry.itemPos)(view.state, view.dispatch)
    }

    const openMenu = (view: EditorView, mount: Mount, event: MouseEvent): void => {
      const m = matchOf(view, mount)
      const parent = view.dom.parentElement
      if (m === null || parent === null || opts.linkMenu === undefined) return
      event.preventDefault()
      closeMenu()
      const rows = linkMenuRows({ ...opts.linkMenu(m.target), edit: undefined, remove: undefined })
      const group = (list: Array<MenuRow | null>) => {
        const kept = list.filter((row): row is MenuRow => row !== null)
        if (kept.length > 0) rows.push({ ...kept[0]!, divider: true }, ...kept.slice(1))
      }
      group(mount.handle?.menuRows().map(menuRowOf) ?? [])
      const live = () => matchOf(view, mount)
      const replace = (text: string) => {
        const now = live()
        if (now !== null) view.dispatch(view.state.tr.insertText(text, now.from, now.to))
      }
      const editable = view.editable
      const drawing = fileKind(m.target.split('#')[0]!.trim()) === 'drawing'
      group([
        editable && drawing && opts.onEditInPopup !== undefined ? { label: 'Edit in a popup', run: () => opts.onEditInPopup?.(m.target) } : null,
        editable ? { label: 'Show as link', run: () => replace(`[[${m.target}]]`) } : null,
        editable
          ? {
              label: 'Edit link',
              run: () => {
                const now = live()
                if (now === null) return
                view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, now.from + 3, now.from + 3 + now.target.length)).setMeta(OPEN_ID_LINK, true))
                view.focus()
              },
            }
          : null,
        editable ? { label: 'Remove embed', danger: true, run: () => replace('') } : null,
      ])
      closeMenu = openMenuAt(parent, event.clientX, event.clientY, rows)
    }

    const boxFor = (view: EditorView, getPos: () => number | undefined, fact: EmbedFact): HTMLElement => {
      const dom = document.createElement('span')
      dom.className = BOARD_EMBED_CLASS
      dom.contentEditable = 'false'
      const latest = pending.get(fact.id) ?? fact
      if (opts.cards !== undefined && isCardEmbed(latest.target.split('#')[0]!.trim())) return cardBoxFor(view, dom, getPos, fact.id, latest, opts.cards)
      const ref = refOf(latest.target)
      const mount: Mount = { id: fact.id, dom, getPos, target: latest.target, options: latest.options, handle: null, isCard: false, card: null, refKey: keyOf(ref), selected: false, fold: firstFold(latest.cell), cell: latest.cell }
      mounts.set(dom, mount)
      byId.set(fact.id, mount)
      const columnWidth = () => view.dom.clientWidth
      mountInBox(dom, {
        options: parseOptions(latest.options),
        columnWidth,
        host: () => ({
          ref: refOf(mount.target),
          options: parseOptions(mount.options),
          editable: view.editable,
          columnWidth,
          onOptions: (next) => writeOptions(view, mount, next),
          onOpen: (how) => opts.follow?.(mount.target, how),
          onContextMenu: (event) => openMenu(view, mount, event),
          onSelect: () => select(view, mount),
          onFold: () => fold(view, mount),
        }),
        live: () => mounts.get(dom) === mount,
        done: (handle) => {
          mount.handle = handle
        },
        state: () => mount,
        name: () => boardEmbedName(mount.target),
      })
      return dom
    }

    /**
     * A card's box (YAZ-5037, `cardEmbed.ts`) in the widget, once its chunk is there: its head from the index, its card
     * read when near the screen. The selection and the fold the host knew meanwhile apply then; a cell's starts folded,
     * as a window shows its pill line there.
     */
    const cardBoxFor = (view: EditorView, dom: HTMLElement, getPos: () => number | undefined, id: number, fact: EmbedFact, doors: CardEmbedDoors): HTMLElement => {
      const mount: Mount = { id, dom, getPos, target: fact.target, options: fact.options, handle: null, isCard: true, card: null, refKey: '', selected: false, fold: firstFold(fact.cell), cell: fact.cell }
      mounts.set(dom, mount)
      byId.set(id, mount)
      void loadCardEmbed().then(
        (mod) => {
          if (mounts.get(dom) !== mount) return
          const card = mod.mountCardEmbed({
            target: fact.target.split('#')[0]!.trim(),
            source: opts.source,
            viewOnly: opts.viewOnly,
            doors,
            editable: () => view.editable,
            select: () => select(view, mount),
            replace: (text) => {
              const now = matchOf(view, mount)
              if (now !== null && view.editable) view.dispatch(view.state.tr.insertText(text, now.from, now.to))
            },
            menuParent: () => view.dom.parentElement ?? document.body,
            place: () => {
              const now = matchOf(view, mount)
              if (now === null) return null
              const $at = view.state.doc.resolve(now.from)
              const inner = loneEmbedOf($at.parent, $at.node($at.depth - 1), $at.index($at.depth - 1))
              if (inner !== now.inner) return null
              // Its place among the page's lone embeds of that text, as the file's lines read them (`embedLine`).
              const before = $at.before()
              let nth = 0
              view.state.doc.descendants((node, pos, parent, index) => {
                if (pos >= before) return false
                if (node.type.name !== 'paragraph') return true
                if (loneEmbedOf(node, parent, index) === inner) nth++
                return false
              })
              return { inner, nth }
            },
          })
          mount.card = card
          if (mount.fold.folded) card.setFolded(true)
          if (mount.selected) card.setSelected(true)
          dom.replaceChildren(card.dom)
        },
        () => {
          if (mounts.get(dom) === mount) cantShowCard(dom)
        },
      )
      return dom
    }

    const unmount = (dom: HTMLElement): void => {
      const mount = mounts.get(dom)
      if (mount === undefined) return
      mounts.delete(dom)
      if (byId.get(mount.id) === mount) byId.delete(mount.id)
      mount.handle?.destroy()
      mount.handle = null
      mount.card?.destroy()
      mount.card = null
    }

    /** The resolver changed: each window whose board now resolves elsewhere hears its new ref; each card's box looks again. */
    const resolved = (): void => {
      for (const mount of mounts.values()) {
        if (mount.isCard) {
          mount.card?.refresh()
          continue
        }
        const ref = refOf(mount.target)
        const key = keyOf(ref)
        if (key === mount.refKey) continue
        mount.refKey = key
        mount.handle?.update({ ref })
      }
    }

    /** The embed the selection covers exactly, by its id, or null. */
    const selectedId = (state: EditorState): number | null => {
      const { selection } = state
      if (selection.empty || !(selection instanceof TextSelection)) return null
      const set = boardEmbedKey.getState(state)
      const hit = set?.find(selection.from, selection.to, (spec) => typeof spec.boardEmbed === 'number').find((d) => d.from === selection.from && d.to === selection.to)
      return hit === undefined ? null : (hit.spec.boardEmbed as number)
    }

    return new Plugin({
      key: boardEmbedKey,
      // The scan's board check, for the find, the caret, the menus and the embed's own line (`boardCheckOf`).
      isBoard,
      // The card a link or an embed names (YAZ-5037, `cardCheckOf`): the link menu's and the paste chip's "embed".
      cards: opts.cards === undefined ? undefined : ({ cardOf, isMissing } satisfies CardCheck),
      state: {
        init: (_, state) => build(state),
        apply: (tr, set, oldState, state) => (tr.getMeta(BOARD_RESCAN) === true ? rescan(set, state) : tr.docChanged || tr.selectionSet ? update(set, tr, oldState, state) : set),
      },
      props: {
        decorations: (state) => boardEmbedKey.getState(state),
        handleKeyDown: (view, event) => {
          const id = selectedId(view.state)
          const mount = id === null ? undefined : byId.get(id)
          if (mount === undefined) return false
          // The window's keys (D10): ⌘+ ⌘− ⌘0, and Shift+1 (fit, never a typed "!" over the embed). The editor keeps
          // the focus, so any other key types over the embed as over any selection (item 21).
          if (mount.handle?.handleKey(event) === true) return true
          if (event.metaKey || event.ctrlKey || event.altKey) return false
          // Escape first deselects the window (item 20): the caret goes after the embed.
          if (event.key === 'Escape') {
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.selection.to)))
            return true
          }
          return false
        },
      },
      view: (editorView) => {
        let editable = editorView.editable
        let selected: number | null = null
        let folds = embedFolds(editorView.state)
        /** The resolver changed (YAZ-4920): a page with an id embed scans again, then the windows hear their refs. */
        const resolvedAll = (): void => {
          if (sawIdEmbed) editorView.dispatch(editorView.state.tr.setMeta(BOARD_RESCAN, true))
          resolved()
        }
        const offSource = opts.source.subscribe(resolvedAll)
        const offViewOnly = opts.viewOnly?.subscribe(resolvedAll)
        const offFlush = onFlush(editorView, () => mounts.forEach((mount) => mount.handle?.flush()))
        /** Each window's fold, from the outline's state: only when that state changed. */
        const syncFolds = (before: ReadonlyMap<number, unknown> | null) => {
          // A9: no embed on a bullet, before or now (the typing path of most pages): nothing to ask of any mount.
          if (before !== null && before.size === 0 && folds.size === 0) return
          boardEmbedStats.foldPasses++
          for (const mount of mounts.values()) {
            if (mount.cell) continue
            const pos = mount.getPos()
            const entry = pos === undefined ? undefined : folds.get(pos)
            const next = { foldable: entry !== undefined, folded: entry?.folded === true }
            if (next.foldable !== mount.fold.foldable) mount.handle?.setFoldable(next.foldable)
            if (next.folded !== mount.fold.folded) {
              mount.handle?.setFolded(next.folded)
              mount.card?.setFolded(next.folded)
            }
            mount.fold = next
          }
        }
        // The view drew the boxes before it made this plugin view: their first fold.
        syncFolds(null)
        return {
          update: (view, previous) => {
            if (view.state.doc !== previous.doc) closeMenu()
            // New options for the windows of the embeds scanned again (a view write, an outside edit, an undo).
            for (const fact of pending.values()) {
              const mount = byId.get(fact.id)
              if (mount === undefined) continue
              if (mount.cell !== fact.cell) {
                // Moved into or out of a table cell: the pill line there, the window elsewhere (its bullet's fold follows).
                mount.cell = fact.cell
                mount.fold = firstFold(fact.cell)
                mount.handle?.setFoldable(false)
                mount.handle?.setFolded(fact.cell)
                mount.card?.setFolded(fact.cell)
              }
              if (mount.options !== fact.options) {
                mount.options = fact.options
                mount.handle?.update({ options: parseOptions(fact.options) })
              }
            }
            pending.clear()
            if (view.editable !== editable) {
              editable = view.editable
              for (const mount of mounts.values()) mount.handle?.update({ editable })
              // A card's box: Edit card and Show as link follow the page (YAZ-5037).
              for (const mount of mounts.values()) mount.card?.refresh()
            }
            const now = selectedId(view.state)
            if (now !== selected) {
              const before = selected === null ? undefined : byId.get(selected)
              if (before !== undefined) {
                before.selected = false
                before.handle?.setSelected(false)
                before.card?.setSelected(false)
              }
              selected = now
              const after = now === null ? undefined : byId.get(now)
              if (after !== undefined) {
                after.selected = true
                after.handle?.setSelected(true)
                after.card?.setSelected(true)
              }
            }
            const nextFolds = embedFolds(view.state)
            if (nextFolds !== folds) {
              const before = folds
              folds = nextFolds
              syncFolds(before)
            }
          },
          destroy: () => {
            offSource()
            offViewOnly?.()
            offFlush()
            closeMenu()
          },
        }
      },
    })
  })
}
