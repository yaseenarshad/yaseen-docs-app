/**
 * The macOS spell checker's guesses for the right-click menus (YAZ-4464 D1). Electron loads no
 * dictionary on macOS, so `webFrame.isWordMisspelled` is always false there and the `context-menu`
 * params carry no `dictionarySuggestions`. One small Swift helper (`build/speller.swift`) asks
 * `NSSpellChecker`: started at the first ask, kept until the app quits (`speller.stop()`, in the quit
 * sequence), started again at the next ask if it exits. One process at most; asks answer in order.
 */
import { spawn as nodeSpawn, type ChildProcessByStdio } from 'node:child_process'
import { join, resolve } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { isSpellWord } from '@shared/spelling'

/** The helper's process: stdin and stdout piped, stderr ignored, so a full stderr pipe can never block it (S5). */
export type SpellerProcess = ChildProcessByStdio<Writable, Readable, null>
type Spawn = (file: string) => SpellerProcess

/** How long one ask waits for the helper (S2). Past it the helper counts as stuck: it is killed, and the next ask starts a new one. */
export const ASK_LIMIT_MS = 2000
/** The most asks that wait at one time (S2). One more answers null at once. */
export const MAX_WAITING = 16

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

/**
 * One window's native menu guesses, latest-wins (S6): null when a newer right-click came while this
 * one waited, so only the latest opens a menu. `guesses` carries the menu's wait (`createSpellWait`).
 */
export function nativeMenuAsker(platform: NodeJS.Platform, guesses: (word: string) => Promise<string[] | null>) {
  let latest = 0
  return async (params: { misspelledWord: string; dictionarySuggestions: string[] }): Promise<string[] | null> => {
    const ask = ++latest
    const suggestions = await nativeMenuGuesses(params, platform, guesses)
    return ask === latest ? suggestions : null
  }
}

/** A speller over one helper file. `spawn` is for the tests. */
export function createSpeller(file: string, spawn: Spawn = (f) => nodeSpawn(f, { stdio: ['pipe', 'pipe', 'ignore'] })) {
  /** The running helper with its own waiting asks: an old helper's late line, exit or EPIPE never reaches a new one's (S1). */
  let helper: { child: SpellerProcess; waiting: ((guesses: string[] | null) => void)[]; end: (failure: string | null) => void } | null = null
  /** A helper failed on its own before its first answer (S7): no new start until the app restarts. */
  let broken = false
  let warned = false

  const start = () => {
    const child = spawn(file)
    const waiting: ((guesses: string[] | null) => void)[] = []
    let answered = false
    let over = false
    // Gone: this helper's waiting asks get no guesses, and the next ask starts a new one. `failure` is why, null when the app stopped it.
    const end = (failure: string | null) => {
      if (over) return
      over = true
      if (helper?.child === child) helper = null
      if (failure !== null && !warned) {
        warned = true
        console.warn(`speller: ${file}: ${failure}`)
      }
      for (const answer of waiting.splice(0)) answer(null)
    }
    // It exited or could not start before its first answer: a missing or broken helper, started once only.
    const failed = (failure: string) => {
      if (!over && !answered) broken = true
      end(failure)
    }
    let buffer = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk
      for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
        const line = buffer.slice(0, at)
        buffer = buffer.slice(at + 1)
        let answer: string[] | null = null
        try {
          const parsed: unknown = JSON.parse(line)
          if (Array.isArray(parsed)) answer = parsed.filter((g): g is string => typeof g === 'string')
        } catch {
          // A line that is not JSON answers "no guesses".
        }
        answered = true
        waiting.shift()?.(answer)
      }
    })
    child.on('exit', (code, signal) => failed(`exited (${signal ?? code})`))
    child.on('error', (error) => failed(String(error)))
    child.stdin.on('error', (error) => failed(String(error)))
    return { child, waiting, end }
  }

  return {
    /** The guesses for a misspelled `word`, best first; null when it is spelled right or the helper cannot answer. */
    guesses(word: string): Promise<string[] | null> {
      if (broken || !isSpellWord(word)) return Promise.resolve(null)
      helper ??= start()
      const { child, waiting, end } = helper
      if (waiting.length >= MAX_WAITING) return Promise.resolve(null)
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          end(`no answer in ${ASK_LIMIT_MS} ms`)
          child.kill()
        }, ASK_LIMIT_MS)
        waiting.push((guesses) => {
          clearTimeout(timer)
          resolve(guesses)
        })
        child.stdin.write(`${word}\n`)
      })
    },
    stop(): void {
      const running = helper
      running?.end(null)
      running?.child.kill()
    },
  }
}
