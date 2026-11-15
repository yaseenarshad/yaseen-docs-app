/**
 * YAZ-5440: the drawing engine lives in ONE lazy chunk of the phone (`mobile/src/drawing/engine/drawPicture.ts`), with
 * its font files beside it, each a chunk of its own. The whole phone app is built (the real Vite build, the phone's own
 * import wall). The test fails when an engine module is in any other chunk, when the drawing chunk is in the first load
 * or in what the reader's chunk loads at once, or when the engine's editor extras (Mermaid, the WebAssembly font
 * cutter, the code editor, the languages) come back. The Review screen's own wall (`review/wall.test.ts`) is unchanged.
 *
 * YAZ-5533, draw.io: its viewer, renderer page, shape libraries and fonts are files of `drawio/<hash>/`, no chunk; the
 * app's diagram code is ONE lazy chunk that imports nothing. NONE of it is in the first load, the reader's chunk, or the
 * service worker's install list (Yaseen: nothing about draw.io may bloat the app): the phone fetches it the first time
 * a diagram is opened.
 */
import { fileURLToPath } from 'node:url'
import type { OutputAsset, OutputChunk, RollupOutput } from 'rollup'
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

    // YAZ-5533: the diagram chunk: lazy, alone, imports nothing; not in the first load or the reader.
    const diagram = chunks.find((c) => c.facadeModuleId?.endsWith('mobile/src/drawing/diagram/drawDiagram.ts'))!
    expect(diagram.isDynamicEntry).toBe(true)
    expect(diagram.imports).toEqual([])
    for (const start of [entry, reader]) expect(closure(start).has(diagram.fileName)).toBe(false)
    // draw.io's own files are files, never in a chunk.
    expect(all.filter((m) => /viewer-static|stencils\.min|yaseen-render\.js|mobile\/drawio\//.test(m))).toEqual([])
    const assets = out.output.filter((o): o is OutputAsset => o.type === 'asset')
    const drawio = assets.filter((a) => /^drawio\/[0-9a-f]{12}\//.test(a.fileName)).map((a) => a.fileName)
    expect(drawio.some((f) => f.endsWith('/viewer-static.min.js'))).toBe(true)
    expect(drawio.some((f) => f.endsWith('/render.html'))).toBe(true)
    expect(drawio.filter((f) => f.includes('/stencils/')).length).toBe(204)
    // The install list (the worker's shell): no draw.io file, not the diagram chunk or its stylesheet.
    const sw = String(assets.find((a) => a.fileName === 'sw.js')!.source)
    const shell = JSON.parse(/\bfiles:(\[[^\]]*\])/.exec(sw)![1]) as string[]
    const diagramFiles = [diagram.fileName, ...(diagram.viteMetadata?.importedCss ?? [])]
    expect(shell.filter((f) => f.startsWith('/drawio/') || diagramFiles.includes(f.slice(1)) || /drawDiagram/.test(f))).toEqual([])
    expect(JSON.parse(/\bdrawioChunks:(\[[^\]]*\])/.exec(sw)![1])).toEqual(diagramFiles.map((f) => `/${f}`))
    const installBytes = shell.reduce((n, f) => {
      const file = f === '/' ? 'index.html' : /^\/(friend|group|join)$/.test(f) ? `${f.slice(1)}.html` : f.slice(1)
      const o = out.output.find((x) => x.fileName === file)
      return n + (o === undefined ? 0 : Buffer.byteLength(o.type === 'chunk' ? o.code : o.source))
    }, 0)
    const drawioBytes = assets.filter((a) => drawio.includes(a.fileName)).reduce((n, a) => n + Buffer.byteLength(a.source), 0)
    console.log(`[drawing wall] install (the worker's shell, the build's own files): ${shell.length} files, ${installBytes} bytes; draw.io files NOT installed: ${drawio.length}, ${drawioBytes} bytes; the diagram chunk ${diagram.fileName}: ${Buffer.byteLength(diagram.code)} bytes`)
  }, 240_000)
})
