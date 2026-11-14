import { describe, expect, it } from 'vitest'
import { forbiddenImport, forbiddenUse } from './importRules'

describe('forbiddenImport: what the phone bundle never takes in', () => {
  it('Electron and every Node built-in, with or without node:', () => {
    for (const id of ['electron', 'electron/renderer', 'fs', 'node:fs', 'path', 'node:path', 'child_process', 'fs/promises']) expect(forbiddenImport(id)).not.toBeNull()
  })

  it('the desktop app and the drawing engine, by name or by resolved path', () => {
    for (const id of ['@excalidraw/excalidraw', '/repo/node_modules/@excalidraw/excalidraw/dist/index.js', '/repo/engine/packages/element/src/a.ts', 'monaco-editor', '/repo/desktop/src/main/index.ts'])
      expect(forbiddenImport(id)).not.toBeNull()
  })

  // YAZ-5158 (3A3): the desktop bridge and the app's storage wrapper are forbidden by path too.
  it('the desktop bridge (client/src/api) and the app storage wrapper (client/src/lib/storage), by alias or by path', () => {
    for (const id of ['@client/api', '@client/api.ts', '/repo/client/src/api.ts', '/repo/client/src/api', '@client/lib/storage', '/repo/client/src/lib/storage.ts'])
      expect(forbiddenImport(id)).not.toBeNull()
    expect(forbiddenImport('/repo/client/src/apiHelpers.ts')).toBeNull()
  })

  it('the pure code the phone is for', () => {
    for (const id of ['react', 'react-dom/client', '@shared/fileKind', '/repo/shared/fileKind.ts', '/repo/client/src/review/cardParts.tsx', './store/vaults', '/repo/mobile/src/main.tsx'])
      expect(forbiddenImport(id)).toBeNull()
  })
})

describe('forbiddenUse: code that reaches the desktop bridge or browser storage outside mobile/src/store', () => {
  const file = '/repo/client/src/review/thing.ts'
  it('window.yaseenDocs, localStorage, sessionStorage and indexedDB in a bundled source file', () => {
    expect(forbiddenUse(file, 'export const v = window.yaseenDocs.vault.list()')).toMatch(/desktop bridge/)
    expect(forbiddenUse(file, 'localStorage.setItem("a", "b")')).toMatch(/browser storage/)
    expect(forbiddenUse(file, 'const s = window.sessionStorage')).toMatch(/browser storage/)
    expect(forbiddenUse('/repo/mobile/src/screens/Review.tsx', 'indexedDB.open("x")')).toMatch(/browser storage/)
  })

  it('the bridge in any form: a cast, a bracket, a destructure (round 3 nit)', () => {
    expect(forbiddenUse(file, '(window as any).yaseenDocs.vault.list()')).toMatch(/desktop bridge/)
    expect(forbiddenUse(file, '(globalThis as unknown as { yaseenDocs: Bridge }).yaseenDocs')).toMatch(/desktop bridge/)
    expect(forbiddenUse(file, "window['yaseenDocs'].vault")).toMatch(/desktop bridge/)
    expect(forbiddenUse(file, 'const { yaseenDocs } = window')).toMatch(/desktop bridge/)
    expect(forbiddenUse(file, 'interface Window { yaseenDocs: YaseenDocsApi }')).toBeNull()
  })

  it('a word in a comment is not a use', () => {
    expect(forbiddenUse(file, '// reads localStorage? no: window.yaseenDocs is the desktop\n/* indexedDB */ export const x = 1')).toBeNull()
  })

  it('the store may use storage; node_modules and files outside the repo sources are not read', () => {
    expect(forbiddenUse('/repo/mobile/src/store/idbBackend.ts', 'indexedDB.open("x")')).toBeNull()
    expect(forbiddenUse('/repo/node_modules/react-dom/cjs/x.js', 'localStorage')).toBeNull()
  })

  // YAZ-5160: a test file is never bundled, and the guard does not run in the test project (testConfig.test.ts).
  // forbiddenUse itself reads a file by its code, not by its name: a file named like a test gets no pass.
  it('a file is judged by its code, not by its name', () => {
    expect(forbiddenUse('/repo/mobile/src/screens/latest.ts', 'localStorage')).toMatch(/browser storage/)
    expect(forbiddenUse('/repo/mobile/src/screens/latest.test.ts', 'localStorage')).toMatch(/browser storage/)
  })
})
