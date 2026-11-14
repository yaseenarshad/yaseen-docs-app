/**
 * The card block in the page (YAZ-4961, decisions D1, D9, D13, D16 on YAZ-4948): a ```` ```card ```` code block,
 * drawn read-only as a card. A NODE VIEW on `code_block` (CONTRACTS rule 30: a node the schema has) for the language
 * `card` only; every other code block gets Crepe's own view from Crepe's own factory, untouched.
 *
 * Why not Crepe's code-block preview (`renderPreview`): its panel sanitises with a private DOMPurify that drops
 * `app://` image sources and every listener, it draws only once the block's CodeMirror is made (off the screen a
 * block shows its raw text), and it draws again only on a text change. "Finding (agent)" on YAZ-4961.
 *
 * THE CARD: a head (the card ID first, small and grey, a click copies it, D20; "Archived" when the line says `off`, and the card muted, YAZ-5046;
 * the chip "Up next ×" when it says `next`, YAZ-4999 D3 — its × removes the mark; Edit card; ⋯) and the sides, `renderCard` (the Inbox's function too). The head does not repeat the card's first
 * line: the text is right below it (say each thing once). Hidden words show highlighted (idea 21 is later). A
 * `[[link]]` is the page's pill: a click opens it in Explore, a bound gesture (⌘-click by default) in a tab, as the
 * page's links (`cardLinkWhere`); a board's picture (YAZ-5015) opens the same way. A sound's player (YAZ-5014) takes
 * its own press: it plays, and selects no card. Images resolve as the page's do (`imageSrc`). On an index change only the pills
 * draw again (`refreshCardLook`). In a vault that gives no IDs a ```` ```card ```` block is a code block (D8).

 * READ ONLY (a read-only page or vault): the card's TEXT is locked — Edit card (its button, a double-click, Enter)
 * asks "Allow edits?" first, then opens (YAZ-5145); a preview has none — but its review is not. The ⋯
 * menu's Archive card / Unarchive card and Reset history write the card line to the FILE (`changeCardLine`, the app's own
 * write), as the Inbox does; the open page takes it quietly.
 *
 * EDIT CARD (idea 8, idea 25): Crepe's own `CodeMirrorBlock`, made only then, from Crepe's factory in `nodeViewCtx`,
 * so the code editor, its keys, theme and extensions are every code block's; the `card` language is Markdown with
 * spell check (`cardLanguage`). "Done" (or Esc, or ⌘↵ in the editor, YAZ-5001) destroys it and draws the card
 * again; the head says the keys, as Explore's Done does ("Done esc ⌘↵"). Under the editor, only while it is open, a
 * quiet key row (YAZ-5034, `cardKeyRow`): "⌘L hide word · ⌘⇧↵ new side · ⌘↵ / esc Done". ⌘⇧↵ puts a side break
 * (`---` on its own line) at the caret (`insertSideBreak`). The card window's Edit card is this view, so it has both. A card that
 * is not being edited has no CodeMirror at all, and a caret that arrives in its text becomes the card's node
 * selection (`cardSelection`), so no key types into text that does not show.
 *
 * OPEN CARD (D13): the ⋯ menu's "Open card", or ⌘↵ with the card selected (not while it is edited: there ⌘↵ is Done). The editor sends ONE
 * bubbling DOM event, `CARD_OPEN` (`mdapp:card-open`, detail `CardOpenRequest`), from its
 * `.ProseMirror`; App's listener opens the card window. ⌘↵ anywhere else is unchanged.
 *
 * REVIEWS (YAZ-5000, YAZ-5032; YAZ-5105 round 4): a card with reviews has THE Reviews strip at its bottom, tucked under
 * its text, closed — the one `CardReviews` of the Inbox and the card file tab (`reviewsStrip.ts`, a React root loaded
 * the first time a card with reviews draws) — with the card's facts on its right (`CardFacts`: next review, recall), so
 * they show without opening; a card with none has no strip (silence). A click opens the table inside it. Open or closed
 * is UI state (`openReviews`, by page and ID, so a page read again keeps it), never a transaction. The table's delete
 * is the vault's `deleteReview` (`deps.reviews`): a write of the card line to the FILE, with Undo in its notice, as in
 * the card window, so it works read only and in Explore's read layer too.
 *
 * THE ⋯ MENU (D13): Put at top of Inbox / Remove from top of Inbox (`withCardNext`, YAZ-4999 D3), Archive card /
 * Unarchive card (`withCardOff`, YAZ-5046: the line's `off`), Reset history (`withoutCardReviews`), Copy card ID, Open card, and
 * with the host's convert door Move to its own file (YAZ-5037: a card file in the page's folder, `![[GEO-140]]` in its
 * place; a card with no ID yet is not offered). Each line change is ONE transaction on the node's `cardLine` attribute (`changeCardLineAt`): one ⌘Z, saved as
 * any edit. The ID at insert (`cardRow`) is a transaction out of the undo history, saved by `CARD_ID_META`.
 */
