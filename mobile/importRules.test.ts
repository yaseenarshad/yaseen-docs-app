import { describe, expect, it } from 'vitest'
import { forbiddenImport } from './importRules'

describe('forbiddenImport: what the phone bundle never takes in', () => {
  it('Electron and every Node built-in, with or without node:', () => {
    for (const id of ['electron', 'electron/renderer', 'fs', 'node:fs', 'path', 'node:path', 'child_process', 'fs/promises']) expect(forbiddenImport(id)).not.toBeNull()
  })

  it('the desktop app and the drawing engine, by name or by resolved path', () => {
    for (const id of ['@excalidraw/excalidraw', '/repo/node_modules/@excalidraw/excalidraw/dist/index.js', '/repo/engine/packages/element/src/a.ts', 'monaco-editor', '/repo/desktop/src/main/index.ts'])
      expect(forbiddenImport(id)).not.toBeNull()
  })

  it('the pure code the phone is for', () => {
    for (const id of ['react', 'react-dom/client', '@shared/fileKind', '/repo/shared/fileKind.ts', '/repo/client/src/review/cardParts.tsx', './store/vaults', '/repo/mobile/src/main.tsx'])
      expect(forbiddenImport(id)).toBeNull()
  })
})
