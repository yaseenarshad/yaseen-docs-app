/**
 * WHICH FONT FILES A DRAWING'S PICTURE NEEDS. A picture shows in an `<img>`, which draws only the fonts that
 * are inside the SVG. On the Mac the engine puts them in itself (`boardPictures.ts`: "The engine inlines the fonts it
 * draws with"): it fetches each file and cuts it to the letters used, with a WebAssembly tool in a worker. The phone's
 * CSP allows none of that (no `fetch` of its own files, no WebAssembly, no `blob:` worker), so the phone asks the engine
 * for no fonts (`skipInliningFonts`) and puts in the WHOLE files that the text needs, from its own chunks
 * (`engine/fonts.ts`). These are the pure parts: which faces, and their CSS.
 */

/** One font file of the engine (`engine/fontFiles.ts`). */
export interface FontFile {
  family: string
  /** Under the engine's `fonts/` folder: `Excalifont/Excalifont-Regular-….woff2`. */
  file: string
  /** CSS `unicode-range`; null: every letter. */
  range: string | null
  weight: string
  style: string
}

/** The text of a picture: per family, the letters it shows and the weights it uses. */
export type TextUse = Map<string, { chars: Set<number>; weights: Set<string> }>

/** `U+20-7e, U+a0` → the code point ranges. */
export function parseRange(range: string): Array<[number, number]> {
  return range
    .split(',')
    .map((part) => /U\+([0-9a-f?]+)(?:-([0-9a-f]+))?/i.exec(part.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => {
      const from = parseInt(m[1].replaceAll('?', '0'), 16)
      const to = m[2] !== undefined ? parseInt(m[2], 16) : m[1].includes('?') ? parseInt(m[1].replaceAll('?', 'f'), 16) : from
      return [from, to]
    })
}

const covers = (range: string | null, chars: Set<number>): boolean => {
  if (range === null) return chars.size > 0
  const ranges = parseRange(range)
  for (const c of chars) if (ranges.some(([a, b]) => c >= a && c <= b)) return true
  return false
}

/** The first family a `font-family` list names, unquoted: `Excalifont, Xiaolai, …` → `Excalifont`. */
export const firstFamily = (list: string): string => (list.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '')

/** The text of an SVG: each `<text>` element's family, weight and letters. */
export function textUse(svg: Element): TextUse {
  const use: TextUse = new Map()
  for (const text of svg.querySelectorAll('text')) {
    const family = firstFamily(text.getAttribute('font-family') ?? '')
    if (family === '') continue
    let held = use.get(family)
    if (held === undefined) use.set(family, (held = { chars: new Set(), weights: new Set() }))
    held.weights.add(text.getAttribute('font-weight') ?? '400')
    for (const ch of text.textContent ?? '') held.chars.add(ch.codePointAt(0)!)
  }
  return use
}

/**
 * The files the text needs: of each family it uses, the files whose range holds one of its letters, in the weights it
 * uses (all the family's weights when it has none of them: the browser then picks the nearest).
 */
export function facesFor(use: TextUse, files: readonly FontFile[]): FontFile[] {
  const out: FontFile[] = []
  for (const [family, { chars, weights }] of use) {
    const own = files.filter((f) => f.family === family && covers(f.range, chars))
    const weighted = own.filter((f) => weights.has(f.weight))
    out.push(...(weighted.length > 0 ? weighted : own))
  }
  return out
}

/** One `@font-face` rule with the file's bytes inside (a `data:` URL), as the engine writes its own. */
export function fontFaceCss(face: FontFile, dataUrl: string): string {
  const parts = [`font-family: ${JSON.stringify(face.family)}`, `src: url(${dataUrl})`, `font-style: ${face.style}`, `font-weight: ${face.weight}`, 'font-display: swap']
  if (face.range !== null) parts.push(`unicode-range: ${face.range}`)
  return `@font-face { ${parts.join('; ')}; }`
}
