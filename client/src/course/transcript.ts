import type { CourseChapter } from './script'

/** The first line of `skills/card-skill/Course transcript.md`. */
export const TRANSCRIPT_FIRST_LINE = 'The words of the card course.'

/**
 * Pure: the page `Course transcript.md` of the card skill, made from the course script (YAZ-5119, suggestion 22).
 * One heading for each chapter, each clip's text as a paragraph, then the chapter's "Try it in the app" lines.
 */
export function courseTranscript(course: readonly CourseChapter[]): string {
  const parts: string[] = [TRANSCRIPT_FIRST_LINE]
  course.forEach((chapter, i) => {
    parts.push(`## Chapter ${i + 1}. ${chapter.title}`)
    for (const clip of chapter.clips) parts.push(clip.text)
    if (chapter.tryIt !== undefined && chapter.tryIt.length > 0) {
      parts.push('### Try it in the app')
      parts.push(chapter.tryIt.map((step, n) => `${n + 1}. ${step.say}`).join('\n'))
    }
  })
  return `${parts.join('\n\n')}\n`
}
