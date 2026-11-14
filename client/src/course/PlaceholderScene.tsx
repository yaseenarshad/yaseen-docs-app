/**
 * The frame's scene for each clip (YAZ-5120), until issue 6C draws the real ones: the clip's words, large, in the
 * middle of the stage. A clip that waits for the person has one button, "Done, go on", which stands for the step.
 * So the course can be walked from the first clip to the last, silent, before any real scene exists.
 */
import type { SceneFor, SceneProps } from './scene'

export function PlaceholderScene({ clip, waits, done }: SceneProps) {
  return (
    <div className="course-scene course-scene--placeholder">
      <p className="course-scene__words">{clip.text}</p>
      {waits && (
        <button type="button" className="course__btn course__btn--primary" onClick={done}>
          Done, go on
        </button>
      )}
    </div>
  )
}

/** Each clip's scene in this frame: the placeholder. */
export const placeholderScenes: SceneFor = () => PlaceholderScene
