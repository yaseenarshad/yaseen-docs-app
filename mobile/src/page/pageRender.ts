import { isAudioRef } from '@client/editor/card/cardMedia'
import { LOCAL_SRC, cleanLocal, localMark, urlOf } from '@client/editor/card/localOnly'
import { parseAlt } from '@client/editor/image/imageSrc'
import { cardIdOf, parseCardLine } from '@shared/cardLine'
import { Marked, type TokenizerAndRendererExtension, type Tokens } from 'marked'

/**
 * A PAGE, READ ONLY, WITH NO EDITOR (YAZ-5079, 4C). The Mac reads a page with its editor (`useReadOnlyPage`: Crepe,
 * ProseMirror), which never reaches the phone. The phone draws the page's Markdown with the two libraries the Mac
 * already uses to draw a card and a comment (`renderCard`, `comments/markdown.ts`): `marked` (GitHub flavour; a single
 * line break is a line break, as the Mac's page shows it, `softBreaks.css`) and DOMPurify. This file is in a chunk of
 * its own: Search does not load it.
 *
 * A page is the person's own text, but it can come from git or an agent, so it is untrusted: DOMPurify keeps document
 * markup only. No script, style, frame, form or control; no handler; no `javascript:` address. The phone's own marks
 * (links, embeds, cards) are data attributes that DOMPurify keeps, and that this file turns into elements AFTER it,
 * with `textContent` and `setAttribute`, never with HTML.
 *
 * What the page shows, as on the Mac:
 *  - Headings, paragraphs, bold, italic, strike, code, `==highlight==`, `<u>`, lists, task boxes (a mark, not a
 *    control: no ticking in stage one), tables (in a box that scrolls sideways), code blocks, quotes, rules.
 *  - A callout (`> [!tip] Title`): a box with its title. The Mac's page shows it as a quote; the phone draws it as
 *    Obsidian and GitHub do (the brief lists callouts; recorded on YAZ-5079).
 *  - `[[link]]`: what `look.link` says: a page, a card or a file opens; a broken link keeps its text, marked missing.
 *  - `![[ID]]` of a card: a box the page view fills with the card (round 15, item 1); an ID no card has: "Missing card ·
 *    ID", as the Mac. A picture or a sound waits for its bytes (`data-vault-src`, `data-vault-sound`): the address is
 *    never one the browser fetches. A drawing: "Open it on the Mac" (C3). A picture from the web: a calm line, because
 *    the page's CSP loads none (decision 8, round 12 item 13).
 *  - The page's own card (a `card` fence): drawn read only by `look.card` (`renderCard`); its card line is out of sight.
 *  - Web links open in Safari (`target="_blank"`); a link to a vault file opens it (`data-open`).
 *
 * A long page draws in slices (`renderPage`'s `slice`): it is cut between blocks (`cutAt`, never inside a code fence),
 * and each piece is parsed, cleaned and drawn on its own, so a 2 MB page never holds the thread for a long task.
 * A page under `ONE_PIECE` characters is one piece, so a reference link or a list reads as it does on the Mac. Above
 * it, a definition in another piece is not found, and an ordered list cut between items starts again at its number.
 */

/** What a `[[link]]` opens. */
export type LinkOpen = { kind: 'page'; path: string } | { kind: 'card'; path: string; id: string } | { kind: 'file'; path: string }

export interface LinkShow {
  /** The text the link shows (the Mac's `linksAsShown`: a title for an ID, the words after `|`). */
  label: string
  /** What a tap opens; null: the link is broken. */
  open: LinkOpen | null
  /** A broken link's words for VoiceOver ("Missing page · DEMO-9"). */
  missing?: string
}

/** What an `![[embed]]` is. */
export type EmbedShow =
  | { kind: 'card'; id: string }
  | { kind: 'missing-card'; id: string }
  | { kind: 'picture'; path: string; alt: string }
  | { kind: 'sound'; path: string }
  | { kind: 'drawing'; name: string }
  | { kind: 'file'; path: string; name: string }
  | { kind: 'text'; text: string }

/** The vault's look-ups, from the index (`pageLook.ts`); the tests give their own. */
export interface PageLook {
  link(inner: string): LinkShow
  embed(inner: string): EmbedShow
  /** A Markdown link's or picture's address as written → the vault file, or null (none, or not in the vault). */
  asset(src: string): string | null
  /** The page's own card, drawn read only (`renderCard`). */
  card(text: string): HTMLElement
}

