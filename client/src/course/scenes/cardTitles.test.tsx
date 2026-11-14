/**
 * The course's copies of a card's text and of a new card show the title where the app keeps it (YAZ-5356, after
 * YAZ-5308): chapter 8's "plain Markdown file" is the app's own card file, `kind: card` alone in its front matter, the
 * title on the card line, never a first line of the text; chapter 4's `/card` opens an empty card whose Title field has
 * the keyboard, its placeholder "Title" showing (nothing typed or selected in it).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cardTitleOf, findCards } from '@shared/cardLine'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { COURSE } from '../script'
import { courseScenes } from '.'
import { memoryHost, mountScene, testClock } from './testing'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const chapterOf = (clipId: string) => COURSE.find((ch) => ch.clips.some((c) => c.id === clipId))!
const clipOf = (clipId: string) => chapterOf(clipId).clips.find((c) => c.id === clipId)!

/** Mounts the scene of `clipId` at `fraction` of its clip. */
function sceneAt(clipId: string, fraction: number) {
  const { clock, at } = testClock(6)
  const scene = mountScene(courseScenes(clipId), chapterOf(clipId), { clock, done: () => undefined, host: memoryHost() })
  scene.render(clipOf(clipId))
  at(fraction, true)
  return scene
}

afterEach(() => {
  document.body.textContent = ''
})

describe("the course shows a card's title on its card line (YAZ-5356)", () => {
  it("c8-02: the plain Markdown file is the app's card file: kind: card alone, the card, the title on the card line, marked", () => {
    const scene = sceneAt('c8-02', 1)
    try {
      const text = scene.el.querySelector('.ai-file__text')!.textContent!
      const { frontmatter, body } = splitFrontmatter(text)
      expect(parseFrontmatter(frontmatter).properties).toEqual({ kind: 'card' })
      const cards = findCards(body.replace(/\n$/, ''))
      expect(cards).toHaveLength(1)
      expect(cardTitleOf(cards[0].line)).toBe('Sleep debt')
      expect(cards[0].text.split('\n')[0]).not.toBe('Sleep debt')
      expect(text).toContain('<!-- card: DEMO-14, title "Sleep debt" -->')
      // The card line is one of the light marks that light up.
      const marks = [...scene.el.querySelectorAll('.ai-file__text mark')].map((m) => m.textContent)
      expect(marks).toContain('<!-- card: DEMO-14, title "Sleep debt" -->')
      expect(scene.el.querySelector('.ai-file__head')!.textContent).toBe('sleep-debt-demo-14.md')
    } finally {
      scene.unmount()
    }
  })

  it('c4-05: /card opens an empty card; its Title field has the caret and shows the placeholder, nothing selected', () => {
    const scene = sceneAt('c4-05', 0.95)
    try {
      const field = scene.el.querySelector('.kit-where__newcard .card-editor__title')!
      expect(field.classList.contains('kit-editcard__title--empty')).toBe(true)
      expect(field.textContent).toBe('Title')
      expect(field.querySelector('.kit-caret')).not.toBeNull()
      expect(field.querySelector('.kit-selection')).toBeNull()
    } finally {
      scene.unmount()
    }
  })
})
