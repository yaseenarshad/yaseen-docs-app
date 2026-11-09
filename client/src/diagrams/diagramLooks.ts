/**
 * WHAT A DIAGRAM'S PILLS SHOW outside its editor (YAZ-4748 D9): the sidebar's hover preview, Version history and
 * Export Image draw a diagram in draw.io's viewer (`renderDiagram.ts`), which gets the pills' looks with the request.
 * The looks come from the window's link resolver, which the board link code puts here when it loads
 * (`drawingLinks.ts`): a window that has opened no board or diagram knows no vault, so its previews keep the raw text,
 * as a board's previews do. This file is tiny on purpose: the sidebar's preview loads it, not the link code.
 */

/** A pill's look as draw.io's side takes it: the icon as its data URL; null, no icon; absent, not drawn yet. */
export interface WireLook {
  label: string
  missing?: boolean
  folder?: boolean
  icon?: string | null
}

let source: ((inner: string) => WireLook | null) | null = null

/** The window's resolver, from the link code (`drawingLinks.ts`). */
export function setDiagramLinkLooks(next: (inner: string) => WireLook | null): void {
  source = next
}

const LINK = /\[\[([^[\]]+)\]\]/g
const decode = (text: string): string =>
  text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')

/**
 * The look of each `[[inner]]` in a diagram's XML, or undefined with no resolver or no link. A label is HTML inside
 * an XML attribute, so its text is decoded twice: `[[Q&amp;amp;A]]` is the link `Q&A`. A compressed diagram shows no
 * link here, and keeps its raw text.
 */
export function diagramLinkLooks(xml: string): Record<string, WireLook | null> | undefined {
  if (source === null || !xml.includes('[[')) return undefined
  const looks: Record<string, WireLook | null> = {}
  for (const match of xml.matchAll(LINK)) {
    const inner = decode(decode(match[1]!))
    if (!(inner in looks)) looks[inner] = source(inner)
  }
  return Object.keys(looks).length > 0 ? looks : undefined
}
