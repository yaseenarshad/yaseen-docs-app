/**
 * `editor/crepe.ts` (YAZ-2184): the app's Crepe, built from Crepe's own parts with only the features
 * it loads. These pin it to the installed package — the same feature values, the same editor as
 * the package's own `Crepe` for the app's feature set — and keep the package's root module, which
 * carries every disabled feature (KaTeX among them), out of the renderer's production code.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Crepe as PackageCrepe, CrepeFeature as PackageCrepeFeature, useCrepeFeatures } from '@milkdown/crepe'
import { codeBlockConfig } from '@milkdown/kit/component/code-block'
import { editorViewCtx } from '@milkdown/kit/core'
import { Crepe, CrepeFeature } from './crepe'
import { ENABLED_FEATURES, features } from './featureConfig'

/** `client/src` — every production module of the renderer. */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourceFiles(join(dir, e.name)) : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  )
}

/** A value import, re-export, side-effect or dynamic import of the package ROOT (`import type` is fine). */
const ROOT_VALUE_IMPORT = /^\s*(?:import|export)\s+(?!type\b)[^'"]*\bfrom\s+['"]@milkdown\/crepe['"]|\bimport\s*\(?\s*['"]@milkdown\/crepe['"]/m

/** Every Crepe feature the document below exercises, in one note. */
const DOC = [
  '# Heading',
  '',
  'Text with **bold**, *em*, `code`, ~~strike~~ and a [link](https://example.com).',
  '',
  '* bullet',
  '  * nested',
  '* [ ] task',
  '',
  '1. first',
  '2. second',
  '',
  '> quote',
  '',
  '```js',
  'const x = 1',
  '```',
  '',
  '| a | b |',
  '| - | - |',
  '| 1 | 2 |',
  '',
  '![alt](img.png)',
  '',
  '***',
  '',
].join('\n')

describe('editor/crepe (YAZ-2184)', () => {
  const roots: HTMLElement[] = []
  const editors: { destroy: () => Promise<unknown> }[] = []
  afterEach(async () => {
    for (const e of editors.splice(0)) await e.destroy()
    for (const r of roots.splice(0)) r.remove()
  })

  it('mirrors every CrepeFeature value of the installed Crepe', () => {
    expect({ ...CrepeFeature }).toEqual({ ...PackageCrepeFeature })
  })

  it('no production module imports a VALUE from the @milkdown/crepe root — one would bring katex back into the main chunk', () => {
    const offenders = sourceFiles(SRC)
      .filter((f) => ROOT_VALUE_IMPORT.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f))
      .sort()
    expect(offenders).toEqual([])
  })

  it("builds the same editor as the package's Crepe for the app's features: loaded features, schema, plugins, rendered DOM and code languages", async () => {
    const build = async (Ctor: typeof Crepe | typeof PackageCrepe) => {
      const root = document.createElement('div')
      document.body.appendChild(root)
      roots.push(root)
      // Fresh configs per editor: the package's Crepe merges its defaults INTO the object it is given.
      const crepe = new Ctor({
        root,
        defaultValue: DOC,
        features,
        featureConfigs: { [CrepeFeature.BlockEdit]: { listGroup: { orderedList: null } }, [CrepeFeature.Cursor]: { virtual: false } },
      })
      editors.push(crepe)
      await crepe.create()
      return crepe.editor.action((ctx) => {
        const { state } = ctx.get(editorViewCtx)
        return {
          features: useCrepeFeatures(ctx).get(),
          nodes: Object.keys(state.schema.nodes),
          marks: Object.keys(state.schema.marks),
          // PluginKey names carry a global counter (`tooltip$3`); the name is what identifies the plugin.
          plugins: state.plugins.map((p) => (p as unknown as { key: string }).key.replace(/\$\d*$/, '')),
          // The link editor's input carries a random id per mount.
          html: root.innerHTML.replace(/id="milkdown-link-edit-\w+"/g, 'id="milkdown-link-edit"'),
          markdown: crepe.getMarkdown(),
          // The Crepe CodeMirror default this app keeps: the language picker's list.
          languages: ctx.get(codeBlockConfig.key).languages.map((l) => l.name),
        }
      })
    }
    const ours = await build(Crepe)
    const pkg = await build(PackageCrepe)
    expect([...ours.features].sort()).toEqual([...ENABLED_FEATURES].sort())
    expect(ours.languages.length).toBeGreaterThan(100)
    expect(ours).toEqual(pkg)
  })

  it('refuses a feature it does not bundle instead of silently leaving it out', () => {
    expect(() => new Crepe({ features: { ...features, [CrepeFeature.Latex]: true } })).toThrow(/"latex" is not bundled/)
  })

  it("main.tsx imports Crepe's common theme file by file, in the package's order, minus the disabled features' CSS", () => {
    const style = createRequire(import.meta.url).resolve('@milkdown/crepe/theme/common/style.css')
    const packageFiles = [...readFileSync(style, 'utf8').matchAll(/@import '\.\/([\w-]+)\.css'/g)].map((m) => m[1])
    const imported = [...readFileSync(join(SRC, 'main.tsx'), 'utf8').matchAll(/import '@milkdown\/crepe\/theme\/common\/([\w-]+)\.css'/g)].map((m) => m[1])
    expect(imported).toEqual(packageFiles.filter((f) => !['latex', 'top-bar', 'diff', 'ai'].includes(f)))
  })

  it("the KaTeX stylesheet latex.css used to carry now loads with the drawing surface (Excalidraw's Mermaid dialog)", () => {
    const latex = createRequire(import.meta.url).resolve('@milkdown/crepe/theme/common/latex.css')
    expect(readFileSync(latex, 'utf8')).toContain("@import 'katex/dist/katex.min.css';")
    expect(readFileSync(join(SRC, 'drawings', 'ExcalidrawSurface.tsx'), 'utf8')).toContain("import('katex/dist/katex.min.css')")
  })
})
