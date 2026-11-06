import { EventEmitter } from 'node:events'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'
import { SPECIAL } from '@shared/ipc'
import { createSpellWait, SPELL_WAIT_FIRST_MS, SPELL_WAIT_MS } from '@shared/spelling'
import { registered } from './ipc/ipcFixture'
import { registerSpellerIpc } from './ipc/speller'
import { ASK_LIMIT_MS, createSpeller, MAX_WAITING, nativeMenuAsker, nativeMenuGuesses, spellerPath, type SpellerProcess } from './speller'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

type FakeChild = EventEmitter & { stdin: PassThrough; stdout: PassThrough; kill: () => void; asked: string[] }

/** A helper process the test drives: it records each line it reads, and answers only when the test writes to its stdout. */
function manualChild(): FakeChild {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), asked: [] as string[], kill: () => void child.emit('exit', null, 'SIGTERM') })
  child.stdin.setEncoding('utf8').on('data', (lines: string) => void child.asked.push(...lines.split('\n').slice(0, -1)))
  return child
}
const asProcess = (child: FakeChild) => child as unknown as SpellerProcess

/** A helper process that answers each line it reads with `answer(word)`, as the Swift one does. */
function fakeHelper(answer: (word: string) => unknown) {
  const started: FakeChild[] = []
  const spawn = () => {
    const child = manualChild()
    child.stdin.on('data', (lines: string) => {
      for (const word of lines.split('\n').slice(0, -1)) child.stdout.write(`${JSON.stringify(answer(word))}\n`)
    })
    started.push(child)
    return asProcess(child)
  }
  return { spawn, started }
}
const typos = (word: string) => ({ relavent: ['relevant'], teh: ['the'] })[word] ?? null
/** Lets the fake streams deliver what was written. */
const flushed = () => new Promise((done) => setImmediate(done))

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('createSpeller (YAZ-4464 D1)', () => {
  it('answers asks in order from one helper, null for a word spelled right', async () => {
    const helper = fakeHelper(typos)
    const speller = createSpeller('speller', helper.spawn)

    expect(await Promise.all([speller.guesses('relavent'), speller.guesses('relevant'), speller.guesses('relavent')])).toEqual([['relevant'], null, ['relevant']])
    expect(helper.started).toHaveLength(1)
  })

  it('asks only about a word "Add to dictionary" takes too: no empty word, none longer than 64, no white space (S10)', async () => {
    const helper = fakeHelper(() => ['x'])
    const speller = createSpeller('speller', helper.spawn)

    expect(await Promise.all([speller.guesses(''), speller.guesses('a'.repeat(65)), speller.guesses('two\nwords'), speller.guesses('wrold hello')])).toEqual([null, null, null, null])
    expect(helper.started).toHaveLength(0)
    expect(await speller.guesses('a'.repeat(64))).toEqual(['x'])
  })

  it('reads an answer split across stdout chunks, a UTF-8 letter cut in two too (S11)', async () => {
    const child = manualChild()
    const speller = createSpeller('speller', () => asProcess(child))
    const asked = speller.guesses('cafe')
    const line = Buffer.from('["café"]\n')
    const cut = line.indexOf(0xc3) + 1
    child.stdout.write(line.subarray(0, cut))
    await flushed()
    child.stdout.write(line.subarray(cut))
    expect(await asked).toEqual(['café'])
  })

  it('gives waiting asks no guesses when a helper that answered exits, and starts a new one at the next ask', async () => {
    const first = manualChild()
    const helper = fakeHelper(typos)
    const spawn = vi.fn().mockReturnValueOnce(asProcess(first)).mockImplementation(helper.spawn)
    const speller = createSpeller('speller', spawn)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const answered = speller.guesses('relavent')
    first.stdout.write('["relevant"]\n')
    expect(await answered).toEqual(['relevant'])
    const waiting = speller.guesses('teh')
    first.emit('exit', 1, null)
    expect(await waiting).toBeNull()
    expect(await speller.guesses('teh')).toEqual(['the'])
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['a late stdout line', (old: FakeChild) => void old.stdout.write('["relevant"]\n')],
    ['a late EPIPE', (old: FakeChild) => void old.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))],
  ])('an old helper\'s %s never reaches the new helper\'s asks (S1)', async (_, late) => {
    const [old, next] = [manualChild(), manualChild()]
    const speller = createSpeller('speller', vi.fn().mockReturnValueOnce(asProcess(old)).mockReturnValueOnce(asProcess(next)))
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const first = speller.guesses('relavent')
    old.stdout.write('["relevant"]\n')
    await first
    old.emit('exit', 0, null)

    const asked = [speller.guesses('teh'), speller.guesses('relavent')]
    late(old)
    next.stdout.write('["the"]\n["relevant"]\n')
    expect(await Promise.all(asked)).toEqual([['the'], ['relevant']])
  })

  it(`a helper silent for ${ASK_LIMIT_MS} ms: the ask gets no guesses, the helper is killed, and the next ask starts a new one (S2)`, async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const stuck = manualChild()
    const kill = vi.spyOn(stuck, 'kill')
    const helper = fakeHelper(typos)
    const spawn = vi.fn().mockReturnValueOnce(asProcess(stuck)).mockImplementation(helper.spawn)
    const speller = createSpeller('speller', spawn)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const asked = speller.guesses('relavent')
    vi.advanceTimersByTime(ASK_LIMIT_MS - 1)
    expect(kill).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(await asked).toBeNull()
    expect(kill).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledExactlyOnceWith(`speller: speller: no answer in ${ASK_LIMIT_MS} ms`)
    // A late line from the killed helper answers nothing: its asks are over.
    stuck.stdout.write('["wrong"]\n')
    expect(await speller.guesses('teh')).toEqual(['the'])
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it(`at most ${MAX_WAITING} asks wait; one more gets no guesses at once (S2)`, async () => {
    const child = manualChild()
    const speller = createSpeller('speller', () => asProcess(child))
    const waiting = Array.from({ length: MAX_WAITING }, () => speller.guesses('relavent'))
    expect(await speller.guesses('teh')).toBeNull()
    await flushed()
    expect(child.asked).toHaveLength(MAX_WAITING)
    child.stdout.write('["relevant"]\n'.repeat(MAX_WAITING))
    expect(await Promise.all(waiting)).toEqual(Array(MAX_WAITING).fill(['relevant']))
  })

  it('a helper that cannot start: no guesses, one warning with its path, and no second start until the app restarts (S7)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const spawn = vi.fn(() => {
      const child = manualChild()
      queueMicrotask(() => child.emit('error', new Error('spawn /x/speller ENOENT')))
      return asProcess(child)
    })
    const broken = createSpeller('/x/speller', spawn)
    expect(await broken.guesses('relavent')).toBeNull()
    expect(await broken.guesses('teh')).toBeNull()
    expect(spawn).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledExactlyOnceWith('speller: /x/speller: Error: spawn /x/speller ENOENT')
  })

  it('a helper that exits before its first answer counts as broken too; a line that is not JSON answers none (S7)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const crash = manualChild()
    const spawn = vi.fn(() => asProcess(crash))
    const crashed = createSpeller('speller', spawn)
    const asked = crashed.guesses('relavent')
    crash.emit('exit', 6, null)
    expect(await asked).toBeNull()
    expect(await crashed.guesses('relavent')).toBeNull()
    expect(spawn).toHaveBeenCalledOnce()

    const garbled = createSpeller('speller', fakeHelper(() => 'not json').spawn)
    expect(await garbled.guesses('relavent')).toBeNull()
  })

  it('stop() ends the helper with no warning, and the next ask starts a new one', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const helper = fakeHelper(typos)
    const speller = createSpeller('speller', helper.spawn)
    expect(await speller.guesses('teh')).toEqual(['the'])
    speller.stop()
    expect(await speller.guesses('teh')).toEqual(['the'])
    expect(helper.started).toHaveLength(2)
    expect(warn).not.toHaveBeenCalled()
  })

  it('finds the helper in Resources/bin when packaged, else in desktop/build/bin', () => {
    expect(spellerPath({ isPackaged: true, resourcesPath: '/A.app/Contents/Resources', mainDir: '/x' })).toBe('/A.app/Contents/Resources/bin/speller')
    expect(spellerPath({ isPackaged: false, resourcesPath: '', mainDir: '/repo/desktop/out/main' })).toBe('/repo/desktop/build/bin/speller')
  })
})

