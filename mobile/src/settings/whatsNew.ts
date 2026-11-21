/**
 * Settings › What's new. Newest first, in plain short words, one entry for each version. Its own chunk: it
 * loads when the person first opens What's new (never in the first load). The newest entry's version is the version of
 * `mobile/package.json` (a test checks it): add an entry when the version goes up.
 */
export interface WhatsNewEntry {
  version: string
  /** The day of the version, YYYY-MM-DD. */
  date: string
  items: string[]
}

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    version: '0.8.0',
    date: '2026-11-14',
    items: [
      'The app is now called Yaseen Docs, with the Yaseen Docs logo.',
      "The tabs follow the open vault: Search always. Review and Friends when the vault's review is on. Today when its daily notes are on.",
      'A vault with Search alone shows no tab bar.',
      'A new address: preview.docs.yaseenarshad.com.',
    ],
  },
  {
    version: '0.7.0',
    date: '2026-11-14',
    items: [
      'Settings shows the version, with the date and time of the build.',
      "What's new: this list.",
      'Sign out and erase this phone sits at the bottom of Settings, in red, and always asks first.',
      'A fast double tap on a repo checks it only once.',
      'VoiceOver says "the three lines" for the Safari menu button.',
    ],
  },
  {
    version: '0.6.0',
    date: '2026-11-14',
    items: [
      'Review looks like Mochi: tap anywhere to show the answer.',
      'Back, next, wrong, right and a menu sit at the top of the card.',
      'Your progress shows in steps.',
      'Swipe from the left edge to go back.',
      'Only the screen scrolls, never the whole page.',
    ],
  },
  {
    version: '0.5.0',
    date: '2026-11-14',
    items: [
      "Pick your vault from the list of the token's repos. Likely vaults come first.",
      'A card shows how to add Notecard to your Home Screen.',
      'Each card is named by its title.',
      'Undo of a sent answer puts the next card back in its place.',
    ],
  },
  {
    version: '0.4.0',
    date: '2026-11-14',
    items: [
      'Your friends list lives in your vault repo.',
      'Before it erases, the phone says what you lose: answers not sent yet, and your friends.',
      'Every text and button is easy to read, in light and dark.',
      'Choose the home time zone of your numbers.',
    ],
  },
  {
    version: '0.3.0',
    date: '2026-11-14',
    items: [
      'The app is now called Notecard, with a new icon and address.',
      'Groups: make one, join one, see each other’s numbers.',
      'One cheer and one nudge a day for each friend.',
      'Undo takes back Archive card, Up next and Fix later.',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-11-13',
    items: [
      'The Friends tab: you vs a friend, Cheer and Nudge.',
      'Add the app to your Home Screen. It opens with no signal.',
      'Pictures, sounds and files show in the reader.',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-11-13',
    items: [
      'The first version: sign in with a GitHub token, or scan a code from the Mac.',
      'Review your cards on the phone. Your answers go to GitHub.',
      'Search your pages.',
      'A dot at the top says if everything is sent.',
    ],
  },
]

/** "14 Nov 2026" for "2026-11-14" (a day, with no time zone). */
export function entryDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))
}
