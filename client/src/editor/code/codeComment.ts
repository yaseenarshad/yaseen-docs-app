/**
 * The code block comment itself (YAZ-4783): the one reader and writer of `<!-- code: … -->`, the line right under a
 * code block's closing fence that holds the block's own width, as `<!-- table: … -->` holds a table's look
 * (`table/tableComment.ts`) and `<!-- line: … -->` a line's (`line/lineComment.ts`). No editor imports, on purpose: the
 * line-number worker (`lineNumbers/blockLines.ts`) reads the same comment to know that it is no block of the page.
 * `codeWidth.ts` joins it to the block on load and writes it back on save.
 *
 * ONE PART today: `width 1300`, the box's width in px at 100% document zoom, a whole number from `CODE_WIDTH_MIN` to
 * `CODE_WIDTH_MAX` with no leading zero. No width writes no comment: a plain code block keeps the bytes of before.
 *
 * The reader is tolerant, as the table's is (YAZ-4161, YAZ-4176): a part it does not know, and a `width` it cannot read
 * (`width 100`, `width wide`), are KEPT as their text, so an older or a newer build never deletes what it cannot read.
 * A part keeps its side of the width part (before it or after it), so a comment this build reads saves with the same
 * bytes. A kept `width …` text goes only when this build writes a width itself. The comment is ours when it has the
 * shape `<!-- code: part, part -->` on ONE line with no empty part; anything else (`<!-- code: -->`, `<!-- codes: … -->`,
 * a comment over two lines) is not ours (`null`), and the editor keeps it as an ordinary HTML block with its text.
 */

/** The narrowest a code block can be dragged or read, in px at 100% zoom. */
export const CODE_WIDTH_MIN = 240
/** The widest a width can be read or written: four digits. */
export const CODE_WIDTH_MAX = 9999

/** A part this build does not read: its text, and whether it stood after the width part. */
export interface CodeUnknownPart {
  afterWidth: boolean
  text: string
}

/** What the comment holds: the width (`null` for the normal width) and the parts this build keeps as text. */
export interface CodeLook {
  width: number | null
  unknownParts: CodeUnknownPart[]
}

export const PLAIN_CODE: CodeLook = { width: null, unknownParts: [] }

/** `<!-- code: … -->` on one line (`.` takes no line break), any spaces inside the delimiters. */
const COMMENT = /^<!--[ \t]*code:[ \t]*(.*?)[ \t]*-->$/
/** The width part: `width`, one space, a whole number with no leading zero. */
const WIDTH_PART = /^width ([1-9]\d{0,3})$/

/** A width, checked: a whole number in range, else `null`. */
export function codeWidth(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= CODE_WIDTH_MIN && value <= CODE_WIDTH_MAX ? value : null
}

/** The look a comment holds, or `null` when it is not the code comment. */
export function parseCodeComment(value: string): CodeLook | null {
  const body = COMMENT.exec(value.trim())?.[1]
  if (body === undefined || body === '' || body.includes('-->')) return null
  const parts = body.split(/[ \t]*,[ \t]*/)
  if (parts.some((part) => part === '')) return null
  const look: CodeLook = { width: null, unknownParts: [] }
  for (const text of parts) {
    const width = look.width === null ? codeWidth(Number(WIDTH_PART.exec(text)?.[1])) : null
    if (width !== null) look.width = width
    else look.unknownParts.push({ afterWidth: look.width !== null, text })
  }
  return look
}

/** The comment for a look, or `null` when it holds nothing: the parts before the width, the width, the parts after it. */
export function formatCodeComment(look: CodeLook): string | null {
  const kept = look.width === null ? look.unknownParts : look.unknownParts.filter((part) => !/^width\b/.test(part.text))
  const parts = [
    ...kept.filter((part) => !part.afterWidth).map((part) => part.text),
    ...(look.width === null ? [] : [`width ${look.width}`]),
    ...kept.filter((part) => part.afterWidth).map((part) => part.text),
  ]
  return parts.length === 0 ? null : `<!-- code: ${parts.join(', ')} -->`
}
