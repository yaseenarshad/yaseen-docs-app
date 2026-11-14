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
export const isRemote = (value: string): boolean => loadsElsewhere(value) || /url\(|image-set\(|@import/i.test(value)

/**
 * Every attribute of every element under `root` that holds a remote value, as `tag[name=value]`. The one exception: the
 * `href` of an `<a>` that opens a new browsing context with no opener and no referrer (Safari, a tap of the person).
 */
export function remoteAttributes(root: ParentNode): string[] {
  const out: string[] = []
  for (const el of root.querySelectorAll('*')) {
    for (const attr of el.attributes) {
      if (!isRemote(attr.value)) continue
      let web = false
      try {
        web = /^https?:$/.test(new URL(attr.value.replace(/[\t\n\r]/g, '').trim(), location.href).protocol)
      } catch {
        // Not a URL: not a link to the web.
      }
      const link = el.tagName === 'A' && attr.name === 'href' && web && el.getAttribute('rel') === 'noopener noreferrer' && el.getAttribute('target') === '_blank'
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
    [HTMLImageElement.prototype, 'srcset'],
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
  // The other ways a page asks the network: fetch, XMLHttpRequest, sendBeacon, a new Audio.
  const g = globalThis as Record<string, unknown>
  const before = { fetch: g.fetch, XMLHttpRequest: g.XMLHttpRequest, Audio: g.Audio, beacon: navigator.sendBeacon }
  g.fetch = (input: unknown) => {
    remote.push(`fetch ${String(input)}`)
    return Promise.reject(new Error('no network in this test'))
  }
  g.XMLHttpRequest = class {
    open(_m: string, url: string) {
      remote.push(`xhr ${url}`)
    }
    send() {}
  }
  const RealAudio = before.Audio as typeof Audio
  g.Audio = function (url?: string) {
    if (url !== undefined && isRemote(url)) remote.push(`audio ${url}`)
    return new RealAudio(url)
  }
  navigator.sendBeacon = (url: string | URL) => (remote.push(`beacon ${String(url)}`), true)
  return {
    remote,
    stop() {
      g.fetch = before.fetch
      g.XMLHttpRequest = before.XMLHttpRequest
      g.Audio = before.Audio
      navigator.sendBeacon = before.beacon
      for (const [proto, name, fn] of kept) (proto as Record<string, unknown>)[name] = fn
      Element.prototype.setAttribute = setAttribute
      for (const [proto, name, d] of held) if (d !== undefined) Object.defineProperty(proto, name, d)
    },
  }
}

const H = 'https://evil.example'

/**
 * YAZ-5242: the checker's attack list (round 2 on YAZ-5079), one vector a line, each with its own path (`/vNN`). Every
 * page, card and Review card must turn each one into text, a link to tap, or a calm line: no request.
 */
export const VECTORS: string[] = [
  `<img src="${H}/v01">`,
  `<img srcset="${H}/v02 1x, ${H}/v02b 2x">`,
  `<picture><source srcset="${H}/v03"><img src="${H}/v03b"></picture>`,
  `<video src="${H}/v04" autoplay muted></video>`,
  `<audio src="${H}/v05" autoplay></audio>`,
  `<video><source src="${H}/v06"></video>`,
  `<video><track src="${H}/v07"></video>`,
  `<video poster="${H}/v08"></video>`,
  `<table background="${H}/v09"><tr><td>x</td></tr></table>`,
  `<table><tr><td background="${H}/v10">x</td></tr></table>`,
  `<body background="${H}/v11">`,
  `<marquee background="${H}/v12">m</marquee>`,
  `<input type="image" src="${H}/v13">`,
  `<object data="${H}/v14"></object>`,
  `<embed src="${H}/v15">`,
  `<iframe src="${H}/v16"></iframe>`,
  `<iframe srcdoc="<img src=${H}/v17>"></iframe>`,
  `<link rel="stylesheet" href="${H}/v18.css">`,
  `<link rel="preload" as="image" href="${H}/v19">`,
  `<link rel="prefetch" href="${H}/v20">`,
  `<link rel="icon" href="${H}/v21">`,
  `<meta http-equiv="refresh" content="0;url=${H}/v22">`,
  `<base href="${H}/v23/">`,
  `<form action="${H}/v24"><input value="x"></form>`,
  `<button formaction="${H}/v25">b</button>`,
  `<a href="${H}/v26" ping="${H}/v26p">a</a>`,
  `<a href="${H}/v27" target="_self">self</a>`,
  `<map><area href="${H}/v28" shape="rect" coords="0,0,1,1"></map>`,
  `<applet code="x" codebase="${H}/v29"></applet>`,
  `<span style="background:url(${H}/v30)">s</span>`,
  `<div style="background-image:image-set('${H}/v31' 1x)">d</div>`,
  `<p style="list-style:url('${H}/v32')">p</p>`,
  `<span style="cursor:url(${H}/v33), auto">c</span>`,
  `<span style="border-image:url(${H}/v34) 30">b</span>`,
  `<span style="content:url(${H}/v35)">c</span>`,
  `<style>@import '${H}/v36.css'; p{background:url(${H}/v36b)}</style>`,
  `<svg><image href="${H}/v37"/></svg>`,
  `<svg><use href="${H}/v38#x"/></svg>`,
  `<svg><image xlink:href="${H}/v39"/></svg>`,
  `<svg><filter id="f"><feImage href="${H}/v40"/></filter></svg>`,
  `<svg><style>@import url(${H}/v41);</style></svg>`,
  `<svg><foreignObject><img src="${H}/v42"></foreignObject></svg>`,
  `<svg><a href="${H}/v43"><text>t</text></a></svg>`,
  `<math href="${H}/v44"><mi>x</mi></math>`,
  `<img lowsrc="${H}/v45">`,
  `<img src="//evil.example/v46">`,
  `<IMG SRC="HTTPS://EVIL.EXAMPLE/v47">`,
  `<img src="hTtPs://evil.example/v48">`,
  `<img src="ht&#10;tps://evil.example/v49">`,
  `<img src="ht&#9;tps://evil.example/v50">`,
  `<img src="&#104;ttps://evil.example/v51">`,
  `<img src=" https://evil.example/v52 ">`,
  `<img src="\\\\evil.example\\v53">`,
  `<img src="/\\evil.example/v54">`,
  `<img src="https:\\\\evil.example\\v55">`,
  `<img data-local-src="http:evil.example/v56">`,
  `<img src="http:evil.example/v57">`,
  `<img src="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><image href='${H}/v58'/></svg>">`,
  `![md](${H}/v59.png)`,
  `![ref][r59]\n\n[r59]: ${H}/v60.png`,
  `<${H}/v61>`,
  `[![in a link](${H}/v62.png)](${H}/v62)`,
  `![[${H}/v63.png]]`,
  `<img src="\\\\evil.example\\v64.mp3">`,
  `<img src="ht&#10;tps://evil.example/v65.mp3">`,
  `![[http:evil.example/v66.mp3]]`,
  `<span data-card-audio="http:evil.example/v67.mp3">s</span>`,
  `<span data-card-audio="${H}/v68.mp3">s</span>`,
  `![s](${H}/v69.mp3)`,
  `<img data-vault-src="${H}/v70">`,
  `<div data-vault-sound="${H}/v71.mp3">s</div>`,
  `<span data-web-src="javascript:fetch('${H}/v72')">x</span>`,
  `<img data-web-src="${H}/v73">`,
  `<a class="page-media--web" href="ht&#10;tps://evil.example/v74">x</a>`,
  `<a href="ht&#10;tps://evil.example/v75">x</a>`,
  `<a href="\\\\evil.example\\v76">x</a>`,
  `<a href="javascript:fetch('${H}/v77')">js</a>`,
  `<a href="java&#10;script:fetch('${H}/v78')">js</a>`,
  `[md js](javascript:fetch('${H}/v79'))`,
  `<a href="data:text/html,<img src=${H}/v80>">d</a>`,
  `<img src="data:text/html,<img src=${H}/v81>">`,
  `<img src="blob:https://evil.example/v82">`,
  `<img src="file:///etc/v83">`,
  `---\nimage: ${H}/v84\n---\n\ntext`,
  `<img src="x" onerror="fetch('${H}/v85')">`,
  `<video><source src="ht&#9;tps://evil.example/v86"></video>`,
  `<audio><source src="\\\\evil.example\\v87.mp3"></audio>`,
  `<img src="  \u0001https://evil.example/v88">`,
  `<a href="  https://evil.example/v89" target="_parent">p</a>`,
  `<object data="ht&#10;tps://evil.example/v90"></object>`,
]

/**
 * Would the browser load `value` from another host, in a page at `base`? The browser's own reading (WHATWG): tab, new
 * line and carriage return go, leading and trailing C0 controls and spaces go, then the URL is parsed against the
 * page. Written apart from the app's `urlOf`, so the test does not share its blind spots.
 */
export function loadsElsewhere(value: string, base = location.href): boolean {
  const clean = value.replace(/[\t\n\r]/g, '').replace(/^[\u0000- ]+|[\u0000- ]+$/g, '')
  let url: URL
  try {
    url = new URL(clean, base)
  } catch {
    return false
  }
  const own = new URL(base).origin
  if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'ws:' || url.protocol === 'wss:' || url.protocol === 'ftp:') return url.origin !== own
  if (url.protocol === 'blob:') return new URL(url.pathname).origin !== own
  if (url.protocol === 'data:') return !/^image\//i.test(url.pathname)
  return url.protocol === 'javascript:' || url.protocol === 'file:'
}
