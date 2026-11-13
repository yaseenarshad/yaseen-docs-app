/**
 * The note card block in the page (YAZ-4961, decisions D1, D9, D13, D16 on YAZ-4948): a ```` ```card ```` code block,
 * drawn read-only as a card. A NODE VIEW on `code_block` (CONTRACTS rule 30: a node the schema has) for the language
 * `card` only; every other code block gets Crepe's own view from Crepe's own factory, untouched.
 *
 * Why not Crepe's code-block preview (`renderPreview`): its panel sanitises with a private DOMPurify that drops
 * `app://` image sources and every listener, it draws only once the block's CodeMirror is made (off the screen a
 * block shows its raw text), and it draws again only on a text change. "Finding (agent)" on YAZ-4961.
 *
 * THE CARD: a head (the card ID first, small and grey, a click copies it, D20; "Review off" when the line says `off`;
 * the chip "Up next ×" when it says `next`, YAZ-4999 D3 — its × removes the mark; Edit card; ⋯) and the sides, `renderNoteCard` (the Inbox's function too). The head does not repeat the card's first
 * line: the text is right below it (say each thing once). Hidden words show highlighted (idea 21 is later). A
 * `[[link]]` is the page's pill: a click opens it in Explore, a bound gesture (⌘-click by default) in a tab, as the
 * note's links (`noteCardLinkWhere`). Images resolve as the note's do (`imageSrc`). On an index change only the pills
 * draw again (`refreshNoteCardLook`). In a vault that gives no IDs a ```` ```card ```` block is a code block (D8).

 * READ ONLY (a read-only page or vault): the card's TEXT is locked — no Edit card — but its review is not. The ⋯
 * menu's Turn review off / on and Reset history write the card line to the FILE (`changeCardLine`, the app's own
 * write), as the Inbox does; the open page takes it quietly.
 *
 * EDIT CARD (idea 8, idea 25): Crepe's own `CodeMirrorBlock`, made only then, from Crepe's factory in `nodeViewCtx`,
 * so the code editor, its keys, theme and extensions are every code block's; the `card` language is Markdown with
 * spell check (`noteCardLanguage`). "Done" (or Esc in the editor) destroys it and draws the card again. A card that
 * is not being edited has no CodeMirror at all, and a caret that arrives in its text becomes the card's node
 * selection (`noteCardSelection`), so no key types into text that does not show.
 *
 * OPEN CARD (D13): the ⋯ menu's "Open card", or ⌘↵ with the card selected or the caret in it. The editor sends ONE
 * bubbling DOM event, `NOTE_CARD_OPEN` (`mdapp:note-card-open`, detail `NoteCardOpenRequest`), from its
 * `.ProseMirror`; App's listener opens the card window. ⌘↵ anywhere else is unchanged.
 *
 * THE ⋯ MENU (D13): Put at top of Inbox / Remove from top of Inbox (`withCardNext`, YAZ-4999 D3), Turn review off /
 * on (`withCardOff`), Reset history (`withoutCardReviews`), Copy card ID, Open card. Each change is ONE transaction on the node's `cardLine` attribute (`changeNoteCardLine`): one ⌘Z, saved as
 * any edit. The ID at insert (`noteCardRow`) is a transaction out of the undo history, saved by `NOTE_CARD_ID_META`.
 */
import { Prec, type Extension } from '@codemirror/state'
import { isHistoryTransaction } from '@milkdown/kit/prose/history'
import { ReplaceAroundStep, ReplaceStep } from '@milkdown/kit/prose/transform'
import type { Fragment } from '@milkdown/kit/prose/model'
import { EditorView as CodeMirrorView, keymap } from '@codemirror/view'
import { LanguageDescription, LanguageSupport } from '@codemirror/language'
import { commandsCtx, editorViewCtx, nodeViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState } from '@milkdown/kit/prose/state'
import type { Decoration, DecorationSource, EditorView, NodeView, NodeViewConstructor } from '@milkdown/kit/prose/view'
import { clearTextInCurrentBlockCommand, setBlockTypeCommand } from '@milkdown/kit/preset/commonmark'
import { $prose, $shortcut, $view } from '@milkdown/kit/utils'
import { cardIdOf, cardReviewsOf, formatCardLine, isCardNext, isCardOff, settleCardCopy, withCardId, withCardNext, withCardOff, withoutCardId, withoutCardReviews, type CardLine } from '@shared/cardLine'
import type { HotkeyOverrides } from '@shared/hotkeyBindings'
import { codeWidthSchema } from '../code/codeWidth'
import { copyText, openMenuAt } from '../linkMenu'
import type { MenuRow } from '../blockHandleMenu'
import type { SlashRow } from '../slashMenu'
import type { LinkFollow } from '../wikilink/wikilinkClick'
import { CardLineStep, changeNoteCardLine, isNoteCardNode, NOTE_CARD_LANGUAGE, noteCardLineOf } from './noteCardLine'
import { NOTE_CARD_LINK_ATTR, noteCardLinkWhere, refreshNoteCardLook, renderNoteCard, type NoteCardLook } from './noteCardRender'
import './noteCard.css'

