/**
 * A note card's text as the reader sees it (YAZ-4961; the Inbox's too, YAZ-4962 D18): ONE pure function,
 * `renderNoteCard(text, show, look)` → an element. No editor, no app state: the page's card block (`noteCardView.ts`)
 * and the Inbox call the same function.
 *
 *  - The sides (`cardSides`, `---` alone on a line) in order, a thin rule (`.note-card__rule`) between two.
 *  - Each side is ONE Markdown text (`marked`, GitHub flavour, a single newline is a line break, as a comment reads,
 *    `comments/markdown.ts`), sanitised by DOMPurify with the comments' profile: no script, style or form control.
 *  - A hidden word (`{{word}}`, `{{1::word}}`) becomes a placeholder in the text BEFORE the Markdown render (a private
 *    use character pair around its number, `markHidden`), so `**bold {{word}} more**`, a hidden word in a list item or
 *    in a link's text render as Markdown does. After DOMPurify, each placeholder in a TEXT node becomes a span:
 *    `.note-card__hidden` (the word, highlighted or underlined) while it shows, `.note-card__blank` while it does not.
 *    YAZ-5013 (Yaseen: "never jumping around"): BOTH hold the real word in `.note-card__word`, so the blank is exactly
 *    the word's width and a show changes only the class. In a blank the word is invisible (`visibility: hidden`), out
 *    of a selection (`user-select: none`), out of the accessibility tree (`aria-hidden`; the blank says "Hidden word"),
 *    and out of a copy (`copyWithoutHidden`).
 *  - `show.sides`: how many sides show (default all); `show.shown`: how many hidden words show, in page order over
 *    the whole card (default all); the blank the next Space shows has `data-next` (YAZ-5053 round 3). The page shows everything (idea 21 is later); the Inbox steps one word, then one
 *    side, at a time (D18).
 *  - `[[link]]` is a pill: `<span class="wikilink" data-note-card-link="inner">` with the label, the unresolved class
 *    and the icon attributes `look.link` gives (the note's own pill rules, `wikilinkPlugin.ts`); an `![[embed]]` stays
 *    its text; a link to a note card (YAZ-5030, `look.link` gives `card`) is the card pill, title, ID and card icon.
 *    `look.image` gives an image's URL (the vault's `app://vault/…`, `imageSrc.ts`); Obsidian's `alt|300`
 *    is the width. Without `look`, a link shows its text and an image keeps its source.
 *  - A sound (`![](x.mp3)`, `![[x.mp3]]`; YAZ-5014) is the one-line player, its URL by `look.image`; a board embed
 *    (`![[x.excalidraw]]`, `![[x.drawio]]`; YAZ-5015) is the board's still picture, its file by `look.board` (no
 *    `look.board`: its text; it does not resolve: the unresolved pill). Both are built AFTER DOMPurify from a marker
 *    span, as the hidden words are (`noteCardMedia.ts`).
 */
import DOMPurify from 'dompurify'
import { Marked, type TokenizerAndRendererExtension, type Tokens } from 'marked'
import { cardSides, hiddenCount, markHidden } from '@shared/cardText'
import type { HotkeyOverrides } from '@shared/hotkeyBindings'
import type { GestureAction, MouseMods } from '@shared/keys'
import { parseAlt } from '../image/imageSrc'
import { cardPillSpan } from '../wikilink/wikilinkPlugin'
import { linkClickAction } from '../linkGesture'
import { audioPlayer, boardPicture, isAudioRef, isBoardRef, missingBoard, NOTE_CARD_AUDIO_ATTR, NOTE_CARD_BOARD_ATTR, type NoteCardBoardLook } from './noteCardMedia'

/** How much of the card shows (the Inbox's steps, D18). Absent: everything, as in the page. */
export interface NoteCardShow {
  /** How many sides show, from the first. */
  sides?: number
  /** How many hidden words show, in page order over the whole card. */
  shown?: number
}

/** What a `[[link]]` shows: its label, whether it resolves, and the icon attributes of its page (`LinkLook`). */
export interface NoteCardLink {
  label: string
  resolved: boolean
  attrs?: Record<string, string>
  /** A link to a note card (YAZ-5030): the card's ID, drawn small after the title, with the card icon (`cardPillSpan`). */
  card?: string
}

