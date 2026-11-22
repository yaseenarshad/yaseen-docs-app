/**
 * Pure Web Crypto RFC 8291 (`aes128gcm`) + RFC 8292 (VAPID ES256) Web Push sender.
 * Zero npm dependencies — runs natively on Cloudflare Workers and Node 20+.
 */
import type { PushSubscriptionInput } from '../../shared/friendsApi'

export interface WebPushEnv {
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  VAPID_SUBJECT?: string
}

export interface WebPushPayload {
  title: string
  body: string
  url?: string
  tag?: string
}

export interface WebPushResult {
  ok: boolean
  status: number
  gone: boolean
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>

const DEFAULT_VAPID_SUBJECT = 'mailto:yaseen@yaseenarshad.com'
const VAPID_EXP_SECONDS = 12 * 3600
const AES128GCM_RECORD_SIZE = 4096
const MAX_ENDPOINT_LENGTH = 2048

const textEncoder = new TextEncoder()

export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    bin += String.fromCharCode(bytes[i])
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function base64UrlDecode(input: string): Uint8Array<ArrayBuffer> | null {
  const clean = input.trim().replace(/\s+/g, '')
  if (!clean) return null
  const std = clean.replace(/-/g, '+').replace(/_/g, '/')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(std)) return null
  const padLen = (4 - (std.length % 4)) % 4
  const padded = std + '='.repeat(padLen)
  try {
    const bin = atob(padded)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  let total = 0
  for (const c of chunks) total += c.byteLength
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host) return true
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true

  // IPv6 loopback, unspecified, link-local, unique-local, or IPv4-mapped IPv6
  if (host.includes(':')) {
    if (host === '::1' || host === '::' || host === '0:0:0:0:0:0:0:1' || host === '0:0:0:0:0:0:0:0') return true
    if (/^(fc|fd)[0-9a-f]{2}:/i.test(host)) return true
    if (/^fe[89ab][0-9a-f]:/i.test(host)) return true
    if (host.startsWith('::ffff:')) return true
    return false
  }

  // IPv4 literal check
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])]
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true
  }
  return false
}

/** Validates that a Web Push subscription endpoint is a public HTTPS URL. */
export function isValidPushEndpoint(endpoint: string): boolean {
  if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > MAX_ENDPOINT_LENGTH) return false
  let parsed: URL
  try {
    parsed = new URL(endpoint)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  if (parsed.username || parsed.password) return false
  if (isPrivateOrLocalHost(parsed.hostname)) return false
  return true
}

/** Validates subscriber `p256dh` (65-byte uncompressed P-256 point) and `auth` (16-byte secret). */
export function isValidPushKeys(keys: { p256dh: string; auth: string } | null | undefined): boolean {
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return false
  const p256dh = base64UrlDecode(keys.p256dh)
  const auth = base64UrlDecode(keys.auth)
  if (!p256dh || p256dh.byteLength !== 65 || p256dh[0] !== 0x04) return false
  if (!auth || auth.byteLength !== 16) return false
  return true
}

async function importVapidPrivateKey(publicKeyB64Url: string, privateKeyRaw: string): Promise<CryptoKey> {
  const trimmed = privateKeyRaw.trim()
  if (trimmed.includes('-----BEGIN PRIVATE KEY-----')) {
    const body = trimmed
      .replace(/-----BEGIN PRIVATE KEY-----/g, '')
      .replace(/-----END PRIVATE KEY-----/g, '')
      .replace(/\s+/g, '')
    const der = base64UrlDecode(body)
    if (!der) throw new Error('Invalid VAPID PKCS#8 private key')
    return crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  }

  const pubBytes = base64UrlDecode(publicKeyB64Url)
  if (!pubBytes || pubBytes.byteLength !== 65 || pubBytes[0] !== 0x04) {
    throw new Error('Invalid VAPID public key')
  }
  const dBytes = base64UrlDecode(trimmed)
  if (!dBytes || dBytes.byteLength !== 32) {
    throw new Error('Invalid VAPID private key scalar')
  }
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: base64UrlEncode(pubBytes.slice(1, 33)),
    y: base64UrlEncode(pubBytes.slice(33, 65)),
    d: base64UrlEncode(dBytes),
    ext: false,
  }
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
}

/** Mints an RFC 8292 `Authorization: vapid t=<jwt>, k=<pub>` header signed with ES256. */
export async function createVapidAuthHeader(
  env: WebPushEnv,
  audience: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const pubKey = env.VAPID_PUBLIC_KEY?.trim()
  const privKey = env.VAPID_PRIVATE_KEY?.trim()
  if (!pubKey || !privKey) throw new Error('VAPID keys are not configured')
  const subject = env.VAPID_SUBJECT?.trim() || DEFAULT_VAPID_SUBJECT

  const headerB64 = base64UrlEncode(textEncoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const payloadB64 = base64UrlEncode(
    textEncoder.encode(
      JSON.stringify({
        aud: audience,
        exp: nowSec + VAPID_EXP_SECONDS,
        sub: subject,
      }),
    ),
  )
  const signingInput = textEncoder.encode(`${headerB64}.${payloadB64}`)
  const key = await importVapidPrivateKey(pubKey, privKey)
  const sigBuf = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, signingInput)
  const sigB64 = base64UrlEncode(new Uint8Array(sigBuf))
  return `vapid t=${headerB64}.${payloadB64}.${sigB64}, k=${pubKey}`
}

