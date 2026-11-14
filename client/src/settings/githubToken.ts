/**
 * Is a GitHub token saved on this Mac? (YAZ-5098, Settings › Review › "Phone and friends"). The ONE answer the two rows
 * share: the token row writes, and "Connect your phone" waits for a token. It holds a yes or a no, never the token:
 * the token goes to main through `secrets:set` and no channel answers it back (`main/ipc/secrets.ts`).
 */
import { useEffect, useSyncExternalStore } from 'react'
import { GITHUB_TOKEN_SECRET } from '@shared/types'
import { cleanToken } from '@shared/githubInput'
import { api } from '../api'

/** `null` while the first `secrets:has` is in flight. */
type Saved = boolean | null

let saved: Saved = null
let asked = false
const listeners = new Set<() => void>()
const set = (next: Saved) => {
  saved = next
  for (const l of listeners) l()
}

/** For tests: forget the answer, so the next row asks main again. */
export function resetGithubTokenStatus(): void {
  saved = null
  asked = false
}

/** The answer, asked of main once per run of Settings. */
export function useGithubTokenSaved(): Saved {
  const value = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => saved,
  )
  useEffect(() => {
    if (asked) return
    asked = true
    api.secrets.has({ name: GITHUB_TOKEN_SECRET }).then(
      (v) => set(v),
      () => set(false),
    )
  }, [])
  return value
}

export type SaveTokenResult = 'saved' | 'not-a-token' | 'failed'

/** Sends a pasted token to main, once; it is checked here first so a password pasted by mistake never leaves the field. */
export async function saveGithubToken(pasted: string): Promise<SaveTokenResult> {
  const token = cleanToken(pasted)
  if (token === null) return 'not-a-token'
  try {
    await api.secrets.set({ name: GITHUB_TOKEN_SECRET, value: token })
  } catch {
    return 'failed'
  }
  set(true)
  return 'saved'
}

/** "Remove token": the token leaves this Mac. A phone that has it keeps it. */
export async function removeGithubToken(): Promise<boolean> {
  try {
    await api.secrets.set({ name: GITHUB_TOKEN_SECRET, value: null })
  } catch {
    return false
  }
  set(false)
  return true
}
