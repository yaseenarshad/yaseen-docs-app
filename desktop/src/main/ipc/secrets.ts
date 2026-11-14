import { join } from 'node:path'
import { GITHUB_TOKEN_SECRET, PIXABAY_SECRET } from '@shared/types'
import { cleanToken } from '@shared/githubInput'
import { CONTRACT } from '@shared/ipc'
import { BridgeFailure } from '../fs/fsUtils'
import { requireRequest, str } from '../fs/validate'
import { createSecrets, SECRETS_FILE, type Secrets } from '../secrets'
import { handle } from './envelope'

/**
 * The `secrets.*` half of `window.yaseenDocs` (ported from Draw by YAZ-3038) (🔒 YAZ-1775 D4, YAZ-1842 D1, YAZ-1817): two channels, `set` and `has`.
 * There is deliberately no third — a renderer can never ask for a value. `read` is on the
 * returned instance, for main's own callers (YAZ-1818's providers) only. Secrets are NOT app state:
 * nothing here touches the store, so a key can never ride `state:changed` into a renderer.
 */

/**
 * The only names a renderer may WRITE. A secret that main stores itself (Draw's sharing token, YAZ-3040)
 * must not be one a renderer can overwrite. The GitHub token (YAZ-5098, Settings › Review › "Phone and friends") is
 * pasted in Settings; main reads it for the phone's code (`phone:code`) and for the friends sender (4E5, YAZ-5086).
 */
export const RENDERER_WRITABLE_SECRETS: readonly string[] = [PIXABAY_SECRET, GITHUB_TOKEN_SECRET]

/** A value's own check, by name: the stored value, or null to refuse it. The refusal never repeats the value. */
const CLEAN: Readonly<Record<string, (value: string) => string | null>> = {
  [GITHUB_TOKEN_SECRET]: cleanToken,
}

const setListeners = new Set<(name: string) => void>()
/**
 * Hear each secret a renderer set or cleared, by name, never the value (YAZ-5086: a new GitHub token resets the Mac's
 * send of the numbers). Returns its unsubscribe.
 */
export function onRendererSecretSet(listener: (name: string) => void): () => void {
  setListeners.add(listener)
  return () => setListeners.delete(listener)
}

/** `onSet` hears each name a renderer set or cleared: a new Pixabay key starts the favorites' backfill (YAZ-4363). */
export function registerSecretsIpc(userData: string, onSet: (name: string) => void = () => undefined): Secrets {
  const secrets = createSecrets(join(userData, SECRETS_FILE))
  handle(CONTRACT.secrets.set, async (req: unknown) => {
    const r = requireRequest(req)
    const name = str(r.name, 'name')
    if (!RENDERER_WRITABLE_SECRETS.includes(name)) throw new BridgeFailure('BAD_REQUEST', `'${name}' is not a secret this window may set`)
    // `''` is not a value: storing it would make `has` say yes to a key that is not there.
    if (r.value !== null && (typeof r.value !== 'string' || r.value === '')) throw new BridgeFailure('BAD_REQUEST', "'value' must be a non-empty string or null")
    const clean = r.value === null ? null : (CLEAN[name] ?? ((v: string) => v))(r.value)
    if (r.value !== null && clean === null) throw new BridgeFailure('BAD_REQUEST', 'That is not a GitHub token.')
    await secrets.set(name, clean)
    onSet(name)
    for (const listener of setListeners) listener(name)
  })
  handle(CONTRACT.secrets.has, async (req: unknown) => {
    return secrets.has(str(requireRequest(req).name, 'name'))
  })
  return secrets
}
