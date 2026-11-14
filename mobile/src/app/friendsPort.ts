import { PHONE, type VaultStore } from '../store'

/**
 * What the shell needs from Friends (4E, YAZ-5081): whether there is a friend (decision 21: the app opens on Friends;
 * with no friend yet, on Review), and the two Friends settings (decision 22: "Vaults that count" and "Name").
 *
 * Round 12, item 3 puts both settings in the person's friends list (`FriendsIndex.vaults`, `nickname`, a gist), so each
 * device uses the same values. That gist is 4E's. Until 4E lands, `localFriends` keeps them on this phone, and 4E swaps
 * in its own `FriendsPort` (it can read these values once to carry them over).
 */
export interface FriendsSettings {
  /** The vault ids (`vaultId`) whose cards count for the numbers. Null: every vault on the phone counts. */
  vaults: string[] | null
  /** The name friends see in place of the GitHub name. Null: the GitHub name (or the login). */
  nickname: string | null
}

export interface FriendsPort {
  /** At least one friend or group. */
  hasFriends(): Promise<boolean>
  settings(): Promise<FriendsSettings>
  saveSettings(settings: FriendsSettings): Promise<void>
}

export const NO_FRIENDS_SETTINGS: FriendsSettings = Object.freeze({ vaults: null, nickname: null })

const SETTINGS = 'friendsSettings'

/** Until 4E: no friends, and the two settings as this phone's state (erased by "Sign out and erase this phone"). */
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
