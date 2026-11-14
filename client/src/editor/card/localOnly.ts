import DOMPurify from 'dompurify'

/**
 * LOCAL MEDIA ONLY (YAZ-5208, YAZ-5209): the ONE sanitiser of the phone. Each page (`mobile/src/page/pageRender.ts`) and
 * each card (`renderCard` with `onlyLocalMedia()`: the page's own card, an embedded card, the card view, Review) goes
 * through it, so a page's or a card's text can make the phone load nothing from another host. A request there would
 * tell a third party that the page was opened, and the phone's CSP would block it noisily.
 *
 * It is an ALLOW LIST, on the inert document of the parse, so nothing is fetched while it works:
 *  - Elements: document markup only (`TAGS`). No script, style, frame, object, form, control, SVG, meta, base or link.
 *  - Attributes: `ATTRS`, ARIA and `data-*`. No `style` (so no `url()`, `image-set()` or `@import`), no `srcset`,
 *    `poster`, `background`, `ping`, `action`, `target`, `xlink:href`.
 *  - Then each element's attributes are read one by one (`keepLocal`): `href` stays only on `<a>`, for a web address,
 *    `mailto:`, `tel:`, `#…` or a vault path. `src` stays only for `data:` and `blob:` (the app's own bytes). Any other
 *    value that names a host (`scheme://`, `//host`, `url(`) goes.
 *  - A picture, a sound or a video whose source is on the web becomes a LINK that the person may tap (Safari: a new
 *    browsing context, no opener, no referrer). The app never fetches it.
 *  - A vault picture keeps its path as `data-local-src` (no address); the page or the card resolves it to the vault's
 *    bytes (3D's media).
 */

/** What may stay. Everything else is dropped (its text kept). */
const TAGS = [
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'code', 'col', 'colgroup', 'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em',
  'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'q',
  's', 'samp', 'section', 'small', 'span', 'strike', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th',
  'thead', 'tr', 'u', 'ul', 'var', 'wbr',
  // Kept only to turn them into a link or a calm line (`finish`): they never load.
  'video', 'audio', 'source',
]
const ATTRS = ['href', 'src', 'alt', 'title', 'class', 'id', 'role', 'colspan', 'rowspan', 'align', 'width', 'height', 'start', 'reversed', 'value', 'scope', 'abbr', 'headers', 'lang', 'dir', 'datetime', 'open']

/** The source of a vault file, before it is resolved: a path, with no address the browser would fetch. */
export const LOCAL_SRC = 'data-local-src'
/** A web source, until `finish` makes the element a link. */
const WEB_SRC = 'data-web-src'

/**
 * WHAT A URL IS, AS THE BROWSER WILL READ IT (YAZ-5242): the ONE test of the phone, for the page, the card and Review.
 * The WHATWG rules first: tab, new line and carriage return go from anywhere; C0 controls and spaces go from both ends.
 * Then the URL is parsed against the app's page (`base`), as the browser parses it, so `ht\ntps://host`, `\\host\x`,
 * `/\host`, `https:\\host` and `http:host` read as the address the browser would fetch.
 *  - `path`: a reference relative to the page (a vault path as a page writes it, or `#part`); it names no other host.
 *  - `own`: bytes the app holds: a `blob:` URL (of the app's own origin, or opaque), or a `data:` picture (an SVG
 *    in `<img>` loads nothing more: browsers run no script and fetch nothing from a picture).
 *  - `web`: `http:` or `https:` (on any host but the app's own); `mail`: `mailto:` or `tel:`.
 *  - `none`: anything else (`javascript:`, `data:` text or SVG, `file:`, another origin's `blob:`, a URL that fails to
 *    parse, an absolute URL of the app's own host).
 */
export type UrlKind = 'path' | 'own' | 'web' | 'mail' | 'none'

/** A base that no real URL has: a reference that keeps it is relative. */
const PROBE = 'https://relative.invalid/'