describe('the spell:guesses door (S10)', () => {
  it('asks the speller on macOS; off macOS it answers null and starts nothing', async () => {
    const guesses = vi.fn(async (word: string) => typos(word))
    vi.mocked(ipcMain.handle).mockClear()
    registerSpellerIpc({ guesses }, 'darwin')
    expect(await registered(SPECIAL.spellGuesses)({}, 'relavent')).toEqual({ ok: true, value: ['relevant'] })
    expect(await registered(SPECIAL.spellGuesses)({}, 7)).toEqual({ ok: true, value: null })

    vi.mocked(ipcMain.handle).mockClear()
    registerSpellerIpc({ guesses }, 'win32')
    expect(await registered(SPECIAL.spellGuesses)({}, 'relavent')).toEqual({ ok: true, value: null })
    expect(guesses).toHaveBeenCalledOnce()
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

describe('nativeMenuAsker: one window\'s native menu, latest-wins (S6)', () => {
  /** Asks the test answers by hand, in any order. */
  function deferred() {
    const answers: Array<(guesses: string[] | null) => void> = []
    return { answers, guesses: (_word: string) => new Promise<string[] | null>((answer) => void answers.push(answer)) }
  }
  const marked = (misspelledWord: string) => ({ misspelledWord, dictionarySuggestions: [] })

  it.each([
    ['the first answer comes first', [0, 1]],
    ['the second answer comes first', [1, 0]],
  ])('two right-clicks, %s: only the second opens a menu', async (_, order) => {
    const speller = deferred()
    const menuGuesses = nativeMenuAsker('darwin', speller.guesses)
    const first = menuGuesses(marked('relavent'))
    const second = menuGuesses(marked('teh'))
    const answer = [['relevant'], ['the']]
    for (const at of order) speller.answers[at](answer[at])
    expect(await first).toBeNull()
    expect(await second).toEqual(['the'])
  })

  it('each window counts its own right-clicks', async () => {
    const speller = deferred()
    const one = nativeMenuAsker('darwin', speller.guesses)
    const two = nativeMenuAsker('darwin', speller.guesses)
    const inOne = one(marked('relavent'))
    const inTwo = two(marked('teh'))
    speller.answers[0](['relevant'])
    speller.answers[1](['the'])
    expect(await Promise.all([inOne, inTwo])).toEqual([['relevant'], ['the']])
  })

  it('past the wait the menu opens with no guesses (the wait gives null)', async () => {
    const menuGuesses = nativeMenuAsker('darwin', async () => null)
    expect(await menuGuesses(marked('relavent'))).toEqual([])
  })
})

describe('createSpellWait: the menus\' wait for the guesses (S2, S8)', () => {
  /** Whether `promise` has settled, and with what, after `ms` of fake time. */
  async function after<T>(promise: Promise<T>, ms: number) {
    let settled: { value: T } | null = null
    void promise.then((value) => (settled = { value }))
    await vi.advanceTimersByTimeAsync(ms)
    return settled as { value: T } | null
  }

  it(`waits ${SPELL_WAIT_FIRST_MS} ms until the helper first answers, then ${SPELL_WAIT_MS} ms`, async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const wait = createSpellWait()
    const never = () => new Promise<string[] | null>(() => undefined)
    // No answer yet: the first ask's wait, again and again.
    expect(await after(wait(never()), SPELL_WAIT_FIRST_MS - 1)).toBeNull()
    expect(await after(wait(never()), SPELL_WAIT_FIRST_MS)).toEqual({ value: null })
    expect(await after(wait(never()), SPELL_WAIT_MS)).toBeNull()
    // The first answer comes, after 600 ms: in time, since the first wait is still 1 s.
    let answer!: (guesses: string[] | null) => void
    const first = wait(new Promise<string[] | null>((resolve) => (answer = resolve)))
    await vi.advanceTimersByTimeAsync(600)
    answer(['the'])
    expect(await first).toEqual(['the'])
    expect(await after(wait(never()), SPELL_WAIT_MS - 1)).toBeNull()
    expect(await after(wait(never()), SPELL_WAIT_MS)).toEqual({ value: null })
    expect(await after(wait(Promise.resolve(['the'])), 0)).toEqual({ value: ['the'] })
  })

  it('an answer before the wait clears its timer; an error answers null', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const wait = createSpellWait()
    expect(await wait(Promise.resolve(['the']))).toEqual(['the'])
    expect(vi.getTimerCount()).toBe(0)
    expect(await wait(Promise.reject(new Error('gone')))).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
})

// Idea 7: the real helper, built by `npm test` (tools/buildSpeller.mjs) on macOS. The YAZ-3653 tests
// faked the spell checker, so a path that never worked on macOS passed.
const realHelper = resolve(__dirname, '../../build/bin/speller')
describe.runIf(process.platform === 'darwin')('the real macOS helper', () => {
  it('is built', () => expect(existsSync(realHelper)).toBe(true))

  it('runs on macOS 12, as Electron 43 does, not only on the build Mac\'s version (S3)', () => {
    const build = execFileSync('otool', ['-l', realHelper], { encoding: 'utf8' })
    expect(build.slice(build.indexOf('LC_BUILD_VERSION'))).toMatch(/minos 12\.0\n/)
  })

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

// Idea 15: "Add to dictionary" (Electron's `addWordToSpellCheckerDictionary`, which calls `learnWord` on
// macOS) also teaches the helper that runs already. `learnWord` writes the Mac's real dictionary, so
// this runs only on the CI runner, never on a person's Mac; `finally` unlearns the word.
const onCiMac = process.platform === 'darwin' && process.env.CI !== undefined && process.env.GITHUB_ACTIONS === 'true'
describe.runIf(onCiMac)('the real helper and "Add to dictionary" (idea 15)', () => {
  const word = `zqvlorbix${Date.now().toString(36).replace(/[0-9]/g, '')}`
  const dictionary = (call: 'learnWord' | 'unlearnWord') =>
    execFileSync('osascript', ['-l', 'JavaScript', '-e', `ObjC.import('AppKit'); $.NSSpellChecker.sharedSpellChecker.${call}(${JSON.stringify(word)})`])

  it('a word learned while the helper runs has no guesses after', async () => {
    const speller = createSpeller(realHelper)
    try {
      expect(await speller.guesses(word)).not.toBeNull()
      dictionary('learnWord')
      expect(await speller.guesses(word)).toBeNull()
    } finally {
      speller.stop()
      dictionary('unlearnWord')
    }
  }, 20_000)
})