export type Slice = () => Promise<void>

/** For the speed test: the time each piece of a long page took to draw, in ms. */
export interface PieceStats {
  times: number[]
}

/** A page this long or shorter is one piece. */
export const ONE_PIECE = 64_000
/** The first piece of a longer page; it shrinks while a piece takes too long. */
const FIRST_PIECE = 1_500
const SLOW_PIECE_MS = 10
const QUICK_PIECE_MS = 4
const SMALLEST_PIECE = 1_000
const LARGEST_PIECE = 8_000

/** A small text with each kind of block: drawn once, cold, in its own slices, so the first real piece is not slow. */
const WARM_UP = ['w', '## w\n\n**b** *i* `c`', '[[l]] [a](#a) ==h==', '- x\n- [ ] y', '| a | b |\n| - | - |\n| 1 | 2 |', '> q\n\n```\nc\n```']
let warm = false

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

interface LinkToken extends Tokens.Generic {
  inner: string
  embed: boolean
}

/** `[[inner]]` and `![[inner]]`, as the card's tokenizer reads them (`cardRender.ts`): before marked's own links. */
const wikilinks: TokenizerAndRendererExtension = {
  name: 'pageLink',
  level: 'inline',
  start(src) {
    const at = src.indexOf('[[')
    return at < 0 ? undefined : at > 0 && src[at - 1] === '!' ? at - 1 : at
  },
  tokenizer(src) {
    const m = /^(!?)\[\[([^[\]\n]+?)\]\]/.exec(src)
    return m === null ? undefined : ({ type: 'pageLink', raw: m[0], inner: m[2], embed: m[1] === '!' } as LinkToken)
  },
  renderer(token) {
    const { inner, embed } = token as LinkToken
    return embed ? `<span ${localMark('page-embed')}="${escapeHtml(inner)}"></span>` : `<a ${localMark('page-link')}="${escapeHtml(inner)}"></a>`
  },
}

/** `==text==`: the Mac's yellow highlight (`marks/highlight.ts`). */
const highlight: TokenizerAndRendererExtension = {
  name: 'highlight',
  level: 'inline',
  start(src) {
    const at = src.indexOf('==')
    return at < 0 ? undefined : at
  },
  tokenizer(src) {
    const m = /^==(?=\S)([^=\n]*?\S)==/.exec(src)
    return m === null ? undefined : { type: 'highlight', raw: m[0], text: m[1], tokens: this.lexer.inlineTokens(m[1]) }
  },
  renderer(token) {
    return `<mark>${this.parser.parseInline(token.tokens ?? [])}</mark>`
  },
}

/** `[^id]`: a footnote mark (as the Mac's GFM page). A table's cell note (`[^cell-N]`, YAZ-3818) is a small mark. */
const footnoteRef: TokenizerAndRendererExtension = {
  name: 'footnoteRef',
  level: 'inline',
  start(src) {
    const at = src.indexOf('[^')
    return at < 0 ? undefined : at
  },
  tokenizer(src) {
    const m = /^\[\^([^\]\s]+)\](?!:)/.exec(src)
    return m === null ? undefined : { type: 'footnoteRef', raw: m[0], id: m[1] }
  },
  renderer(token) {
    const id = String(token.id)
    if (/^cell-/i.test(id)) return '<sup class="page-cellnote" role="img" aria-label="Cell note">•</sup>'
    return `<sup class="page-fnref"><a href="#fn-${escapeHtml(id)}">${escapeHtml(id)}</a></sup>`
  },
}

/** `[^id]: text`: the note, where it is written (as the Mac's page). A cell note stays hidden under its table (YAZ-3818). */
const footnoteDef: TokenizerAndRendererExtension = {
  name: 'footnoteDef',
  level: 'block',
  start(src) {
    return /^\[\^[^\]\s]+\]:/m.exec(src)?.index
  },
  tokenizer(src) {
    const m = /^\[\^([^\]\s]+)\]:[ \t]*([^\n]*(?:\n(?![ \t]*\n)(?!\[\^)[^\n]*)*)(?:\n+|$)/.exec(src)
    return m === null ? undefined : { type: 'footnoteDef', raw: m[0], id: m[1], tokens: this.lexer.inlineTokens(m[2]) }
  },
  renderer(token) {
    const id = String(token.id)
    if (/^cell-/i.test(id)) return ''
    return `<div class="page-footnote" id="fn-${escapeHtml(id)}"><span class="page-footnote__label">${escapeHtml(id)}</span>${this.parser.parseInline(token.tokens ?? [])}</div>`
  },
}

