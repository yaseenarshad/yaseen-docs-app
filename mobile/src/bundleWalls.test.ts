/**
 * Unified phone bundle walls (YAZ-5377, YAZ-5440, YAZ-5533, YAZ-5079, YAZ-6008 D12):
 * Runs ONE full production Vite build of `mobile/` and verifies all three bundle walls against
 * the same Rollup output — first-load budget/chains, drawing & draw.io chunk isolation, and
 * editor-free reader chunk isolation — eliminating 2 redundant full Vite builds per test run.
 */
import { fileURLToPath } from 'node:url'
import type { OutputAsset, OutputChunk, RollupOutput } from 'rollup'
import { build, type Plugin } from 'vite'
import { beforeAll, describe, expect, it } from 'vitest'
import { FIRST_LOAD_JS_MAX, NEVER_BUNDLED, NOT_FIRST_LOAD } from '../publish/checkBuild'
import { phoneStylesheets } from '../publish/stylesheets'

const CONFIG = fileURLToPath(new URL('../vite.config.ts', import.meta.url))
const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const short = (id: string) => id.replace(ROOT, '').replace(/^.*\/node_modules\//, 'node_modules/')

const ENGINE = /(^|\/)(@excalidraw|engine\/packages)\//
const FONT = /engine\/packages\/excalidraw\/fonts\/[^/]+\/[^/]+\.woff2\?inline$/
const EDITOR_PACKAGE = /node_modules\/(@milkdown\/|prosemirror-|@codemirror\/|codemirror\/|@lezer\/)/
const EDITOR_FILE = /client\/src\/editor\/(wikilink\/wikilinkPlugin|createCrepe|crepe|useReadOnlyPage)\.ts$/

function chainsPlugin(chains: Map<string, string[]>, css: Set<string>): Plugin {
  return {
    name: 'first-load-chains',
    buildEnd() {
      const ids = [...this.getModuleIds()]
      for (const id of ids) if (/\.css$/.test(id)) css.add(id)
      const main = ids.find((i) => i.endsWith('mobile/src/main.tsx'))
      if (!main) return
      const prev = new Map<string, string | null>([[main, null]])
      const queue = [main]
      while (queue.length > 0) {
        const id = queue.shift()!
        for (const next of this.getModuleInfo(id)?.importedIds ?? []) if (!prev.has(next)) (prev.set(next, id), queue.push(next))
      }
      for (const id of prev.keys()) {
        const chain: string[] = []
        for (let c: string | null | undefined = id; c; c = prev.get(c)) chain.unshift(short(c))
        chains.set(short(id), chain)
      }
    },
  }
}

let built: { out: RollupOutput; chains: Map<string, string[]>; css: Set<string> }

beforeAll(async () => {
  const chains = new Map<string, string[]>()
  const css = new Set<string>()
  const before = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    const out = (await build({
      configFile: CONFIG,
      logLevel: 'silent',
      mode: 'production',
      build: { write: false },
      plugins: [chainsPlugin(chains, css)],
    })) as RollupOutput
    built = { out, chains, css }
  } finally {
    process.env.NODE_ENV = before
  }
}, 240_000)

function staticClosure(chunks: OutputChunk[], start: OutputChunk): Set<string> {
  const byName = new Map(chunks.map((c) => [c.fileName, c]))
  const seen = new Set<string>()
  const walk = (name: string) => {
    if (seen.has(name)) return
    seen.add(name)
    for (const n of byName.get(name)?.imports ?? []) walk(n)
  }
  walk(start.fileName)
  return seen
}

describe('the first load stays small (YAZ-5377, YAZ-5362)', () => {
  it('is under its ceiling, holds no lazy-only module, and no chunk holds a dev or test module', () => {
    const { out, chains, css } = built
    expect([...css].map(short).sort()).toEqual(phoneStylesheets().map(short).sort())
    const chunks = out.output.filter((o): o is OutputChunk => o.type === 'chunk')
    const entry = chunks.find((c) => c.isEntry && /\/index\.html$/.test(c.facadeModuleId ?? ''))!
    const first = staticClosure(chunks, entry)
    const eager = chunks.filter((c) => first.has(c.fileName))
    const bytes = eager.reduce((n, c) => n + Buffer.byteLength(c.code), 0)
    const eagerModules = eager.flatMap((c) => Object.keys(c.modules)).map(short)

    const pkg = (m: string) => /^node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(m)?.[1]
    const seen = new Set<string>()
    const heavy = eagerModules
      .filter((m) => NOT_FIRST_LOAD.some((r) => r.test(m)))
      .map((m) => chains.get(m) ?? [m])
      .map((chain) => chain.slice(0, chain.findIndex((m) => pkg(m) !== undefined) + 1 || chain.length))
      .filter((chain) => !seen.has(chain.at(-1)!) && seen.add(chain.at(-1)!))
      .map((chain) => chain.join(' -> '))
    expect(heavy).toEqual([])
    expect(bytes, `first-load JS is ${bytes} bytes (${eager.map((c) => c.fileName).join(', ')})`).toBeLessThanOrEqual(FIRST_LOAD_JS_MAX)
    const all = chunks.flatMap((c) => Object.keys(c.modules).map((m) => `${c.fileName}: ${short(m)}`))
    expect(all.filter((line) => NEVER_BUNDLED.some((r) => r.test(line.split(': ')[1])))).toEqual([])
  })
})

