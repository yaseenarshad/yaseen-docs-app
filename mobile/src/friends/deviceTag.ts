import { PHONE, type VaultStore } from '../store'

/**
 * YAZ-5083: this phone's own tag in the friends list (phone-only state, made once). A remove's step that this phone
 * began before a stop (the intent of a new numbers generation) is known as its own after a restart, so it goes on at
 * once instead of waiting for the lease of another device. Random: it names no person and no device.
 */
const DEVICE = 'friendsDevice'

export async function deviceTag(store: VaultStore): Promise<string> {
  const kept = await store.getState<string>(PHONE, DEVICE)
  if (typeof kept === 'string' && /^p[0-9a-z]{6,20}$/.test(kept)) return kept
  const made = `p${Math.floor(Math.random() * 36 ** 8).toString(36)}${Math.floor(Math.random() * 36 ** 4).toString(36)}`
  await store.setState(PHONE, DEVICE, made)
  return made
}
