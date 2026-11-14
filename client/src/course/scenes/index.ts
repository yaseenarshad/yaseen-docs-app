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
import { HABITS_SCENES } from './habits'
import { LINKS_SCENES } from './links'
import { CARE_SCENES } from './care'
import { WHERE_THINGS_ARE_SCENES } from './whereThingsAre'
import './scenes.css'

export const CHAPTER_SCENES: readonly ChapterScenes[] = [WHY_SCENES, FIRST_CARD_SCENES, HABITS_SCENES, LINKS_SCENES, CARE_SCENES, WHERE_THINGS_ARE_SCENES]

/** The chapters whose every clip has a real scene. */
export const BUILT_CHAPTERS: readonly string[] = ['why', 'first-card', 'habits', 'links', 'care', 'where-things-are']

/** The chapters still on the placeholder (the next builders flip them). */
export const NOT_BUILT_CHAPTERS: readonly string[] = ['inbox', 'where', 'compound', 'knowledge-base', 'good-card', 'ai']

export const courseScenes = sceneRegistry(CHAPTER_SCENES)