/** The host's look-ups: the note's link pills and its image URLs. Each absent one leaves the text as written. */
export interface NoteCardLook {
  link?: (inner: string) => NoteCardLink
  image?: (src: string) => string
  /** A board embed's file (YAZ-5015): its root and path, or null when it does not resolve. Absent: the embed's text. */
  board?: NoteCardBoardLook
}

/** On a pill: the raw `inner` of its `[[inner]]`, for the click (`noteCardView.ts`, `review/noteCardParts.tsx`). */
export const NOTE_CARD_LINK_ATTR = 'data-note-card-link'

/**
 * Where a press on a pill in a card opens its page (idea 6), for the page and the screens alike: a plain click on top
 * (Explore), a bound gesture (⌘-click by default) as the note's links; another modifier, nowhere (null).
 */
export const noteCardLinkWhere = (event: MouseMods, hotkeys: HotkeyOverrides | undefined): GestureAction | 'explore' | null =>
  linkClickAction({ editable: true }, event, hotkeys) ?? (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey ? null : 'explore')

const OPEN = ''
const CLOSE = ''
const PLACEHOLDER_RE = /(\d+)/g

const escapeHtml = (text: string): string => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

interface LinkToken extends Tokens.Generic {
  inner: string
  embed: boolean
}

/** `[[inner]]` → a pill span; `![[inner]]` → its text. Before marked's own links, which would read `[x]`. */
const wikilinks: TokenizerAndRendererExtension = {
  name: 'noteCardLink',
  level: 'inline',
  start(src) {
    const at = src.indexOf('[[')
    return at < 0 ? undefined : at > 0 && src[at - 1] === '!' ? at - 1 : at
  },
  tokenizer(src) {
    const m = /^(!?)\[\[([^[\]\n]+?)\]\]/.exec(src)
    return m === null ? undefined : ({ type: 'noteCardLink', raw: m[0], inner: m[2], embed: m[1] === '!' } as LinkToken)
  },
  renderer(token) {
    const { inner, embed, raw } = token as LinkToken
    // A sound or a board: a marker span DOMPurify keeps as text, built into its DOM after (`applyLook`).
    if (embed && isAudioRef(inner)) return `<span ${NOTE_CARD_AUDIO_ATTR}="${escapeHtml(inner.split('|')[0].trim())}">${escapeHtml(raw)}</span>`
    if (embed && isBoardRef(inner)) return `<span ${NOTE_CARD_BOARD_ATTR}="${escapeHtml(inner)}">${escapeHtml(raw)}</span>`
    return embed ? escapeHtml(raw) : `<span class="wikilink" ${NOTE_CARD_LINK_ATTR}="${escapeHtml(inner)}">${escapeHtml(inner)}</span>`
  },
}

const markdown = new Marked({ gfm: true, breaks: true })
// A task box is a glyph, as in a comment: no `<input>` survives the sanitiser.
markdown.use({ extensions: [wikilinks], renderer: { checkbox: ({ checked }) => (checked ? '☑ ' : '☐ ') } })

const PURIFY = { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input', 'button', 'select', 'textarea'] }

let purifier: ReturnType<typeof DOMPurify> | null = null
/** The card's own DOMPurify copy: hooks another part of the app adds to the shared one never reach it. */
function sanitize(html: string): DocumentFragment {
  purifier ??= DOMPurify(window)
  return purifier.sanitize(html, { ...PURIFY, RETURN_DOM_FRAGMENT: true })
}

/** One side's or one hidden word's Markdown as a sanitised fragment. */
const fragmentOf = (text: string, inline: boolean): DocumentFragment => sanitize(inline ? markdown.parseInline(text, { async: false }) : markdown.parse(text, { async: false }))

/** The text nodes of `root` that hold a placeholder. */
function placeholderTexts(root: Node): Text[] {
  const found: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) if (node.nodeValue?.includes(OPEN) === true) found.push(node as Text)
  return found
}

