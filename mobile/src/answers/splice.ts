import { formatCardLine, parseCardLine, type CardLine, type CardPart } from '@shared/cardLine'

/**
 * YAZ-5409: the phone changes ONLY the part that its action changes. The shared writer (`formatCardLine`) writes each
 * part in the app's form: a raw comma in a title or a value becomes `&#44;` (YAZ-5393), an ID in small letters gets
 * capitals, the spaces around the commas change. That is right for the Mac, which owns the line. The phone writes the
 * line again by SPLICE: each part that its actions kept (the same part object, `applyOp` never copies one) keeps its
 * bytes and its place in `text`, and only an added part is written in the app's form.
 */

const LINE_RE = /^(<!--[ \t]*card:[ \t]*)(.*?)([ \t]*-->)$/
const WRAP = { head: '<!-- card: ', tail: ' -->' }

/** The non-empty parts of a line body with their places, split as the shared reader splits (a comma in quotes stays). */
function pieces(body: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  let start = 0
  let quoted = false
  const push = (end: number) => {
    const raw = body.slice(start, end)
    const lead = raw.length - raw.trimStart().length
    const text = raw.trim()
    if (text !== '') out.push({ start: start + lead, end: start + lead + text.length })
  }
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (quoted && ch === '\\' && i + 1 < body.length) i++
    else if (ch === '"') quoted = !quoted
    else if (ch === ',' && !quoted) {
      push(i)
      start = i + 1
    }
  }
  push(body.length)
  return out
}

/** One part as the shared writer writes it. */
const formatPart = (part: CardPart): string => formatCardLine({ parts: [part] })!.slice(WRAP.head.length, -WRAP.tail.length)

/**
 * The card line `text` (read as `before`) written as `after`: the parts of `before` that `after` keeps stay byte for
 * byte, each with the comma and spaces before it; a new part goes in with `, `. The shared writer's line (`formatCardLine(after)`)
 * when the splice cannot hold (no part left, a line the split reads otherwise, parts in a new order), and whenever the
 * spliced line would not read back as `after` does.
 */
export function spliceCardLine(text: string, before: CardLine, after: CardLine): string | null {
  const formatted = formatCardLine(after)
  const indent = text.slice(0, text.length - text.trimStart().length)
  const m = LINE_RE.exec(text.trim())
  if (formatted === null || m === null) return formatted === null ? null : indent + formatted
  const body = m[2]
  const at = pieces(body)
  if (at.length !== before.parts.length) return indent + formatted
  const kept = after.parts.map((p) => before.parts.indexOf(p))
  const old = kept.filter((k) => k >= 0)
  if (old.some((k, i) => i > 0 && k <= old[i - 1])) return indent + formatted
  let out = ''
  after.parts.forEach((p, i) => {
    const k = kept[i]
    // Each old part keeps the comma and spaces before it (they go with it); a new part, or an old first part that
    // now has a part before it, gets the writer's `, `.
    if (i > 0) out += k > 0 ? body.slice(at[k - 1].end, at[k].start) : ', '
    out += k >= 0 ? body.slice(at[k].start, at[k].end) : formatPart(p)
  })
  const spliced = `${m[1]}${body.slice(0, at[0]?.start ?? 0)}${out}${at.length > 0 ? body.slice(at[at.length - 1].end) : ''}${m[3]}`
  const back = parseCardLine(spliced)
  return back !== null && formatCardLine(back) === formatted ? indent + spliced : indent + formatted
}
