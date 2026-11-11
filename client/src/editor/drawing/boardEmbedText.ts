/**
 * A board embed's TEXT rules (YAZ-4820), with no editor import: the name an embed shows, copies and folds as, and
 * whether a `![[inner]]` is a board embed at all. Read by the host (`boardEmbed.ts`), the plain-text copy
 * (`linksAsShown`), the fold key (`itemLabelText`) and the image node (`imageView.ts`), which must agree.
 */
import { isBoardTarget, splitEmbed } from '@shared/embedOptions'
import { boardBaseName } from '@shared/fileKind'

/** The board an `![[inner]]` embeds (with any `#…`), or null when it is no board: `![[img.png]]`, `![[note]]`. */
export function boardEmbedTarget(inner: string): string | null {
  const { target } = splitEmbed(inner)
  return isBoardTarget(target.split('#')[0]!) ? target : null
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