import { EditorSelection, Prec, type Extension } from '@codemirror/state'
import { closeHistory, isHistoryTransaction } from '@milkdown/kit/prose/history'
import { ReplaceAroundStep, ReplaceStep } from '@milkdown/kit/prose/transform'
import type { Fragment } from '@milkdown/kit/prose/model'
import { EditorView as CodeMirrorView, keymap } from '@codemirror/view'
import { LanguageDescription, LanguageSupport } from '@codemirror/language'
import { commandsCtx, editorViewCtx, nodeViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@milkdown/kit/prose/state'
import type { Decoration, DecorationSource, EditorView, NodeView, NodeViewConstructor } from '@milkdown/kit/prose/view'
import { clearTextInCurrentBlockCommand, setBlockTypeCommand } from '@milkdown/kit/preset/commonmark'
import { $prose, $shortcut, $view } from '@milkdown/kit/utils'
import { cardIdOf, cardReviewsOf, cardTitleOf, formatCardLine, isCardNext, isCardNoTitle, isCardOff, settleCardCopy, withCardId, withCardNext, withCardNoTitle, withCardOff, withCardTitle, withoutCardId, withoutCardReviews, type CardLine } from '@shared/cardLine'
import type { HotkeyOverrides } from '@shared/hotkeyBindings'
import type { CardReview } from '@shared/cardLine'
import type { ReviewSettings } from '@shared/reviews'
import { codeWidthSchema } from '../code/codeWidth'
import { keyCapsDom } from '../../keys/keyWords'
import { copyText, openMenuAt } from '../linkMenu'
import type { MenuRow } from '../blockHandleMenu'
import type { SlashRow } from '../slashMenu'
import type { LinkFollow } from '../wikilink/wikilinkClick'
import { CardLineStep, cardLineStepAt, changeCardLineAt, isCardNode, CARD_LANGUAGE, cardLineOf } from './cardBlockLine'
import { CARD_BOARD_ATTR, CARD_MEDIA, CARD_OPENS } from './cardMedia'
import { CARD_OPEN, landWhenShown, previewCard, takeCardLanding, watchCardLanding, type CardOpenRequest } from './cardOpen'
import { CARD_LINK_ATTR, cardLinkWhere, refreshCardLook, renderCard, type CardLook } from './cardRender'
import { mountCardEditor, type CardCrepe, type CardEditor } from './cardEditor'
import { mountReviewsStrip, type ReviewsStripHandle } from './reviewsStrip'
import { mountCardTitle, type CardTitleHandle } from './cardTitle'
import { tellReadOnlyEdit } from '../readOnlyEdit'
import './card.css'

// The open hook (D13) lives with the card's other doors (`cardOpen.ts`): a card link's click sends it too (YAZ-5030).
export { CARD_OPEN, type CardOpenRequest } from './cardOpen'

/** On the transaction that puts the ID of a new card (out of the undo history): the editor saves it all the same. */
export const CARD_ID_META = 'mdapp-card-id'

/**
 * On the card editor's mirror of a card's text into the page (YAZ-5026; out of the undo history, so Done is ONE undo
 * step): the editor saves it all the same, so a tab switch or a quit loses no typing.
 */
export const CARD_MIRROR_META = 'mdapp-card-mirror'

/** How long after a change in the card editor its text goes into the page (YAZ-5026). */
export const CARD_MIRROR_MS = 300

/**
 * Which editor Edit card opens (YAZ-5026): `page`, the page's own editor in the card (what you see is what you get), or
 * `code`, the raw-text code box — kept as the fallback behind this ONE switch.
 */
export type CardEditorKind = 'page' | 'code'
let editorKind: CardEditorKind = 'page'
export const cardEditorKind = (): CardEditorKind => editorKind
export const setCardEditorKind = (kind: CardEditorKind): void => {
  editorKind = kind
}

/** The ONE card in Edit card with the page's editor (YAZ-5026): a second Edit card first does Done on it. */
let openCard: CardBlockView | null = null

/** The open card editor's text into the page now (a save: a tab switch, a close, a quit): no typing is lost. */
export function flushCardEditor(view: EditorView): void {
  if (openCard !== null && openCard.view === view) openCard.mirror()
}

/** What the host gives the cards of one editor (`createCrepe({ cards })`). Absent → no "Card" row. */
export interface CardHost {
  /** The page's absolute path: the open hook's `path`, and the vault the ID door counts in. */
  path: string
  /** The vault's ID door (`takePageId`, `views/scaffold.ts`): a new card takes its ID at once. Absent → the sweep gives it. */
  mintId?: (path: string) => Promise<string>
  /**
   * Done (its button, Esc or ⌘↵) with the card's text and its Title field's title (YAZ-5003: the card window's Edit card
   * saves them to the page; a card file's tab renames the file with the title). Set, the card is the card window's or a
   * card file tab's (`review/cardPane.tsx`): their own head shows its title.
   */
  onEditDone?: (text: string, title: string) => void
  /** Edit card's Title field shows the title only (a card file's card where nothing renames its file). */
  titleReadOnly?: boolean
  /** The convert actions of this page (YAZ-5037): absent → none (a preview, the card editor). */
  convert?: CardConvertDoor
}

/**
 * The convert actions a page's cards offer (YAZ-5037 phase 5), run by the page's host (`Editor`): it asks the vault's
 * Read only first, writes through `review/cardConvert.ts` and says what failed. There is no ⌘Z: the reverse is the undo.
 */
export interface CardConvertDoor {
  /** May a card of this page go to its own file now? The vault's Review is on (card files are a card feature). */
  canMove: () => boolean
  /** "Move to its own file": card `id`, the one at `index` among the page's cards. */
  move: (id: string, index: number) => void
  /** "Put back into this page": the `nth` lone embed `![[inner]]` of this page becomes card `id` of the card file `path`. */
  putBack: (card: { id: string; path: string }, inner: string, nth: number) => void
}

/** What a card view needs of its editor, made once in `createCrepe`. */
export interface CardDeps {
  host?: CardHost
  /** The page's path when the host gives no `host` (a read layer's image options). */
  path?: string | null
  /** Does the vault give IDs? False: a ```` ```card ```` block is a code block (D8). Absent: it does. */
  ids?: () => boolean
  /** A card line change written to the page's FILE (read only: the card's review is not locked). Absent: none. */
  writeLine?: (path: string, id: string, change: (line: CardLine) => CardLine, index: number) => Promise<unknown>
  /** The link pills' labels and icons, and the images' URLs. */
  look: () => CardLook
  /** Wakes the cards when the index changes: their pills draw again. */
  subscribe?: (listener: () => void) => () => void
  /** The editor's one link follower; absent in a preview with no doors. */
  follow?: LinkFollow
  hotkeys?: () => HotkeyOverrides | undefined
  /** A Markdown link's open (`markdownLinkNav`). Absent → a click on it does nothing. */
  openHref?: (href: string) => void
  onNotice?: (message: string) => void
  /** The vault's card review (YAZ-5000): "Reviews (n)" under a card with reviews. Absent (a hover preview): no section. */
  reviews?: CardReviewDoorApi
  /** The page's editor for Edit card (YAZ-5026), mounted in `root`. Absent: Edit card is the raw-text code box. */
  editor?: (root: HTMLElement) => CardCrepe
}

/** What the Reviews section under a card needs of its vault (YAZ-5000): the card window's settings and delete. */
export interface CardReviewDoorApi {
  settings: () => ReviewSettings
  /** Removes `review` from card `id` of `path` in the FILE; its notice has Undo (`useCardReview.deleteReview`). */
  deleteReview: (path: string, id: string, review: CardReview) => Promise<void>
}

const views = new WeakMap<HTMLElement, CardBlockView>()

/** The cards whose Reviews section is open, by page and ID: UI state, kept when the page is read again (YAZ-5000). */
const openReviews = new Set<string>()

/** The card view that draws `dom` (a `.card`), or null. */
export const cardBlockViewOfDom = (dom: Element | null): CardBlockView | null => (dom instanceof HTMLElement ? (views.get(dom) ?? null) : null)

/** The card view that draws the card at `pos` in `view`, or null. */
export function cardBlockViewAt(view: EditorView, pos: number): CardBlockView | null {
  const dom = view.nodeDOM(pos)
  return dom instanceof HTMLElement ? (views.get(dom) ?? null) : null
}

/** The card's place among the page's cards, as `pageCards` counts them (a card inside another code block is none: it is text). */
function cardIndex(doc: ProseNode, pos: number): number {
  let index = 0
  let found = -1
  doc.descendants((node, at) => {
    if (found >= 0) return false
    if (isCardNode(node)) {
      if (at === pos) found = index
      index++
      return false
    }
    return !node.isTextblock
  })
  return Math.max(0, found)
}

/** Sends the open hook for the card at `pos` (D13). */
function openCardAt(view: EditorView, pos: number, path: string | null): void {
  const node = view.state.doc.nodeAt(pos)
  if (node === null || !isCardNode(node)) return
  const detail: CardOpenRequest = { path, cardId: cardIdOf(cardLineOf(node)), index: cardIndex(view.state.doc, pos) }
  view.dom.dispatchEvent(new CustomEvent<CardOpenRequest>(CARD_OPEN, { bubbles: true, detail }))
}

const button = (className: string, label: string, text: string): HTMLButtonElement => {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = className
  b.setAttribute('aria-label', label)
  b.textContent = text
  return b
}

/** The keys of Edit card (YAZ-5034), in the row under its editor. */
export const CARD_EDIT_KEYS: ReadonlyArray<{ keys: string; label: string }> = [
  { keys: '⌘L', label: 'hide word' },
  { keys: '⌘⇧↵', label: 'new side' },
  { keys: '⌘↵ / esc', label: 'Done' },
]

/**
 * The quiet key row under Edit card's editor, on one line, keycaps as the Inbox's (`.explore__foot kbd`), in words
 * (YAZ-5035, `keyCapsDom`): "Cmd + L hide word · Cmd + Shift + Enter new side · Cmd + Enter / Esc Done". A card embed's
 * Edit card has the same row (YAZ-5037, `cardEmbed.ts`).
 */
export function cardKeyRow(): HTMLElement {
  const row = document.createElement('div')
  row.className = 'explore__foot card__keys'
  row.contentEditable = 'false'
  row.setAttribute('aria-hidden', 'true')
  for (const { keys, label } of CARD_EDIT_KEYS) {
    const part = document.createElement('span')
    part.append(keyCapsDom(keys), ` ${label}`)
    row.append(part)
  }
  return row
}

export class CardBlockView implements NodeView {
  dom: HTMLElement
  /** The card ID, first in the head (D20): a click copies it. Hidden while the card has none. */
  private readonly idButton: HTMLButtonElement
  private readonly state: HTMLElement
  /** "Title hidden in review" (YAZ-5030): shown while the line holds `notitle`; quiet, as "Archived" is. */
  private readonly notitle: HTMLElement
  /** The "Up next" chip (YAZ-4999 D3): shown while the line holds `next`; its × removes the mark. */
  private readonly next: HTMLElement
  private readonly editButton: HTMLButtonElement
  private readonly previewButton: HTMLButtonElement
  private readonly more: HTMLButtonElement
  private readonly body: HTMLElement
  /** Crepe's code block while the card is edited with the raw-text fallback, else null. */
  private code: NodeView | null = null
  /** The page's editor while the card is edited with it (YAZ-5026), its mount, and what it writes over. */
  private inner: { editor: CardEditor; mount: HTMLElement; base: string; written: string; timer: ReturnType<typeof setTimeout> | undefined } | null = null
  /** The key row under the editor (YAZ-5034): in the card only while it is edited. */
  private keyRow: HTMLElement | null = null
  /** What the body last drew: redrawn only when it changes. */
  private drawn: string | null = null
  private readonly unsubscribe: (() => void) | undefined
  /** This card's door to a landing asked while it shows (YAZ-5164, `watchCardLanding`). */
  private readonly unwatchLanding: () => void
  private closeMenu: (() => void) | null = null
  /** The Reviews strip (YAZ-5105 round 4): made only for a card with reviews. */
  private strip: ReviewsStripHandle | null = null
  /** The title in the head (YAZ-5164 part 3): the page title's component; none where the card window's own head shows it. */
  private readonly title: CardTitleHandle | null

  constructor(
    private node: ProseNode,
    readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly deps: CardDeps,
    private readonly makeCode: ((node: ProseNode) => NodeView) | null,
  ) {
    this.dom = document.createElement('div')
    this.dom.className = 'card'
    // The page's own card, its ID on it (YAZ-5164): what Explore's page layer lands on (`pageCardIn`); an embed has neither.
    this.dom.dataset.pageCard = ''
    const head = document.createElement('div')
    head.className = 'card__head'
    this.idButton = button('card__id', 'Copy card ID', '')
    this.state = document.createElement('span')
    this.state.className = 'card__state'
    this.notitle = document.createElement('span')
    this.notitle.className = 'card__state card__notitle'
    this.notitle.textContent = 'Title hidden in review'
    this.next = document.createElement('span')
    this.next.className = 'card__next'
    this.next.append('Up next', button('card__next-remove', 'Remove from top of Inbox', '×'))
    this.editButton = button('card__edit', 'Edit card', 'Edit card')
    // Preview (YAZ-5152): in Edit card's head, beside Done — the card as the Inbox shows it, with what is typed.
    this.previewButton = button('card__preview', 'Preview card', 'Preview')
    this.more = button('card__more', 'Card menu', '⋯')
    // The title after the ID (YAZ-5164 part 3): the head shows it, and the body never repeats it.
    this.title = deps.host?.onEditDone === undefined ? mountCardTitle() : null
    head.append(this.idButton, ...(this.title === null ? [] : [this.title.dom]), this.state, this.notitle, this.next, this.previewButton, this.editButton, this.more)
    this.body = document.createElement('div')
    this.body.className = 'card__body'
    this.dom.append(head, this.body)
    if (deps.reviews !== undefined) this.dom.classList.add('card--reviews')
    this.dom.addEventListener('mousedown', this.onMouseDown)
    this.dom.addEventListener('click', this.onClick)
    this.dom.addEventListener('dblclick', this.onDoubleClick)
    views.set(this.dom, this)
    this.draw()
    // A card link's ⌘-click, or a card row of search, opened this page to land on this card (YAZ-5030, YAZ-5164): it
    // lands once it shows, as the table of contents lands. Asked while the page is open already: it lands then.
    if (takeCardLanding(this.path, cardIdOf(cardLineOf(node)))) landWhenShown(this.dom)
    this.unwatchLanding = watchCardLanding((path, id) => {
      if (path !== this.path || cardIdOf(cardLineOf(this.node))?.toLowerCase() !== id.toLowerCase()) return false
      landWhenShown(this.dom)
      return true
    })
    this.unsubscribe = deps.subscribe?.(() => {
      // An index change redraws only the pills of a card with a link: no Markdown render again.
      if (!this.editing && this.node.textContent.includes('[[')) refreshCardLook(this.body, this.deps.look())
    })
  }

  get editing(): boolean {
    return this.code !== null || this.inner !== null
  }

  /** Edited in the raw-text fallback: the caret is in the card's own text then. */
  get editingText(): boolean {
    return this.code !== null
  }

  /** The open card editor (YAZ-5026), for tests and the card window: null while the card is not edited with it. */
  get cardEditor(): CardEditor | null {
    return this.inner?.editor ?? null
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
    const line = cardLineOf(this.node)
    const id = cardIdOf(line)
    this.idButton.textContent = id ?? ''
    if (id === null) delete this.dom.dataset.cardId
    else this.dom.dataset.cardId = id
    this.idButton.hidden = id === null
    this.state.textContent = isCardOff(line) ? 'Archived' : ''
    this.notitle.hidden = !isCardNoTitle(line)
    this.dom.classList.toggle('card--off', isCardOff(line))
    this.next.hidden = !isCardNext(line)
    // Done says its keys, as Explore's head does (YAZ-5001), in words (YAZ-5035): "Done Esc Cmd + Enter".
    if (!this.editing) this.editButton.textContent = 'Edit card'
    else if (this.editButton.firstChild?.textContent !== 'Done') this.editButton.replaceChildren('Done', keyCapsDom('esc'), keyCapsDom('⌘↵'))
    this.editButton.setAttribute('aria-label', this.editing ? 'Done' : 'Edit card')
    this.dom.classList.toggle('card--editing', this.editing)
    this.previewButton.hidden = !this.editing
    this.drawReviews()
    // The title in the head, off the card line (YAZ-5308); the body is the card's text, its sides only.
    this.drawTitle(cardTitleOf(line))
    if (this.editing || this.drawn === text) return
    this.drawn = text
    this.body.replaceChildren(text.trim() === '' ? this.emptyHint() : renderCard(text, {}, this.deps.look()))
  }

  /** The head's title (YAZ-5164 part 3); `now`: drawn at once, for a press about to click it. */
  private drawTitle(title: string, now = false): void {
    this.title?.render({ title, readOnly: !this.view.editable, onRetitle: (next) => this.retitle(next) }, now)
  }

  /**
   * The head's rename (YAZ-5164 part 3): the title on the card line (YAZ-5308), ONE undo step. A page that cannot be
   * edited never gets here: its title's click is an edit attempt (`PageTitle`), and the unlock runs the rename.
   */
  private retitle(title: string): void {
    if (!this.view.editable) return
    this.change((l) => withCardTitle(l, title))
  }

  /** The key of this card's open state: its page and ID; null before it has both. */
  private get reviewsKey(): string | null {
    const id = cardIdOf(cardLineOf(this.node))
    const path = this.path
    return id === null || path === null ? null : `${path}\n${id}`
  }

  get reviewsOpen(): boolean {
    const key = this.reviewsKey
    return key !== null && openReviews.has(key)
  }

  /** The Reviews strip at the bottom of a card with reviews, its table inside while open; nothing for a card with none. */
  private drawReviews(): void {
    const door = this.deps.reviews
    const line = cardLineOf(this.node)
    const reviews = door === undefined ? [] : cardReviewsOf(line)
    if (door === undefined || reviews.length === 0) {
      this.strip?.destroy()
      this.strip = null
      return
    }
    if (this.strip === null) this.strip = mountReviewsStrip()
    // After the card's text, before an editor's key row: the strip stays the text's neighbour (hidden while edited).
    if (this.strip.dom.parentNode !== this.dom) this.body.after(this.strip.dom)
    const id = cardIdOf(line)
    const path = this.path
    this.strip.render({
      reviews,
      settings: door.settings(),
      onDelete: id === null || path === null ? undefined : (review) => void door.deleteReview(path, id, review),
      open: this.reviewsOpen,
      onToggle: () => this.toggleReviews(),
      facts: true,
    })
  }

  /** A click on "✓ n Reviews": open or closed, UI state only (no transaction, nothing in the undo history). */
  toggleReviews(): void {
    const key = this.reviewsKey
    if (key === null) return
    if (openReviews.has(key)) openReviews.delete(key)
    else openReviews.add(key)
    this.drawReviews()
  }

  private emptyHint(): HTMLElement {
    const hint = document.createElement('div')
    hint.className = 'card__empty'
    hint.textContent = 'Empty card. Write the front, then --- and the back.'
    return hint
  }

  /**
   * "Edit card": Crepe's code block in the card, the caret at the end of its text. In a page locked by Read only it is an
   * edit attempt that carries itself (YAZ-5145 round 2): the pane's chip shows its card, and once the person allows
   * edits, Edit card opens at once — no second double-click or Enter.
   */
  edit(select?: { from: number; to: number } | 'title'): void {
    const pos = this.pos
    if (this.editing || pos === null) return
    if (!this.view.editable) return tellReadOnlyEdit(this.dom, 'card', () => this.edit(select))
    if (editorKind === 'page' && this.deps.editor !== undefined) return this.editWithPage(this.deps.editor, select)
    if (this.makeCode === null) return
    this.code = this.makeCode(this.node)
    this.code.dom.classList.add('card__code')
    this.keyRow ??= cardKeyRow()
    this.dom.append(this.code.dom, this.keyRow)
    this.draw()
    // The caret at the end, or `select` (offsets in the card's text). The code box has no Title field: `'title'` is the end.
    const size = this.node.content.size
    const at = select === 'title' ? undefined : select
    const from = Math.max(0, Math.min(at?.from ?? size, size))
    const to = Math.max(from, Math.min(at?.to ?? size, size))
    this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, pos + 1 + from, pos + 1 + to)).scrollIntoView())
    // ProseMirror hands the caret to the view (`setSelection`), which makes CodeMirror and focuses it.
    this.code.setSelection?.(from, to, this.view.root)
  }

  /**
   * Edit card with the page's editor (YAZ-5026): mounted in the card under its head, the key row under it. The page's
   * selection is the card while it is edited (the page does not see the inner editor's focus); the inner editor takes
   * the keyboard once it is made. `select` `'title'`: the Title field takes it (`/card`).
   */
  private editWithPage(make: (root: HTMLElement) => CardCrepe, select?: { from: number; to: number } | 'title'): void {
    if (openCard !== null && openCard !== this) openCard.done()
    const pos = this.pos
    if (pos === null) return
    const mount = document.createElement('div')
    mount.className = 'card__editor'
    mount.contentEditable = 'false'
    this.keyRow ??= cardKeyRow()
    this.dom.append(mount, this.keyRow)
    const text = this.node.textContent
    const title = cardTitleOf(cardLineOf(this.node))
    const editor = mountCardEditor({
      root: mount,
      text,
      title,
      make,
      titleReadOnly: this.deps.host?.titleReadOnly === true,
      ...(select === 'title' ? { selectTitle: true } : select !== undefined && { select }),
      doors: { done: () => this.done(), changed: () => this.changed() },
    })
    this.inner = { editor, mount, base: text, written: text, timer: undefined }
    openCard = this
    this.draw()
    this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)))
    this.drawSelected()
  }

  /**
   * The page's "selected block" look on the card (YAZ-5026 round 2: "double click highlight doesnt work"): on while the
   * card is the page's selection and NOT edited. Crepe's reset makes every selection inside a selected block clear
   * (`.milkdown .ProseMirror .ProseMirror-selectednode ::selection { background: transparent }`), so a card selected
   * before Edit card hid each selection in its editor: a double click, a drag, ⇧+arrows. ProseMirror calls
   * `selectNode` / `deselectNode` only when the page's selection moves to or off the card, and Edit card and Done keep
   * it on the card, so the look is set here too.
   */
  private drawSelected(): void {
    const { selection } = this.view.state
    const selected = this.inner === null && selection instanceof NodeSelection && selection.from === this.pos
    this.dom.classList.toggle('ProseMirror-selectednode', selected)
  }

  /** A change in the card editor: its text goes into the page 300 ms later (`mirror`). */
  private changed(): void {
    const inner = this.inner
    if (inner === null) return
    clearTimeout(inner.timer)
    inner.timer = setTimeout(() => this.mirror(), CARD_MIRROR_MS)
  }

  /** The card's text from its editor into the page, out of the undo history; saved as the card ID is. */
  mirror(): void {
    const inner = this.inner
    if (inner === null) return
    clearTimeout(inner.timer)
    inner.timer = undefined
    this.write(inner.editor.text(), false)
  }

  /**
   * Puts `text` as the card's text in the page with the least change (the common start and end kept), and `title` on its
   * card line when given (YAZ-5308: Edit card's Title field), in the same transaction: `history` false → out of the undo
   * history, saved by `CARD_MIRROR_META`; true → ONE undo step of its own.
   */
  private write(text: string, history: boolean, title?: string): void {
    const pos = this.pos
    const inner = this.inner
    if (pos === null || this.view.isDestroyed) return
    const node = this.view.state.doc.nodeAt(pos)
    if (node === null || !isCardNode(node)) return
    const now = node.textContent
    if (inner !== null) inner.written = text
    let tr = this.view.state.tr
    if (now !== text) {
      let head = 0
      while (head < now.length && head < text.length && now[head] === text[head]) head++
      let tail = 0
      while (tail < now.length - head && tail < text.length - head && now[now.length - 1 - tail] === text[text.length - 1 - tail]) tail++
      const from = pos + 1 + head
      const to = pos + 1 + now.length - tail
      const middle = text.slice(head, text.length - tail)
      tr = middle === '' ? tr.delete(from, to) : tr.replaceWith(from, to, this.view.state.schema.text(middle))
    }
    const step = title === undefined ? null : cardLineStepAt(tr.doc, pos, (l) => withCardTitle(l, title))
    if (step !== null) tr.step(step)
    if (!tr.docChanged) return
    if (history) this.view.dispatch(closeHistory(tr))
    else this.view.dispatch(tr.setMeta('addToHistory', false).setMeta(CARD_MIRROR_META, true))
  }

  /**
   * Done with the page's editor (YAZ-5026): the page gets back the text the edit started from (or the one an outside
   * change brought), out of the undo history, then the new text as ONE undo step: one ⌘Z in the page takes the whole
   * edit back. No change: nothing is written.
   */
  private doneWithPage(): void {
    const inner = this.inner
    if (inner === null) return
    clearTimeout(inner.timer)
    const text = inner.editor.text()
    const title = inner.editor.title()
    inner.editor.destroy()
    inner.mount.remove()
    this.keyRow?.remove()
    if (openCard === this) openCard = null
    this.write(inner.base, false)
    this.inner = null
    // The Title field's title on the card line, in the same undo step as the text. A card window's or a card file tab's
    // card hands both to its host instead (a card file's title renames the file).
    const host = this.deps.host?.onEditDone
    this.write(text, true, host === undefined ? title : undefined)
    this.draw()
    host?.(this.node.textContent, title)
    const pos = this.pos
    if (pos === null || this.view.isDestroyed) return
    this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)))
    this.drawSelected()
    this.view.focus()
  }

  /** "Done": the card drawn again, selected. */
  done(): void {
    if (this.inner !== null) return this.doneWithPage()
    if (this.code === null) return
    this.code.destroy?.()
    this.code.dom.remove()
    this.keyRow?.remove()
    this.code = null
    this.draw()
    this.deps.host?.onEditDone?.(this.node.textContent, cardTitleOf(cardLineOf(this.node)))
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

  /**
   * Preview (YAZ-5152): the card as the Inbox shows it, nothing saved (`CARD_PREVIEW`). While edited, what is typed —
   * Edit card's text — saved or not. A preview that does not know its page sends nothing.
   */
  preview(): void {
    const path = this.path
    if (path === null) return
    const line = cardLineOf(this.node)
    const text = this.inner?.editor.text() ?? this.node.textContent
    const title = this.inner?.editor.title() ?? cardTitleOf(line)
    previewCard(this.dom, { path, id: cardIdOf(line), text, title, notitle: isCardNoTitle(line), reviews: cardReviewsOf(line) })
  }

  /** Sends the open hook for this card (D13). */
  open(): void {
    const pos = this.pos
    if (pos !== null) openCardAt(this.view, pos, this.path)
  }

  /**
   * One change of the card line: a transaction (one ⌘Z) in a page that can be edited; in a read-only page a write to
   * the file (`deps.writeLine`), which the page takes quietly — read only locks the card's text, not its review.
   */
  private change(change: Parameters<typeof changeCardLineAt>[2]): void {
    const pos = this.pos
    if (pos === null) return
    if (this.view.editable) {
      const tr = changeCardLineAt(this.view.state, pos, change)
      if (tr !== null) this.view.dispatch(tr)
      return
    }
    const id = cardIdOf(cardLineOf(this.node))
    const path = this.path
    if (id === null || path === null || this.deps.writeLine === undefined) return
    this.deps.writeLine(path, id, change, cardIndex(this.view.state.doc, pos)).catch((err: unknown) => this.deps.onNotice?.(`Can't change the card: ${err instanceof Error ? err.message : String(err)}`))
  }

  /** Can the ⋯ menu change the card line? In an editable page, yes; read only, through the file, for a card with an ID. */
  private get canChangeLine(): boolean {
    return this.view.editable || (cardIdOf(cardLineOf(this.node)) !== null && this.path !== null && this.deps.writeLine !== undefined)
  }

  /** The ID the door gave this new card, unless it has one by now. Out of the undo history; saved by `CARD_ID_META`. */
  takeId(id: string): void {
    const pos = this.pos
    if (pos === null || this.view.isDestroyed) return
    const tr = changeCardLineAt(this.view.state, pos, (line) => (cardIdOf(line) === null ? withCardId(line, id) : line))
    if (tr !== null) this.view.dispatch(tr.setMeta('addToHistory', false).setMeta(CARD_ID_META, true))
  }

  /** The ⋯ menu's rows (D13). */
  menuRows(): MenuRow[] {
    const line = cardLineOf(this.node)
    const id = cardIdOf(line)
    const editable = this.canChangeLine
    const onNotice = this.deps.onNotice ?? (() => {})
    const convert = this.deps.host?.convert
    const pos = this.pos
    // A card with no ID yet is not offered: its card file's name and its embed need the ID (the door gives it at once).
    const move = id !== null && pos !== null && convert?.canMove() === true ? { label: 'Move to its own file', run: () => convert.move(id, cardIndex(this.view.state.doc, pos)) } : null
    return [
      { label: 'Open card', hint: '⌘↵', run: () => this.open() },
      { label: 'Preview', hint: 'P', disabled: this.path === null, run: () => this.preview() },
      ...(move === null ? [] : [move]),
      { label: isCardNext(line) ? 'Remove from top of Inbox' : 'Put at top of Inbox', disabled: !editable, divider: true, run: () => this.change((l) => withCardNext(l, !isCardNext(l))) },
      { label: isCardOff(line) ? 'Unarchive card' : 'Archive card', disabled: !editable, run: () => this.change((l) => withCardOff(l, !isCardOff(l))) },
      // ONE toggle row (YAZ-5030): its hint is the state now; a click turns it to the other.
      { label: 'Title on the front', hint: isCardNoTitle(line) ? 'Hide' : 'Show', disabled: !editable, run: () => this.change((l) => withCardNoTitle(l, !isCardNoTitle(l))) },
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
    if (target === null || event.button !== 0 || (this.code !== null && this.code.dom.contains(target)) || this.inner?.mount.contains(target) === true) return
    // The Reviews strip is React's (its toggle, its table): a press in it never selects the card.
    if (this.strip?.dom.contains(target) === true) return
    // The title is the page title's (YAZ-5164 part 3): its click renames, or asks to unlock a locked page. Drawn now with
    // whether the page can be edited NOW (an unlock does not redraw the card).
    if (this.title?.dom.contains(target) === true) {
      this.drawTitle(cardTitleOf(cardLineOf(this.node)), true)
      return
    }
    if (target.closest('.card__more') !== null) {
      event.preventDefault()
      this.openMenu()
      return
    }
    if (target.closest('.card__next-remove') !== null) {
      event.preventDefault()
      if (this.canChangeLine) this.change((l) => withCardNext(l, false))
      return
    }
    if (target.closest('.card__preview') !== null) {
      event.preventDefault()
      this.preview()
      return
    }
    if (target.closest('.card__edit') !== null) {
      event.preventDefault()
      if (this.code === null) this.edit()
      else this.done()
      return
    }
    if (target.closest('.card__id') !== null) {
      event.preventDefault()
      const id = cardIdOf(cardLineOf(this.node))
      if (id !== null) copyText(id, 'card ID', this.deps.onNotice ?? (() => {}), undefined, true)
      return
    }
    // A sound's player is its own (YAZ-5014): its click plays, and the card is not selected.
    if (target.closest(CARD_MEDIA) !== null) return
    // A pill, or a board's picture (YAZ-5015): it opens as its link does.
    const pill = target.closest<HTMLElement>(CARD_OPENS)
    if (pill !== null && this.deps.follow !== undefined) {
      const where = cardLinkWhere(event, this.deps.hotkeys?.())
      event.preventDefault()
      if (where !== null) this.deps.follow(pill.getAttribute(CARD_LINK_ATTR) ?? pill.getAttribute(CARD_BOARD_ATTR) ?? '', where)
      return
    }
    if (target.closest('a[href]') !== null) return
    // A press on the card selects it whole: ⌘↵ opens it, Delete removes it.
    event.preventDefault()
    this.select()
  }

  /** A Markdown link never navigates the window: it opens as the page's links do. */
  private onClick = (event: MouseEvent): void => {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('.card__body a[href]') : null
    if (link === null) return
    event.preventDefault()
    this.deps.openHref?.(link.getAttribute('href') ?? '')
  }

  private onDoubleClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('.card__body') == null || target.closest(`${CARD_OPENS}, ${CARD_MEDIA}, a[href]`) !== null) return
    event.preventDefault()
    this.edit()
  }

  update(node: ProseNode, decorations: readonly Decoration[], inner: DecorationSource): boolean {
    if (!isCardNode(node)) return false
    this.node = node
    if (this.code !== null && this.code.update?.(node, decorations, inner) === false) return false
    const edit = this.inner
    if (edit !== null && node.textContent !== edit.written) {
      // The card's TEXT changed from outside while it is edited (an agent, git): Done writes ours, and ⌘Z brings theirs back.
      edit.base = node.textContent
      edit.written = node.textContent
      this.deps.onNotice?.('This card changed outside while you edit it. Done keeps your text; ⌘Z brings the other back.')
    }
    this.draw()
    return true
  }

  setSelection(anchor: number, head: number, root: Document | ShadowRoot): void {
    // Not edited: `cardSelection` turns the caret into the card's selection; nothing to place here.
    this.code?.setSelection?.(anchor, head, root)
  }

  selectNode(): void {
    if (this.code !== null) this.code.selectNode?.()
    // While its editor is open the card is the page's selection, and its "Editing" frame says so.
    else if (this.inner === null) this.dom.classList.add('ProseMirror-selectednode')
  }

  deselectNode(): void {
    this.code?.deselectNode?.()
    this.dom.classList.remove('ProseMirror-selectednode')
  }

  stopEvent(): boolean {
    return true
  }

  ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: Node }): boolean {
    // The card's own drawing never reaches ProseMirror; CodeMirror's selection does, as in a code block. The page's
    // editor in the card (YAZ-5026) is all its own: the page never reads it.
    return this.code === null || !this.code.dom.contains(mutation.target) || mutation.type !== 'selection'
  }

  destroy(): void {
    const inner = this.inner
    if (inner !== null) {
      // The page goes (a tab switch, a page read again): what the mirror wrote stays; the editor goes.
      clearTimeout(inner.timer)
      inner.editor.destroy()
      this.inner = null
      if (openCard === this) openCard = null
    }
    this.strip?.destroy()
    this.strip = null
    this.title?.destroy()
    this.closeMenu?.()
    this.unsubscribe?.()
    this.unwatchLanding()
    this.code?.destroy?.()
    views.delete(this.dom)
  }
}

