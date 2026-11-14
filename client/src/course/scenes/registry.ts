/**
 * THE SCENE REGISTRY (YAZ-5121): clip id → scene, for the layer's `scenes` seam (`SceneFor`).
 *
 * - Each chapter gives a list of entries. An entry is ONE scene for one clip, or for several clips IN A ROW: a span.
 *   A span's scene stays mounted from its first clip to its last (the layer keys the stage by `spanOf`), so it keeps
 *   its state (what the person typed, where a drawing is) and moves on with no cut. It reads `clip.id` to know where
 *   it is.
 * - A clip with no entry gets the frame's `PlaceholderScene`. A chapter is "built" when each of its clips has an entry
 *   (`BUILT_CHAPTERS`; `scenes.test.ts` fails when one falls back). The next builders add their chapter's entries in
 *   `chapters.ts` and move its id to `BUILT_CHAPTERS`.
 */
import type { Scene, SceneFor } from '../scene'
import { PlaceholderScene } from '../PlaceholderScene'

export interface SceneEntry {
  /** The clips, in the script's order, with no gap. One clip, or a span. */
  clips: readonly string[]
  scene: Scene
}

export interface ChapterScenes {
  chapter: string
  entries: readonly SceneEntry[]
}

/** The registry: a `SceneFor`, with each clip's span (the stage's key; absent for a one-clip entry). */
export function sceneRegistry(chapters: readonly ChapterScenes[], fallback: Scene = PlaceholderScene): Required<Pick<SceneFor, 'spanOf'>> & SceneFor {
  const byClip = new Map<string, { scene: Scene; span?: string }>()
  for (const chapter of chapters) {
    for (const entry of chapter.entries) {
      const span = entry.clips.length > 1 ? `${chapter.chapter}/${entry.clips[0]}…${entry.clips[entry.clips.length - 1]}` : undefined
      for (const clip of entry.clips) {
        if (byClip.has(clip)) throw new Error(`Two scenes for the clip ${clip}`)
        byClip.set(clip, { scene: entry.scene, span })
      }
    }
  }
  const scenes = (clipId: string): Scene => byClip.get(clipId)?.scene ?? fallback
  return Object.assign(scenes, { spanOf: (clipId: string) => byClip.get(clipId)?.span })
}
