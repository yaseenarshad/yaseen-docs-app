/**
 * The language helper door's data (YAZ-3454 4B, YAZ-3455 4C; D9, D10): what a code tab and main
 * send each other to jump by meaning. Its own file, so `types.ts` stays as it is.
 *
 * Positions are LSP's: 0-based lines, 0-based UTF-16 columns (Monaco counts the same units, from 1).
 * Places are absolute paths, never URIs: main turns the helper's `file://` URIs into paths, and a
 * place that is not a file (a helper's virtual document) is dropped.
 */

/** The helpers the app ships: TypeScript 7 for TS, JS and React, `pyright` for Python. */
export type LspLanguage = 'typescript' | 'python'

export interface LspPosition {
  line: number
  character: number
}

export interface LspRange {
  start: LspPosition
  end: LspPosition
}

export interface LspLocation {
  /** Absolute path of the file. */
  path: string
  range: LspRange
}

export interface LspOpenRequest {
  /** The vault the tab belongs to: the Python project when no `pyproject.toml`, `setup.py` or `requirements.txt` is above the file. */
  root: string
  /** Absolute path of the file. */
  path: string
  /** The text in the tab now. */
  text: string
}

export interface LspOpenResponse {
  /** This tab's document; every later call names it. */
  handle: string
  language: LspLanguage
  /** The folder the helper works in. */
  projectRoot: string
}

export interface LspPositionRequest {
  handle: string
  position: LspPosition
}

export interface LspHover {
  /** Markdown. */
  contents: string
  range?: LspRange
}

/** The LSP `languageId` of each extension the helpers take: only `text` kinds a tab opens (no `.mts`, `.cts`, `.pyi`). */
const LANGUAGE_IDS: Record<string, { language: LspLanguage; languageId: string }> = {
  '.ts': { language: 'typescript', languageId: 'typescript' },
  '.tsx': { language: 'typescript', languageId: 'typescriptreact' },
  '.js': { language: 'typescript', languageId: 'javascript' },
  '.mjs': { language: 'typescript', languageId: 'javascript' },
  '.cjs': { language: 'typescript', languageId: 'javascript' },
  '.jsx': { language: 'typescript', languageId: 'javascriptreact' },
  '.py': { language: 'python', languageId: 'python' },
}

/** The helper of a file and its LSP `languageId`; null for a file no helper takes. */
export function lspLanguageOf(path: string): { language: LspLanguage; languageId: string } | null {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? null : (LANGUAGE_IDS[name.slice(dot).toLowerCase()] ?? null)
}