/** The code block's node view: a card for the language `card`, else Crepe's own, unchanged. */
function cardNodeView(deps: CardDeps) {
  const view = $view(codeWidthSchema.node, (ctx: Ctx): NodeViewConstructor => {
    const ours: NodeViewConstructor = (node, editor, getPos, decorations, inner) => {
      // Crepe's factory, registered before this one (`Object.fromEntries` takes the last, ours).
      const crepe = ctx.get(nodeViewCtx).find(([id, make]) => id === 'code_block' && make !== ours)?.[1] ?? null
      // A vault that gives no IDs has no cards (D8): its ```card block is a code block, as the index reads it.
      if (!isCardNode(node) || deps.ids?.() === false) return crepe === null ? (undefined as unknown as NodeView) : crepe(node, editor, getPos, decorations, inner)
      const makeCode = crepe === null ? null : (n: ProseNode) => crepe(n, editor, getPos, decorations, inner)
      return new CardBlockView(node, editor, getPos, deps, makeCode)
    }
    return ours
  })
  return view
}

/**
 * A caret that lands in the text of a card that is not being edited (an arrow key, a find) becomes the card's node
 * selection: the text does not show, so nothing may type into it.
 */
function cardSelection() {
  let editor: EditorView | null = null
  return $prose(
    () =>
      new Plugin({
        key: new PluginKey('mdapp-card-selection'),
        view: (view) => {
          editor = view
          return { destroy: () => (editor = null) }
        },
        appendTransaction: (trs, _old, state: EditorState) => {
          if (editor === null || !trs.some((tr) => tr.selectionSet)) return null
          const { selection } = state
          if (!(selection instanceof TextSelection)) return null
          const { $from, $to } = selection
          if (!isCardNode($from.parent) || $to.parent !== $from.parent) return null
          const pos = $from.before()
          const card = cardBlockViewAt(editor, pos)
          if (card === null || card.editingText) return null
          return state.tr.setSelection(NodeSelection.create(state.doc, pos))
        },
      }),
  )
}

