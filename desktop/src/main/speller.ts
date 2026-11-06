/**
 * The macOS spell checker's guesses for the right-click menus (YAZ-4464 D1). Electron loads no
 * dictionary on macOS, so `webFrame.isWordMisspelled` is always false there and the `context-menu`
 * params carry no `dictionarySuggestions`. One small Swift helper (`build/speller.swift`) asks
 * `NSSpellChecker`: started at the first ask, kept until the app quits (`stopSpeller`, in the quit
 * sequence), started again at the next ask if it exits. One process at most; asks answer in order.
 */
import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { join, resolve } from 'node:path'

type Spawn = (file: string) => ChildProcessWithoutNullStreams

/** A word the helper is never asked about: nothing to check, or a line break that would split the ask. */
const MAX_WORD = 100

/** Where the helper lives: `Resources/bin` in the app, `desktop/build/bin` in a checkout (found from main's own folder too). */
export function spellerPath({ isPackaged, resourcesPath, mainDir }: { isPackaged: boolean; resourcesPath: string; mainDir: string }): string {
  return isPackaged ? join(resourcesPath, 'bin', 'speller') : resolve(mainDir, '..', '..', 'build', 'bin', 'speller')
}

/**
 * The guesses for the native right-click menu (YAZ-4464 D3): on macOS Chromium names the misspelled
 * word but gives no guesses, so the helper's stand in; elsewhere Chromium's own (Hunspell) stay.
 */
export async function nativeMenuGuesses(params: { misspelledWord: string; dictionarySuggestions: string[] }, platform: NodeJS.Platform, guesses: (word: string) => Promise<string[] | null>): Promise<string[]> {
  if (platform !== 'darwin' || params.misspelledWord === '') return params.dictionarySuggestions
  return (await guesses(params.misspelledWord)) ?? []
}

/** A speller over one helper file. `spawn` is for the tests. */
export function createSpeller(file: string, spawn: Spawn = (f) => nodeSpawn(f)) {
  let helper: ChildProcessWithoutNullStreams | null = null
  const waiting: ((guesses: string[] | null) => void)[] = []

  const start = (): ChildProcessWithoutNullStreams => {
    const child = spawn(file)
    let buffer = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk
      for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 1)
        let answer: string[] | null = null
        try {
          const parsed: unknown = JSON.parse(line)
          if (Array.isArray(parsed)) answer = parsed.filter((g): g is string => typeof g === 'string')
        } catch {
          // A line that is not JSON answers "no guesses".
        }
        waiting.shift()?.(answer)
      }
    })
    // Gone (or never started: no helper on this build): every waiting ask gets no guesses, the next ask starts a new one.
    const gone = () => {
      if (helper === child) helper = null
      for (const answer of waiting.splice(0)) answer(null)
    }
    child.on('exit', gone)
    child.on('error', gone)
    child.stdin.on('error', gone)
    return child
  }

  return {
    /** The guesses for a misspelled `word`, best first; null when it is spelled right or the helper cannot answer. */
    guesses(word: string): Promise<string[] | null> {
      if (word.length === 0 || word.length > MAX_WORD || /[\r\n]/.test(word)) return Promise.resolve(null)
      helper ??= start()
      const child = helper
      return new Promise((answer) => {
        waiting.push(answer)
        child.stdin.write(`${word}\n`)
      })
    },
    stop(): void {
      helper?.kill()
      helper = null
    },
  }
}
