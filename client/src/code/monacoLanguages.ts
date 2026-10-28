/**
 * COLOURS FOR THE CODE FILES MONACO DOES NOT KNOW (YAZ-3479, 2D2). Monaco ships no language for 8 of
 * the D4 types: `.hs .diff .patch .gradle .groovy .erl .cmake .elm`. Each one gets a small Monarch
 * tokenizer here: keywords, strings, comments, numbers, and a few names each language needs to read
 * well. `.diff` and `.patch` share one; `.gradle` and `.groovy` share one. No npm dependency.
 *
 * Token names are Monaco's standard ones (`keyword`, `string`, `comment`, `number`, `type.identifier`,
 * `predefined`, `annotation`, `key`, `type`). `monacoTheme.ts` gives each one an app.css colour, so
 * light and dark both work. A diff adds two names with their own theme rules: `inserted` (`--ok`, green)
 * and `deleted` (`--danger`, red). Its file headers are `type`, its `@@` lines `predefined`.
 *
 * `.ml` (OCaml) is not here: Monaco's own F# language claims it, F# is of the same ML family, and its
 * colours fit (YAZ-3479).
 *
 * `monaco.ts` registers these once, at load, before any model is made, so a model's file extension
 * picks the language as it does for Monaco's own. Each language also gets its comment marks (⌘/) and
 * its brackets.
 */
import type { languages } from 'monaco-editor'

export interface ExtraLanguage {
  id: string
  extensions: string[]
  aliases: string[]
  tokens: languages.IMonarchLanguage
  config: languages.LanguageConfiguration
}

const NUMBERS: languages.IMonarchLanguageRule[] = [
  [/0[xX][0-9a-fA-F_]+/, 'number.hex'],
  [/\d[\d_]*(\.\d+)?([eE][-+]?\d+)?/, 'number'],
]

const BRACKETS: languages.CharacterPair[] = [
  ['{', '}'],
  ['[', ']'],
  ['(', ')'],
]

const PAIRS: languages.IAutoClosingPairConditional[] = [
  { open: '{', close: '}' },
  { open: '[', close: ']' },
  { open: '(', close: ')' },
  { open: '"', close: '"', notIn: ['string'] },
]

/** A double-quoted string with backslash escapes, as a state. */
const quoted = (quote: string): languages.IMonarchLanguageRule[] => [
  [new RegExp(`[^\\\\${quote}]+`), 'string'],
  [/\\./, 'string.escape'],
  [new RegExp(quote), 'string', '@pop'],
]