/**
 * A transaction that may put other content where a selected card was (none in the app yet: an escape hatch). ⌘Z / ⇧⌘Z
 * and an outside edit of the file may too.
 */
export const CARD_REPLACE_META = 'card-replace'

/** Text or a leaf (an image, a rule) in `content`, outside a card: what typing, a paste or a drop puts there. */
function holdsOtherContent(content: Fragment): boolean {
  let found = false
  content.descendants((node) => {
    if (found || isCardNode(node)) return false
    if (node.isText || node.isLeaf) found = true
    return !found
  })
  return found
}

/**
 * Does `tr` put other content where the card `from`..`to` was? The card is gone (its opening token deleted) and what
 * stands in its place holds text or a leaf. A pure delete (Backspace, Delete, a cut, the block menu's delete, the
 * first half of a drag move) leaves nothing there, or the empty paragraph an empty page needs; a card that moves next
 * to its own place, or a change of the card's line or attributes, leaves the card there.
 */
function replacesCard(tr: Transaction, from: number, to: number): boolean {
  if (!tr.mapping.mapResult(from, 1).deleted) return false
  const start = tr.mapping.map(from, -1)
  const end = tr.mapping.map(to, 1)
  return end > start && holdsOtherContent(tr.doc.slice(start, end).content)
}

