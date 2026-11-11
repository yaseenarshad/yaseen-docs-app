/**
 * Board embeds in the note (YAZ-4827 2A; was the drawing preview of YAZ-878): `![[CloudFront.drawio|640x360 view=…]]`
 * and `![[Sketch.excalidraw]]` show as a WINDOW into the board (`embed/types.ts`, the window is 1B's, in a lazy chunk).
 *
 * DECORATIONS ONLY (🔒 the locked editor contract): the embed stays PLAIN TEXT in the document — no schema node, no
 * serializer, no node view — so round trip stays byte-identical (`roundtrip.test.ts`). The pair, as before:
 *   - `Decoration.inline` over the whole match with `drawing-embed__syntax` (CSS `display: none`); its spec names the
 *     embed (`boardEmbed`), which ⌘F reads to leave the hidden text out (item 15),
 *   - `Decoration.widget` at the match START (`side: -1`) holding the window's box, `contenteditable="false"`.
 *     `stopEvent` gives the window every event in it: ProseMirror and the link plugins (click, menu, hover) see none.
 *
 * ONLY board targets (`.excalidraw`, `.drawio`, `boardEmbedTarget`): every other embed and every link passes through.
 *
 * THE TYPING PATH (D1): a key or a caret move can only change the embeds of the textblocks it touched. The set is
 * mapped and only those blocks are scanned again — the wikilink plugin's `updateDecorations` rule. A block with no
 * `![[` costs one `includes`. `boardEmbedStats` counts the blocks scanned, for the count test.
 *
 * IDENTITY: each embed gets an id when the host first sees it, and the id moves with the text. A block scanned again
 * gives each embed the id of the old embed of the same target, in order. The widget key is `board:<id>`, never the
 * options, so a view write keeps the same DOM and the same window (`handle.update`).
 *
 * WINDOW: the box is drawn at once and the window mounts as soon as its chunk is there: the window watches the screen
 * itself before it makes a picture. The widget's `destroy` destroys the window.
 *
 * SELECTION: the whole embed selected (a TextSelection of exactly its text) is the window selected (`setSelected`).
 * Only a selection strictly inside it, which "Edit link" alone puts there (`idLinkCaret.ts` steps the caret over an
 * embed), shows the raw text. A click on the window selects the embed. Typing replaces it (it is text); ⌘Z brings it
 * back. Escape first deselects it (item 20); Shift+1 fits the board (D10).
 *
 * WRITES (D4): the window's `onOptions` → one `insertText` over the options part only (after the first `|`, or a new
 * `|…` before `]]`), `addToHistory: false`, only in an editable note, only when the text differs. The embed is found
 * again from the CURRENT doc at the widget's live position, and its target must still be the same: no stale position.
 */
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, TextSelection, type EditorState, type Selection, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { optionsSuffix, parseEmbedOptions, type EmbedOptions } from '@shared/embedOptions'
import { fileKind } from '@shared/fileKind'
import type { MenuRow } from '../blockHandleMenu'
import { loadBoardWindow, type BoardRef, type BoardWindowHandle, type OpenHow, type WindowMenuRow } from '../embed/types'
import { linkMenuRows, openMenuAt, type LinkMenu } from '../linkMenu'
import { embedFolds, toggleOutlineFold } from '../outline/outlineFolding'
import { OPEN_ID_LINK } from '../wikilink/idLinkCaret'
import { viewOnlyLinkTarget, type ViewOnlyLinkSource } from '../wikilink/viewOnlyLinkSource'
import { linkPath, type LinkLook, type WikilinkResolveSource } from '../wikilink/wikilinkPlugin'
import { boardEmbedAt, boardEmbedKey, boardEmbedsIn, embedRevealed, type BoardEmbedMatch } from './boardEmbedScan'
import { boardEmbedName } from './boardEmbedText'
import './boardEmbed.css'

export { boardEmbedKey }

export const BOARD_EMBED_SYNTAX_CLASS = 'drawing-embed__syntax'
/** The window's box, here and on a board image node (`imageView.ts`): the hover card and the click plugins skip it. */
export const BOARD_EMBED_CLASS = 'board-embed'
/** Set on a view write (D4): not the user's typing, not an undo step. */
export const BOARD_VIEW_META = 'mdapp-board-view'

export interface BoardEmbedOptions {
  /** The vault root the boards load from. */
  root: string
  /** The one resolve source of the note's links: a target's path, re-read when it changes. */
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
}

/** Counts, for the typing test: the textblocks scanned since the editor started. */
export const boardEmbedStats = { blocksScanned: 0 }