/** The open hook (D13): sent from the editor's `.ProseMirror`, it bubbles. App listens and opens the card window. */
export const NOTE_CARD_OPEN = 'mdapp:note-card-open'
export interface NoteCardOpenRequest {
  /** The page's absolute path, or null in a preview that does not know it. */
  path: string | null
  /** The card's ID, or null before it has one. */
  cardId: string | null
  /** The card's place among the page's cards (`pageCards` order, 0 first): finds a card with no ID yet. */
  index: number
}

/** On the transaction that puts the ID of a new card (out of the undo history): the editor saves it all the same. */
export const NOTE_CARD_ID_META = 'mdapp-note-card-id'

/** What the host gives the note cards of one editor (`createCrepe({ noteCards })`). Absent → no "Note card" row. */
export interface NoteCardHost {
  /** The page's absolute path: the open hook's `path`, and the vault the ID door counts in. */
  path: string
  /** The vault's ID door (`takeNoteId`, `views/scaffold.ts`): a new card takes its ID at once. Absent → the sweep gives it. */
  mintId?: (path: string) => Promise<string>
}

/** What a card view needs of its editor, made once in `createCrepe`. */
export interface NoteCardDeps {
  host?: NoteCardHost
  /** The page's path when the host gives no `host` (a read layer's image options). */
  path?: string | null
  /** Does the vault give IDs? False: a ```` ```card ```` block is a code block (D8). Absent: it does. */
  ids?: () => boolean
  /** A card line change written to the page's FILE (read only: the card's review is not locked). Absent: none. */
  writeLine?: (path: string, id: string, change: (line: CardLine) => CardLine, index: number) => Promise<unknown>
  /** The link pills' labels and icons, and the images' URLs. */
  look: () => NoteCardLook
  /** Wakes the cards when the index changes: their pills draw again. */
  subscribe?: (listener: () => void) => () => void
  /** The editor's one link follower; absent in a preview with no doors. */
  follow?: LinkFollow
  hotkeys?: () => HotkeyOverrides | undefined
  /** A Markdown link's open (`markdownLinkNav`). Absent → a click on it does nothing. */
  openHref?: (href: string) => void
  onNotice?: (message: string) => void
}

const views = new WeakMap<HTMLElement, NoteCardView>()

/** The card view that draws the card at `pos` in `view`, or null. */
export function noteCardViewAt(view: EditorView, pos: number): NoteCardView | null {
  const dom = view.nodeDOM(pos)
  return dom instanceof HTMLElement ? (views.get(dom) ?? null) : null
}

/** The card's place among the page's cards, as `pageCards` counts them (a card inside another code block is none: it is text). */
function cardIndex(doc: ProseNode, pos: number): number {
  let index = 0
  let found = -1
  doc.descendants((node, at) => {
    if (found >= 0) return false
    if (isNoteCardNode(node)) {
      if (at === pos) found = index
      index++
      return false
    }
    return !node.isTextblock
  })
  return Math.max(0, found)
}

/** Sends the open hook for the card at `pos` (D13). */
function openNoteCard(view: EditorView, pos: number, path: string | null): void {
  const node = view.state.doc.nodeAt(pos)
  if (node === null || !isNoteCardNode(node)) return
  const detail: NoteCardOpenRequest = { path, cardId: cardIdOf(noteCardLineOf(node)), index: cardIndex(view.state.doc, pos) }
  view.dom.dispatchEvent(new CustomEvent<NoteCardOpenRequest>(NOTE_CARD_OPEN, { bubbles: true, detail }))
}

const button = (className: string, label: string, text: string): HTMLButtonElement => {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = className
  b.setAttribute('aria-label', label)
  b.textContent = text
  return b
}

