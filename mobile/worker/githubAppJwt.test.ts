import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { mintReadOnlyRepoToken, pemToPkcs8Der, signGithubAppJwt } from './githubAppJwt'

function base64UrlToUint8Array(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  return new Uint8Array(Buffer.from(padded, 'base64'))
}

async function verifyRs256Jwt(jwt: string, publicKeySpkiDer: Buffer): Promise<{ header: Record<string, unknown>; payload: Record<string, unknown>; valid: boolean }> {
  const [h, p, s] = jwt.split('.')
  const header = JSON.parse(Buffer.from(base64UrlToUint8Array(h)).toString('utf8')) as Record<string, unknown>
  const payload = JSON.parse(Buffer.from(base64UrlToUint8Array(p)).toString('utf8')) as Record<string, unknown>
  const sig = base64UrlToUint8Array(s)
  const pubKey = await crypto.subtle.importKey(
    'spki',
    publicKeySpkiDer.buffer.slice(publicKeySpkiDer.byteOffset, publicKeySpkiDer.byteOffset + publicKeySpkiDer.byteLength) as ArrayBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    pubKey,
    sig.buffer.slice(sig.byteOffset, sig.byteOffset + sig.byteLength) as ArrayBuffer,
    new TextEncoder().encode(`${h}.${p}`),
  )
  return { header, payload, valid }
}

describe('githubAppJwt (YAZ-6284)', () => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pkcs8Pem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
  const pkcs1Pem = pair.privateKey.export({ type: 'pkcs1', format: 'pem' }) as string
  const spkiDer = pair.publicKey.export({ type: 'spki', format: 'der' }) as Buffer

  it('signs a valid RS256 JWT from a PKCS#8 BEGIN PRIVATE KEY PEM', async () => {
    const nowSec = 1_700_000_000
    const jwt = await signGithubAppJwt('123456', pkcs8Pem, nowSec)
    const { header, payload, valid } = await verifyRs256Jwt(jwt, spkiDer)
    expect(valid).toBe(true)
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' })
    expect(payload).toEqual({ iat: nowSec - 60, exp: nowSec + 540, iss: '123456' })
  })

  it('wraps PKCS#1 BEGIN RSA PRIVATE KEY PEM in PKCS#8 and signs an identical valid RS256 JWT', async () => {
    const nowSec = 1_700_000_123
    const jwtPkcs1 = await signGithubAppJwt('98765', pkcs1Pem, nowSec)
    const jwtPkcs8 = await signGithubAppJwt('98765', pkcs8Pem, nowSec)
    const { payload, valid } = await verifyRs256Jwt(jwtPkcs1, spkiDer)
    expect(valid).toBe(true)
    expect(payload.iss).toBe('98765')
    // RSASSA-PKCS1-v1_5 is deterministic, so PKCS#1 and PKCS#8 produce the exact same JWT!
    expect(jwtPkcs1).toBe(jwtPkcs8)
  })

  it('supports literal \\n newlines in env var PEM strings and rejects invalid PEMs', async () => {
    const singleLinePem = pkcs1Pem.replace(/\n/g, '\\n')
    const jwt = await signGithubAppJwt('42', singleLinePem, 1_700_000_000)
    const { valid } = await verifyRs256Jwt(jwt, spkiDer)
    expect(valid).toBe(true)
    expect(() => pemToPkcs8Der('not a pem')).toThrow()
  })

  it('mintReadOnlyRepoToken requests contents:read scoped to a single repo and handles errors cleanly', async () => {
    // Missing env -> 503
    const missing = await mintReadOnlyRepoToken({}, 777, 'med-notes')
    expect(missing).toEqual({ ok: false, status: 503, error: 'github_app_not_configured' })

    // Success path
    let seenUrl = ''
    let seenInit: RequestInit | undefined
    const okFetch = async (url: string, init: RequestInit) => {
      seenUrl = url
      seenInit = init
      return new Response(JSON.stringify({ token: 'ghs_readonly_123', expires_at: '2026-11-22T05:00:00Z' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })
    }
    const res = await mintReadOnlyRepoToken(
      { GITHUB_APP_ID: '123456', GITHUB_APP_PRIVATE_KEY: pkcs1Pem },
      777,
      'med-notes',
      okFetch,
      1_700_000_000,
    )
    expect(res).toEqual({ ok: true, token: 'ghs_readonly_123', expiresAt: '2026-11-22T05:00:00Z' })
    expect(seenUrl).toBe('https://api.github.com/app/installations/777/access_tokens')
    expect(seenInit?.method).toBe('POST')
    expect(JSON.parse(String(seenInit?.body))).toEqual({
      repositories: ['med-notes'],
      permissions: { contents: 'read' },
    })
    const auth = (seenInit?.headers as Record<string, string>)?.authorization ?? ''
    expect(auth.startsWith('Bearer ')).toBe(true)
    const { valid } = await verifyRs256Jwt(auth.slice(7), spkiDer)
    expect(valid).toBe(true)

    // GitHub 404 -> 403 repo_not_accessible
    const notFound = await mintReadOnlyRepoToken(
      { GITHUB_APP_ID: '123456', GITHUB_APP_PRIVATE_KEY: pkcs8Pem },
      777,
      'private-repo',
      async () => new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 }),
    )
    expect(notFound).toEqual({ ok: false, status: 403, error: 'repo_not_accessible' })
  })
})