describe('the drawing engine is in its own lazy chunk only (YAZ-5440)', () => {
  it('builds; the engine is in the drawing chunk alone; not in the first load, the reader or Review', () => {
    const { out } = built
    const chunks = out.output.filter((o): o is OutputChunk => o.type === 'chunk')
    const byName = new Map(chunks.map((c) => [c.fileName, c]))
    const drawing = chunks.find((c) => c.facadeModuleId?.endsWith('mobile/src/drawing/engine/drawPicture.ts'))!
    expect(drawing.isDynamicEntry).toBe(true)
    expect(Object.keys(drawing.modules).some((m) => /@excalidraw\/excalidraw|engine\/packages\/excalidraw\/dist/.test(m))).toBe(true)

    const withEngine = chunks.filter((c) => Object.keys(c.modules).some((m) => ENGINE.test(m)))
    const fontChunks = withEngine.filter((c) => c !== drawing)
    expect(fontChunks.every((c) => Object.keys(c.modules).length === 1 && FONT.test(Object.keys(c.modules)[0]))).toBe(true)

    const entry = chunks.find((c) => c.isEntry && /\/index\.html$/.test(c.facadeModuleId ?? ''))!
    const reader = chunks.find((c) => Object.keys(c.modules).some((m) => m.endsWith('mobile/src/page/pageRender.ts')))!
    for (const start of [entry, reader]) expect([...staticClosure(chunks, start)].filter((n) => withEngine.includes(byName.get(n)!))).toEqual([])
    expect(Object.keys(reader.modules).filter((m) => ENGINE.test(m))).toEqual([])

    const all = chunks.flatMap((c) => Object.keys(c.modules))
    expect(all.filter((m) => /mermaid|katex|cytoscape|subset-(shared|worker)|CodeMirrorEditor|gifShrinkWorker|\/locales\/(?!en-)|node_modules\/(pako|pica|image-blob-reduce)\//.test(m))).toEqual([])
    expect(all.filter((m) => /Xiaolai/.test(m))).toEqual([])

    const diagram = chunks.find((c) => c.facadeModuleId?.endsWith('mobile/src/drawing/diagram/drawDiagram.ts'))!
    expect(diagram.isDynamicEntry).toBe(true)
    expect(diagram.imports).toEqual([])
    for (const start of [entry, reader]) expect(staticClosure(chunks, start).has(diagram.fileName)).toBe(false)
    expect(all.filter((m) => /viewer-static|stencils\.min|yaseen-render\.js|mobile\/drawio\//.test(m))).toEqual([])

    const assets = out.output.filter((o): o is OutputAsset => o.type === 'asset')
    const drawio = assets.filter((a) => /^drawio\/[0-9a-f]{12}\//.test(a.fileName)).map((a) => a.fileName)
    expect(drawio.some((f) => f.endsWith('/viewer-static.min.js'))).toBe(true)
    expect(drawio.some((f) => f.endsWith('/render.html'))).toBe(true)
    expect(drawio.filter((f) => f.includes('/stencils/')).length).toBe(204)

    const sw = String(assets.find((a) => a.fileName === 'sw.js')!.source)
    const shell = JSON.parse(/\bfiles:(\[[^\]]*\])/.exec(sw)![1]) as string[]
    const diagramFiles = [diagram.fileName, ...(diagram.viteMetadata?.importedCss ?? [])]
    const drawingFiles = [drawing, ...fontChunks].flatMap((c) => [c.fileName, ...(c.viteMetadata?.importedCss ?? [])])
    expect(shell.filter((f) => f.startsWith('/drawio/') || diagramFiles.includes(f.slice(1)) || /drawDiagram/.test(f))).toEqual([])
    expect(shell.filter((f) => drawingFiles.includes(f.slice(1)) || /drawPicture/.test(f))).toEqual([])
    expect(JSON.parse(/\bdrawioChunks:(\[[^\]]*\])/.exec(sw)![1])).toEqual(diagramFiles.map((f) => `/${f}`))
    expect(JSON.parse(/\bdrawingChunks:(\[[^\]]*\])/.exec(sw)![1]).sort()).toEqual(drawingFiles.map((f) => `/${f}`).sort())
  })
})

describe('the phone app has no editor, and the reader is a lazy chunk (YAZ-5079)', () => {
  it('builds; no chunk holds an editor module; marked and DOMPurify are not in the first load', () => {
    const { out } = built
    const chunks = out.output.filter((o): o is OutputChunk => o.type === 'chunk')
    const modules = chunks.flatMap((c) => Object.keys(c.modules))
    expect(modules.filter((m) => EDITOR_PACKAGE.test(m) || EDITOR_FILE.test(m))).toEqual([])
    expect(modules.some((m) => m.endsWith('mobile/src/page/pageRender.ts'))).toBe(true)
    const entry = chunks.find((c) => c.isEntry && /\/index\.html$/.test(c.facadeModuleId ?? ''))!
    const first = staticClosure(chunks, entry)
    const eager = chunks.filter((c) => first.has(c.fileName)).flatMap((c) => Object.keys(c.modules))
    expect(eager.filter((m) => /node_modules\/(marked|dompurify)\//.test(m) || m.endsWith('page/pageRender.ts'))).toEqual([])
    expect(modules.some((m) => m.endsWith('mobile/src/media/ahead.ts'))).toBe(true)
    expect(eager.filter((m) => /mobile\/src\/media\/(ahead|plan|refs)\.ts$|media\/ui\/vaultMedia\.ts$/.test(m))).toEqual([])
    expect(eager.some((m) => m.endsWith('mobile/src/screens/Search.tsx'))).toBe(true)
  })
})