export class NoteCardView implements NodeView {
  dom: HTMLElement
  /** The card ID, first in the head (D20): a click copies it. Hidden while the card has none. */
  private readonly idButton: HTMLButtonElement
  private readonly state: HTMLElement
  /** The "Up next" chip (YAZ-4999 D3): shown while the line holds `next`; its × removes the mark. */
  private readonly next: HTMLElement
  private readonly editButton: HTMLButtonElement
  private readonly more: HTMLButtonElement
  private readonly body: HTMLElement
  /** Crepe's code block while the card is edited, else null. */
  private code: NodeView | null = null
  /** What the body last drew: redrawn only when it changes. */
  private drawn: string | null = null
  private readonly unsubscribe: (() => void) | undefined
  private closeMenu: (() => void) | null = null

  constructor(
    private node: ProseNode,
    readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly deps: NoteCardDeps,
    private readonly makeCode: ((node: ProseNode) => NodeView) | null,
  ) {
    this.dom = document.createElement('div')
    this.dom.className = 'note-card'
    const head = document.createElement('div')
    head.className = 'note-card__head'
    this.idButton = button('note-card__id', 'Copy card ID', '')
    this.state = document.createElement('span')
    this.state.className = 'note-card__state'
    this.next = document.createElement('span')
    this.next.className = 'note-card__next'
    this.next.append('Up next', button('note-card__next-remove', 'Remove from top of Inbox', '×'))
    this.editButton = button('note-card__edit', 'Edit card', 'Edit card')
    this.more = button('note-card__more', 'Card menu', '⋯')
    head.append(this.idButton, this.state, this.next, this.editButton, this.more)
    this.body = document.createElement('div')
    this.body.className = 'note-card__body'
    this.dom.append(head, this.body)
    this.dom.addEventListener('mousedown', this.onMouseDown)
    this.dom.addEventListener('click', this.onClick)
    this.dom.addEventListener('dblclick', this.onDoubleClick)
    views.set(this.dom, this)
    this.draw()
    this.unsubscribe = deps.subscribe?.(() => {
      // An index change redraws only the pills of a card with a link: no Markdown render again.
      if (this.code === null && this.node.textContent.includes('[[')) refreshNoteCardLook(this.body, this.deps.look())
    })
  }

  get editing(): boolean {
    return this.code !== null
  }

  private get pos(): number | null {
    return this.getPos() ?? null
  }

  private get path(): string | null {
    return this.deps.host?.path ?? this.deps.path ?? null
  }

  /** The head and, while the card is not edited, the body (drawn again only when the text changed). */
  private draw(): void {
    const text = this.node.textContent
    const line = noteCardLineOf(this.node)
    const id = cardIdOf(line)
    this.idButton.textContent = id ?? ''
    this.idButton.hidden = id === null
    this.state.textContent = isCardOff(line) ? 'Review off' : ''
    this.dom.classList.toggle('note-card--off', isCardOff(line))
    this.next.hidden = !isCardNext(line)
    this.editButton.textContent = this.code === null ? 'Edit card' : 'Done'
    this.editButton.setAttribute('aria-label', this.code === null ? 'Edit card' : 'Done')
    this.dom.classList.toggle('note-card--editing', this.code !== null)
    if (this.code !== null || this.drawn === text) return
    this.drawn = text
    this.body.replaceChildren(text.trim() === '' ? this.emptyHint() : renderNoteCard(text, {}, this.deps.look()))
  }

  private emptyHint(): HTMLElement {
    const hint = document.createElement('div')
    hint.className = 'note-card__empty'
    hint.textContent = 'Empty card. Write the front, then --- and the back.'
    return hint
  }

