import { isBuiltin } from 'node:module'

/**
 * Why the phone bundle must not take in this module, or `null` when it may. `id` is an import as written
 * (`'node:fs'`, `'@excalidraw/excalidraw'`) or a path the bundler resolved it to.
 *
 * The phone is a plain web page (YAZ-5071, decision 1): no Electron and no Node, so it can run in Safari.
 * It does not carry the desktop app, or the drawing engine and the code editor, which are megabytes the
 * phone never shows (decision 1: "the drawing component is not in the phone bundle").
 */
export function forbiddenImport(id: string): string | null {
  const path = id.split('?')[0].replaceAll('\\', '/')
  if (path === 'electron' || path.startsWith('electron/')) return 'Electron'
  if (!path.startsWith('/') && !path.startsWith('.') && isBuiltin(path)) return 'a Node built-in'
  if (/(^|\/)@excalidraw\//.test(path) || /(^|\/)engine\/packages\//.test(path)) return 'the drawing engine'
  if (/(^|\/)monaco-editor(\/|$)/.test(path)) return 'the code editor'
  if (/(^|\/)desktop\/src\//.test(path)) return 'the desktop app'
  return null
}
