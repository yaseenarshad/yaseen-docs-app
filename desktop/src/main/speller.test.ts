import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { createSpeller, nativeMenuGuesses, spellerPath } from './speller'

/** A helper process that answers each line it reads with `answer(word)`, as the Swift one does. */
function fakeHelper(answer: (word: string) => unknown) {
  const started: FakeChild[] = []
  const spawn = () => {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: () => child.emit('exit', null) })
    child.stdin.setEncoding('utf8').on('data', (lines: string) => {
      for (const word of lines.split('\n').slice(0, -1)) child.stdout.write(`${JSON.stringify(answer(word))}\n`)
    })
    started.push(child)
    return child as unknown as ChildProcessWithoutNullStreams
  }
  return { spawn, started }
}
type FakeChild = EventEmitter & { stdin: PassThrough; stdout: PassThrough }

describe('createSpeller (YAZ-4464 D1)', () => {
  it('answers asks in order from one helper, null for a word spelled right', async () => {
    const helper = fakeHelper((word) => (word === 'relavent' ? ['relevant'] : null))
    const speller = createSpeller('speller', helper.spawn)

    expect(await Promise.all([speller.guesses('relavent'), speller.guesses('relevant'), speller.guesses('relavent')])).toEqual([['relevant'], null, ['relevant']])
    expect(helper.started).toHaveLength(1)
  })

  it('never asks about an empty word, a long one, or one with a line break', async () => {
    const helper = fakeHelper(() => ['x'])
    const speller = createSpeller('speller', helper.spawn)

    expect(await Promise.all([speller.guesses(''), speller.guesses('a'.repeat(101)), speller.guesses('two\nwords')])).toEqual([null, null, null])
    expect(helper.started).toHaveLength(0)
  })

  it('gives waiting asks no guesses when the helper exits, and starts a new one at the next ask', async () => {
    const silent = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough() })
    const helper = fakeHelper(() => ['relevant'])
    let spawned = 0
    const speller = createSpeller('speller', () => (spawned++ === 0 ? (silent as unknown as ChildProcessWithoutNullStreams) : helper.spawn()))

    const waiting = speller.guesses('relavent')
    silent.emit('exit', 1)
    expect(await waiting).toBeNull()
    expect(await speller.guesses('relavent')).toEqual(['relevant'])
    expect(spawned).toBe(2)
  })

  it('gives no guesses when the helper cannot start, and a line that is not JSON answers none', async () => {
    const broken = createSpeller('speller', () => {
      const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough() })
      queueMicrotask(() => child.emit('error', new Error('ENOENT')))
      return child as unknown as ChildProcessWithoutNullStreams
    })
    expect(await broken.guesses('relavent')).toBeNull()

    const garbled = createSpeller('speller', fakeHelper(() => 'not json').spawn)
    expect(await garbled.guesses('relavent')).toBeNull()
  })

  it('finds the helper in Resources/bin when packaged, else in desktop/build/bin', () => {
    expect(spellerPath({ isPackaged: true, resourcesPath: '/A.app/Contents/Resources', mainDir: '/x' })).toBe('/A.app/Contents/Resources/bin/speller')
    expect(spellerPath({ isPackaged: false, resourcesPath: '', mainDir: '/repo/desktop/out/main' })).toBe('/repo/desktop/build/bin/speller')
  })
})

describe('nativeMenuGuesses (YAZ-4464 D3)', () => {
  const ask = async (word: string) => (word === 'relavent' ? ['relevant'] : null)

  it('on macOS asks the helper for the word Chromium marked', async () => {
    expect(await nativeMenuGuesses({ misspelledWord: 'relavent', dictionarySuggestions: [] }, 'darwin', ask)).toEqual(['relevant'])
    expect(await nativeMenuGuesses({ misspelledWord: 'zzqx', dictionarySuggestions: [] }, 'darwin', ask)).toEqual([])
  })

  it('asks nothing with no marked word, and keeps the Hunspell guesses off macOS', async () => {
    const never = async () => {
      throw new Error('asked')
    }
    expect(await nativeMenuGuesses({ misspelledWord: '', dictionarySuggestions: [] }, 'darwin', never)).toEqual([])
    expect(await nativeMenuGuesses({ misspelledWord: 'relavent', dictionarySuggestions: ['relevant'] }, 'win32', never)).toEqual(['relevant'])
  })
})

// Idea 7: the real helper, built by `npm test` (tools/buildSpeller.mjs) on macOS. The YAZ-3653 tests
// faked the spell checker, so a path that never worked on macOS passed.
const realHelper = resolve(__dirname, '../../build/bin/speller')
describe.runIf(process.platform === 'darwin')('the real macOS helper', () => {
  it('is built', () => expect(existsSync(realHelper)).toBe(true))

  it('guesses as the macOS checker does, the autocorrect pick first, keeping the case', async () => {
    const speller = createSpeller(realHelper)
    try {
      expect((await speller.guesses('relavent'))?.[0]).toBe('relevant')
      expect((await speller.guesses('Relavent'))?.[0]).toBe('Relevant')
      expect((await speller.guesses('persue'))?.[0]).toBe('pursue')
      expect((await speller.guesses('Fundations'))?.[0]).toBe('Foundations')
      expect(await speller.guesses('relevant')).toBeNull()
      expect(await speller.guesses("don't")).toBeNull()
      expect((await speller.guesses('teh'))?.length).toBeLessThanOrEqual(5)
    } finally {
      speller.stop()
    }
  }, 20_000)
})
