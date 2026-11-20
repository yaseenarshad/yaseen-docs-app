/**
 * The Review Inbox's keys (YAZ-5996, D7): rebindable answer keys for two-button (`Remembered = 1`, `Forgot = 2`)
 * and four-button (`Again = 1`, `Hard = 2`, `Good = 3`, `Easy = 4`) modes, plus the Inbox's built-in keys so
 * Settings › Hotkeys › Review and Keys of this tab list them all and refuse binding an answer onto a built-in key.
 */
import type { KeyRow } from './types'

const answer = (id: string, label: string, key: string, mode: 'two' | 'four', hint: string): KeyRow => ({
  id: `review.${id}`,
  scope: 'review',
  label,
  hint,
  keys: [key],
  changeable: true,
  mode,
})

const fixed = (id: string, label: string, keys: readonly string[], hint: string): KeyRow => ({
  id: `review.${id}`,
  scope: 'review',
  label,
  hint,
  keys,
  changeable: false,
})

export const REVIEW_KEYS: readonly KeyRow[] = [
  answer('remembered', 'Remembered', '1', 'two', 'Two-button review: mark the card remembered'),
  answer('forgot', 'Forgot', '2', 'two', 'Two-button review: mark the card forgotten'),
  answer('again', 'Again', '1', 'four', 'Four-button review: mark the card Again'),
  answer('hard', 'Hard', '2', 'four', 'Four-button review: mark the card Hard'),
  answer('good', 'Good', '3', 'four', 'Four-button review: mark the card Good'),
  answer('easy', 'Easy', '4', 'four', 'Four-button review: mark the card Easy'),
  fixed('step', 'Show next hidden word or side', ['Space'], 'Reveal the next hidden word, title, or side'),
  fixed('previous', 'Previous card', ['Left'], 'Move to the card before without answering'),
  fixed('next', 'Next card', ['Right'], 'Move to the card after without answering'),
  fixed('open', 'Open page or card', ['O'], 'Open the card or its page in Explore'),
  fixed('edit', 'Edit card', ['E'], 'Edit the card in Explore'),
  fixed('play', 'Play card audio', ['P'], "Play or stop the card's sound"),
  fixed('focus', 'Focus mode', ['F'], 'Hide or show the tab bar in the Inbox'),
  fixed('undo', 'Undo last review', ['CmdOrCtrl+Z'], 'Take back the last answer, add, or archive'),
  fixed('newTab', 'Open page in background tab', ['CmdOrCtrl+Enter'], 'Keep your place in the Inbox'),
]
