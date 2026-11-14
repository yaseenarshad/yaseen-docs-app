import { PHONE, type VaultStore } from '../store'

/**
 * What the shell needs from Friends (4E, YAZ-5081): whether there is a friend (decision 21: the app opens on Friends;
 * with no friend yet, on Review), and the two Friends settings (decision 22: "Vaults that count" and "Name").
 *
 * Round 12, item 3 puts both settings in the person's friends list (`FriendsIndex.vaults`, `nickname`, a gist), so each
 * device uses the same values. The app's `FriendsPort` is the friends list (`friends/list.ts`, loaded by
 * `friends/ui/lazy.ts`). Before the first share or paste makes that list, `localFriends` keeps the two settings on this
 * phone; the first share or paste carries them over.
 */
export interface FriendsSettings {
  /** The vault ids (`vaultId`) whose cards count for the numbers. Null: every vault on the phone counts. */
  vaults: string[] | null
  /** The name friends see in place of the GitHub name. Null: the GitHub name (or the login). */
  nickname: string | null
  /**
   * YAZ-5251: the HOME time zone (IANA) in which every device counts the days of the numbers. Null or absent: not set
   * yet (the first device that makes the list or sends writes its own zone).
   */
  zone?: string | null
}

export interface FriendsPort {
  /** At least one friend or group. */
  hasFriends(): Promise<boolean>
  settings(): Promise<FriendsSettings>
  saveSettings(settings: FriendsSettings): Promise<void>
  /** YAZ-5195 (4E4 wires it): before "Sign out and erase this phone", stop each friends request and timer. */
  stop?(): Promise<void>
}

export const NO_FRIENDS_SETTINGS: FriendsSettings = Object.freeze({ vaults: null, nickname: null })

const SETTINGS = 'friendsSettings'

/**
 * No friends, and the two settings as this phone's state (erased by "Sign out and erase this phone"). The friends list
 * (`friends/list.ts`) reads the settings here until the list exists, and always writes them here too.
 */
export function localFriends(store: VaultStore): FriendsPort {
  return {
    hasFriends: async () => false,
    settings: async () => ({ ...NO_FRIENDS_SETTINGS, ...((await store.getState<FriendsSettings>(PHONE, SETTINGS)) ?? {}) }),
    saveSettings: (settings) => store.setState(PHONE, SETTINGS, settings),
  }
}

/** A nickname as typed: trimmed, one line, at most 40 characters; '' is none. */
export function cleanNickname(text: string): string | null {
  const name = text.replace(/\s+/g, ' ').trim().slice(0, 40)
  return name === '' ? null : name
}