/**
 * `$$ … $$` alone: block math. The Mac draws no math (its Latex feature is off, YAZ-977: dollars are text), and a math
 * library is heavy: the phone shows the source in a code block. `$…$` inside a line stays text, as on the Mac.
 */
const blockMath: TokenizerAndRendererExtension = {
  name: 'blockMath',
  level: 'block',
  start(src) {
    return /^\$\$/m.exec(src)?.index
  },
  tokenizer(src) {
    const m = /^\$\$([\s\S]+?)\$\$[ \t]*(?:\n+|$)/.exec(src)
    return m === null ? undefined : { type: 'blockMath', raw: m[0], text: m[1].trim() }
  },
  renderer(token) {
    return `<pre class="page-math"><code>${escapeHtml(String(token.text))}</code></pre>`
  },
}

/** One parse: the page's own cards it met, in order, with the ID of the card line under each. */
interface Parse {
  cards: { text: string; id: string | null }[]
}
let parse: Parse = { cards: [] }

const markdown = new Marked({ gfm: true, breaks: true })
markdown.use({
  extensions: [blockMath, footnoteDef, wikilinks, footnoteRef, highlight],
  renderer: {
    checkbox: ({ checked }) => `<span class="page-task" role="img" aria-label="${checked ? 'Done' : 'Not done'}" ${localMark('checked')}="${checked}"></span> `,
    code(token) {
      if (token.lang?.trim() !== 'card') return false
      parse.cards.push({ text: token.text, id: null })
      return `<div ${localMark('page-card')}="${parse.cards.length - 1}"></div>`
    },
    html({ text }) {
      // A comment shows nothing. A card line (`<!-- card: ID, … -->`) under a card gives that card its ID.
      if (/^\s*<!--\s*card:[\s\S]*?-->\s*$/.test(text)) {
        const last = parse.cards.at(-1)
        const line = parseCardLine(text.trim())
        if (last !== undefined && last.id === null && line !== null) last.id = cardIdOf(line)
        return ''
      }
      return /^\s*<!--/.test(text) ? '' : false
    },
  },
})

/**
 * The page's text cleaned by THE phone's allow list (`cleanLocal`, `client/src/editor/card/localOnly.ts`), which every
 * card on the phone goes through too: document markup only, and nothing that loads from another host (YAZ-5208).
 */
const clean = (html: string): DocumentFragment => cleanLocal(html)

const WEB = /^(https?:|mailto:|tel:)/i
const SCHEME = /^[a-z][a-z0-9+.-]*:/i

function decoded(src: string): string {
  try {
    return decodeURIComponent(src)
  } catch {
    return src
  }
}

/** A quiet line in place of something the phone does not draw. */
function mediaLine(kind: 'missing' | 'board', text: string): HTMLElement {
  const el = document.createElement('span')
  el.className = `page-media page-media--${kind}`
  el.textContent = text
  return el
}

function picture(path: string, alt: string): HTMLImageElement {
  const { text, width } = parseAlt(alt)
  const img = document.createElement('img')
  img.className = 'page-picture'
  img.alt = text
  img.dataset.vaultSrc = path
  if (width !== null) img.width = width
  return img
}

function sound(path: string): HTMLElement {
  const el = document.createElement('div')
  el.className = 'page-sound'
  el.dataset.vaultSound = path
  el.textContent = path.slice(path.lastIndexOf('/') + 1)
  return el
}

/** Marks an `<a>` as one the page view opens: no address the browser follows. */
function opens(a: HTMLAnchorElement, open: LinkOpen): void {
  a.setAttribute('href', '#')
  a.dataset.open = open.kind
  a.dataset.path = open.path
  if (open.kind === 'card') a.dataset.card = open.id
}