export function urlOf(value: string, base: string = location.href): { kind: UrlKind; href: string } {
  const clean = value.replace(/[\t\n\r]/g, '').replace(/^[\u0000- ]+|[\u0000- ]+$/g, '')
  if (clean === '') return { kind: 'none', href: '' }
  let url: URL
  try {
    // Relative, as the browser reads it against any page: it stays on the page's own host.
    if (new URL(clean, PROBE).origin === new URL(PROBE).origin) return { kind: 'path', href: clean }
    url = new URL(clean, base)
  } catch {
    return { kind: 'none', href: '' }
  }
  const own = new URL(base).origin
  switch (url.protocol) {
    case 'http:':
    case 'https:':
      return { kind: url.origin === own ? 'none' : 'web', href: url.href }
    case 'mailto:':
    case 'tel:':
      return { kind: 'mail', href: url.href }
    case 'blob:': {
      // A blob URL is bytes in this browser: no request leaves it. One that names ANOTHER origin is refused all the same.
      let origin: string | null = null
      try {
        origin = new URL(url.pathname).origin
      } catch {
        // Opaque (no origin in it): bytes of this page only.
      }
      return { kind: origin === null || origin === 'null' || origin === own ? 'own' : 'none', href: url.href }
    }
    case 'data:':
      return { kind: /^image\/(png|jpeg|gif|webp|avif|bmp|svg\+xml)[;,]/i.test(url.pathname) ? 'own' : 'none', href: url.href }
    default:
      return { kind: 'none', href: '' }
  }
}