/**
 * NO TEXT REPLACES A SELECTED CARD (YAZ-5006): ProseMirror replaces a selected node with what is typed, so one letter
 * took the card and its review history away. Round 1 stopped the key presses; text that comes with no key press (macOS
 * dictation, the emoji picker, text replacement: a `beforeinput` insert, or text the page reads from the DOM) still
 * replaced the card. So the rule sits on the transaction, whatever its source: while a card is node-selected, a
 * transaction that puts text or a leaf where the card was is refused (ProseMirror then redraws the page over any text
 * the browser wrote). A paste over a selected card is refused too. Backspace / Delete, a cut, the block menu's delete
 * and a drag move delete the card as any block (⌘Z undoes); ⌘Z / ⇧⌘Z and an outside edit of the file are not refused.
 *
 * The props stop what they can before the browser writes: a typed character, a `beforeinput` insert and a paste do
 * nothing to a selected card, and Enter is Edit card.
 */
function cardKeyGuard() {
  const selected = (state: EditorState): number | null => {
    const { selection } = state
    return selection instanceof NodeSelection && isCardNode(selection.node) ? selection.from : null
  }
  return $prose(
    () =>
      new Plugin({
        key: new PluginKey('mdapp-card-key-guard'),
        filterTransaction: (tr, state) => {
          if (!tr.docChanged || selected(state) === null) return true
          if (tr.getMeta(CARD_REPLACE_META) === true || tr.getMeta(EXTERNAL_EDIT_META) === true || isHistoryTransaction(tr)) return true
          return !replacesCard(tr, state.selection.from, state.selection.to)
        },
        props: {
          handleTextInput: (view) => selected(view.state) !== null,
          handleDOMEvents: {
            // Dictation, the emoji picker, text replacement, a composition's end: cancelled before the browser writes
            // the text into the card. A drop stays ProseMirror's (a drag move). A composition's own updates cannot be
            // cancelled: the transaction rule refuses what they write.
            beforeinput: (view, event) => {
              const { inputType } = event as InputEvent
              if (selected(view.state) === null || !inputType.startsWith('insert') || inputType === 'insertFromDrop') return false
              event.preventDefault()
              return true
            },
            // The page's paste props are direct editor props (`clipboardPaste.ts`) and run before a plugin's `handlePaste`.
            paste: (view, event) => {
              if (selected(view.state) === null) return false
              event.preventDefault()
              return true
            },
          },
          handleKeyDown: (view, event) => {
            if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey || event.isComposing) return false
            // Enter edits the selected card; P previews it (YAZ-5152: P typed over a selected card would replace it).
            if (event.key !== 'Enter' && event.key !== 'p' && event.key !== 'P') return false
            const pos = selected(view.state)
            if (pos === null) return false
            const card = cardBlockViewAt(view, pos)
            if (event.key === 'Enter') card?.edit()
            else {
              event.preventDefault()
              card?.preview()
            }
            return true
          },
        },
      }),
  )
}

