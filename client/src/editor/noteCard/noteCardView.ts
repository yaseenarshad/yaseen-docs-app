/**
 * The note card block in the page (YAZ-4961, decisions D1, D9, D13, D16 on YAZ-4948): a ```` ```card ```` code block,
 * drawn read-only as a card. A NODE VIEW on `code_block` (CONTRACTS rule 30: a node the schema has) for the language
 * `card` only; every other code block gets Crepe's own view from Crepe's own factory, untouched.
 *
 * Why not Crepe's code-block preview (`renderPreview`): its panel sanitises with a private DOMPurify that drops
 * `app://` image sources and every listener, it draws only once the block's CodeMirror is made (off the screen a
 * block shows its raw text), and it draws again only on a text change. "Finding (agent)" on YAZ-4961.
 *
 * THE CARD: a head (the card title, `cardTitle`; the card ID small and grey, a click copies it, D20; "Review off" when
 * the line says `off`; Edit card; ⋯) and the sides,
 * `renderNoteCard` (the Inbox's function too). Hidden words show highlighted (idea 21 is later). A `[[link]]` is the
 * page's pill: a click opens it in Explore, a bound gesture (⌘-click by default) in a tab, as the note's links
 * (`linkClickAction`). Images resolve as the note's do (`imageSrc`). The pills follow the index live.
 *
 * EDIT CARD (idea 8, idea 25): Crepe's own `CodeMirrorBlock`, made only then, from Crepe's factory in `nodeViewCtx`,
 * so the code editor, its keys, theme and extensions are every code block's; the `card` language is Markdown with
 * spell check (`noteCardLanguage`). "Done" (or Esc in the editor) destroys it and draws the card again. A card that
 * is not being edited has no CodeMirror at all, and a caret that arrives in its text becomes the card's node
 * selection (`noteCardSelection`), so no key types into text that does not show.
 *
 * OPEN CARD (D13): a click on the head's title, the ⋯ menu's "Open card", or ⌘↵ with the card selected or the caret in
 * it. The card window is YAZ-4962: the editor sends ONE bubbling DOM event, `NOTE_CARD_OPEN` (`mdapp:note-card-open`,
 * detail `NoteCardOpenRequest`), from its `.ProseMirror`. Nobody listening is a no-op. ⌘↵ anywhere else is unchanged.
 *
 * THE ⋯ MENU (D13): Turn review off / on (`withCardOff`), Reset history (`withoutCardReviews`), Copy card ID, Open
 * card. Each change is ONE transaction on the node's `cardLine` attribute (`changeNoteCardLine`): one ⌘Z, saved as
 * any edit. The ID at insert (`noteCardRow`) is a transaction out of the undo history, saved by `NOTE_CARD_ID_META`.
 */
import { Prec, type Extension } from '@codemirror/state'
import { EditorView as CodeMirrorView, keymap } from '@codemirror/view'
import { LanguageDescription, LanguageSupport } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { commandsCtx, editorViewCtx, nodeViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState } from '@milkdown/kit/prose/state'
import type { Decoration, DecorationSource, EditorView, NodeView, NodeViewConstructor } from '@milkdown/kit/prose/view'
import { clearTextInCurrentBlockCommand, setBlockTypeCommand } from '@milkdown/kit/preset/commonmark'
import { $prose, $shortcut, $view } from '@milkdown/kit/utils'
import { cardIdOf, cardReviewsOf, isCardOff, withCardId, withCardOff, withoutCardReviews } from '@shared/cardLine'
import { cardTitle } from '@shared/cardText'
import type { HotkeyOverrides } from '@shared/hotkeyBindings'
import { codeWidthSchema } from '../code/codeWidth'
import { linkClickAction } from '../linkGesture'
import { copyText, openMenuAt } from '../linkMenu'
import type { MenuRow } from '../blockHandleMenu'
import type { SlashRow } from '../slashMenu'
import type { LinkFollow } from '../wikilink/wikilinkClick'
import { changeNoteCardLine, isNoteCardNode, NOTE_CARD_LANGUAGE, noteCardLineOf } from './noteCardLine'
import { NOTE_CARD_LINK_ATTR, renderNoteCard, type NoteCardLook } from './noteCardRender'
import './noteCard.css'

