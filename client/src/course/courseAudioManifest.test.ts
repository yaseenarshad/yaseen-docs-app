/**
 * The course sound's manifest against the script (YAZ-5159, 6D1). The app carries `course-audio.json` (made by
 * `tools/course-audio/pack.mjs`); each clip's `hash` is the first 16 hex of the SHA-256 of the words the voice said.
 * When a clip's words change in `script.ts`, its sound no longer says them: this test fails and lists the clips to
 * voice again (`tools/cardCourseVoice.mjs`), then pack again.
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import manifest from '../../../desktop/src/main/courseAudio/course-audio.json'
import { COURSE } from './script'

/**
 * THE ONE PLACE for clips whose words changed after the voice run, or that are new: they play silent, with captions,
 * until they are voiced and packed again. Empty: every clip's sound says its words (checked 2026-11-13, 245 clips).
 */
const NOT_VOICED_YET: readonly string[] = []

const clipHash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
const chapters = manifest.chapters as Record<string, { clips: Record<string, { seconds: number; hash: string }> }>

describe('the course sound matches the script (YAZ-5159)', () => {
  it('names the chapters in the course order', () => {
    expect(Object.keys(chapters)).toEqual(COURSE.map((c) => c.id))
  })

  it('every clip has a voice whose text hash is its words now (or is on NOT_VOICED_YET)', () => {
    const toVoice = COURSE.flatMap((chapter) => chapter.clips.filter((clip) => chapters[chapter.id]?.clips[clip.id]?.hash !== clipHash(clip.text)).map((clip) => clip.id))
    // The clips to voice again, by id: run tools/cardCourseVoice.mjs for them, then tools/course-audio/pack.mjs.
    expect(toVoice.filter((id) => !NOT_VOICED_YET.includes(id))).toEqual([])
  })

  it('NOT_VOICED_YET names only clips that really need a voice', () => {
    const ids = new Map(COURSE.flatMap((ch) => ch.clips.map((clip) => [clip.id, { chapter: ch.id, text: clip.text }] as const)))
    for (const id of NOT_VOICED_YET) {
      const clip = ids.get(id)
      expect(clip, `${id} is not in the script`).toBeDefined()
      expect(chapters[clip!.chapter]?.clips[id]?.hash, `${id} is voiced: take it off the list`).not.toBe(clipHash(clip!.text))
    }
  })

  it('holds no clip the script does not have', () => {
    const ids = new Set(COURSE.flatMap((ch) => ch.clips.map((c) => `${ch.id}/${c.id}`)))
    expect(Object.entries(chapters).flatMap(([ch, c]) => Object.keys(c.clips).map((id) => `${ch}/${id}`)).filter((id) => !ids.has(id))).toEqual([])
  })
})
