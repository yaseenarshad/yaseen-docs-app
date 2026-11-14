import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { AGENT_PROMPT, COURSE, NO_CARDS_YET } from './script'
import { courseTranscript, TRANSCRIPT_FIRST_LINE } from './transcript'

/** The skill's page made from the script. `UPDATE_COURSE_TRANSCRIPT=1 npx vitest run client/src/course/script.test.ts` writes it again. */
const PAGE = resolve(__dirname, '../../../skills/card-skill/Course transcript.md')

describe('the course script (YAZ-5119, version 2 YAZ-5147, version 3 YAZ-5148)', () => {
  it('has the 12 chapters with unique ids, and chapter 1 keeps the one sample clip whose words did not change', () => {
    expect(COURSE).toHaveLength(12)
    expect(new Set(COURSE.map((ch) => ch.id)).size).toBe(COURSE.length)
    expect(COURSE[0].clips.filter((c) => /^s\d[ab]$/.test(c.id)).map((c) => c.id)).toEqual(['s2b'])
  })

  it('gives each clip a unique id of the form c<chapter>-<nn>', () => {
    const ids = COURSE.flatMap((ch) => ch.clips.map((c) => c.id))
    expect(new Set(ids).size).toBe(ids.length)
    COURSE.forEach((ch, i) => {
      for (const clip of ch.clips) if (!/^s\d[ab]$/.test(clip.id)) expect(clip.id).toMatch(new RegExp(`^c${i + 1}-\\d\\d$`))
    })
  })

  it('keeps the words plain: no exclamation mark, never "note card"', () => { // rename-note-to-page: keep (the old name stays out of the course)
    const lines = [...COURSE.flatMap((ch) => [...ch.clips.map((c) => c.text), ...(ch.tryIt ?? []).map((s) => s.say)]), NO_CARDS_YET]
    for (const line of lines) {
      expect(line).not.toContain('!')
      expect(line.toLowerCase()).not.toContain('note card') // rename-note-to-page: keep
    }
  })

  it('keeps the spoken words at 3,850 or fewer (about 26 minutes at 145 words a minute), and never says "atomic"', () => {
    const clips = COURSE.flatMap((ch) => ch.clips.map((c) => c.text))
    const words = clips.join(' ').split(/\s+/).filter((w) => w !== '').length
    expect(words).toBeLessThanOrEqual(3850)
    for (const line of clips) expect(line.toLowerCase()).not.toMatch(/\batomic\b/)
  })

  it('names each tour target in kebab case', () => {
    for (const step of COURSE.flatMap((ch) => ch.tryIt ?? [])) expect(step.target).toMatch(/^[a-z]+(-[a-z]+)*$/)
  })

  it('holds the prompt\'s first sentence with a {path} place', () => {
    expect(AGENT_PROMPT.replace('{path}', '/x/card-skill')).toBe('Read the card skill at "/x/card-skill" before you make or change cards in this vault.')
  })

  it('matches the skill page Course transcript.md', () => {
    const made = courseTranscript(COURSE)
    expect(made.split('\n')[0]).toBe(TRANSCRIPT_FIRST_LINE)
    if (process.env.UPDATE_COURSE_TRANSCRIPT === '1') writeFileSync(PAGE, made)
    expect(readFileSync(PAGE, 'utf8'), 'Course transcript.md differs from script.ts: run UPDATE_COURSE_TRANSCRIPT=1 npx vitest run client/src/course/script.test.ts').toBe(made)
  })
})
