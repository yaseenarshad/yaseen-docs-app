import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PUT_SECRET, WORKER_SECRET, secretNames, secretVerdict } from './workerSecret'

/** YAZ-5645 GHF: the publish never ships a Worker without the GitHub App's client secret, and says so after a deploy. */

describe('the Worker secret check of the publish', () => {
  it("reads only the names in wrangler's list", () => {
    expect(secretNames('[]')).toEqual([])
    expect(secretNames('\n[\n  { "name": "GITHUB_CLIENT_SECRET", "type": "secret_text" }\n]\n')).toEqual(['GITHUB_CLIENT_SECRET'])
    expect(secretNames('✘ [ERROR] Not logged in')).toBeNull()
    expect(secretNames('')).toBeNull()
  })

  it('no secret (the live Worker on 2026-11-16): the publish stops BEFORE the deploy, and says how to put it', () => {
    const before = secretVerdict('[]', 'before')
    expect(before.ok).toBe(false)
    expect(before.say).toContain(`no ${WORKER_SECRET}`)
    expect(before.say).toContain('Nothing was published')
    expect(before.say).toContain(PUT_SECRET)
    expect(secretVerdict('[]', 'after')).toMatchObject({ ok: false, say: expect.stringContaining('the deploy is live') })
  })

  it('the secret set: the publish goes on; wrangler not signed in: it stops', () => {
    expect(secretVerdict('[{"name":"GITHUB_CLIENT_SECRET","type":"secret_text"}]', 'before').ok).toBe(true)
    expect(secretVerdict('[{"name":"OTHER","type":"secret_text"}]', 'before').ok).toBe(false)
    expect(secretVerdict('not json', 'before').ok).toBe(false)
  })

  it('the publish runs the check before and after the deploy', () => {
    const root = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    expect(root.scripts['mobile:check-secret']).toBe('vite-node mobile/publish/workerSecretCli.ts --')
    expect(root.scripts['mobile:publish:preview']).toMatch(/&& npm run mobile:check-secret -- before && npx --yes wrangler@\d+\.\d+\.\d+ deploy --config mobile\/wrangler\.jsonc && npm run mobile:check-secret -- after$/)
  })
})
