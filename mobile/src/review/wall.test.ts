/**
 * YAZ-5078: the Review tab builds through the phone's wall (the real Vite build with `vite.config.ts`, so the same
 * guard as the phone's build: no desktop bridge, no app storage, no Electron, no Node), and it loads NO editor: no
 * Milkdown, ProseMirror, CodeMirror, Lezer, Excalidraw or Monaco (the checker's round 2 nit: the wall alone does not
 * stop an editor package). Built alone, nothing written.
 */
import { fileURLToPath } from 'node:url'
import { build, type Rollup } from 'vite'
import { describe, expect, it } from 'vitest'

const CONFIG = fileURLToPath(new URL('../../vite.config.ts', import.meta.url))
const ENTRY = fileURLToPath(new URL('./ReviewView.tsx', import.meta.url))
const EDITOR = /@milkdown|prosemirror|@codemirror|@lezer|@excalidraw|monaco-editor|\/editor\/crepe|createCrepe|wikilinkPlugin/

describe('the Review tab: the phone wall, and no editor', () => {
  it('builds alone with the phone config; no module of an editor is in it', async () => {
    const out = (await build({ configFile: CONFIG, logLevel: 'silent', build: { write: false, rollupOptions: { input: ENTRY, preserveEntrySignatures: 'strict' } } })) as Rollup.RollupOutput | Rollup.RollupOutput[]
    const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) => o.output)
    const modules = outputs.flatMap((o) => (o.type === 'chunk' ? Object.keys(o.modules) : []))
    console.log(`[4B wall] ${modules.length} modules in the Review screen's build`)
    expect(modules.some((m) => m.includes('client/src/review/useCardReview'))).toBe(true)
    expect(modules.some((m) => m.includes('client/src/editor/card/cardRender'))).toBe(true)
    expect(modules.filter((m) => EDITOR.test(m))).toEqual([])
    expect(modules.filter((m) => /client\/src\/(api|lib\/storage)\.ts/.test(m))).toEqual([])
  }, 120_000)
})