  /** "Edit card": Crepe's code block in the card, the caret at the end of its text. */
  edit(): void {
    const pos = this.pos
    if (this.code !== null || this.makeCode === null || pos === null || !this.view.editable) return
    this.code = this.makeCode(this.node)
    this.code.dom.classList.add('note-card__code')
    this.dom.append(this.code.dom)
    this.draw()
    const end = pos + 1 + this.node.content.size
    this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, end)).scrollIntoView())
    // ProseMirror hands the caret to the view (`setSelection`), which makes CodeMirror and focuses it.
    this.code.setSelection?.(this.node.content.size, this.node.content.size, this.view.root)
  }

  /** "Done": the card drawn again, selected. */
  done(): void {
    if (this.code === null) return
    this.code.destroy?.()
    this.code.dom.remove()
    this.code = null
    this.draw()
    const pos = this.pos
    if (pos === null) return
    this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)))
    this.view.focus()
  }

  private select(): void {
    const pos = this.pos
    if (pos === null) return
    this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)))
    this.view.focus()
  }

  /** Sends the open hook for this card (D13). */
  open(): void {
    const pos = this.pos
    if (pos !== null) openNoteCard(this.view, pos, this.path)
  }

  /**
   * One change of the card line: a transaction (one ⌘Z) in a page that can be edited; in a read-only page a write to
   * the file (`deps.writeLine`), which the page takes quietly — read only locks the card's text, not its review.
   */
  private change(change: Parameters<typeof changeNoteCardLine>[2]): void {
    const pos = this.pos
    if (pos === null) return
    if (this.view.editable) {
      const tr = changeNoteCardLine(this.view.state, pos, change)
      if (tr !== null) this.view.dispatch(tr)
      return
    }
    const id = cardIdOf(noteCardLineOf(this.node))
    const path = this.path
    if (id === null || path === null || this.deps.writeLine === undefined) return
    this.deps.writeLine(path, id, change, cardIndex(this.view.state.doc, pos)).catch((err: unknown) => this.deps.onNotice?.(`Can't change the card: ${err instanceof Error ? err.message : String(err)}`))
  }

  /** Can the ⋯ menu change the card line? In an editable page, yes; read only, through the file, for a card with an ID. */
  private get canChangeLine(): boolean {
    return this.view.editable || (cardIdOf(noteCardLineOf(this.node)) !== null && this.path !== null && this.deps.writeLine !== undefined)
  }

  /** The ID the door gave this new card, unless it has one by now. Out of the undo history; saved by `NOTE_CARD_ID_META`. */
  takeId(id: string): void {
    const pos = this.pos
    if (pos === null || this.view.isDestroyed) return
    const tr = changeNoteCardLine(this.view.state, pos, (line) => (cardIdOf(line) === null ? withCardId(line, id) : line))
    if (tr !== null) this.view.dispatch(tr.setMeta('addToHistory', false).setMeta(NOTE_CARD_ID_META, true))
  }

  /** The ⋯ menu's rows (D13). */
  menuRows(): MenuRow[] {
    const line = noteCardLineOf(this.node)
    const id = cardIdOf(line)
    const editable = this.canChangeLine
    const onNotice = this.deps.onNotice ?? (() => {})
    return [
      { label: 'Open card', hint: '⌘↵', run: () => this.open() },
      { label: isCardNext(line) ? 'Remove from top of Inbox' : 'Put at top of Inbox', disabled: !editable, divider: true, run: () => this.change((l) => withCardNext(l, !isCardNext(l))) },
      { label: isCardOff(line) ? 'Turn review on' : 'Turn review off', disabled: !editable, run: () => this.change((l) => withCardOff(l, !isCardOff(l))) },
      { label: 'Reset history', disabled: !editable || cardReviewsOf(line).length === 0, danger: true, run: () => this.change(withoutCardReviews) },
      { label: 'Copy card ID', disabled: id === null, divider: true, run: () => id !== null && copyText(id, 'card ID', onNotice, undefined, true) },
    ]
  }

  private openMenu(): void {
    this.closeMenu?.()
    const rect = this.more.getBoundingClientRect()
    const close = openMenuAt(this.view.dom.parentElement ?? document.body, rect.left, rect.bottom + 4, this.menuRows())
    this.closeMenu = () => {
      close()
      this.closeMenu = null
    }
  }

  private onMouseDown = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null
    // CodeMirror's own presses while the card is edited.
    if (target === null || event.button !== 0 || (this.code !== null && this.code.dom.contains(target))) return
    if (target.closest('.note-card__more') !== null) {
      event.preventDefault()
      this.openMenu()
      return
    }
    if (target.closest('.note-card__next-remove') !== null) {
      event.preventDefault()
      if (this.canChangeLine) this.change((l) => withCardNext(l, false))
      return
    }
    if (target.closest('.note-card__edit') !== null) {
      event.preventDefault()
      if (this.code === null) this.edit()
      else this.done()
      return
    }
    if (target.closest('.note-card__id') !== null) {
      event.preventDefault()
      const id = cardIdOf(noteCardLineOf(this.node))
      if (id !== null) copyText(id, 'card ID', this.deps.onNotice ?? (() => {}), undefined, true)
      return
    }
    const pill = target.closest<HTMLElement>(`[${NOTE_CARD_LINK_ATTR}]`)
    if (pill !== null && this.deps.follow !== undefined) {
      const where = noteCardLinkWhere(event, this.deps.hotkeys?.())
      event.preventDefault()
      if (where !== null) this.deps.follow(pill.getAttribute(NOTE_CARD_LINK_ATTR) ?? '', where)
      return
    }
    if (target.closest('a[href]') !== null) return
    // A press on the card selects it whole: ⌘↵ opens it, Delete removes it.
    event.preventDefault()
    this.select()
  }

  /** A Markdown link never navigates the window: it opens as the note's links do. */
  private onClick = (event: MouseEvent): void => {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('.note-card__body a[href]') : null
    if (link === null) return
    event.preventDefault()
    this.deps.openHref?.(link.getAttribute('href') ?? '')
  }

  private onDoubleClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('.note-card__body') == null || target.closest(`[${NOTE_CARD_LINK_ATTR}], a[href]`) !== null) return
    event.preventDefault()
    this.edit()
  }

  update(node: ProseNode, decorations: readonly Decoration[], inner: DecorationSource): boolean {
    if (!isNoteCardNode(node)) return false
    this.node = node
    if (this.code !== null && this.code.update?.(node, decorations, inner) === false) return false
    this.draw()
    return true
  }

  setSelection(anchor: number, head: number, root: Document | ShadowRoot): void {
    // Not edited: `noteCardSelection` turns the caret into the card's selection; nothing to place here.
    this.code?.setSelection?.(anchor, head, root)
  }

  selectNode(): void {
    if (this.code !== null) this.code.selectNode?.()
    else this.dom.classList.add('ProseMirror-selectednode')
  }

  deselectNode(): void {
    this.code?.deselectNode?.()
    this.dom.classList.remove('ProseMirror-selectednode')
  }

  stopEvent(): boolean {
    return true
  }

  ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: Node }): boolean {
    // The card's own drawing never reaches ProseMirror; CodeMirror's selection does, as in a code block.
    return this.code === null || !this.code.dom.contains(mutation.target) || mutation.type !== 'selection'
  }

  destroy(): void {
    this.closeMenu?.()
    this.unsubscribe?.()
    this.code?.destroy?.()
    views.delete(this.dom)
  }
}

