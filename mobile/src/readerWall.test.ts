/**
 * YAZ-5079 (4C): the phone reads a page with NO editor. The whole phone app is built (the real Vite build, the phone's own
 * import wall), and no chunk of it, lazy chunks too, holds Milkdown, Crepe, ProseMirror, CodeMirror or Lezer, or the
 * editor's own files. The Markdown renderer of the reader (`marked`, DOMPurify) is in a lazy chunk: the first load (the
 * tabs, the Search tab) does not carry it.
 */
import { fileURLToPath } from 'node:url'
import type { RollupOutput } from 'rollup'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'

const CONFIG = fileURLToPath(new URL('../vite.config.ts', import.meta.url))

const EDITOR_PACKAGE = /node_modules\/(@milkdown\/|prosemirror-|@codemirror\/|codemirror\/|@lezer\/)/
const EDITOR_FILE = /client\/src\/editor\/(wikilink\/wikilinkPlugin|createCrepe|crepe|useReadOnlyPage)\.ts$/

describe('the phone app has no editor, and the reader is a lazy chunk (YAZ-5079)', () => {
  it('builds; no chunk holds an editor module; marked and DOMPurify are not in the first load', async () => {
    const out = (await build({ configFile: CONFIG, logLevel: 'silent', build: { write: false } })) as RollupOutput
    const chunks = out.output.filter((o) => o.type === 'chunk')
    const modules = chunks.flatMap((c) => Object.keys(c.modules))
    expect(modules.filter((m) => EDITOR_PACKAGE.test(m) || EDITOR_FILE.test(m))).toEqual([])
    // The reader is there, in a chunk of its own.
    expect(modules.some((m) => m.endsWith('mobile/src/page/pageRender.ts'))).toBe(true)
    // The app's entry (YAZ-5087 adds a second page, the friend landing page `friend.html`).
    const entry = chunks.find((c) => c.isEntry && /\/index\.html$/.test(c.facadeModuleId ?? ''))!
    const first = new Set([entry.fileName, ...entry.imports])
    const eager = chunks.filter((c) => first.has(c.fileName)).flatMap((c) => Object.keys(c.modules))
    expect(eager.filter((m) => /node_modules\/(marked|dompurify)\//.test(m) || m.endsWith('page/pageRender.ts'))).toEqual([])
    // 3D's media (YAZ-5074) comes with the engine or the reader, never in the first load.
    expect(modules.some((m) => m.endsWith('mobile/src/media/ahead.ts'))).toBe(true)
    expect(eager.filter((m) => /mobile\/src\/media\/(ahead|plan|refs)\.ts$|media\/ui\/vaultMedia\.ts$/.test(m))).toEqual([])
    // The Search tab is in the first load: it opens at once, with no signal.
    expect(eager.some((m) => m.endsWith('mobile/src/screens/Search.tsx'))).toBe(true)
  }, 180_000)
})
