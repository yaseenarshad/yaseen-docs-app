/**
 * YAZ-5067 (decision 3): the review hook and the card drawing load without the editor. The phone app builds its
 * review screen from `useCardReview` and `renderCard` (`cardRender.ts`), so neither may pull in the editor's link
 * plugin (`wikilinkPlugin.ts`), `createCrepe.ts`, Milkdown, Crepe, ProseMirror, CodeMirror or Lezer at load. esbuild
 * reads the real module graph, the packages' own files included (YAZ-5162: a package that pulls in the editor is seen
 * too); only static imports count (an `import()` is a lazy chunk, loaded when used).
 */
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO = resolve(__dirname, '../../..')

/**
 * esbuild, loaded under this project's jsdom: its start-up check wants `TextEncoder` to give the page's own
 * `Uint8Array`, and jsdom's global `Uint8Array` is another realm's. This file's encoder copies into it (vitest gives
 * each test file its own globals).
 */
async function esbuild(): Promise<typeof import('esbuild')> {
  const Native = globalThis.TextEncoder
  globalThis.TextEncoder = class extends Native {
    override encode(input?: string): Uint8Array<ArrayBuffer> {
      return new Uint8Array(super.encode(input))
    }
  }
  return import('esbuild')
}

/**
 * Every module `entry` loads at once (static imports only): repo files and the files of the packages they load, by
 * path (`node_modules/…`). `packages` holds what is left out of the bundle: Vite's suffixed imports.
 */
async function staticGraph(entry: string): Promise<{ files: string[]; packages: string[] }> {
  const { build } = await esbuild()
  const result = await build({
    entryPoints: [join(REPO, entry)],
    absWorkingDir: REPO,
    bundle: true,
    write: false,
    metafile: true,
    format: 'esm',
    outdir: 'out',
    logLevel: 'silent',
    alias: { '@shared': join(REPO, 'shared') },
    // The graph, not the bytes: no file type stops the walk.
    loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty', '.wasm': 'empty' },
    plugins: [
      {
        name: 'static-only',
        setup: (b) => {
          // Vite's own suffixes (`?worker`, `?inline`) are not modules esbuild knows.
          b.onResolve({ filter: /\?/ }, (a) => ({ path: a.path, external: true }))
          // An `import()` is a lazy chunk: it is not walked (the drawing engine's chunk names files esbuild cannot read).
          b.onResolve({ filter: /.*/ }, (a) => (a.kind === 'dynamic-import' ? { path: a.path, external: true } : undefined))
        },
      },
    ],
  })
  const inputs = result.metafile.inputs
  const files = new Set<string>()
  const packages = new Set<string>()
  const stack = [relative(REPO, join(REPO, entry))]
  while (stack.length > 0) {
    const file = stack.pop()!
    if (files.has(file) || inputs[file] === undefined) continue
    files.add(file)
    for (const i of inputs[file].imports) {
      if (i.kind !== 'import-statement') continue
      if (i.external) packages.add(i.path)
      else stack.push(i.path)
    }
  }
  return { files: [...files], packages: [...packages] }
}

/** The editor's own repo files: the link plugin and Crepe's setup. */
const EDITOR_FILE = /(^|\/)client\/src\/editor\/(wikilink\/wikilinkPlugin|createCrepe|crepe)\.ts$/
/** The editor's packages (Milkdown and its Crepe, ProseMirror, CodeMirror, Lezer), as a name or a file inside node_modules. */
const EDITOR_PACKAGE = /^(@milkdown\/|prosemirror-|@codemirror\/|codemirror(\/|$)|@lezer\/)/
const isEditorModule = (path: string): boolean => {
  const inPackage = /(^|\/)node_modules\/(.*)$/.exec(path)?.[2]
  return EDITOR_FILE.test(path) || EDITOR_PACKAGE.test(inPackage ?? path)
}
const editorParts = (g: { files: string[]; packages: string[] }) => [...g.files, ...g.packages].filter(isEditorModule)

describe('the review screen loads without the editor (YAZ-5067)', () => {
  it('useCardReview: no editor module; no host either (YAZ-5161: the caller passes it, so no bridge comes in)', async () => {
    const graph = await staticGraph('client/src/review/useCardReview.ts')
    expect(graph.files.filter((f) => /review\/desktopReviewHost\.ts$|client\/src\/api\.ts$|lib\/storage\.ts$/.test(f))).toEqual([])
    expect(graph.files.some((f) => f.includes('node_modules/react/'))).toBe(true) // the walk goes into packages
    expect(editorParts(graph)).toEqual([])
  })

  it('cardRender (the card drawing): the card pill from `cardPill.ts`; no editor module', async () => {
    const graph = await staticGraph('client/src/editor/card/cardRender.ts')
    expect(graph.files).toContain('client/src/editor/wikilink/cardPill.ts')
    expect(editorParts(graph)).toEqual([])
  })

  // YAZ-5153 (2A1): the review screen's parts and the helpers they read, for the phone's Review screen (4B).
  it.each([
    ['client/src/editor/wikilink/linkResolve.ts', 'how a link in a card resolves: linkCard, linkPath, linksAsShown'],
    ['client/src/editor/card/cardLook.ts', 'a card`s look in a vault'],
    ['client/src/review/cardParts.tsx', 'the card body, its ID and its Reviews table'],
    ['client/src/review/CardInbox.tsx', 'the Inbox screen'],
  ])('%s (%s): no editor module', async (entry) => {
    expect(editorParts(await staticGraph(entry))).toEqual([])
  })

  // YAZ-5162 (2A3): the guard knows every editor module: Milkdown and Crepe, ProseMirror, CodeMirror and Lezer, as a
  // package a repo file names and as a file inside node_modules that a package pulls in.
  it('the guard stops ProseMirror, CodeMirror, Lezer and Crepe, not only Milkdown', () => {
    const graph = {
      files: ['node_modules/prosemirror-state/dist/index.js', 'node_modules/@codemirror/view/dist/index.js', 'node_modules/@milkdown/crepe/lib/esm/index.js', 'client/src/editor/card/cardRender.ts', 'node_modules/marked/lib/marked.esm.js'],
      packages: ['prosemirror-view', '@codemirror/state', 'codemirror', '@lezer/common', '@milkdown/kit/core', 'react'],
    }
    expect(editorParts(graph).sort()).toEqual(['@codemirror/state', '@lezer/common', '@milkdown/kit/core', 'codemirror', 'node_modules/@codemirror/view/dist/index.js', 'node_modules/@milkdown/crepe/lib/esm/index.js', 'node_modules/prosemirror-state/dist/index.js', 'prosemirror-view'].sort())
  })

  it('the walk finds the editor where it is: the page card block loads ProseMirror, CodeMirror and Milkdown from node_modules', async () => {
    const found = editorParts(await staticGraph('client/src/editor/card/cardBlockView.ts'))
    for (const p of [/node_modules\/prosemirror-/, /node_modules\/@codemirror\//, /node_modules\/@milkdown\//]) expect(found.some((f) => p.test(f))).toBe(true)
  })
})
