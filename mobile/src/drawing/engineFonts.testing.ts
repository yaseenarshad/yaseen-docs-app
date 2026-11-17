import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { FontFile } from './fontFaces'

/** The engine's font folder (`engine/packages/excalidraw/fonts`). */
export const ENGINE_FONTS = resolve(import.meta.dirname, '../../../engine/packages/excalidraw/fonts') + '/'

/** The family each folder registers (`Fonts.init`). */
const FAMILY: Record<string, string> = {
  Assistant: 'Assistant',
  Cascadia: 'Cascadia',
  ComicShanns: 'Comic Shanns',
  Excalifont: 'Excalifont',
  Liberation: 'Liberation Sans',
  Inter: 'Inter',
  Roboto: 'Roboto',
  LiberationSerif: 'Liberation Serif',
  IBMPlexMono: 'IBM Plex Mono',
  Lilita: 'Lilita One',
  Nunito: 'Nunito',
  Virgil: 'Virgil',
}

/** Every face of the engine's own font files, read from its `fonts/<Folder>/index.ts` (the CJK fallback left out). */
export function engineFontFiles(): FontFile[] {
  const meta = readFileSync(resolve(import.meta.dirname, '../../../engine/packages/common/src/font-metadata.ts'), 'utf8')
  const google = /GOOGLE_FONTS_RANGES = \{([\s\S]*?)\};/.exec(meta)![1]
  const named = new Map([...google.matchAll(/(\w+):\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]))
  const out: FontFile[] = []
  for (const dir of readdirSync(ENGINE_FONTS).sort()) {
    const family = FAMILY[dir]
    if (family === undefined) continue
    const src = readFileSync(`${ENGINE_FONTS}${dir}/index.ts`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const files = new Map([...src.matchAll(/import\s+(\w+)\s+from\s+"\.\/([^"]+\.woff2)"/g)].map((m) => [m[1], m[2]]))
    for (const part of src.split(/\buri:\s*/).slice(1)) {
      const ident = /^(\w+)/.exec(part)![1]
      const range = /unicodeRange:\s*"([^"]+)"/.exec(part)?.[1] ?? named.get(/unicodeRange:\s*GOOGLE_FONTS_RANGES\.(\w+)/.exec(part)?.[1] ?? '') ?? null
      const weight = /weight:\s*"(\d+)"/.exec(part)?.[1] ?? '400'
      const style = /style:\s*"(\w+)"/.exec(part)?.[1] ?? 'normal'
      out.push({ family, file: `${dir}/${files.get(ident)}`, range, weight, style })
    }
  }
  return out
}
