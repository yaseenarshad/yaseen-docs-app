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
 *    `.note-card__hidden` (the word, highlighted) while it shows, `.note-card__blank` (empty, about the word's width,
 *    so a selection cannot read it) while it does not.
 *  - `show.sides`: how many sides show (default all); `show.shown`: how many hidden words show, in page order over
 *    the whole card (default all). The page shows everything (idea 21 is later); the Inbox steps one word, then one
 *    side, at a time (D18).
 *  - `[[link]]` is a pill: `<span class="wikilink" data-note-card-link="inner">` with the label, the unresolved class
 *    and the icon attributes `look.link` gives (the note's own pill rules, `wikilinkPlugin.ts`); an `![[embed]]` stays
 *    its text. `look.image` gives an image's URL (the vault's `app://vault/…`, `imageSrc.ts`); Obsidian's `alt|300`
 *    is the width. Without `look`, a link shows its text and an image keeps its source.
 */
import DOMPurify from 'dompurify'
import { Marked, type TokenizerAndRendererExtension, type Tokens } from 'marked'
import { cardSides, hiddenCount, markHidden } from '@shared/cardText'
import { parseAlt } from '../image/imageSrc'

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
}

/** The host's look-ups: the note's link pills and its image URLs. Each absent one leaves the text as written. */
export interface NoteCardLook {
  link?: (inner: string) => NoteCardLink
  image?: (src: string) => string
}

/** On a pill: the raw `inner` of its `[[inner]]`, for the click (`noteCardView.ts`). */
export const NOTE_CARD_LINK_ATTR = 'data-note-card-link'
export const NOTE_CARD_HIDDEN_CLASS = 'note-card__hidden'
export const NOTE_CARD_BLANK_CLASS = 'note-card__blank'

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
      const span = document.createElement('span')
      if (n < shown) {
        span.className = NOTE_CARD_HIDDEN_CLASS
        span.append(fragmentOf(word, true))
      } else {
        span.className = NOTE_CARD_BLANK_CLASS
        span.setAttribute('aria-label', 'Hidden word')
        // About the word's width, never its text (D18: a selection cannot read it).
        span.style.width = `${Math.min(24, Math.max(3, word.trim().length))}ch`
      }
      span.dataset.hidden = String(n)
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

/** The pills' labels and looks, and the images' URLs and widths, by `look`. */
function applyLook(root: ParentNode, look: NoteCardLook | undefined): void {
  for (const pill of root.querySelectorAll<HTMLElement>(`[${NOTE_CARD_LINK_ATTR}]`)) {
    const shown = look?.link?.(pill.getAttribute(NOTE_CARD_LINK_ATTR) ?? '')
    if (shown === undefined) continue
    pill.textContent = shown.label
    pill.classList.toggle('wikilink--unresolved', !shown.resolved)
    for (const [name, value] of Object.entries(shown.attrs ?? {})) pill.setAttribute(name, value)
  }
  for (const img of root.querySelectorAll('img')) {
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