/** The code block's node view: a card for the language `card`, else Crepe's own, unchanged. */
function noteCardNodeView(deps: NoteCardDeps) {
  const view = $view(codeWidthSchema.node, (ctx: Ctx): NodeViewConstructor => {
    const ours: NodeViewConstructor = (node, editor, getPos, decorations, inner) => {
      // Crepe's factory, registered before this one (`Object.fromEntries` takes the last, ours).
      const crepe = ctx.get(nodeViewCtx).find(([id, make]) => id === 'code_block' && make !== ours)?.[1] ?? null
      // A vault that gives no IDs has no cards (D8): its ```card block is a code block, as the index reads it.
      if (!isNoteCardNode(node) || deps.ids?.() === false) return crepe === null ? (undefined as unknown as NodeView) : crepe(node, editor, getPos, decorations, inner)
      const makeCode = crepe === null ? null : (n: ProseNode) => crepe(n, editor, getPos, decorations, inner)
      return new NoteCardView(node, editor, getPos, deps, makeCode)
    }
    return ours
  })
  return view
}

/**
 * A caret that lands in the text of a card that is not being edited (an arrow key, a find) becomes the card's node
 * selection: the text does not show, so nothing may type into it.
 */
function noteCardSelection() {
  let editor: EditorView | null = null
  return $prose(
    () =>
      new Plugin({
        key: new PluginKey('mdapp-note-card-selection'),
        view: (view) => {
          editor = view
          return { destroy: () => (editor = null) }
        },
        appendTransaction: (trs, _old, state: EditorState) => {
          if (editor === null || !trs.some((tr) => tr.selectionSet)) return null
          const { selection } = state
          if (!(selection instanceof TextSelection)) return null
          const { $from, $to } = selection
          if (!isNoteCardNode($from.parent) || $to.parent !== $from.parent) return null
          const pos = $from.before()
          const card = noteCardViewAt(editor, pos)
          if (card === null || card.editing) return null
          return state.tr.setSelection(NodeSelection.create(state.doc, pos))
        },
      }),
  )
}

