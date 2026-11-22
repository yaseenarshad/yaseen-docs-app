/**
 * Pure Web Crypto RS256 GitHub App JWT signer & read-only installation token minter (YAZ-6284).
 * Supports both PKCS#8 (`BEGIN PRIVATE KEY`) and PKCS#1 (`BEGIN RSA PRIVATE KEY`) PEM keys
 * by wrapping PKCS#1 DER in a PKCS#8 `PrivateKeyInfo` envelope for `crypto.subtle.importKey('pkcs8', ...)`.
 * Zero Node-only dependencies — runs identically in Cloudflare Workers and Node 20+.
 */

export interface GithubAppEnv {
  GITHUB_APP_ID?: string
  GITHUB_APP_PRIVATE_KEY?: string
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>

const GITHUB_API = 'https://api.github.com'

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlEncodeJson(obj: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(obj)))
}

function decodeBase64(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, '')
  const bin = atob(clean)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Encodes a DER ASN.1 length field. */
function encodeDerLength(len: number): Uint8Array {
  if (len < 0x80) return new Uint8Array([len])
  const bytes: number[] = []
  let n = len
  while (n > 0) {
    bytes.unshift(n & 0xff)
    n >>>= 8
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes])
}

/**
 * Wraps a PKCS#1 RSAPrivateKey DER buffer in a PKCS#8 PrivateKeyInfo ASN.1 DER envelope:
 *   SEQUENCE {
 *     INTEGER 0
 *     SEQUENCE { OBJECT IDENTIFIER 1.2.840.113549.1.1.1 (rsaEncryption), NULL }
 *     OCTET STRING <pkcs1Der>
 *   }
 */
export function wrapPkcs1AsPkcs8(pkcs1Der: Uint8Array): Uint8Array {
  // INTEGER 0 + AlgorithmIdentifier (rsaEncryption OID + NULL)
  const versionAndAlg = new Uint8Array([
    0x02, 0x01, 0x00,
    0x30, 0x0d,
    0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
    0x05, 0x00,
  ])
  const octetLen = encodeDerLength(pkcs1Der.length)
  const innerLen = versionAndAlg.length + 1 + octetLen.length + pkcs1Der.length
  const seqLen = encodeDerLength(innerLen)
  const out = new Uint8Array(1 + seqLen.length + innerLen)
  let offset = 0
  out[offset++] = 0x30
  out.set(seqLen, offset)
  offset += seqLen.length
  out.set(versionAndAlg, offset)
  offset += versionAndAlg.length
  out[offset++] = 0x04
  out.set(octetLen, offset)
  offset += octetLen.length
  out.set(pkcs1Der, offset)
  return out
}

/** Parses a PKCS#8 or PKCS#1 PEM string into PKCS#8 DER bytes suitable for Web Crypto `importKey('pkcs8', ...)`. */
export function pemToPkcs8Der(pem: string): Uint8Array {
  const normalized = pem.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim()
  const isPkcs1 = /-----BEGIN RSA PRIVATE KEY-----/.test(normalized)
  const isPkcs8 = /-----BEGIN PRIVATE KEY-----/.test(normalized)
  if (!isPkcs1 && !isPkcs8) {
    throw new Error('Unsupported private key PEM format (expected PKCS#8 or PKCS#1 RSA private key)')
  }
  const body = normalized
    .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----/g, '')
    .replace(/-----END (?:RSA )?PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '')
  if (!body) throw new Error('Empty private key PEM body')
  const der = decodeBase64(body)
  return isPkcs1 ? wrapPkcs1AsPkcs8(der) : der
}

/** Signs a short-lived RS256 GitHub App JWT (iat = now - 60s, exp = now + 540s). */
export async function signGithubAppJwt(
  appId: string,
  privateKeyPem: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const pkcs8 = pemToPkcs8Der(privateKeyPem)
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8.buffer.slice(pkcs8.byteOffset, pkcs8.byteOffset + pkcs8.byteLength) as ArrayBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const header = base64UrlEncodeJson({ alg: 'RS256', typ: 'JWT' })
  const payload = base64UrlEncodeJson({
    iat: nowSec - 60,
    exp: nowSec + 540,
    iss: appId,
  })
  const signingInput = `${header}.${payload}`
  const sigBuf = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput))
  return `${signingInput}.${base64UrlEncode(new Uint8Array(sigBuf))}`
}

export type MintRepoTokenResult =
  | { ok: true; token: string; expiresAt: string | null }
  | { ok: false; status: number; error: string }

/**
 * Mints a short-lived, single-repo, read-only (`contents: read`) GitHub App installation access token.
 */
export async function mintReadOnlyRepoToken(
  env: GithubAppEnv,
  installationId: number,
  repoName: string,
  fetchFn: Fetch = (u, init) => globalThis.fetch(u, init),
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<MintRepoTokenResult> {
  const appId = env.GITHUB_APP_ID?.trim()
  const privateKey = env.GITHUB_APP_PRIVATE_KEY?.trim()
  if (!appId || !privateKey) {
    return { ok: false, status: 503, error: 'github_app_not_configured' }
  }
  if (!Number.isInteger(installationId) || installationId <= 0 || !repoName.trim()) {
    return { ok: false, status: 400, error: 'bad_installation' }
  }

  let jwt: string
  try {
    jwt = await signGithubAppJwt(appId, privateKey, nowSec)
  } catch {
    return { ok: false, status: 500, error: 'github_app_key_invalid' }
  }

  let res: Response
  try {
    res = await fetchFn(`${GITHUB_API}/app/installations/${installationId}/access_tokens`, {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${jwt}`,
        'content-type': 'application/json',
        'user-agent': 'yaseen-docs-worker',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify({
        repositories: [repoName.trim()],
        permissions: { contents: 'read' },
      }),
    })
  } catch {
    return { ok: false, status: 502, error: 'github_unreachable' }
  }

  if (!res.ok) {
    if (res.status === 404 || res.status === 422) return { ok: false, status: 403, error: 'repo_not_accessible' }
    return { ok: false, status: 502, error: 'github_token_failed' }
  }

  try {
    const data = (await res.json()) as { token?: unknown; expires_at?: unknown }
    if (typeof data?.token !== 'string' || !data.token) {
      return { ok: false, status: 502, error: 'github_token_failed' }
    }
    return {
      ok: true,
      token: data.token,
      expiresAt: typeof data.expires_at === 'string' ? data.expires_at : null,
    }
  } catch {
    return { ok: false, status: 502, error: 'github_token_failed' }
  }
}
