import { PEOPLE_FILE, parsePeople, type PeopleRead } from '@shared/people'
import { VAULT_CONFIG_DIR } from '@shared/types'
import { loadAccount } from '../auth/account'
import type { VaultStore } from '../store'

/**
 * Who a phone comment is signed with (`by`).
 *
 * The phone has no comment profile; it has the vault token's GitHub account (`GET /user` at sign-in, kept as the vault's
 * `account`, `auth/account.ts`). The Mac signs with its profile's HANDLE (lowercase letters, digits and `-`, made from
 * the name: `Yaseen Arshad` → `yaseen-arshad`), and its people file (`.yaseendocs/people.json`) holds one card per
 * handle: name and picture, no GitHub login. So:
 *  1. the people file has a card under the login (in small letters): that handle (the login IS the handle);
 *  2. else exactly ONE card whose name is the GitHub account's name: that card's handle, so the Mac shows the comment
 *     as the person's own (their name, their picture, their Edit) and not as an unknown writer;
 *  3. else the login in small letters (a valid handle: GitHub logins are letters, digits and inner `-`).
 */
export const PEOPLE_PATH = `${VAULT_CONFIG_DIR}/${PEOPLE_FILE}`

const sameName = (a: string, b: string): boolean => a.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase() === b.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()

/** The handle for a GitHub account, following the vault's people file. Pure. */
export function signerHandle(login: string, name: string | null, people: PeopleRead): string {
  const handle = login.trim().toLowerCase()
  if (people.handles.has(handle)) return handle
  const named = name === null || name.trim() === '' ? [] : Object.entries(people.people).filter(([, card]) => sameName(card.name, name))
  return named.length === 1 ? named[0][0] : handle
}

/** The vault's people file as the phone holds it; none when it is missing or does not read. */
export async function readPeople(store: VaultStore, vault: string): Promise<PeopleRead> {
  const file = await store.read(vault, PEOPLE_PATH)
  const text = file === null ? null : typeof file.content === 'string' ? file.content : new TextDecoder().decode(file.content)
  try {
    return parsePeople(text === null ? null : JSON.parse(text))
  } catch {
    return parsePeople(null)
  }
}

/** The kept `GET /user` of a vault with no account (an old sign-in): the login and the name. */
export const LOGIN_STATE = 'commentLogin'
type Who = { login: string; name: string | null }

/**
 * The `by` of a new comment of `vault`, or undefined when the phone does not know the account yet. `fetchUser` is
 * `GET /user` with the vault's token; it runs only when the sign-in kept no account, and its answer is kept.
 */
export async function commentSigner(store: VaultStore, vault: string, fetchUser?: () => Promise<Who>): Promise<string | undefined> {
  const account = await loadAccount(store, vault)
  let who: Who | undefined = account === undefined ? await store.getState<Who>(vault, LOGIN_STATE) : { login: account.login, name: account.name }
  if (who === undefined && fetchUser !== undefined) {
    try {
      who = await fetchUser()
      await store.setState(vault, LOGIN_STATE, who)
    } catch {
      who = undefined
    }
  }
  if (who === undefined || typeof who.login !== 'string' || who.login.trim() === '') return undefined
  return signerHandle(who.login, who.name, await readPeople(store, vault))
}