function drawLinks(root: DocumentFragment, look: PageLook): void {
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a')) {
    const inner = a.getAttribute('data-page-link')
    if (inner !== null) {
      a.removeAttribute('data-page-link')
      const show = look.link(inner)
      a.textContent = show.label
      a.className = show.open === null ? 'wikilink wikilink--unresolved' : show.open.kind === 'card' ? 'wikilink wikilink--card' : 'wikilink'
      if (show.open !== null) opens(a, show.open)
      else {
        a.removeAttribute('href')
        a.setAttribute('role', 'link')
        a.tabIndex = 0
        if (show.missing !== undefined) a.setAttribute('aria-label', show.missing)
      }
      continue
    }
    // Every other link, by what the browser would open (`urlOf`, YAZ-5243): the web opens Safari; mail stays; a part of
    // the page stays; a vault file opens in the app; anything else is text. A class from the text changes nothing.
    const web = a.classList.contains('page-media--web')
    a.removeAttribute('class')
    const href = a.getAttribute('href')
    if (href === null) continue
    const { kind, href: url } = urlOf(href)
    if (kind === 'web') {
      if (web) a.className = 'page-media page-media--web'
      a.setAttribute('href', url)
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      continue
    }
    if (kind === 'mail' || (kind === 'path' && href.trim().startsWith('#'))) continue
    const path = kind === 'path' ? look.asset(href.split('#')[0]) : null
    if (path === null) a.removeAttribute('href')
    else opens(a, /\.(md|markdown)$/i.test(path) ? { kind: 'page', path } : { kind: 'file', path })
  }
}

function drawPictures(root: DocumentFragment, look: PageLook): void {
  // A web picture is a link already (`cleanLocal`). A vault picture holds its path in `data-local-src`: no address.
  for (const img of root.querySelectorAll<HTMLImageElement>('img')) {
    const src = img.getAttribute(LOCAL_SRC)
    const alt = img.getAttribute('alt') ?? ''
    if (src === null) {
      if (urlOf(img.getAttribute('src') ?? '').kind !== 'own') img.remove()
      continue
    }
    const path = look.asset(src)
    if (path === null) img.replaceWith(mediaLine('missing', `Missing picture · ${decoded(src)}`))
    else if (isAudioRef(path)) img.replaceWith(sound(path))
    else img.replaceWith(picture(path, alt))
  }
}

function drawEmbeds(root: DocumentFragment, look: PageLook): void {
  for (const span of root.querySelectorAll<HTMLElement>('span[data-page-embed]')) {
    const inner = span.getAttribute('data-page-embed') ?? ''
    const show = look.embed(inner)
    let el: Node
    switch (show.kind) {
      case 'card': {
        const box = document.createElement('div')
        box.className = 'card-embed'
        box.dataset.cardEmbed = show.id
        el = box
        break
      }
      case 'missing-card': {
        const box = document.createElement('div')
        box.className = 'card-embed card-embed--missing'
        box.textContent = `Missing card · ${show.id}`
        el = box
        break
      }
      case 'picture':
        el = picture(show.path, show.alt)
        break
      case 'sound':
        el = sound(show.path)
        break
      case 'drawing':
        el = mediaLine('board', `Drawing · ${show.name} · Open it on the Mac`)
        break
      case 'file': {
        const a = document.createElement('a')
        a.className = 'wikilink'
        a.textContent = show.name
        opens(a, { kind: 'file', path: show.path })
        el = a
        break
      }
      case 'text':
        el = document.createTextNode(show.text)
        break
    }
    // A card box is a block: alone in its paragraph, it takes the paragraph's place.
    const p = span.parentElement
    if (show.kind.endsWith('card') && p?.tagName === 'P' && p.childNodes.length === 1) p.replaceWith(el)
    else span.replaceWith(el)
  }
}

function drawCards(root: DocumentFragment, look: PageLook, cards: Parse['cards']): void {
  for (const slot of root.querySelectorAll<HTMLElement>('div[data-page-card]')) {
    const card = cards[Number(slot.getAttribute('data-page-card'))]
    slot.removeAttribute('data-page-card')
    if (card === undefined) continue
    slot.className = 'card page-card'
    if (card.id !== null) slot.dataset.cardId = card.id
    // The Mac's card box: the sides in `.card__body` (`card.css` spaces them and draws the rule across).
    const body = document.createElement('div')
    body.className = 'card__body'
    body.append(look.card(card.text))
    slot.append(body)
  }
}

