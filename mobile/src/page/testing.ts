/**
 * Test help for the reader's safety (YAZ-5208, YAZ-5209): an attack text that tries every way an HTML page makes a
 * browser fetch from another host, and a walk of every attribute of a drawn DOM.
 */

const HOST = 'http://127.0.0.1:9999/leak'

/** Raw HTML and Markdown that try to fetch from another host. A page and a card both get it. */
export const ATTACK = [
  `<img src="${HOST}/img"> <img srcset="${HOST}/srcset 2x"> ![md picture](${HOST}/md.png) ![md sound](${HOST}/sound.mp3)`,
  `<video src="${HOST}/video" autoplay muted></video><video poster="${HOST}/poster"></video><video><source src="${HOST}/vsource"><track src="${HOST}/track"></video>`,
  `<audio src="${HOST}/audio" autoplay></audio><picture><source srcset="${HOST}/psource"><img src="${HOST}/pimg"></picture>`,
  `<table background="${HOST}/tablebg"><tr><td background="${HOST}/tdbg">x</td></tr></table>`,
  `<span style="background:url(${HOST}/style)">s</span> <div style="background-image:image-set('${HOST}/set' 1x)">d</div> <p style="@import '${HOST}/imp'">p</p>`,
  `<svg><image href="${HOST}/svgimage"/><use xlink:href="${HOST}/use#x"/></svg> <object data="${HOST}/object"></object> <embed src="${HOST}/embed">`,
  `<link rel="stylesheet" href="${HOST}/link.css"><meta http-equiv="refresh" content="0;url=${HOST}/meta"><base href="${HOST}/base/">`,
  `<iframe src="${HOST}/frame"></iframe><input type="image" src="${HOST}/input"><body background="${HOST}/body">`,
  `<a href="${HOST}/ok" target="_top" ping="${HOST}/ping">a web link</a> <a href="//127.0.0.1:9999/leak/proto">proto</a> <form action="${HOST}/form"><button formaction="${HOST}/fa">b</button></form>`,
  `<div data-x="${HOST}/data"></div><blockquote cite="${HOST}/cite">q</blockquote><img src="x.png" onerror="this.src='${HOST}/onerror'">`,
].join('\n\n')

/** A value that names another host or loads something: `scheme://`, `//host`, `url(`, `image-set(`, `@import`. */
export const isRemote = (value: string): boolean => /[a-z][a-z0-9+.-]*:\/\//i.test(value) || /(^|[\s"'(=,])\/\/[^/\s]/.test(value) || /url\(|image-set\(|@import/i.test(value)

/**
 * Every attribute of every element under `root` that holds a remote value, as `tag[name=value]`. The one exception: the
 * `href` of an `<a>` that opens a new browsing context with no opener and no referrer (Safari, a tap of the person).
 */
export function remoteAttributes(root: ParentNode): string[] {
  const out: string[] = []
  for (const el of root.querySelectorAll('*')) {
    for (const attr of el.attributes) {
      if (!isRemote(attr.value)) continue
      const link = el.tagName === 'A' && attr.name === 'href' && el.getAttribute('rel') === 'noopener noreferrer' && (el.getAttribute('target') ?? '_blank') === '_blank'
      if (!link) out.push(`${el.tagName.toLowerCase()}[${attr.name}=${attr.value}]`)
    }
  }
  return out
}

/** Spies on every way a value can reach an attribute; gives each remote value written. */
export function watchWrites(): { remote: string[]; stop(): void } {
  const remote: string[] = []
  const setAttribute = Element.prototype.setAttribute
  // Writes on the parse's inert document load nothing; only this page's document counts. A web link's `href` is the one
  // remote value allowed (it loads nothing until the person taps it).
  Element.prototype.setAttribute = function (name: string, value: string) {
    if (this.ownerDocument === document && !(this.tagName === 'A' && name === 'href') && isRemote(String(value))) remote.push(`${this.tagName.toLowerCase()}.${name}=${value}`)
    return setAttribute.call(this, name, value)
  }
  const props: [object, string][] = [
    [HTMLImageElement.prototype, 'src'],
    [HTMLMediaElement.prototype, 'src'],
    [HTMLSourceElement.prototype, 'src'],
    [HTMLVideoElement.prototype, 'poster'],
  ]
  const held = props.map(([proto, name]) => [proto, name, Object.getOwnPropertyDescriptor(proto, name)] as const)
  for (const [proto, name, d] of held) {
    if (d?.set === undefined) continue
    Object.defineProperty(proto, name, {
      ...d,
      set(value: string) {
        if ((this as Element).ownerDocument === document && isRemote(String(value))) remote.push(`${(this as Element).tagName.toLowerCase()}.${name}=${value}`)
        d.set!.call(this, value)
      },
    })
  }
  // A node that arrives in this page's document with a remote attribute starts its fetch there (even detached): check
  // each node at each insertion into an element of this document.
  const inserting: [object, string][] = [
    [Node.prototype, 'appendChild'],
    [Node.prototype, 'insertBefore'],
    [Element.prototype, 'append'],
    [Element.prototype, 'prepend'],
    [Element.prototype, 'replaceWith'],
    [Element.prototype, 'before'],
    [Element.prototype, 'after'],
    [Element.prototype, 'replaceChildren'],
  ]
  const kept = inserting.map(([proto, name]) => [proto, name, (proto as Record<string, unknown>)[name]] as const)
  const check = (node: unknown) => {
    if (!(node instanceof Node)) return
    const all = node instanceof Element ? [node, ...node.querySelectorAll('*')] : node instanceof DocumentFragment ? [...node.querySelectorAll('*')] : []
    for (const el of all)
      for (const attr of el.attributes)
        if (isRemote(attr.value) && !(el.tagName === 'A' && attr.name === 'href')) remote.push(`inserted ${el.tagName.toLowerCase()}[${attr.name}=${attr.value}]`)
  }
  for (const [proto, name, fn] of kept)
    (proto as Record<string, unknown>)[name] = function (this: Node, ...args: unknown[]) {
      if (this.ownerDocument === document || this === document) for (const a of args) check(a)
      return (fn as (...a: unknown[]) => unknown).apply(this, args)
    }
  return {
    remote,
    stop() {
      for (const [proto, name, fn] of kept) (proto as Record<string, unknown>)[name] = fn
      Element.prototype.setAttribute = setAttribute
      for (const [proto, name, d] of held) if (d !== undefined) Object.defineProperty(proto, name, d)
    },
  }
}