/** Each placeholder of `root` as its hidden word: the word highlighted while `n < shown`, else a blank. */
function fillHidden(root: Node, words: readonly string[], shown: number): void {
  for (const text of placeholderTexts(root)) {
    const value = text.nodeValue ?? ''
    const out = document.createDocumentFragment()
    let from = 0
    for (const m of value.matchAll(PLACEHOLDER_RE)) {
      if (m.index > from) out.append(value.slice(from, m.index))
      const n = Number(m[1])
      const word = words[n] ?? ''
      // The same two spans either way (YAZ-5013): only the class (and what a screen reader hears) differs.
      const span = document.createElement('span')
      const inner = document.createElement('span')
      inner.className = 'note-card__word'
      inner.append(fragmentOf(word, true))
      span.className = n < shown ? 'note-card__hidden' : 'note-card__blank'
      if (n >= shown) {
        span.setAttribute('role', 'img')
        span.setAttribute('aria-label', 'Hidden word')
        inner.setAttribute('aria-hidden', 'true')
      }
      span.dataset.hidden = String(n)
      // YAZ-5053 round 3: the blank the next Space shows (the Inbox's step, never computed again elsewhere).
      if (n === shown) span.dataset.next = ''
      span.append(inner)
      out.append(span)
      from = m.index + m[0].length
    }
    if (from < value.length) out.append(value.slice(from))
    text.replaceWith(out)
  }
  // A placeholder in an attribute (an image's alt): the word, or nothing while it hides.
  for (const el of (root as ParentNode).querySelectorAll<HTMLElement>('[alt], [title]')) {
    for (const name of ['alt', 'title']) {
      const value = el.getAttribute(name)
      if (value?.includes(OPEN) === true) el.setAttribute(name, value.replace(PLACEHOLDER_RE, (_, n: string) => (Number(n) < shown ? (words[Number(n)] ?? '') : '…')))
    }
  }
}

const BLANK = '.note-card__blank'
const BLOCK = /^(P|DIV|LI|H[1-6]|BLOCKQUOTE|PRE|TR|UL|OL)$/

/** The plain text of copied nodes: a line break for `<br>` and after each block. */
function plainText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? ''
  const el = node as Element
  if (el.tagName === 'BR') return '\n'
  const inner = [...node.childNodes].map(plainText).join('')
  return node.nodeType === Node.ELEMENT_NODE && BLOCK.test(el.tagName) && !inner.endsWith('\n') ? `${inner}\n` : inner
}

/**
 * A copy of a selection over a blank (YAZ-5013): the blank's word stays out. `user-select: none` keeps it out of the
 * browser's own copy; this covers a selection that starts or ends inside it. A selection with no blank is the browser's.
 */
export function copyWithoutHidden(event: ClipboardEvent): void {
  const box = event.currentTarget
  const selection = document.getSelection()
  if (!(box instanceof Element) || selection === null || selection.rangeCount === 0 || event.clipboardData === null) return
  const range = selection.getRangeAt(0)
  if (![...box.querySelectorAll(BLANK)].some((blank) => range.intersectsNode(blank))) return
  const common = range.commonAncestorContainer
  const inBlank = (common instanceof Element ? common : common.parentElement)?.closest(BLANK) != null
  const part = inBlank ? document.createDocumentFragment() : range.cloneContents()
  for (const blank of part.querySelectorAll(BLANK)) blank.replaceChildren()
  const html = document.createElement('div')
  html.append(part.cloneNode(true))
  event.preventDefault()
  event.stopPropagation()
  event.clipboardData.setData('text/plain', plainText(part).replace(/\n$/, ''))
  event.clipboardData.setData('text/html', html.innerHTML)
}

/**
 * The pills of `root` drawn again by `look`: each pill is made new — `wikilink`, `wikilink--unresolved` when it does
 * not resolve, and the icon's attributes, its `class` ADDED to those (YAZ-4974: it replaced `wikilink`, so the pill
 * lost its look). A pill made new drops the icon of the page it no longer opens.
 */
