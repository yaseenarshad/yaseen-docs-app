/**
 * THE COURSE'S SCENES (YAZ-5121, issue 6C): the layer's default `scenes` (`CardCourse`). Each built chapter gives its
 * entries (`registry.ts`); a clip of a chapter not built yet gets the frame's placeholder.
 *
 * The next builders: add your chapter's file, put its `ChapterScenes` in `CHAPTER_SCENES`, and move its id from
 * `NOT_BUILT_CHAPTERS` to `BUILT_CHAPTERS`. `scenes.test.ts` then holds each of its clips to a real scene.
 */
import { sceneRegistry, type ChapterScenes } from './registry'
import { WHY_SCENES } from './why'
import { FIRST_CARD_SCENES } from './firstCard'
import { KNOWLEDGE_BASE_SCENES } from './knowledgeBase'
import { GOOD_CARD_SCENES } from './goodCard'
import { AI_SCENES } from './ai'
import './scenes.css'

export const CHAPTER_SCENES: readonly ChapterScenes[] = [WHY_SCENES, FIRST_CARD_SCENES, KNOWLEDGE_BASE_SCENES, GOOD_CARD_SCENES, AI_SCENES]

/** The chapters whose every clip has a real scene. */
export const BUILT_CHAPTERS: readonly string[] = ['why', 'first-card', 'knowledge-base', 'good-card', 'ai']

/** The chapters still on the placeholder (the next builders flip them). */
export const NOT_BUILT_CHAPTERS: readonly string[] = ['inbox', 'where', 'compound', 'habits', 'links', 'care', 'where-things-are']

export const courseScenes = sceneRegistry(CHAPTER_SCENES)