/** The card at the selection: the card selected, or the caret in its text. */
function cardAtSelection(state: EditorState): number | null {
  const { selection } = state
  if (selection instanceof NodeSelection) return isCardNode(selection.node) ? selection.from : null
  const { $from } = selection
  return isCardNode($from.parent) ? $from.before() : null
}

/** ⌘↵ on a card opens it (D13): above the table's and the embed's ⌘↵ (200, 210); anywhere else it declines. */
function cardKeys(deps: CardDeps) {
  return $shortcut(() => ({
    OpenCard: {
      key: 'Mod-Enter',
      priority: 220,
      onRun: () => (state, _dispatch, view) => {
        const pos = cardAtSelection(state)
        if (pos === null || view === undefined) return false
        openCardAt(view, pos, deps.host?.path ?? deps.path ?? null)
        return true
      },
    },
  }))
}

/** The card whose editor `cm` is, or null for any other code block. */
const cardOfCodeMirror = (cm: CodeMirrorView): CardBlockView | null => {
  const dom = cm.dom.closest<HTMLElement>('.card')
  return dom === null ? null : (views.get(dom) ?? null)
}

/**
 * ⌘⇧↵ in Edit card (YAZ-5034): a side break, `---` on its own line, at each caret (a selection is replaced). Mid-line,
 * the line splits there; spaces at the split go. At the start of a line no empty line comes before `---`. The caret
 * goes to the start of the new side. ONE change, so one ⌘Z takes it off.
 */