/**
 * A key on a SELECTED card (YAZ-5006): ProseMirror replaces a selected node with what is typed, so one letter took the
 * card and its review history away. A typed character, a paste and an IME composition do nothing to a selected card;
 * Enter is Edit card. Backspace / Delete, cut, a drag and the arrows stay ProseMirror's, as for any block (⌘Z undoes).
 */
function noteCardKeyGuard() {
  const selected = (state: EditorState): number | null => {
    const { selection } = state
    return selection instanceof NodeSelection && isNoteCardNode(selection.node) ? selection.from : null
  }
  return $prose(
    () =>
      new Plugin({
        key: new PluginKey('mdapp-note-card-key-guard'),
        // A composition's change is read from the page after the fact: refused while a card is selected.
        filterTransaction: (tr, state) => !(tr.docChanged && tr.getMeta('composition') !== undefined && selected(state) !== null),
        props: {
          handleTextInput: (view) => selected(view.state) !== null,
          // The page's paste props are direct editor props (`clipboardPaste.ts`) and run before a plugin's `handlePaste`.
          handleDOMEvents: {
            paste: (view, event) => {
              if (selected(view.state) === null) return false
              event.preventDefault()
              return true
            },
          },
          handleKeyDown: (view, event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey || event.isComposing) return false
            const pos = selected(view.state)
            if (pos === null) return false
            noteCardViewAt(view, pos)?.edit()
            return true
          },
        },
      }),
  )
}

/** The card at the selection: the card selected, or the caret in its text. */
function cardAtSelection(state: EditorState): number | null {
  const { selection } = state
  if (selection instanceof NodeSelection) return isNoteCardNode(selection.node) ? selection.from : null
  const { $from } = selection
  return isNoteCardNode($from.parent) ? $from.before() : null
}

/** ⌘↵ on a card opens it (D13): above the table's and the embed's ⌘↵ (200, 210); anywhere else it declines. */
function noteCardKeys(deps: NoteCardDeps) {
  return $shortcut(() => ({
    OpenNoteCard: {
      key: 'Mod-Enter',
      priority: 220,
      onRun: () => (state, _dispatch, view) => {
        const pos = cardAtSelection(state)
        if (pos === null || view === undefined) return false
        openNoteCard(view, pos, deps.host?.path ?? deps.path ?? null)
        return true
      },
    },
  }))
}

/** The card whose editor `cm` is, or null for any other code block. */
const cardOfCodeMirror = (cm: CodeMirrorView): NoteCardView | null => {
  const dom = cm.dom.closest<HTMLElement>('.note-card')
  return dom === null ? null : (views.get(dom) ?? null)
}

/**
 * In every code block's CodeMirror (`createCrepe.ts`), highest: in a card's editor ⌘↵ opens the card (before
 * `addLineCodeKeys` and Crepe's exit-code) and Esc is "Done". In any other code block both decline.
 */
export const noteCardCodeKeys: Extension = Prec.highest(
  keymap.of([
    {
      key: 'Mod-Enter',
      run: (cm) => {
        const card = cardOfCodeMirror(cm)
        card?.open()
        return card !== null
      },
    },
    {
      key: 'Escape',
      run: (cm) => {
        const card = cardOfCodeMirror(cm)
        card?.done()
        return card !== null
      },
    },
  ]),
)

/**
 * The `card` language of the code editor (idea 8): Markdown highlighting, and the spell check a code block does not
 * have. Joins Crepe's language list (`createCrepe.ts`), so only a card's editor loads it. No setext headings: in a card
 * `---` splits the sides (D10), so the front line above it is no heading — only a `#` line is one.
 */
export const noteCardLanguage = LanguageDescription.of({
  name: 'Note card',
  alias: [NOTE_CARD_LANGUAGE],
  load: async () => {
    // Edit card's own extensions (YAZ-5007 no marks on other copies of a word, YAZ-5008 ⌘L), loaded with the language.
    const [{ markdown }, { noteCardEditExtensions }] = await Promise.all([import('@codemirror/lang-markdown'), import('./noteCardEdit')])
    const md = markdown({ extensions: { remove: ['SetextHeading'] } })
    return new LanguageSupport(md.language, [md.support, CodeMirrorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'on' }), noteCardEditExtensions])
  },
})

/** The words the slash filter finds "Note card" by, besides its label (idea 9). */
const NOTE_CARD_KEYWORDS = ['card', 'notecard', 'flashcard']