/** `> [!tip] Title` (Obsidian, GitHub): the quote becomes a callout with that title. */
function drawCallouts(root: DocumentFragment): void {
  for (const quote of root.querySelectorAll('blockquote')) {
    const p = quote.firstElementChild
    const first = p?.tagName === 'P' ? p.firstChild : null
    if (p === null || p === undefined || first === null || first.nodeType !== Node.TEXT_NODE) continue
    const m = /^\s*\[!([\w-]+)\][+-]?[ \t]*/.exec(first.nodeValue ?? '')
    if (m === null) continue
    first.nodeValue = (first.nodeValue ?? '').slice(m[0].length)
    const title = document.createElement('div')
    title.className = 'page-callout__title'
    // The title is the rest of the first line: the nodes before the first line break.
    while (p.firstChild !== null && p.firstChild.nodeName !== 'BR') title.append(p.firstChild)
    p.firstChild?.remove()
    if ((title.textContent ?? '').trim() === '') title.textContent = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()
    if (p.childNodes.length === 0) p.remove()
    quote.className = 'page-callout'
    quote.setAttribute('data-callout', m[1].toLowerCase())
    quote.prepend(title)
  }
}

function boxTables(root: DocumentFragment): void {
  for (const table of root.querySelectorAll('table')) {
    const box = document.createElement('div')
    box.className = 'page-table'
    table.replaceWith(box)
    box.append(table)
  }
}

/** One piece of a page as clean elements. */
export function renderPiece(text: string, look: PageLook): DocumentFragment {
  parse = { cards: [] }
  const html = markdown.parse(text, { async: false })
  const { cards } = parse
  const root = clean(html)
  drawLinks(root, look)
  drawPictures(root, look)
  drawEmbeds(root, look)
  drawCards(root, look, cards)
  drawCallouts(root)
  boxTables(root)
  return root
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/

/**
 * Where the piece that starts at `from` ends: after the first blank line at or past `from + size`, outside a code fence.
 * The whole rest when there is none.
 */
export function cutAt(text: string, from: number, size: number): number {
  let fence: string | null = null
  let at = from
  while (at < text.length) {
    const nl = text.indexOf('\n', at)
    const end = nl === -1 ? text.length : nl + 1
    const line = text.slice(at, nl === -1 ? text.length : nl)
    const m = FENCE.exec(line)
    if (m !== null) {
      if (fence === null) fence = m[1][0]
      else if (m[1][0] === fence) fence = null
    }
    if (fence === null && line.trim() === '' && end - from >= size) return end
    at = end
  }
  return text.length
}

/** The pieces of `text` of about `size` characters each (`cutAt`). Joined, they are `text`. */
export function splitBlocks(text: string, size: number): string[] {
  const out: string[] = []
  for (let from = 0; from < text.length; ) {
    const end = cutAt(text, from, size)
    out.push(text.slice(from, end))
    from = end
  }
  return out.length === 0 ? [text] : out
}

/**
 * Draws `body` (a page's Markdown, its properties left out) into `into`, in place of what it held. A long page draws
 * piece by piece, with `slice()` between pieces. `live()` false: stop (the page changed again, or closed).
 */
export async function renderPage(body: string, look: PageLook, into: HTMLElement, slice?: Slice, live: () => boolean = () => true, stats?: PieceStats): Promise<void> {
  if (slice === undefined) {
    into.replaceChildren(renderPiece(body, look))
    return
  }
  // YAZ-5244: the first start of `marked` and DOMPurify is slow (40 to 50 ms of CPU in jsdom), also for a short page (the
  // first that opens). It runs once, cut into its own slices: the cleaner, then small texts with each kind of block.
  // Then the pieces of a long page start small and grow while they are quick.
  if (!warm) {
    cleanLocal('<p>w</p>')
    await slice()
    for (const text of WARM_UP) {
      renderPiece(text, look)
      await slice()
    }
    warm = true
    if (!live()) return
  }
  if (body.length <= ONE_PIECE) {
    into.replaceChildren(renderPiece(body, look))
    return
  }
  let size = FIRST_PIECE
  let first = true
  for (let from = 0; from < body.length; ) {
    const end = cutAt(body, from, size)
    const t0 = performance.now()
    const piece = renderPiece(body.slice(from, end), look)
    // The first piece replaces the old page at once; the rest are added as they come.
    if (first) into.replaceChildren(piece)
    else into.append(piece)
    first = false
    const ms = performance.now() - t0
    stats?.times.push(ms)
    if (ms > SLOW_PIECE_MS && size > SMALLEST_PIECE) size = Math.max(SMALLEST_PIECE, Math.floor(size / 2))
    else if (ms < QUICK_PIECE_MS && size < LARGEST_PIECE) size = Math.min(LARGEST_PIECE, size * 2)
    from = end
    await slice()
    if (!live()) return
  }
  if (first) into.replaceChildren()
}
