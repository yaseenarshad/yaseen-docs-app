/**
 * Settings › Review › Card course (YAZ-5120; Yaseen: "the course can just be a button you click in the review panel
 * in settings"): one row with "Open the course". Its own group at the end of the Review section, so it merges
 * cleanly beside the other Review rows of YAZ-5059. It always shows: the "Card tips" switch hides only the offers.
 * Small and in the startup bundle: it names the minutes from `courseFacts.ts`, never the script.
 */
import type { SettingsGroup } from '../settings/registry'
import { COURSE_HINT } from './courseFacts'

export const COURSE_SETTINGS_GROUP: SettingsGroup = {
  items: [
    {
      id: 'cardCourse',
      label: 'Card course',
      hint: COURSE_HINT,
      keywords: ['review', 'cards', 'flashcards', 'inbox', 'fsrs', 'course', 'learn', 'tutorial', 'lesson', 'how to', 'spaced repetition', 'help'],
      render: ({ openCourse }) =>
        openCourse !== undefined && (
          <button type="button" className="settings__option" onClick={openCourse}>
            Open the course
          </button>
        ),
    },
  ],
}
