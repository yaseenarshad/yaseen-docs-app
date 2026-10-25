/**
 * SETTINGS › NOTIFICATIONS (YAZ-3303): how long the toast stays, which toasts show, and the gesture
 * sounds. In the nav under Appearance (D4). Every field is `SettingsState`'s, so it travels with the
 * settings folder (YAZ-3276). The box after a drag out is not a toast: it asks, and it stays until answered.
 *
 * - Show for (D5): 4 s (the length before 3303), 8 s, 15 s or until closed. A toast with Undo stays at least 6 s.
 * - Show these toasts (D6): three types the code that sends a toast names (`NoticeType`). Errors, skips,
 *   "See changes" and the link notices have no type, so they always show.
 * - Play sounds (D7): the land and trash sounds (YAZ-3267 D15). Turning it on plays the land sound once,
 *   as the Screenshot app's switch does (YAZ-2868 D4); macOS "Play user interface sound effects" can still say no.
 * - Hear them (D7, amended in the demo): a button for each sound, to listen before choosing. It plays with
 *   Play sounds Off too — it asks main directly — and macOS can still say no.
 */
import { api } from '../api'
import { playGestureSound } from '../lib/gestureSound'
import { Segmented } from './controls'
import { NOTICE_LENGTH_OPTIONS, ON_OFF_OPTIONS } from './options'
import type { SettingsSection } from './registry'

const TOAST_WORDS = ['toast', 'notice', 'notification', 'message']

export const NOTIFICATIONS_SECTION: SettingsSection = {
  id: 'notifications',
  title: 'Notifications',
  groups: [
    {
      title: 'Toasts',
      items: [
        {
          id: 'noticeLength',
          label: 'Show for',
          hint: 'Toasts with Undo stay at least 6 s. The mouse on a toast holds it.',
          keywords: [...TOAST_WORDS, 'length', 'duration', 'seconds', 'time', 'fade', 'longer'],
          render: ({ settings, onChange }) => (
            <Segmented options={NOTICE_LENGTH_OPTIONS} value={settings.noticeLength} onChange={(noticeLength) => onChange({ ...settings, noticeLength })} ariaLabel="Show toasts for" />
          ),
        },
      ],
    },
    {
      title: 'Show these toasts',
      hint: 'Errors always show.',
      items: [
        {
          id: 'noticeUndo',
          label: 'Move, rename or delete',
          hint: 'The toast has Undo. ⌘Z works without it.',
          keywords: [...TOAST_WORDS, 'undo', 'redo', 'move', 'rename', 'delete'],
          render: ({ settings, onChange }) => (
            <Segmented options={ON_OFF_OPTIONS} value={settings.noticeUndo} onChange={(noticeUndo) => onChange({ ...settings, noticeUndo })} ariaLabel="Toasts for a move, a rename or a delete" />
          ),
        },
        {
          id: 'noticeClipboard',
          label: 'Copy, cut or paste',
          hint: 'Also "Copied path".',
          keywords: [...TOAST_WORDS, 'clipboard', 'copy', 'cut', 'paste', 'path'],
          render: ({ settings, onChange }) => (
            <Segmented options={ON_OFF_OPTIONS} value={settings.noticeClipboard} onChange={(noticeClipboard) => onChange({ ...settings, noticeClipboard })} ariaLabel="Toasts for copy, cut and paste" />
          ),
        },
        {
          id: 'noticeLists',
          label: 'Favorites and Focus',
          hint: 'Added to or removed from a list.',
          keywords: [...TOAST_WORDS, 'favorites', 'focus', 'heart'],
          render: ({ settings, onChange }) => (
            <Segmented options={ON_OFF_OPTIONS} value={settings.noticeLists} onChange={(noticeLists) => onChange({ ...settings, noticeLists })} ariaLabel="Toasts for Favorites and Focus" />
          ),
        },
      ],
    },
    {
      title: 'Sounds',
      items: [
        {
          id: 'gestureSounds',
          label: 'Play sounds',
          hint: 'When items land in a folder or go to the Trash. The Mac\'s "Play user interface sound effects" must be on too.',
          keywords: ['sound', 'audio', 'paste', 'trash', 'finder', 'mute', 'silent'],
          render: ({ settings, onChange }) => (
            <Segmented
              options={ON_OFF_OPTIONS}
              value={settings.gestureSounds}
              onChange={(gestureSounds) => {
                onChange({ ...settings, gestureSounds })
                // On plays the sound once, so the user hears what they turned on (D7). `onChange` stored it first.
                if (gestureSounds && !settings.gestureSounds) playGestureSound('land')
              }}
              ariaLabel="Play sounds"
            />
          ),
        },
        {
          id: 'hearSounds',
          label: 'Hear them',
          hint: 'The land sound plays for a paste, a drag, a drop from Finder, an undo and a redo. The trash sound plays for a delete.',
          keywords: ['sound', 'audio', 'preview', 'listen', 'test', 'paste', 'trash'],
          render: () => (
            <div className="settings__options" role="group" aria-label="Hear the sounds">
              <button type="button" className="settings__option" onClick={() => void api.app.sound('land').catch(() => undefined)}>
                ▶ Land
              </button>
              <button type="button" className="settings__option" onClick={() => void api.app.sound('trash').catch(() => undefined)}>
                ▶ Trash
              </button>
            </div>
          ),
        },
      ],
    },
  ],
}
