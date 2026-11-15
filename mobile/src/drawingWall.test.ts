/**
 * YAZ-5440: the drawing engine lives in ONE lazy chunk of the phone (`mobile/src/drawing/engine/drawPicture.ts`), with
 * its font files beside it, each a chunk of its own. The whole phone app is built (the real Vite build, the phone's own
 * import wall). The test fails when an engine module is in any other chunk, when the drawing chunk is in the first load
 * or in what the reader's chunk loads at once, or when the engine's editor extras (Mermaid, the WebAssembly font
 * cutter, the code editor, the languages) come back. The Review screen's own wall (`review/wall.test.ts`) is unchanged.
 */
import { fileURLToPath } from 'node:url'
import type { OutputChunk, RollupOutput } from 'rollup'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'

const CONFIG = fileURLToPath(new URL('../vite.config.ts', import.meta.url))
const ENGINE = /(^|\/)(@excalidraw|engine\/packages)\//
const FONT = /engine\/packages\/excalidraw\/fonts\/[^/]+\/[^/]+\.woff2\?inline$/

describe('the drawing engine is in its own lazy chunk only (YAZ-5440)', () => {
  it('builds; the engine is in the drawing chunk alone; not in the first load, the reader or Review', async () => {
    const before = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    let out: RollupOutput
    try {
      out = (await build({ configFile: CONFIG, logLevel: 'silent', mode: 'production', build: { write: false } })) as RollupOutput
    } finally {
      process.env.NODE_ENV = before
    }
    const chunks = out.output.filter((o): o is OutputChunk => o.type === 'chunk')
    const byName = new Map(chunks.map((c) => [c.fileName, c]))
    const closure = (start: OutputChunk) => {
      const seen = new Set<string>()
      const walk = (name: string) => {
        if (seen.has(name)) return
        seen.add(name)
        for (const n of byName.get(name)?.imports ?? []) walk(n)
      }
      walk(start.fileName)
      return seen
    }
    const drawing = chunks.find((c) => c.facadeModuleId?.endsWith('mobile/src/drawing/engine/drawPicture.ts'))!
    expect(drawing.isDynamicEntry).toBe(true)
    expect(Object.keys(drawing.modules).some((m) => /@excalidraw\/excalidraw|engine\/packages\/excalidraw\/dist/.test(m))).toBe(true)
    // Every chunk with an engine module is the drawing chunk or one font file.
    const withEngine = chunks.filter((c) => Object.keys(c.modules).some((m) => ENGINE.test(m)))
    const fontChunks = withEngine.filter((c) => c !== drawing)
    expect(fontChunks.every((c) => Object.keys(c.modules).length === 1 && FONT.test(Object.keys(c.modules)[0]))).toBe(true)
    console.log(`[drawing wall] the drawing chunk ${drawing.fileName}: ${Buffer.byteLength(drawing.code)} bytes; ${fontChunks.length} font chunks`)
    // Not in the first load; not in what the reader (its chunk) loads at once.
    const entry = chunks.find((c) => c.isEntry && /\/index\.html$/.test(c.facadeModuleId ?? ''))!
    const reader = chunks.find((c) => Object.keys(c.modules).some((m) => m.endsWith('mobile/src/page/pageRender.ts')))!
    for (const start of [entry, reader]) expect([...closure(start)].filter((n) => withEngine.includes(byName.get(n)!))).toEqual([])
    expect(Object.keys(reader.modules).filter((m) => ENGINE.test(m))).toEqual([])
    // The engine's editor extras are not on the phone (`drawingChunkTrim`).
    const all = chunks.flatMap((c) => Object.keys(c.modules))
    expect(all.filter((m) => /mermaid|katex|cytoscape|subset-(shared|worker)|CodeMirrorEditor|gifShrinkWorker|\/locales\/(?!en-)|node_modules\/(pako|pica|image-blob-reduce)\//.test(m))).toEqual([])
    expect(all.filter((m) => /Xiaolai/.test(m))).toEqual([])
  }, 240_000)
})