export function refreshNoteCardLook(root: ParentNode, look: NoteCardLook | undefined): void {
  if (look?.link === undefined) return
  for (const pill of root.querySelectorAll<HTMLElement>(`[${NOTE_CARD_LINK_ATTR}]`)) {
    const inner = pill.getAttribute(NOTE_CARD_LINK_ATTR) ?? ''
    const shown = look.link(inner)
    if (shown.card !== undefined) {
      const next = cardPillSpan(shown.label, shown.card)
      next.setAttribute(NOTE_CARD_LINK_ATTR, inner)
      pill.replaceWith(next)
      continue
    }
    const { class: icon, ...attrs } = shown.attrs ?? {}
    const next = document.createElement('span')
    for (const [name, value] of Object.entries(attrs)) next.setAttribute(name, value)
    next.setAttribute(NOTE_CARD_LINK_ATTR, inner)
    next.className = ['wikilink', shown.resolved ? '' : 'wikilink--unresolved', icon ?? ''].filter((c) => c !== '').join(' ')
    next.textContent = shown.label
    pill.replaceWith(next)
  }
}

/** The sounds of `root` as players and its board embeds as pictures (YAZ-5014, YAZ-5015): made after the sanitiser. */
function buildMedia(root: ParentNode, look: NoteCardLook | undefined): void {
  const url = (src: string) => (look?.image === undefined ? src : look.image(src))
  for (const marker of root.querySelectorAll<HTMLElement>(`span[${NOTE_CARD_AUDIO_ATTR}]`)) {
    const src = marker.getAttribute(NOTE_CARD_AUDIO_ATTR) ?? ''
    marker.replaceWith(audioPlayer(url(src), src.slice(src.lastIndexOf('/') + 1)))
  }
  for (const img of root.querySelectorAll('img')) {
    const src = img.getAttribute('src')
    if (src === null || !isAudioRef(src)) continue
    let name = src.split(/[?#]/)[0]
    name = name.slice(name.lastIndexOf('/') + 1)
    try {
      name = decodeURIComponent(name)
    } catch {
      // As written.
    }
    img.replaceWith(audioPlayer(url(src), name))
  }
  if (look?.board === undefined) return
  for (const marker of root.querySelectorAll<HTMLElement>(`span[${NOTE_CARD_BOARD_ATTR}]`)) {
    const inner = marker.getAttribute(NOTE_CARD_BOARD_ATTR) ?? ''
    const file = look.board(inner)
    marker.replaceWith(file === null ? missingBoard(inner) : boardPicture(inner, file.root, file.path))
  }
}

/** The pills' labels and looks, and the images' URLs and widths, by `look`. */
function applyLook(root: ParentNode, look: NoteCardLook | undefined): void {
  buildMedia(root, look)
  refreshNoteCardLook(root, look)
  for (const img of root.querySelectorAll('img')) {
    if (img.classList.contains('note-card__board-img')) continue
    const src = img.getAttribute('src')
    if (src !== null && look?.image !== undefined) img.setAttribute('src', look.image(src))
    const { text, width } = parseAlt(img.getAttribute('alt') ?? '')
    img.setAttribute('alt', text)
    if (width !== null) img.setAttribute('width', String(width))
  }
}

/**
 * The card `text` (its raw Markdown between the fences) as an element: `div.note-card__sides`, a
 * `div.note-card__side` for each side that shows, a `div.note-card__rule` between two. See the header.
 */
export function renderNoteCard(text: string, show: NoteCardShow = {}, look?: NoteCardLook): HTMLElement {
  const sides = cardSides(text)
  const count = Math.max(1, Math.min(sides.length, show.sides ?? sides.length))
  const shown = show.shown ?? Number.POSITIVE_INFINITY
  const out = document.createElement('div')
  out.className = 'note-card__sides'
  out.addEventListener('copy', copyWithoutHidden)
  let from = 0
  for (let i = 0; i < count; i++) {
    const words: string[] = []
    const marked = markHidden(
      sides[i],
      (word, n) => {
        words[n] = word
        return `${OPEN}${n}${CLOSE}`
      },
      from,
    )
    const side = document.createElement('div')
    side.className = 'note-card__side'
    side.dataset.side = String(i)
    side.append(fragmentOf(marked, false))
    fillHidden(side, words, shown)
    applyLook(side, look)
    if (i > 0) {
      const rule = document.createElement('div')
      rule.className = 'note-card__rule'
      rule.setAttribute('role', 'separator')
      out.append(rule)
    }
    out.append(side)
    from += hiddenCount(sides[i])
  }
  return out
}
