/**
 * YAZ-5067 (decision 3): the review hook and the card drawing load without the editor. The phone app builds its
 * review screen from `useCardReview` and `renderCard` (`cardRender.ts`), so neither may pull in the editor's link
 * plugin (`wikilinkPlugin.ts`), `createCrepe.ts` or Milkdown at load. esbuild reads the real module graph; only
 * static imports count (an `import()` is a lazy chunk, loaded when used).
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

/** Every module `entry` loads at once (static imports only), and the packages it names. */
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
    packages: 'external',
    alias: { '@shared': join(REPO, 'shared') },
    loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty' },
    // Vite's own suffixes (`?worker`, `?inline`) are not modules esbuild knows.
    plugins: [{ name: 'vite-suffix', setup: (b) => b.onResolve({ filter: /\?/ }, (a) => ({ path: a.path, external: true })) }],
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

const editorParts = (g: { files: string[]; packages: string[] }) => [
  ...g.files.filter((f) => /wikilinkPlugin\.ts$|createCrepe\.ts$|editor\/crepe\.ts$/.test(f)),
  ...g.packages.filter((p) => p.startsWith('@milkdown/')),
]

describe('the review screen loads without the editor (YAZ-5067)', () => {
  it('useCardReview: no link plugin, no Crepe, no Milkdown', async () => {
    const graph = await staticGraph('client/src/review/useCardReview.ts')
    expect(graph.files).toContain('client/src/review/reviewHost.ts')
    expect(editorParts(graph)).toEqual([])
  })

  it('cardRender (the card drawing): the card pill from `cardPill.ts`; no link plugin, no Crepe, no Milkdown', async () => {
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
  ])('%s (%s): no link plugin, no Crepe, no Milkdown', async (entry) => {
    expect(editorParts(await staticGraph(entry))).toEqual([])
  })
})