/**
 * The "Note card" slash row (D1, idea 9): the `/query` cleared, the line made an empty card, and the card edited at
 * once. The card takes its ID now (the coordinator's decision on YAZ-4961): when the door answers, ONE transaction out
 * of the undo history puts `<!-- card: WIKI-512 -->` on it, so ⌘Z removes the card in one step. No answer: the sweep
 * gives the ID later.
 */
export function noteCardRow(host: NoteCardHost): SlashRow {
  return {
    label: 'Note card',
    icon: NOTE_CARD_ICON,
    keywords: NOTE_CARD_KEYWORDS,
    onRun: (ctx) => {
      const commands = ctx.get(commandsCtx)
      commands.call(clearTextInCurrentBlockCommand.key)
      const view = ctx.get(editorViewCtx)
      commands.call(setBlockTypeCommand.key, { nodeType: codeWidthSchema.type(ctx), attrs: { language: NOTE_CARD_LANGUAGE } })
      const { $from } = view.state.selection
      if (!isNoteCardNode($from.parent)) return
      const card = noteCardViewAt(view, $from.before())
      card?.edit()
      if (card === null || host.mintId === undefined) return
      host.mintId(host.path).then(
        (id) => card.takeId(id),
        () => {
          // No ID now (a vault that stopped giving them, a door that failed): the sweep gives it.
        },
      )
    },
  }
}

/** A card with a fold line, drawn to match the stock 24px items. */
const NOTE_CARD_ICON = `
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
    <path d="M5 4H19C20.1 4 21 4.9 21 6V18C21 19.1 20.1 20 19 20H5C3.9 20 3 19.1 3 18V6C3 4.9 3.9 4 5 4ZM5 6V11H19V6H5ZM5 13V18H19V13H5ZM7 7.5H14V9.5H7V7.5ZM7 14.5H12V16.5H7V14.5Z" />
  </svg>
`

/** Does `content` hold a note card that has an ID? A cheap look at what a step inserts. */
function holdsCardWithId(content: Fragment): boolean {
  let found = false
  content.descendants((node) => {
    if (found) return false
    if (isNoteCardNode(node)) {
      found = cardIdOf(noteCardLineOf(node)) !== null
      return false
    }
    return !node.isTextblock
  })
  return found
}

/** `EXTERNAL_EDIT_META` of `external/applyExternalMarkdown.ts` (that module imports `createCrepe`, which imports this one). */
const EXTERNAL_EDIT_META = 'external-edit'

/**
 * THE COPY RULE IN THE PAGE (YAZ-4972): a card that a user edit INSERTS (a paste, a drop, Alt-drag) while another card
 * of the page holds its ID is the copy — it loses its ID and its history in the same transaction, and asks the vault's
 * door for a new ID (`host.mintId`, as `/card` does; no door: the sweep gives one). Which card is the copy is known
 * here, not by its place: the card the page already held keeps its ID and history, above or below. A move (cut and
 * paste, a drag) adds no holder of the ID, so it keeps its ID and history — also when an agent's copy of the card, not
 * yet swept, holds the ID too (YAZ-4993: that copy's line can be older, so emptying the moved card could drop a review).
 * Only as many inserted cards are copies as the edit adds holders of the ID. An outside write and ⌘Z / ⇧⌘Z are not
 * user inserts: the sweep's rule settles an agent's copy, and never drops a review.
 *
 * NO REVIEW IS DROPPED (YAZ-4998): a copy is settled by the one no-drop rule (`settleCardCopy`). The card the page
 * already held keeps the ID. With its text, it takes each review of the copy that it lacks, in the SAME transaction (one
 * ⌘Z undoes the paste and the union), and only then does the copy's history empty. With another text, the copy keeps its
 * history. So a cut and a paste of the original beside an agent's older copy (two dispatches: the paste "adds a
 * holder") loses no review: the agent's copy takes the original's reviews, or the original keeps them.
 */