export function insertSideBreak(cm: CodeMirrorView): boolean {
  const { state } = cm
  const change = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.from)
    const before = state.sliceDoc(line.from, range.from)
    const end = state.doc.lineAt(range.to)
    const after = state.sliceDoc(range.to, end.to)
    const from = range.from - (before.length - before.trimEnd().length)
    const to = range.to + (after.length - after.trimStart().length)
    const insert = (before.trim() === '' ? '' : '\n') + '---\n'
    // Spaces only before the caret: they go too, so `---` starts its line.
    const start = before.trim() === '' ? line.from : from
    return { changes: { from: start, to, insert }, range: EditorSelection.cursor(start + insert.length) }
  })
  cm.dispatch(state.update(change, { scrollIntoView: true, userEvent: 'input' }))
  return true
}

/**
 * In every code block's CodeMirror (`createCrepe.ts`), highest: in a card's editor ⌘↵ and Esc are "Done" (YAZ-5001;
 * before `addLineCodeKeys` and Crepe's exit-code), and ⌘⇧↵ is a new side (YAZ-5034, `insertSideBreak`). In any other
 * code block all three decline: ⌘↵ / ⌘⇧↵ still add a line below / above (`addLineCodeKeys`). Not `Prec.high` in the card
 * language: `addLineCodeKeys` is `Prec.highest`, so the card's ⌘⇧↵ must be here, before it, to win.
 */
