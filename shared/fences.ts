/**
 * THE ONE FENCE WALK (YAZ-4964 audit 8): which lines of a Markdown text are code. The index (`scan.ts` tags, links and
 * embeds), the rename (`linkRewrite.ts`), the card's sides and hidden words (`cardText.ts`) and the command
 * (`cli.ts`, `card add --after`) all read code through here, so one fence rule holds for all.
 *
 * A fence is three or more backticks or tildes; it closes on the same character, at least as long, with nothing after
 * it. A NOTE CARD's text (a ```` ```card ```` block, `cardLine.ts`) is Markdown (YAZ-4960 D17): its lines are `card`,
 * not code — but a code block INSIDE a card is code again (audit 7: its `[[x]]` is no link, its `{{x}}` no hidden word).
 * Pure: no fs, no DOM.
 */

/** What one line is: page text, a fence line of a block, a code line, or a card's text. */
export type LineKind = 'text' | 'fence' | 'code' | 'card'

const FENCE_RE = /^[ \t]*(`{3,}|~{3,})/
/** The fence of a note card: the language `card` and nothing else (`cardLine.ts` `isCardFence`). */
const CARD_FENCE_RE = /^[ \t]*(`{3,}|~{3,})[ \t]*card[ \t]*$/
const CODE_SPAN_RE = /(`+)[\s\S]*?\1/g

/** Does `line` close a block opened by `fence`? Same character, at least as long, nothing after it. */
export function closesFence(line: string, fence: string): boolean {
  const m = line.includes(fence[0]) ? FENCE_RE.exec(line) : null
  return m !== null && m[1][0] === fence[0] && m[1].length >= fence.length && line.trim() === m[1]
}

/** The fence `line` opens with (its backticks or tildes), or null. */
export const fenceOf = (line: string): string | null => (line.includes('`') || line.includes('~') ? (FENCE_RE.exec(line)?.[1] ?? null) : null)

/** The kind of each of `lines`. A block that is never closed runs to the end. */
export function lineKinds(lines: readonly string[]): LineKind[] {
  const kinds: LineKind[] = []
  let outer: { fence: string; card: boolean } | null = null
  // A code block inside a card.
  let inner: string | null = null
  for (const line of lines) {
    if (outer === null) {
      const fence = fenceOf(line)
      if (fence === null) kinds.push('text')
      else {
        outer = { fence, card: CARD_FENCE_RE.test(line) }
        kinds.push('fence')
      }
    } else if (closesFence(line, outer.fence)) {
      outer = null
      inner = null
      kinds.push('fence')
    } else if (!outer.card) kinds.push('code')
    else if (inner !== null) {
      if (closesFence(line, inner)) inner = null
      kinds.push('code')
    } else {
      inner = fenceOf(line)
      kinds.push(inner === null ? 'card' : 'code')
    }
  }
  return kinds
}

/**
 * `text` with its code as spaces, LENGTH-PRESERVING (match offsets over it address `text`): each fence and code line,
 * and each inline code span outside them. A card's text stays (D17), its own code goes. `cardText` passes `card`: the
 * text is ONE card's, so its fences are code.
 */
export function maskCode(text: string): string {
  const lines = text.split('\n')
  const kinds = lineKinds(lines)
  return lines
    .map((line, i) => (kinds[i] === 'text' || kinds[i] === 'card' ? line : ' '.repeat(line.length)))
    .join('\n')
    .replace(CODE_SPAN_RE, (span) => ' '.repeat(span.length))
}
