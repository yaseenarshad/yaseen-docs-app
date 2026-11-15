/**
 * THE COURSE'S SCENES (YAZ-5121, issue 6C): the layer's default `scenes` (`CardCourse`). Each chapter gives its entries
 * (`registry.ts`); `scenes.test.tsx` holds every clip of the script to a scene.
 */
import { sceneRegistry, type ChapterScenes } from './registry'
import { WHY_SCENES } from './why'
import { FIRST_CARD_SCENES } from './firstCard'
import { INBOX_SCENES } from './inbox'
import { WHERE_SCENES } from './where'
import { COMPOUND_SCENES } from './compound'
import { KNOWLEDGE_BASE_SCENES } from './knowledgeBase'
import { GOOD_CARD_SCENES } from './goodCard'
import { AI_SCENES } from './ai'
import { HABITS_SCENES } from './habits'
import { LINKS_SCENES } from './links'
import { CARE_SCENES } from './care'
import { WHERE_THINGS_ARE_SCENES } from './whereThingsAre'
import './scenes.css'

export const CHAPTER_SCENES: readonly ChapterScenes[] = [
  WHY_SCENES,
  FIRST_CARD_SCENES,
  INBOX_SCENES,
  WHERE_SCENES,
  COMPOUND_SCENES,
  KNOWLEDGE_BASE_SCENES,
  GOOD_CARD_SCENES,
  AI_SCENES,
  HABITS_SCENES,
  LINKS_SCENES,
  CARE_SCENES,
  WHERE_THINGS_ARE_SCENES,
]

export const courseScenes = sceneRegistry(CHAPTER_SCENES)