function noteCardCopies(deps: NoteCardDeps) {
  /** Positions of copies that wait for a new ID from the door, set by `appendTransaction`, taken by the plugin view. */
  let asking: number[] = []
  return $prose(
    () =>
      new Plugin({
        key: new PluginKey('mdapp-note-card-copies'),
        appendTransaction: (trs, old, state) => {
          const inserted: Array<{ from: number; to: number }> = []
          for (const tr of trs) {
            if (!tr.docChanged || tr.getMeta(EXTERNAL_EDIT_META) === true || tr.getMeta(NOTE_CARD_ID_META) === true || isHistoryTransaction(tr)) continue
            tr.steps.forEach((step, i) => {
              if (!(step instanceof ReplaceStep || step instanceof ReplaceAroundStep) || !holdsCardWithId(step.slice.content)) return
              const from = (step as ReplaceStep).from
              // Where the inserted content is in the final doc: through the rest of this transaction and the later ones.
              const after = (pos: number, assoc: number) => {
                let at = tr.mapping.slice(i + 1).map(pos, assoc)
                for (const later of trs.slice(trs.indexOf(tr) + 1)) at = later.mapping.map(at, assoc)
                return at
              }
              inserted.push({ from: after(from, -1), to: after(from + step.slice.size, 1) })
            })
          }
          if (inserted.length === 0) return null
          const isNew = (pos: number) => inserted.some((r) => pos >= r.from && pos < r.to)
          /** Each ID the page holds, with the card that keeps it: the first card the page held before the edit. */
          const keepers = new Map<string, number>()
          const fresh: Array<{ pos: number; id: string }> = []
          state.doc.descendants((node, pos) => {
            if (isNoteCardNode(node)) {
              const id = cardIdOf(noteCardLineOf(node))
              if (id !== null) {
                if (isNew(pos)) fresh.push({ pos, id })
                else if (!keepers.has(id)) keepers.set(id, pos)
              }
              return false
            }
            return !node.isTextblock
          })
          // How many more cards hold each ID than before the edit: only that many inserted cards are copies. A move of a
          // card while an unswept copy of it sits on the page (YAZ-4993) adds none, so the moved card keeps its history.
          const more = new Map<string, number>()
          const count = (doc: typeof state.doc, sign: number) =>
            doc.descendants((node) => {
              if (isNoteCardNode(node)) {
                const id = cardIdOf(noteCardLineOf(node))
                if (id !== null && fresh.some((f) => f.id === id)) more.set(id, (more.get(id) ?? 0) + sign)
                return false
              }
              return !node.isTextblock
            })
          count(state.doc, 1)
          count(old.doc, -1)
          const tr = state.tr
          const copies: number[] = []
          /** The keepers' lines as the copies' reviews reach them, by position; written once, after the copies. */
          const unions = new Map<number, CardLine>()
          for (const { pos, id } of fresh) {
            const at = keepers.get(id)
            if (at === undefined) {
              // An ID no other card of the page holds (a cut from another page): this card keeps it.
              keepers.set(id, pos)
              continue
            }
            if ((more.get(id) ?? 0) <= 0) continue
            more.set(id, more.get(id)! - 1)
            const node = state.doc.nodeAt(pos)!
            const keeper = state.doc.nodeAt(at)!
            const line = noteCardLineOf(node)
            const settled = settleCardCopy({ line: unions.get(at) ?? noteCardLineOf(keeper), text: keeper.textContent }, { line, text: node.textContent })
            if (settled.keeper !== null) unions.set(at, settled.keeper)
            tr.step(new CardLineStep(pos, formatCardLine(line), formatCardLine(withoutCardId(settled.copy))))
            copies.push(pos)
          }
          // The union lands on each keeper in this same transaction: the copy never empties before its reviews are there.
          for (const [at, line] of unions) {
            const before = noteCardLineOf(state.doc.nodeAt(at)!)
            if (formatCardLine(line) !== formatCardLine(before)) tr.step(new CardLineStep(at, formatCardLine(before), formatCardLine(line)))
          }
          if (copies.length === 0) return null
          if (deps.host?.mintId !== undefined) asking = [...asking, ...copies]
          return tr
        },
        view: () => ({
          update: (view) => {
            const host = deps.host
            if (asking.length === 0 || host?.mintId === undefined) return
            const cards = asking.flatMap((pos) => noteCardViewAt(view, pos) ?? [])
            asking = []
            for (const card of cards)
              host.mintId(host.path).then(
                (id) => card.takeId(id),
                () => {
                  // No ID now: the sweep gives it.
                },
              )
          },
        }),
      }),
  )
}

/** The card's plugins for one editor (`createCrepe`): its view, the caret rule, the copy rule, ⌘↵. */
export function noteCardPlugins(deps: NoteCardDeps) {
  return [noteCardNodeView(deps), noteCardSelection(), noteCardKeyGuard(), noteCardCopies(deps), noteCardKeys(deps)].flat()
}
