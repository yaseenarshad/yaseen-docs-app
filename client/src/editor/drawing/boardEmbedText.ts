/**
 * A board embed's TEXT rules (YAZ-4820), with no editor import: the name an embed shows, copies and folds as, and
 * whether a `![[inner]]` is a board embed at all. Read by the host (`boardEmbed.ts`), the plain-text copy
 * (`linksAsShown`), the fold key (`itemLabelText`) and the image node (`imageView.ts`), which must agree.
 */
import { isBoardTarget, splitEmbed } from '@shared/embedOptions'
import { boardBaseName } from '@shared/fileKind'

/** The host's word on an id-shaped target (YAZ-4920): does the id resolve to a board file? */
export type BoardCheck = (target: string) => boolean

/** An id-shaped link target (`EMB-40`, the vault's note ids): no ending to read, so only a resolver knows its kind. */
export const isIdTarget = (page: string): boolean => /^[A-Za-z]{2,5}-[1-9]\d{0,14}$/.test(page.trim())

/** The text has an id-shaped embed (`![[EMB-40`, resolved or not): what it is can change when the resolver does. */
export const hasIdEmbed = (text: string): boolean => text.includes('![[') && /!\[\[[A-Za-z]{2,5}-[1-9]\d{0,14}(?:[|#\]])/.test(text)

/**
 * The board an `![[inner]]` embeds (with any `#…`), or null when it is no board: `![[img.png]]`, `![[note]]`. An id
 * link (`![[EMB-40]]`, YAZ-4920: the paste chip's "Embed" and the picker's ⌥Enter write the id in an ID vault, D1 on
 * YAZ-4821) is a board when `isBoard`, the host's resolver, says the id names a board file; without it, no id is.
 */
export function boardEmbedTarget(inner: string, isBoard?: BoardCheck): string | null {
  const { target } = splitEmbed(inner)
  const page = target.split('#')[0]!
  return isBoardTarget(page) || (isBoard !== undefined && isIdTarget(page) && isBoard(page)) ? target : null
}

/** The page part of a board target: no `#…`, no folders. */
const fileOf = (target: string): string => {
  const page = target.split('#')[0]!.trim()
  return page.slice(Math.max(page.lastIndexOf('/'), page.lastIndexOf('\\')) + 1)
}

/** What an embed is called (the name pill, a copy, a fold key): `assets/CloudFront.drawio|640x360` → "CloudFront". */
export function boardEmbedName(inner: string): string {
  return boardBaseName(fileOf(splitEmbed(inner).target))
}

/** A board src of the image node (YAZ-4828): `../Other/x.drawio`, decoded, with no `?` or `#`. */
export function isBoardSrc(src: string): boolean {
  let path = src.replace(/[?#].*$/, '')
  try {
    path = decodeURIComponent(path)
  } catch {
    // a malformed escape: the src as written
  }
  return !/^[a-z][a-z\d+.-]*:/i.test(path) && isBoardTarget(path)
}

/** A board image node's name (`![CloudFront|640x360 …](x.drawio)` → "CloudFront"), or null when the src is no board. */
export function boardImageName(src: string, alt: string): string | null {
  if (!isBoardSrc(src)) return null
  const text = alt.split('|')[0]!.trim()
  if (text !== '') return text
  let file = fileOf(src.replace(/[?#].*$/, ''))
  try {
    file = decodeURIComponent(file)
  } catch {
    // as written
  }
  return boardBaseName(file)
}