/**
 * Encrypts a payload per RFC 8291 (Web Push Message Encryption) + RFC 8188 (`aes128gcm`).
 * Returns the complete HTTP body: `[16B salt][4B rs][1B idlen=65][65B as_pub][ciphertext+tag]`.
 */
export async function encryptWebPushPayload(
  p256dh: string,
  auth: string,
  plaintext: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublicBytes = base64UrlDecode(p256dh)
  const authSecret = base64UrlDecode(auth)
  if (!uaPublicBytes || uaPublicBytes.byteLength !== 65 || uaPublicBytes[0] !== 0x04) {
    throw new Error('Invalid subscriber p256dh key')
  }
  if (!authSecret || authSecret.byteLength !== 16) {
    throw new Error('Invalid subscriber auth secret')
  }

  // 1. Generate ephemeral application-server ECDH P-256 key pair
  const asKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const asPublicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', asKeyPair.publicKey))

  // 2. ECDH shared secret with subscriber public key
  const uaPublicKey = await crypto.subtle.importKey('raw', uaPublicBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPublicKey }, asKeyPair.privateKey, 256))

  // 3. RFC 8291 §3.3: IKM = HKDF(salt=auth_secret, ikm=ecdh_secret, info="WebPush: info\0" || ua_pub || as_pub, L=32)
  const ecdhKey = await crypto.subtle.importKey('raw', ecdhSecret, 'HKDF', false, ['deriveBits'])
  const keyInfo = concatBytes(textEncoder.encode('WebPush: info\0'), uaPublicBytes, asPublicBytes)
  const ikm = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: authSecret, info: keyInfo }, ecdhKey, 256),
  )

  // 4. RFC 8291 §3.4 / RFC 8188 §2.2–2.3: derive CEK (16B) & Nonce (12B) using random 16B salt
  const salt = new Uint8Array(16)
  crypto.getRandomValues(salt)
  const ikmKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const cekBytes = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info: textEncoder.encode('Content-Encoding: aes128gcm\0') },
      ikmKey,
      128,
    ),
  )
  const nonceBytes = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info: textEncoder.encode('Content-Encoding: nonce\0') },
      ikmKey,
      96,
    ),
  )

  // 5. AES-128-GCM encrypt (plaintext || 0x02 final-record delimiter)
  const paddedPlaintext = concatBytes(plaintext, new Uint8Array([0x02]))
  const cekKey = await crypto.subtle.importKey('raw', cekBytes, { name: 'AES-GCM' }, false, ['encrypt'])
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonceBytes, tagLength: 128 }, cekKey, paddedPlaintext),
  )

  // 6. RFC 8188 §2.1 content coding header: salt(16) || rs(4 BE) || idlen(1) || keyid(65)
  const header = new Uint8Array(16 + 4 + 1 + asPublicBytes.byteLength)
  header.set(salt, 0)
  const view = new DataView(header.buffer)
  view.setUint32(16, AES128GCM_RECORD_SIZE, false)
  header[20] = asPublicBytes.byteLength
  header.set(asPublicBytes, 21)

  return concatBytes(header, ciphertext)
}

/** Sends a single encrypted Web Push notification using VAPID + `aes128gcm`. Never throws. */
export async function sendWebPush(
  env: WebPushEnv,
  sub: PushSubscriptionInput,
  payload: WebPushPayload,
  fetchFn: Fetch = (u, init) => globalThis.fetch(u, init),
  nowMs: number = Date.now(),
): Promise<WebPushResult> {
  if (!env.VAPID_PUBLIC_KEY?.trim() || !env.VAPID_PRIVATE_KEY?.trim()) {
    return { ok: false, status: 0, gone: false }
  }
  if (!isValidPushEndpoint(sub.endpoint) || !isValidPushKeys(sub.keys)) {
    return { ok: false, status: 400, gone: false }
  }

  try {
    const endpointUrl = new URL(sub.endpoint)
    const authorization = await createVapidAuthHeader(env, endpointUrl.origin, Math.floor(nowMs / 1000))
    const plaintext = textEncoder.encode(JSON.stringify(payload))
    const body = await encryptWebPushPayload(sub.keys.p256dh, sub.keys.auth, plaintext)

    const res = await fetchFn(sub.endpoint, {
      method: 'POST',
      headers: {
        authorization,
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: '86400',
        urgency: 'normal',
      },
      body,
    })
    return {
      ok: res.ok,
      status: res.status,
      gone: res.status === 404 || res.status === 410,
    }
  } catch {
    return { ok: false, status: 0, gone: false }
  }
}
