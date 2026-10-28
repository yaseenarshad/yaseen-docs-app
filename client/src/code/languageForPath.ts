/**
 * THE LANGUAGE OF A FILE NAME, BY MONACO'S OWN REGISTRATIONS (YAZ-3508), for a caller that colours text with
 * no model (the hover card's `monaco.editor.colorize`). A code tab's model gets its language from its URI; this
 * reads the same entries (`monaco.languages.getLanguages()`) in the same order of strength as VS Code: a whole
 * file name (`Dockerfile`, `Makefile`), then a file name pattern (`Dockerfile.*`), then the longest extension
 * (`.d.ts` before `.ts`). Case aside, as Monaco matches. None → `plaintext`. Pure: the tests hand it a list.
 */

/** The fields of Monaco's `ILanguageExtensionPoint` this reads. */
export interface LanguageEntry {
  id: string
  extensions?: readonly string[]
  filenames?: readonly string[]
  filenamePatterns?: readonly string[]
}

/** A file name glob (`*`, `?`) as a whole-name, case-aside regular expression. */
const globRegExp = (glob: string): RegExp => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i')

export function languageForPath(path: string, languages: readonly LanguageEntry[]): string {
  // The base name after `/` or `\` (a Windows path, YAZ-3516), as `fileKind` reads it.
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const lower = name.toLowerCase()
  for (const lang of languages) if (lang.filenames?.some((f) => f.toLowerCase() === lower)) return lang.id
  for (const lang of languages) if (lang.filenamePatterns?.some((p) => globRegExp(p).test(name))) return lang.id
  let best: { id: string; length: number } | null = null
  for (const lang of languages) {
    for (const ext of lang.extensions ?? []) {
      const e = ext.toLowerCase()
      if (lower.length > e.length && lower.endsWith(e) && (best === null || e.length > best.length)) best = { id: lang.id, length: e.length }
    }
  }
  return best?.id ?? 'plaintext'
}