/** A value that names a host or loads something, in any attribute: a web or script address, or a CSS loader. */
export const NAMES_A_HOST = (value: string): boolean => {
  if (/url\(|image-set\(|@import/i.test(value)) return true
  const { kind } = urlOf(value)
  return kind === 'web' || (kind === 'none' && /^[a-z][a-z0-9+.-]*:/i.test(value.replace(/[\t\n\r]/g, '').trim()) && !/^[a-z][a-z0-9+.-]*:\s/i.test(value.trim()))
}

/**
 * THE ONE RULE FOR `data-*` (YAZ-5280): no `data-*` attribute of the text survives. The app's own marks are not read
 * from the text: a renderer of the app (`pageRender.ts`, `renderCard`) writes each one under a secret name that this
 * page load made (`localMark`), the allow list keeps only those, and gives them their real names AFTER the clean
 * (`restoreMarks`). Text cannot guess the secret, so it cannot write `data-open`, `data-path`, `data-card-link`, or any
 * mark the app adds later.
 */
const SECRET = (() => {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
})()
const MARK_PREFIX = `data-m${SECRET}-`

/** `data-<name>` as a renderer of the app writes it into the HTML it gives `cleanLocal`. */
export const localMark = (name: string): string => `${MARK_PREFIX}${name.replace(/^data-/, '')}`

/** Each mark of the app gets its real name back (`data-<name>`), after the clean. */
function restoreMarks(root: DocumentFragment): void {
  for (const el of root.querySelectorAll('*'))
    for (const { name, value } of [...el.attributes])
      if (name.startsWith(MARK_PREFIX)) {
        el.removeAttribute(name)
        el.setAttribute(`data-${name.slice(MARK_PREFIX.length)}`, value)
      }
}

/** The allow list for one element's attributes (a DOMPurify hook: it runs on the inert document). */
function keepLocal(node: Element): void {
  const tag = node.tagName
  // The one rule for `data-*` (above): only the app's marks under the secret name stay.
  for (const { name } of [...node.attributes]) if (name.startsWith('data-') && !name.startsWith(MARK_PREFIX)) node.removeAttribute(name)
  for (const { name, value } of [...node.attributes]) {
    if (name === 'href') {
      const { kind, href } = urlOf(value)
      node.removeAttribute(name)
      if (tag !== 'A') continue
      if (kind === 'web' || kind === 'mail') node.setAttribute(name, href)
      else if (kind === 'path') node.setAttribute(name, value.replace(/[\t\n\r]/g, '').trim())
      continue
    }
    if (name === 'src') {
      node.removeAttribute(name)
      const { kind, href } = urlOf(value)
      if (tag === 'IMG' && kind === 'own') {
        node.setAttribute(name, href)
        continue
      }
      // A `<source>` gives its source to its video or audio.
      const holder = tag === 'SOURCE' && (node.parentElement?.tagName === 'VIDEO' || node.parentElement?.tagName === 'AUDIO') ? node.parentElement : node
      if (kind === 'web' && !holder.hasAttribute(WEB_SRC)) holder.setAttribute(WEB_SRC, href)
      else if (kind === 'path' && !holder.hasAttribute(LOCAL_SRC)) holder.setAttribute(LOCAL_SRC, value.replace(/[\t\n\r]/g, '').trim())
      continue
    }
    if (NAMES_A_HOST(value)) node.removeAttribute(name)
  }
  // A web link opens Safari: a new browsing context, no opener, no referrer.
  if (tag === 'A' && urlOf(node.getAttribute('href') ?? '').kind === 'web') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
}

const AUDIO = /\.(mp3|m4a|wav|ogg)([?#].*)?$/i
const nameOf = (src: string) => {
  const bare = src.split(/[?#]/)[0]
  try {
    return decodeURIComponent(bare.slice(bare.lastIndexOf('/') + 1))
  } catch {
    return bare.slice(bare.lastIndexOf('/') + 1)
  }
}

/** Web media become links; the rest of a video or an audio element becomes a calm line; `source` goes. */
function finish(root: DocumentFragment): void {
  const doc = root.ownerDocument
  for (const el of [...root.querySelectorAll<HTMLElement>(`[${WEB_SRC}]`)]) {
    const { kind: urlKind, href: url } = urlOf(el.getAttribute(WEB_SRC)!)
    if (urlKind !== 'web') {
      el.remove()
      continue
    }
    const kind = el.tagName === 'VIDEO' ? 'Video' : el.tagName === 'AUDIO' || AUDIO.test(url) ? 'Sound' : 'Picture'
    const a = doc.createElement('a')
    a.className = 'page-media page-media--web'
    a.setAttribute('href', url)
    a.setAttribute('target', '_blank')
    a.setAttribute('rel', 'noopener noreferrer')
    a.textContent = `${kind} from the web · ${el.getAttribute('alt') || nameOf(url)}`
    el.replaceWith(a)
  }
  for (const el of [...root.querySelectorAll('video, audio')]) {
    const src = el.getAttribute(LOCAL_SRC)
    const line = doc.createElement('span')
    line.className = 'page-media page-media--missing'
    line.textContent = `${el.tagName === 'VIDEO' ? 'Video' : 'Sound'}${src === null ? '' : ` · ${nameOf(src)}`} · Open it on the Mac`
    el.replaceWith(line)
  }
  for (const el of [...root.querySelectorAll('source')]) el.remove()
}

const CONFIG = {
  ALLOWED_TAGS: TAGS,
  ALLOWED_ATTR: ATTRS,
  ALLOW_DATA_ATTR: true,
  ALLOW_ARIA_ATTR: true,
  RETURN_DOM_FRAGMENT: true as const,
}

/**
 * YAZ-5318: the elements whose content the HTML parser reads as RAW TEXT, up to their end tag or to the end of the input.
 * A renderer of the app writes its own marks into the same HTML as the text's raw HTML, so one stray `<textarea>` would
 * read the rest of the page, marks and secret name included, as its text, and hide it.
 */
const RAW_TEXT = /<(\/?)(textarea|title|xmp|noembed|noframes|plaintext|iframe|noscript|style|script)(?=[\s/>]|$)/gi

/**
 * Each raw-text tag of the input becomes plain text (`&lt;textarea>`), BEFORE the parse: no element of the text can
 * swallow what comes after it. The app's renderers never write these tags (their own text is escaped), so only the
 * text's tags change; they show as written, as any other text.
 */
const plainRawText = (html: string): string => html.replace(RAW_TEXT, '&lt;$1$2')

let purifier: ReturnType<typeof DOMPurify> | null = null

/** `html` cleaned to local media only (see the module doc), as a fragment of the inert document: nothing loaded yet. */
export function cleanLocal(html: string): DocumentFragment {
  if (purifier === null) {
    purifier = DOMPurify(window)
    purifier.addHook('afterSanitizeAttributes', (node) => {
      if (node.nodeType === 1) keepLocal(node as Element)
    })
  }
  const root = purifier.sanitize(plainRawText(html), CONFIG)
  finish(root)
  restoreMarks(root)
  return root
}
