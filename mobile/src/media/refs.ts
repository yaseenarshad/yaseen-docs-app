import { isAudioRef } from '@client/editor/card/cardMedia'
import { Marked, type Token, type TokenizerAndRendererExtension, type Tokens } from 'marked'

/**
 * WHICH FILES A CARD SHOWS (YAZ-5074 3D): the pictures and sounds of a card's text, as the Mac's `renderCard`
 * (`client/src/editor/card/cardRender.ts`) draws them, and where each one lands in the vault (the shared asset
 * lookup, 2B). Pure: no store, no network.
 *
 * What counts, as on the Mac:
 * - A Markdown picture `![alt](src)`: an `<img>`; a sound file there (`![](x.mp3)`) is the sound player.
 * - A wikilink sound `![[x.mp3]]` (`isAudioRef`): the sound player.
 * - NOT a wikilink picture `![[x.png]]`: a card shows it as its text. NOT a board embed: the Mac draws it from a picture
 *   it makes itself, which is not a vault file. NOT a source with a scheme (`https:`, `data:`): the browser loads it.
 * - Nothing inside code.
 *
 * The source becomes a vault path as the Mac's `imageSrc` does: a leading `/` is the vault's root, and each part is
 * decoded ONCE (`my%20pic.png` and `my pic.png` are one file; `100%.png`, a bad escape, stays as written).
 */

/** `[[…]]` and `![[…]]` as the card's own tokenizer reads them, so `[x]` inside them is no Markdown link. */
interface LinkToken extends Tokens.Generic {
  inner: string
  embed: boolean
}
const wikilinks: TokenizerAndRendererExtension = {
  name: 'cardLink',
  level: 'inline',
  start(src) {
    const at = src.indexOf('[[')
    return at < 0 ? undefined : at > 0 && src[at - 1] === '!' ? at - 1 : at
  },
  tokenizer(src) {
    const m = /^(!?)\[\[([^[\]\n]+?)\]\]/.exec(src)
    return m === null ? undefined : ({ type: 'cardLink', raw: m[0], inner: m[2], embed: m[1] === '!' } as LinkToken)
  },
  renderer: () => '',
}
const markdown = new Marked({ gfm: true, breaks: true })
markdown.use({ extensions: [wikilinks] })

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i

/** marked's `cleanUrl`: what the `<img>` gets as its `src`. Null when marked drops the picture. */
function cleanUrl(href: string): string | null {
  try {
    return encodeURI(href).replace(/%25/g, '%')
  } catch {
    return null
  }
}

function decodePart(part: string): string {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

/** The vault path part of a source as `imageSrc` reads it: no leading `/`, each part decoded once. Null for a scheme or nothing. */
export function mediaTarget(src: string): string | null {
  if (SCHEME_RE.test(src)) return null
  const ref = src.replace(/^\/+/, '')
  if (ref === '') return null
  return ref
    .split('/')
    .map(decodePart)
    .join('/')
}

function walk(tokens: readonly Token[], out: string[]): void {
  for (const token of tokens) {
    if (token.type === 'image') {
      const src = cleanUrl((token as Tokens.Image).href)
      const target = src === null ? null : mediaTarget(src)
      if (target !== null) out.push(target)
    } else if (token.type === 'cardLink') {
      const { inner, embed } = token as LinkToken
      if (embed && isAudioRef(inner)) {
        const target = mediaTarget(inner.split('|')[0].trim())
        if (target !== null) out.push(target)
      }
    }
    const t = token as Tokens.Generic
    if (Array.isArray(t.tokens)) walk(t.tokens as Token[], out)
    if (t.type === 'list') for (const item of (t as Tokens.List).items) walk(item.tokens, out)
    if (t.type === 'table') {
      const table = t as Tokens.Table
      for (const cell of table.header) walk(cell.tokens, out)
      for (const row of table.rows) for (const cell of row) walk(cell.tokens, out)
    }
  }
}

/** The sources of a card's pictures and sounds (vault paths as written, not resolved), in text order, each once. */
export function cardMediaRefs(text: string): string[] {
  // Most cards hold no picture and no sound: no Markdown read for them. Every picture or sound starts with `![`.
  if (!text.includes('![')) return []
  const out: string[] = []
  walk(markdown.lexer(text), out)
  return [...new Set(out)]
}

/** The folder of a vault path ('' at the root). */
export const folderOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')))

/**
 * The vault files a card shows: each source resolved by the shared lookup (`makeAssetResolver`, 2B) from the folder of
 * `holder`, the file that HOLDS the card. An embedded card's links resolve from its own card file, never from the page
 * that embeds it (YAZ-5074). A link to no file gives nothing.
 */
export function cardMediaPaths(text: string, holder: string, resolve: (target: string, from?: string) => string | null): string[] {
  const out: string[] = []
  for (const target of cardMediaRefs(text)) {
    const path = resolve(target, folderOf(holder))
    if (path !== null && !out.includes(path)) out.push(path)
  }
  return out
}
