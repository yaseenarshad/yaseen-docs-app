import { describe, expect, it } from 'vitest'
import type { CourseAudioChange, CourseAudioSound } from '@shared/courseAudio'
import { downloadedVoice, type CourseAudioBridge } from './downloadedVoice'

/** A fake main: chapters arrive when the test says, and each call is recorded. */
function fakeMain() {
  const here = new Map<string, CourseAudioSound>()
  const listeners = new Set<(change: CourseAudioChange) => void>()
  const calls: string[] = []
  let failing = false
  const bridge: CourseAudioBridge = {
    open: async (open) => void calls.push(`open:${open}`),
    chapterStarting: async (chapter) => {
      calls.push(`start:${chapter}`)
      if (failing) throw new Error('bridge down')
    },
    chapter: async (chapter) => {
      if (failing) throw new Error('bridge down')
      return here.get(chapter) ?? null
    },
    onChange: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
  return {
    bridge,
    calls,
    listeners,
    fail: () => void (failing = true),
    send: (change: CourseAudioChange, sound?: CourseAudioSound) => {
      if (sound !== undefined) here.set(change.chapter, sound)
      listeners.forEach((fn) => fn(change))
    },
  }
}

const WHY: CourseAudioSound = { clips: { 'c1-01': { url: 'app://course-voice/why/c1-01.m4a?v=1bff852e', seconds: 5.55 } } }

describe('the downloaded voice fills the seam (YAZ-5159)', () => {
  it('null before the sound is here; onArrive when it arrives; then each clip with its URL and seconds', async () => {
    const main = fakeMain()
    const voice = downloadedVoice(main.bridge)
    const arrived: string[] = []
    const off = voice.onArrive((id) => arrived.push(id))
    voice.chapterStarting('why')
    expect(main.calls).toEqual(['start:why'])
    expect(await voice.chapter('why')).toBeNull()
    main.send({ chapter: 'why', state: 'loading' })
    expect(arrived).toEqual([])
    main.send({ chapter: 'why', state: 'here' }, WHY)
    expect(arrived).toEqual(['why'])
    const sound = await voice.chapter('why')
    expect(sound?.clip('c1-01')).toEqual({ url: 'app://course-voice/why/c1-01.m4a?v=1bff852e', seconds: 5.55 })
    expect(sound?.clip('c1-02')).toBeNull()
    expect(sound?.clip('constructor')).toBeNull()
    off()
    expect(main.listeners.size).toBe(0)
  })

  it('missing, then "Try again" asks main again, then the line goes when the sound comes', () => {
    const main = fakeMain()
    const voice = downloadedVoice(main.bridge)
    const seen: [string, boolean][] = []
    voice.onMissing!((id, missing) => seen.push([id, missing]))
    main.send({ chapter: 'why', state: 'missing' })
    voice.retry!('why')
    main.send({ chapter: 'why', state: 'loading' })
    main.send({ chapter: 'why', state: 'here' }, WHY)
    expect(main.calls).toEqual(['start:why'])
    expect(seen).toEqual([
      ['why', true],
      ['why', false],
      ['why', false],
    ])
  })

  it('a bridge that fails is silence, never an error', async () => {
    const main = fakeMain()
    main.fail()
    const voice = downloadedVoice(main.bridge)
    expect(() => voice.chapterStarting('why')).not.toThrow()
    expect(await voice.chapter('why')).toBeNull()
  })

  it('a window with no course-audio door: subscribing does not throw', () => {
    const main = fakeMain()
    const voice = downloadedVoice({
      ...main.bridge,
      onChange: () => {
        throw new TypeError('no door')
      },
    })
    expect(() => voice.onArrive(() => undefined)()).not.toThrow()
    expect(() => voice.onMissing!(() => undefined)()).not.toThrow()
  })

  it('open tells main the course is open in this window, and closed', () => {
    const main = fakeMain()
    const voice = downloadedVoice(main.bridge)
    voice.open(true)
    voice.open(false)
    expect(main.calls).toEqual(['open:true', 'open:false'])
  })
})
