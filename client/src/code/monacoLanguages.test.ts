/**
 * The 8 file types Monaco does not colour (YAZ-3479): each has a registered language with a tokenizer,
 * each tokenizer compiles with Monaco's own Monarch compiler (a bad state or rule throws there), and each
 * token it gives has a colour in the app theme. The colours on screen are checked in the real app
 * (`desktop/e2e/codeTab.spec.ts`).
 */
import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error -- Monaco ships no types for its internal Monarch compiler; the test only calls `compile(id, json)`.
import { compile as untypedCompile } from 'monaco-editor/editor/standalone/common/monarch/monarchCompile.js'
import { EXTRA_LANGUAGES, registerExtraLanguages, type LanguageRegistry } from './monacoLanguages'
import { buildMonacoTheme } from './monacoTheme'

const compile = untypedCompile as (languageId: string, json: unknown) => unknown

const EIGHT = ['.hs', '.diff', '.patch', '.gradle', '.groovy', '.erl', '.cmake', '.elm']

/** Every token name a tokenizer can give, with its `.postfix` and its `.sub` parts. */
function tokensOf(value: unknown, into = new Set<string>()): Set<string> {
  if (typeof value === 'string') into.add(value)
  else if (Array.isArray(value)) value.forEach((v, i) => (i === 0 && value.length > 1 && v instanceof RegExp ? undefined : tokensOf(v, into)))
  else if (value !== null && typeof value === 'object' && !(value instanceof RegExp)) {
    for (const [key, v] of Object.entries(value)) if (key !== 'next' && key !== '@keywords' && key !== '@default') tokensOf(v, into)
    const cases = (value as { cases?: Record<string, string> }).cases
    if (cases !== undefined) for (const v of Object.values(cases)) into.add(v)
  }
  return into
}

describe('the extra languages (YAZ-3479)', () => {
  it('each of the 8 extensions has exactly one language, with a tokenizer that has a root state', () => {
    for (const ext of EIGHT) {
      const owners = EXTRA_LANGUAGES.filter((l) => l.extensions.includes(ext))
      expect(owners, ext).toHaveLength(1)
      expect(owners[0].tokens.tokenizer.root.length, ext).toBeGreaterThan(0)
    }
    // .diff + .patch share one, .gradle + .groovy share one: 6 languages.
    expect(EXTRA_LANGUAGES.map((l) => l.id)).toEqual(['haskell', 'diff', 'groovy', 'erlang', 'cmake', 'elm'])
  })

  it(".ml stays on Monaco's F# (not claimed here)", () => {
    expect(EXTRA_LANGUAGES.some((l) => l.extensions.includes('.ml'))).toBe(false)
  })

  it("each tokenizer compiles with Monaco's own Monarch compiler", () => {
    for (const lang of EXTRA_LANGUAGES) expect(() => compile(lang.id, lang.tokens), lang.id).not.toThrow()
  })

  it('every token a tokenizer gives has an app theme colour, or is plain text on purpose', () => {
    const rules = buildMonacoTheme('light', () => 'rgb(1, 2, 3)').rules.map((r) => r.token)
    const coloured = (token: string) => rules.some((rule) => rule !== '' && (token === rule || token.startsWith(`${rule}.`)))
    const plain = new Set(['', 'identifier', 'variable', 'string.escape'])
    for (const lang of EXTRA_LANGUAGES) {
      for (const token of tokensOf(lang.tokens.tokenizer)) {
        if (token.startsWith('@')) continue
        expect(plain.has(token) || coloured(token), `${lang.id}: ${token}`).toBe(true)
      }
    }
  })

  it('registers each language once, with its extensions, tokenizer and comment marks; one Monaco already has is left alone', () => {
    const registry = { register: vi.fn(), setMonarchTokensProvider: vi.fn(), setLanguageConfiguration: vi.fn(), getLanguages: () => [{ id: 'elm' }] } as unknown as LanguageRegistry
    registerExtraLanguages(registry)
    expect(vi.mocked(registry.register).mock.calls.map(([l]) => l.id)).toEqual(['haskell', 'diff', 'groovy', 'erlang', 'cmake'])
    expect(registry.register).toHaveBeenCalledWith({ id: 'groovy', extensions: ['.groovy', '.gradle'], aliases: ['Groovy', 'Gradle', 'groovy'] })
    expect(registry.setLanguageConfiguration).toHaveBeenCalledWith('haskell', expect.objectContaining({ comments: { lineComment: '--', blockComment: ['{-', '-}'] } }))
    expect(vi.mocked(registry.setMonarchTokensProvider).mock.calls.map(([id]) => id)).toEqual(['haskell', 'diff', 'groovy', 'erlang', 'cmake'])
  })
})