/** What a widget knows of its embed. */
interface EmbedFact {
  id: number
  target: string
  inner: string
  options: string | null
}


const parseOptions = (text: string | null): EmbedOptions | null => (text === null ? null : parseEmbedOptions(text))

/** A window row as a menu row; the window's `checked` (a page's flyout) is the ✓ hint. */
const menuRowOf = (row: WindowMenuRow): MenuRow => ({
  label: row.label,
  run: row.run,
  disabled: row.disabled,
  hint: (row as WindowMenuRow & { checked?: boolean }).checked === true ? '✓' : undefined,
  children: row.children === undefined ? undefined : [row.children.map(menuRowOf)],
})

/** One mounted box: its widget's DOM, its live position, and the window once the chunk is there. */
interface Mount {
  id: number
  dom: HTMLElement
  getPos: () => number | undefined
  target: string
  inner: string
  options: string | null
  handle: BoardWindowHandle | null
  refKey: string
  selected: boolean
  fold: { foldable: boolean; folded: boolean }
}

export function createBoardEmbed(opts: BoardEmbedOptions) {
  return $prose(() => {
    let nextId = 1
    /** Embeds scanned since the last view update: their window hears the new options. */
    const pending = new Map<number, EmbedFact>()
    const mounts = new Map<HTMLElement, Mount>()
    const byId = new Map<number, Mount>()
    let closeMenu = () => {}

    /** One textblock's decorations; `idFor` gives each embed its id (inherited, or new). */
    const decorateBlock = (out: Decoration[], block: ProseNode, pos: number, sel: Selection, idFor: (target: string) => number): void => {
      boardEmbedStats.blocksScanned++
      for (const m of boardEmbedsIn(block, pos)) {
        if (embedRevealed(sel, m.from, m.to)) continue
        const fact: EmbedFact = { id: idFor(m.target), target: m.target, inner: m.inner, options: m.options }
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
        decorateBlock(out, node, pos, state.selection, fresh)
        return false
      })
      return out.length === 0 ? DecorationSet.empty : DecorationSet.create(state.doc, out)
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
        decorateBlock(out, block, pos, state.selection, idFor)
      }
      return stale.length === 0 && out.length === 0 ? set : set.remove(stale).add(doc, out)
    }

    // ---- the windows ----

    const refOf = (target: string): BoardRef => {
      const page = target.split('#')[0]!.trim()
      const viewOnlyTarget = opts.viewOnly !== undefined && viewOnlyLinkTarget(target) !== null
      const ready = viewOnlyTarget ? opts.viewOnly!.resolve !== null : opts.source.resolve !== null
      // Before the index lands nothing is known: the target as written (vault-relative) is the best guess.
      const path = linkPath(target, opts.source, opts.viewOnly) ?? (ready ? null : page)
      const icon = path === null || opts.look === undefined ? undefined : opts.look.icon(path, false)
      return { root: opts.root, path, kind: fileKind(page) === 'diagram' ? 'diagram' : 'drawing', name: boardEmbedName(target), vault: null, ...(icon === undefined ? {} : { icon }) }
    }
    const keyOf = (ref: BoardRef) => `${ref.path ?? ''}|${JSON.stringify(ref.icon ?? null)}`

    /** The embed a mount stands for, in the CURRENT doc: at its widget's live position, with the same target. */
    const matchOf = (view: EditorView, mount: Mount): BoardEmbedMatch | null => {
      const pos = mount.getPos()
      const m = pos === undefined ? null : boardEmbedAt(view.state.doc, pos, 'start')
      return m !== null && m.target === mount.target ? m : null
    }

    const writeOptions = (view: EditorView, mount: Mount, next: EmbedOptions): void => {
      if (!view.editable) return
      const m = matchOf(view, mount)
      if (m === null) return
      const pipe = m.inner.indexOf('|')
      const from = pipe < 0 ? m.to - 2 : m.from + 3 + pipe
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
      const ref = refOf(latest.target)
      const mount: Mount = { id: fact.id, dom, getPos, target: latest.target, inner: latest.inner, options: latest.options, handle: null, refKey: keyOf(ref), selected: false, fold: { foldable: false, folded: false } }
      // No page jump (item 12): the box holds the stored height until the window is there.
      const stored = parseOptions(latest.options)
      if (stored !== null) dom.style.setProperty('--board-embed-height', `${stored.height}px`)
      mounts.set(dom, mount)
      byId.set(fact.id, mount)
      void loadBoardWindow().then(
        (mod) => {
          if (mounts.get(dom) !== mount) return
          try {
            mount.handle = mod.mountBoardWindow({
              ref: refOf(mount.target),
              options: parseOptions(mount.options),
              editable: view.editable,
              columnWidth: () => view.dom.clientWidth,
              onOptions: (next) => writeOptions(view, mount, next),
              onOpen: (how) => opts.follow?.(mount.target, how),
              onContextMenu: (event) => openMenu(view, mount, event),
              onSelect: () => select(view, mount),
              onFold: () => fold(view, mount),
            })
          } catch {
            broken(mount)
            return
          }
          dom.style.removeProperty('--board-embed-height')
          dom.replaceChildren(mount.handle.dom)
          if (mount.selected) mount.handle.setSelected(true)
          if (mount.fold.foldable) mount.handle.setFoldable(true)
          if (mount.fold.folded) mount.handle.setFolded(true)
        },
        () => broken(mount),
      )
      return dom
    }

    /** The window could not load: the box says so, and keeps its place. */
    const broken = (mount: Mount): void => {
      mount.dom.classList.add(`${BOARD_EMBED_CLASS}--broken`)
      mount.dom.textContent = `Can't show ${boardEmbedName(mount.target)}`
    }

    const unmount = (dom: HTMLElement): void => {
      const mount = mounts.get(dom)
      if (mount === undefined) return
      mounts.delete(dom)
      if (byId.get(mount.id) === mount) byId.delete(mount.id)
      mount.handle?.destroy()
      mount.handle = null
    }

    /** The resolver changed: each window whose board now resolves elsewhere hears its new ref. */
    const resolved = (): void => {
      for (const mount of mounts.values()) {
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
      state: {
        init: (_, state) => build(state),
        apply: (tr, set, oldState, state) => (tr.docChanged || tr.selectionSet ? update(set, tr, oldState, state) : set),
      },
      props: {
        decorations: (state) => boardEmbedKey.getState(state),
        handleKeyDown: (view, event) => {
          const id = selectedId(view.state)
          const mount = id === null ? undefined : byId.get(id)
          if (mount === undefined || event.metaKey || event.ctrlKey || event.altKey) return false
          // Escape first deselects the window (item 20): the caret goes after the embed.
          if (event.key === 'Escape') {
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.selection.to)))
            return true
          }
          // Shift+1 fits the board (D10), as in the board's own tab: never a typed "!" over the embed.
          if (event.key === '!' && event.shiftKey && mount.handle !== null) {
            mount.handle.fit()
            return true
          }
          return false
        },
      },
      view: (editorView) => {
        let editable = editorView.editable
        let selected: number | null = null
        let folds = embedFolds(editorView.state)
        const offSource = opts.source.subscribe(resolved)
        const offViewOnly = opts.viewOnly?.subscribe(resolved)
        /** Each window's fold, from the outline's state: only when that state changed. */
        const syncFolds = () => {
          for (const mount of mounts.values()) {
            const pos = mount.getPos()
            const entry = pos === undefined ? undefined : folds.get(pos)
            const next = { foldable: entry !== undefined, folded: entry?.folded === true }
            if (next.foldable !== mount.fold.foldable) mount.handle?.setFoldable(next.foldable)
            if (next.folded !== mount.fold.folded) mount.handle?.setFolded(next.folded)
            mount.fold = next
          }
        }
        // The view drew the boxes before it made this plugin view: their first fold.
        syncFolds()
        return {
          update: (view, previous) => {
            if (view.state.doc !== previous.doc) closeMenu()
            // New options for the windows of the embeds scanned again (a view write, an outside edit, an undo).
            for (const fact of pending.values()) {
              const mount = byId.get(fact.id)
              if (mount === undefined) continue
              mount.inner = fact.inner
              if (mount.options !== fact.options) {
                mount.options = fact.options
                mount.handle?.update({ options: parseOptions(fact.options) })
              }
            }
            pending.clear()
            if (view.editable !== editable) {
              editable = view.editable
              for (const mount of mounts.values()) mount.handle?.update({ editable })
            }
            const now = selectedId(view.state)
            if (now !== selected) {
              const before = selected === null ? undefined : byId.get(selected)
              if (before !== undefined) {
                before.selected = false
                before.handle?.setSelected(false)
              }
              selected = now
              const after = now === null ? undefined : byId.get(now)
              if (after !== undefined) {
                after.selected = true
                after.handle?.setSelected(true)
              }
            }
            const nextFolds = embedFolds(view.state)
            if (nextFolds !== folds) {
              folds = nextFolds
              syncFolds()
            }
          },
          destroy: () => {
            offSource()
            offViewOnly?.()
            closeMenu()
          },
        }
      },
    })
  })
}