/** The open hook (D13): sent from the editor's `.ProseMirror`, it bubbles. The card window (YAZ-4962) listens. */
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
export function openNoteCard(view: EditorView, pos: number, path: string | null): void {
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
  private readonly title: HTMLButtonElement
  /** The card ID after the title (D20): a click copies it. Hidden while the card has none. */
  private readonly idButton: HTMLButtonElement
  private readonly state: HTMLElement
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
    this.title = button('note-card__title', 'Open card', '')
    this.title.title = 'Open card (⌘↵)'
    this.idButton = button('note-card__id', 'Copy card ID', '')
    this.idButton.title = 'Copy card ID'
    this.state = document.createElement('span')
    this.state.className = 'note-card__state'
    this.editButton = button('note-card__edit', 'Edit card', 'Edit card')
    this.more = button('note-card__more', 'Card menu', '⋯')
    head.append(this.title, this.idButton, this.state, this.editButton, this.more)
    this.body = document.createElement('div')
    this.body.className = 'note-card__body'
    this.dom.append(head, this.body)
    this.dom.addEventListener('mousedown', this.onMouseDown)
    this.dom.addEventListener('click', this.onClick)
    this.dom.addEventListener('dblclick', this.onDoubleClick)
    views.set(this.dom, this)
    this.draw()
    this.unsubscribe = deps.subscribe?.(() => {
      // Only a card with a link draws again when the index changes.
      if (this.code === null && this.node.textContent.includes('[[')) this.draw(true)
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

  /** The head and, while the card is not edited, the body. `force` draws the body again with the same text (the index changed). */
  private draw(force = false): void {
    const text = this.node.textContent
    const line = noteCardLineOf(this.node)
    const title = cardTitle(text)
    this.title.textContent = title === '' ? 'New note card' : title
    this.title.classList.toggle('note-card__title--empty', title === '')
    const id = cardIdOf(line)
    this.idButton.textContent = id ?? ''
    this.idButton.hidden = id === null
    this.state.textContent = isCardOff(line) ? 'Review off' : ''
    this.dom.classList.toggle('note-card--off', isCardOff(line))
    this.editButton.textContent = this.code === null ? 'Edit card' : 'Done'
    this.editButton.setAttribute('aria-label', this.code === null ? 'Edit card' : 'Done')
    this.dom.classList.toggle('note-card--editing', this.code !== null)
    if (this.code !== null || (!force && this.drawn === text)) return
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

  private change(change: Parameters<typeof changeNoteCardLine>[2]): void {
    const pos = this.pos
    const tr = pos === null ? null : changeNoteCardLine(this.view.state, pos, change)
    if (tr !== null) this.view.dispatch(tr)
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
    const editable = this.view.editable
    const onNotice = this.deps.onNotice ?? (() => {})
    return [
      { label: 'Open card', hint: '⌘↵', run: () => this.open() },
      { label: isCardOff(line) ? 'Turn review on' : 'Turn review off', disabled: !editable, divider: true, run: () => this.change((l) => withCardOff(l, !isCardOff(l))) },
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
    if (target.closest('.note-card__edit') !== null) {
      event.preventDefault()
      if (this.code === null) this.edit()
      else this.done()
      return
    }
    if (target.closest('.note-card__title') !== null) {
      event.preventDefault()
      this.open()
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
      // A plain click opens the page on top (Explore); a bound gesture (⌘-click) in a tab, as the note's links (idea 6).
      const where = linkClickAction({ editable: true }, event, this.deps.hotkeys?.()) ?? (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey ? null : 'explore')
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
      if (!isNoteCardNode(node)) return crepe === null ? (undefined as unknown as NodeView) : crepe(node, editor, getPos, decorations, inner)
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
 * have. Joins Crepe's language list (`createCrepe.ts`), so only a card's editor loads it.
 */
export const noteCardLanguage = LanguageDescription.of({
  name: 'Note card',
  alias: [NOTE_CARD_LANGUAGE],
  load: async () => {
    const md = await languages.find((l) => l.name === 'Markdown')!.load()
    return new LanguageSupport(md.language, [md.support, CodeMirrorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'on' })])
  },
})

/** The words the slash filter finds "Note card" by, besides its label (idea 9). */
export const NOTE_CARD_KEYWORDS = ['card', 'notecard', 'flashcard']

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

/** The card's plugins for one editor (`createCrepe`): its view, the caret rule, ⌘↵, and CodeMirror's way back to the editor. */
export function noteCardPlugins(deps: NoteCardDeps) {
  return [noteCardNodeView(deps), noteCardSelection(), noteCardKeys(deps)].flat()
}