/** `{- … -}` comments that nest (Haskell, Elm). */
const NESTED_BLOCK_COMMENT: languages.IMonarchLanguageRule[] = [
  [/[^{-]+/, 'comment'],
  [/\{-/, 'comment', '@push'],
  [/-\}/, 'comment', '@pop'],
  [/[{-]/, 'comment'],
]

const haskell: ExtraLanguage = {
  id: 'haskell',
  extensions: ['.hs'],
  aliases: ['Haskell', 'haskell'],
  tokens: {
    tokenPostfix: '.hs',
    keywords: ['case', 'class', 'data', 'default', 'deriving', 'do', 'else', 'family', 'forall', 'foreign', 'hiding', 'if', 'import', 'in', 'infix', 'infixl', 'infixr', 'instance', 'let', 'mdo', 'module', 'newtype', 'of', 'qualified', 'then', 'type', 'where'],
    tokenizer: {
      root: [
        [/\{-#/, 'annotation', '@pragma'],
        [/\{-/, 'comment', '@comment'],
        [/--+(?![!#$%&*+./<=>?@\\^|~:]).*$/, 'comment'],
        [/[A-Z][\w']*/, 'type.identifier'],
        [/[a-z_][\w']*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
        ...NUMBERS,
        [/"/, 'string', '@string'],
        [/'(?:[^'\\]|\\[^']*)'/, 'string'],
      ],
      pragma: [
        [/#-\}/, 'annotation', '@pop'],
        [/./, 'annotation'],
      ],
      comment: NESTED_BLOCK_COMMENT,
      string: quoted('"'),
    },
  },
  config: { comments: { lineComment: '--', blockComment: ['{-', '-}'] }, brackets: BRACKETS, autoClosingPairs: PAIRS },
}

const elm: ExtraLanguage = {
  id: 'elm',
  extensions: ['.elm'],
  aliases: ['Elm', 'elm'],
  tokens: {
    tokenPostfix: '.elm',
    keywords: ['alias', 'as', 'case', 'effect', 'else', 'exposing', 'if', 'import', 'in', 'let', 'module', 'of', 'port', 'then', 'type', 'where'],
    tokenizer: {
      root: [
        [/\{-/, 'comment', '@comment'],
        [/--.*$/, 'comment'],
        [/[A-Z][\w']*/, 'type.identifier'],
        [/[a-z_][\w']*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
        ...NUMBERS,
        [/"""/, 'string', '@longString'],
        [/"/, 'string', '@string'],
        [/'(?:[^'\\]|\\u\{[0-9a-fA-F]+\}|\\.)'/, 'string'],
      ],
      comment: NESTED_BLOCK_COMMENT,
      string: quoted('"'),
      longString: [
        [/"""/, 'string', '@pop'],
        [/\\./, 'string.escape'],
        [/[^"\\]+|"/, 'string'],
      ],
    },
  },
  config: { comments: { lineComment: '--', blockComment: ['{-', '-}'] }, brackets: BRACKETS, autoClosingPairs: PAIRS },
}

const groovy: ExtraLanguage = {
  id: 'groovy',
  extensions: ['.groovy', '.gradle'],
  aliases: ['Groovy', 'Gradle', 'groovy'],
  tokens: {
    tokenPostfix: '.groovy',
    keywords: ['abstract', 'as', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue', 'def', 'default', 'do', 'double', 'else', 'enum', 'extends', 'false', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements', 'import', 'in', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'null', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'trait', 'transient', 'true', 'try', 'var', 'void', 'volatile', 'while'],
    tokenizer: {
      root: [
        [/\/\/.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],
        [/@[A-Za-z_][\w.]*/, 'annotation'],
        [/[A-Z][\w$]*/, 'type.identifier'],
        [/[a-zA-Z_$][\w$]*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
        ...NUMBERS,
        [/"""/, 'string', '@tripleDouble'],
        [/'''/, 'string', '@tripleSingle'],
        [/"/, 'string', '@double'],
        [/'/, 'string', '@single'],
      ],
      comment: [
        [/[^/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/[/*]/, 'comment'],
      ],
      double: quoted('"'),
      single: quoted("'"),
      tripleDouble: [
        [/"""/, 'string', '@pop'],
        [/\\./, 'string.escape'],
        [/[^"\\]+|"/, 'string'],
      ],
      tripleSingle: [
        [/'''/, 'string', '@pop'],
        [/\\./, 'string.escape'],
        [/[^'\\]+|'/, 'string'],
      ],
    },
  },
  config: { comments: { lineComment: '//', blockComment: ['/*', '*/'] }, brackets: BRACKETS, autoClosingPairs: [...PAIRS, { open: "'", close: "'", notIn: ['string'] }] },
}

const erlang: ExtraLanguage = {
  id: 'erlang',
  extensions: ['.erl'],
  aliases: ['Erlang', 'erlang'],
  tokens: {
    tokenPostfix: '.erl',
    keywords: ['after', 'and', 'andalso', 'band', 'begin', 'bnot', 'bor', 'bsl', 'bsr', 'bxor', 'case', 'catch', 'cond', 'div', 'else', 'end', 'fun', 'if', 'let', 'maybe', 'not', 'of', 'or', 'orelse', 'receive', 'rem', 'try', 'when', 'xor'],
    tokenizer: {
      root: [
        [/%.*$/, 'comment'],
        // A module attribute: `-module(…).`, `-export([…]).`, `-define(…).`
        [/^-[a-z_]\w*/, 'annotation'],
        [/\?\??[A-Za-z_]\w*/, 'predefined'],
        [/[A-Z_][\w@]*/, 'variable'],
        [/[a-z][\w@]*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
        [/\d+#[0-9a-zA-Z]+/, 'number'],
        ...NUMBERS,
        [/\$(?:\\.|.)/, 'string'],
        [/"/, 'string', '@string'],
        [/'(?:[^'\\]|\\.)*'/, 'key'],
      ],
      string: quoted('"'),
    },
  },
  config: { comments: { lineComment: '%' }, brackets: BRACKETS, autoClosingPairs: PAIRS },
}

/** CMake's flow commands. CMake reads a command name in any case (`IF(` in older files), so both cases count. */
const CMAKE_FLOW = ['block', 'break', 'continue', 'else', 'elseif', 'endblock', 'endforeach', 'endfunction', 'endif', 'endmacro', 'endwhile', 'foreach', 'function', 'if', 'macro', 'return', 'while']

const cmake: ExtraLanguage = {
  id: 'cmake',
  extensions: ['.cmake'],
  aliases: ['CMake', 'cmake'],
  tokens: {
    tokenPostfix: '.cmake',
    keywords: [...CMAKE_FLOW, ...CMAKE_FLOW.map((k) => k.toUpperCase())],
    tokenizer: {
      root: [
        [/#\[=*\[/, 'comment', '@bracketComment'],
        [/#.*$/, 'comment'],
        // A command: a name before `(`. The flow commands are keywords; every other one is a function.
        [/[A-Za-z_]\w*(?=\s*\()/, { cases: { '@keywords': 'keyword', '@default': 'predefined' } }],
        [/\$(?:ENV|CACHE)?\{/, 'key', '@variable'],
        [/\b[A-Z][A-Z0-9_]+\b/, 'type'],
        ...NUMBERS,
        [/"/, 'string', '@string'],
      ],
      bracketComment: [
        [/\]=*\]/, 'comment', '@pop'],
        [/[^\]]+|\]/, 'comment'],
      ],
      variable: [
        [/\}/, 'key', '@pop'],
        [/\$(?:ENV|CACHE)?\{/, 'key', '@push'],
        [/[^}$]+|\$/, 'key'],
      ],
      string: [
        [/\$(?:ENV|CACHE)?\{/, 'key', '@variable'],
        [/[^\\"$]+|\$/, 'string'],
        [/\\./, 'string.escape'],
        [/"/, 'string', '@pop'],
      ],
    },
  },
  config: { comments: { lineComment: '#' }, brackets: BRACKETS, autoClosingPairs: PAIRS },
}

const diff: ExtraLanguage = {
  id: 'diff',
  extensions: ['.diff', '.patch'],
  aliases: ['Diff', 'Patch', 'diff'],
  tokens: {
    tokenPostfix: '.diff',
    tokenizer: {
      root: [
        // The file headers first: `---` and `+++` are not a removed or an added line.
        [/^(?:diff |index |--- |\+\+\+ |new file mode|deleted file mode|old mode|new mode|similarity index|rename from|rename to|Binary files|Only in ).*$/, 'type'],
        [/^@@.*$/, 'predefined'],
        [/^[+>].*$/, 'inserted'],
        [/^[-<].*$/, 'deleted'],
        [/^\\.*$/, 'comment'],
        [/.+$/, ''],
      ],
    },
  },
  config: {},
}

/** The languages, in the order they register. */
export const EXTRA_LANGUAGES: readonly ExtraLanguage[] = [haskell, diff, groovy, erlang, cmake, elm]

/** The part of `monaco.languages` this needs (the tests hand it a fake). */
export type LanguageRegistry = Pick<typeof languages, 'register' | 'setMonarchTokensProvider' | 'setLanguageConfiguration' | 'getLanguages'>

/** Registers each language Monaco lacks; one Monaco already has (a later Monaco) is left as it is. */
export function registerExtraLanguages(registry: LanguageRegistry): void {
  const known = new Set(registry.getLanguages().map((l) => l.id))
  for (const lang of EXTRA_LANGUAGES) {
    if (known.has(lang.id)) continue
    registry.register({ id: lang.id, extensions: lang.extensions, aliases: lang.aliases })
    registry.setMonarchTokensProvider(lang.id, lang.tokens)
    registry.setLanguageConfiguration(lang.id, lang.config)
  }
}
