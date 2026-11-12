/**
 * LINK SPOTS (YAZ-4943): where the links of a board are, in board units, beside its picture. A board window's
 * picture is an `<img>`, so its pills are not live; Explore's board layer (`fill`) hit-tests a click against these
 * spots and opens the link as a layer. Made once per picture, in the picture's chunk (`boardPictures.ts`).
 *
 *   drawing   each text with `[[…]]` (its box) and each shape's own `link` (the shape's box).
 *   diagram   each vertex whose label holds `[[…]]`, or whose `link` attribute is set (its box, inside its groups).
 *
 * One link in a text: the whole box. Two or more: the box splits by line, then by the link's place in its line. That
 * is close, not exact: a pill is drawn wider or narrower than its raw text. A rotation is not followed.
 */
import { WIKILINK_RE } from '@shared/linkRewrite'

/** A link's place on the board. `wiki`: `inner` is a `[[link]]`'s inside; else an address as written. */
export interface BoardLinkSpot {
  x: number
  y: number
  width: number
  height: number
  inner: string
  wiki: boolean
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** One whole `[[inner]]`, as a shape's link holds it. */
const WHOLE = /^\s*!?\[\[([^[\]]+)\]\]\s*$/

/** A shape's or a cell's own link: a `[[link]]`, else the address (an empty one is none). */
function linkSpot(b: Box, link: string): BoardLinkSpot | null {
  const whole = WHOLE.exec(link)
  if (whole !== null) return { ...b, inner: whole[1].trim(), wiki: true }
  const text = link.trim()
  return text === '' ? null : { ...b, inner: text, wiki: false }
}

/** The `[[links]]` of a text laid out in `b` (see the module doc). */
function textSpots(b: Box, text: string): BoardLinkSpot[] {
  const all = [...text.matchAll(WIKILINK_RE)]
  if (all.length === 0) return []
  if (all.length === 1) return [{ ...b, inner: all[0][2].trim(), wiki: true }]
  const lines = text.split('\n')
  const lh = b.height / lines.length
  const out: BoardLinkSpot[] = []
  lines.forEach((line, i) => {
    for (const m of line.matchAll(WIKILINK_RE)) {
      const at = m.index ?? 0
      out.push({ x: b.x + (b.width * at) / line.length, y: b.y + lh * i, width: (b.width * m[0].length) / line.length, height: lh, inner: m[2].trim(), wiki: true })
    }
  })
  // A link the wrap broke across lines: the whole box, as for one link.
  return out.length > 0 ? out : all.map((m) => ({ ...b, inner: m[2].trim(), wiki: true }))
}

interface DrawingElement {
  id?: string
  type: string
  x: number
  y: number
  width: number
  height: number
  text?: string
  link?: string | null
  isDeleted?: boolean
}

export function drawingLinkSpots(elements: readonly DrawingElement[]): BoardLinkSpot[] {
  const out: BoardLinkSpot[] = []
  for (const e of elements) {
    if (e.isDeleted === true) continue
    const b = { x: e.x, y: e.y, width: e.width, height: e.height }
    if (typeof e.link === 'string') {
      const spot = linkSpot(b, e.link)
      if (spot !== null) out.push(spot)
    }
    if (e.type === 'text' && typeof e.text === 'string' && e.text.includes('[[')) out.push(...textSpots(b, e.text))
  }
  return out
}

/** The spot under a board point, the last drawn first (it is on top); null when none. */
export function spotAt(spots: readonly BoardLinkSpot[], x: number, y: number): BoardLinkSpot | null {
  for (let i = spots.length - 1; i >= 0; i--) {
    const s = spots[i]
    if (x >= s.x && x <= s.x + s.width && y >= s.y && y <= s.y + s.height) return s
  }
  return null
}

/** A compressed page (draw.io's `encodeURIComponent` → deflate-raw → base64), as text. */
async function inflatePage(text: string): Promise<string> {
  const bytes = Uint8Array.from(atob(text.trim()), (c) => c.charCodeAt(0))
  const stream = new Response(bytes).body!.pipeThrough(new DecompressionStream('deflate-raw'))
  return decodeURIComponent(await new Response(stream).text())
}

/** The model of page `page` of `xml` (the first when it is null or gone), or null. */
async function pageModel(xml: string, page: string | null): Promise<Element | null> {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const top = doc.documentElement
  if (top === null || top.getElementsByTagName('parsererror').length > 0) return null
  if (top.nodeName === 'mxGraphModel') return top
  if (top.nodeName !== 'mxfile') return null
  const pages = [...top.getElementsByTagName('diagram')]
  const chosen = pages.find((p) => p.getAttribute('id') === page) ?? pages[0]
  if (chosen === undefined) return null
  const model = chosen.getElementsByTagName('mxGraphModel')[0]
  if (model !== undefined) return model
  const inner = new DOMParser().parseFromString(await inflatePage(chosen.textContent ?? ''), 'application/xml').documentElement
  return inner?.nodeName === 'mxGraphModel' ? inner : null
}

/** A label's text: an HTML label's tags out, its line breaks kept. */
function labelText(label: string, html: boolean): string {
  if (!html) return label
  const lines = label.replace(/<br\s*\/?>|<\/(div|p|li)>/gi, '\n')
  return new DOMParser().parseFromString(lines, 'text/html').body.textContent ?? ''
}

interface Cell {
  parent: string | null
  geo: Box | null
  vertex: boolean
  label: string
  html: boolean
  link: string | null
}

export async function diagramLinkSpots(xml: string, page: string | null): Promise<BoardLinkSpot[]> {
  let model: Element | null
  try {
    model = await pageModel(xml, page)
  } catch {
    return []
  }
  const root = model?.getElementsByTagName('root')[0]
  if (root === undefined) return []
  const cells = new Map<string, Cell>()
  const order: string[] = []
  for (const node of [...root.children]) {
    // A cell, or a `UserObject` / `object` wrapping one: the wrapper holds the id, the label and the link.
    const cell = node.nodeName === 'mxCell' ? node : node.getElementsByTagName('mxCell')[0]
    const id = node.getAttribute('id')
    if (cell === undefined || id === null) continue
    const g = cell.getElementsByTagName('mxGeometry')[0]
    const num = (name: string) => Number(g?.getAttribute(name) ?? 0) || 0
    const wrapped = node !== cell
    cells.set(id, {
      parent: cell.getAttribute('parent'),
      geo: g === undefined || g.getAttribute('relative') === '1' ? null : { x: num('x'), y: num('y'), width: num('width'), height: num('height') },
      vertex: cell.getAttribute('vertex') === '1',
      label: (wrapped ? node.getAttribute('label') : cell.getAttribute('value')) ?? '',
      html: /(^|;)html=1(;|$)/.test(cell.getAttribute('style') ?? ''),
      link: node.getAttribute('link'),
    })
    order.push(id)
  }
  const out: BoardLinkSpot[] = []
  for (const id of order) {
    const c = cells.get(id)!
    if (!c.vertex || c.geo === null) continue
    // Inside its groups and containers: each vertex parent's corner added.
    let { x, y } = c.geo
    for (let p = c.parent === null ? undefined : cells.get(c.parent), n = 0; p !== undefined && p.vertex && p.geo !== null && n < 100; p = p.parent === null ? undefined : cells.get(p.parent), n++) {
      x += p.geo.x
      y += p.geo.y
    }
    const b = { x, y, width: c.geo.width, height: c.geo.height }
    if (c.link !== null && !c.link.startsWith('data:')) {
      const spot = linkSpot(b, c.link)
      if (spot !== null) out.push(spot)
    }
    if (c.label.includes('[[')) out.push(...textSpots(b, labelText(c.label, c.html)))
  }
  return out
}