export const cardCodeKeys: Extension = Prec.highest(
  keymap.of([
    {
      key: 'Mod-Enter',
      run: (cm) => {
        const card = cardOfCodeMirror(cm)
        card?.done()
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
    {
      key: 'Mod-Shift-Enter',
      // The raw-text card editor only: in a code block INSIDE the page's card editor (YAZ-5026) it adds a line above.
      run: (cm) => cardOfCodeMirror(cm)?.editingText === true && !cm.dom.parentElement?.closest('.card__editor') && insertSideBreak(cm),
    },
  ]),
)

/**
 * The `card` language of the code editor (idea 8): Markdown highlighting, and the spell check a code block does not
 * have. Joins Crepe's language list (`createCrepe.ts`), so only a card's editor loads it. No setext headings: in a card
 * `---` splits the sides (D10), so the front line above it is no heading — only a `#` line is one.
 */
export const cardLanguage = LanguageDescription.of({
  name: 'Card',
  alias: [CARD_LANGUAGE],
  load: async () => {
    // Edit card's own extensions (YAZ-5007 no marks on other copies of a word, YAZ-5008 ⌘L), loaded with the language.
    const [{ markdown }, { cardEditExtensions }] = await Promise.all([import('@codemirror/lang-markdown'), import('./cardEdit')])
    const md = markdown({ extensions: { remove: ['SetextHeading'] } })
    return new LanguageSupport(md.language, [md.support, CodeMirrorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'on' }), cardEditExtensions])
  },
})

/** The words the slash filter finds "Card" by, besides its label (idea 9). */
const CARD_KEYWORDS = ['card', 'card', 'flashcard']

/**
 * The "Card" slash row (D1, idea 9): the `/query` cleared, the line made an empty card, and the card edited at once with
 * its Title field taking the keyboard (YAZ-5308: the title is on the card line, never the card's first line). The card
 * takes its ID now (the coordinator's decision on YAZ-4961): when the door answers, ONE transaction out of the undo
 * history puts `<!-- card: WIKI-512 -->` on it, so ⌘Z removes the card in one step. No answer: the sweep gives the ID
 * later.
 */
export function cardRow(host: CardHost): SlashRow {
  return {
    label: 'Card',
    icon: CARD_ICON,
    keywords: CARD_KEYWORDS,
    onRun: (ctx) => {
      const commands = ctx.get(commandsCtx)
      commands.call(clearTextInCurrentBlockCommand.key)
      const view = ctx.get(editorViewCtx)
      commands.call(setBlockTypeCommand.key, { nodeType: codeWidthSchema.type(ctx), attrs: { language: CARD_LANGUAGE } })
      const { $from } = view.state.selection
      if (!isCardNode($from.parent)) return
      const card = cardBlockViewAt(view, $from.before())
      card?.edit('title')
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
const CARD_ICON = `
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
    <path d="M5 4H19C20.1 4 21 4.9 21 6V18C21 19.1 20.1 20 19 20H5C3.9 20 3 19.1 3 18V6C3 4.9 3.9 4 5 4ZM5 6V11H19V6H5ZM5 13V18H19V13H5ZM7 7.5H14V9.5H7V7.5ZM7 14.5H12V16.5H7V14.5Z" />
  </svg>
`

/** Does `content` hold a card that has an ID? A cheap look at what a step inserts. */
function holdsCardWithId(content: Fragment): boolean {
  let found = false
  content.descendants((node) => {
    if (found) return false
    if (isCardNode(node)) {
      found = cardIdOf(cardLineOf(node)) !== null
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
function cardCopies(deps: CardDeps) {
  /** Positions of copies that wait for a new ID from the door, set by `appendTransaction`, taken by the plugin view. */
  let asking: number[] = []
  return $prose(
    () =>
      new Plugin({
        key: new PluginKey('mdapp-card-copies'),
        appendTransaction: (trs, old, state) => {
          const inserted: Array<{ from: number; to: number }> = []
          for (const tr of trs) {
            if (!tr.docChanged || tr.getMeta(EXTERNAL_EDIT_META) === true || tr.getMeta(CARD_ID_META) === true || isHistoryTransaction(tr)) continue
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
            if (isCardNode(node)) {
              const id = cardIdOf(cardLineOf(node))
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
              if (isCardNode(node)) {
                const id = cardIdOf(cardLineOf(node))
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
            const line = cardLineOf(node)
            const settled = settleCardCopy({ line: unions.get(at) ?? cardLineOf(keeper), text: keeper.textContent }, { line, text: node.textContent })
            if (settled.keeper !== null) unions.set(at, settled.keeper)
            tr.step(new CardLineStep(pos, formatCardLine(line), formatCardLine(withoutCardId(settled.copy))))
            copies.push(pos)
          }
          // The union lands on each keeper in this same transaction: the copy never empties before its reviews are there.
          for (const [at, line] of unions) {
            const before = cardLineOf(state.doc.nodeAt(at)!)
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
            const cards = asking.flatMap((pos) => cardBlockViewAt(view, pos) ?? [])
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
export function cardBlockPlugins(deps: CardDeps) {
  return [cardNodeView(deps), cardSelection(), cardKeyGuard(), cardCopies(deps), cardKeys(deps)].flat()
}
