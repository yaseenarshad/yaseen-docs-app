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

const WEB = /^(https?:|mailto:|tel:)/i
const SCHEME = /^\s*[a-z][a-z0-9+.-]*:/i
const OWN_BYTES = /^\s*(data|blob):/i
/** A value that names a host or loads something. */
export const NAMES_A_HOST = (value: string): boolean => /[a-z][a-z0-9+.-]*:\/\//i.test(value) || /(^|[\s"'(=,])\/\/[^/\s]/.test(value) || /url\(|image-set\(|@import/i.test(value)

/** The allow list for one element's attributes (a DOMPurify hook: it runs on the inert document). */
function keepLocal(node: Element): void {
  const tag = node.tagName
  for (const { name, value } of [...node.attributes]) {
    if (name === 'href') {
      const ok = tag === 'A' && (WEB.test(value) || value.startsWith('#') || !SCHEME.test(value)) && !value.trim().startsWith('//')
      if (!ok) node.removeAttribute(name)
      continue
    }
    if (name === 'src') {
      node.removeAttribute(name)
      if (tag === 'IMG' && OWN_BYTES.test(value)) {
        node.setAttribute(name, value)
        continue
      }
      // A `<source>` gives its source to its video or audio.
      const holder = tag === 'SOURCE' && (node.parentElement?.tagName === 'VIDEO' || node.parentElement?.tagName === 'AUDIO') ? node.parentElement : node
      if (SCHEME.test(value) || value.trim().startsWith('//')) {
        if (/^\s*https?:|^\s*\/\//i.test(value) && !holder.hasAttribute(WEB_SRC)) holder.setAttribute(WEB_SRC, value.trim().startsWith('//') ? `https:${value.trim()}` : value.trim())
      } else if (value.trim() !== '') holder.setAttribute(LOCAL_SRC, value)
      continue
    }
    if (name !== WEB_SRC && NAMES_A_HOST(value)) node.removeAttribute(name)
  }
  // A web link opens Safari: a new browsing context, no opener, no referrer.
  if (tag === 'A' && WEB.test(node.getAttribute('href') ?? '')) {
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
    const url = el.getAttribute(WEB_SRC)!
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

let purifier: ReturnType<typeof DOMPurify> | null = null

/** `html` cleaned to local media only (see the module doc), as a fragment of the inert document: nothing loaded yet. */
export function cleanLocal(html: string): DocumentFragment {
  if (purifier === null) {
    purifier = DOMPurify(window)
    purifier.addHook('afterSanitizeAttributes', (node) => {
      if (node.nodeType === 1) keepLocal(node as Element)
    })
  }
  const root = purifier.sanitize(html, CONFIG)
  finish(root)
  return root
}
