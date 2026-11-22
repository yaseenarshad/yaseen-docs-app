import { describe, expect, it } from 'vitest'
import {
  base64UrlDecode,
  base64UrlEncode,
  createVapidAuthHeader,
  encryptWebPushPayload,
  isValidPushEndpoint,
  sendWebPush,
} from './webPush'

async function generateVapidKeys() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey)
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey))
  let bin = ''
  for (const b of pkcs8) bin += String.fromCharCode(b)
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(bin).match(/.{1,64}/g)?.join('\n')}\n-----END PRIVATE KEY-----`
  return {
    publicKey: kp.publicKey,
    publicKeyB64Url: base64UrlEncode(rawPub),
    privateScalarB64Url: jwk.d!,
    privateKeyPem: pem,
  }
}

async function generateSubscriberKeys() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))
  const authSecret = new Uint8Array(16)
  crypto.getRandomValues(authSecret)
  return {
    privateKey: kp.privateKey,
    publicKeyBytes: rawPub,
    p256dh: base64UrlEncode(rawPub),
    auth: base64UrlEncode(authSecret),
    authSecret,
  }
}

async function decryptAes128Gcm(
  body: Uint8Array,
  uaPrivateKey: CryptoKey,
  uaPublicBytes: Uint8Array<ArrayBuffer>,
  authSecret: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const salt = new Uint8Array(body.slice(0, 16))
  const rs = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(16, false)
  expect(rs).toBe(4096)
  const idlen = body[20]
  expect(idlen).toBe(65)
  const asPublicBytes = new Uint8Array(body.slice(21, 21 + idlen))
  expect(asPublicBytes[0]).toBe(0x04)
  const ciphertext = new Uint8Array(body.slice(21 + idlen))

  const asPublicKey = await crypto.subtle.importKey('raw', asPublicBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asPublicKey }, uaPrivateKey, 256))

  const enc = new TextEncoder()
  const prefix = enc.encode('WebPush: info\0')
  const keyInfo = new Uint8Array(prefix.byteLength + uaPublicBytes.byteLength + asPublicBytes.byteLength)
  keyInfo.set(prefix, 0)
  keyInfo.set(uaPublicBytes, prefix.byteLength)
  keyInfo.set(asPublicBytes, prefix.byteLength + uaPublicBytes.byteLength)

  const ecdhKey = await crypto.subtle.importKey('raw', ecdhSecret, 'HKDF', false, ['deriveBits'])
  const ikm = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: authSecret, info: keyInfo }, ecdhKey, 256),
  )

  const ikmKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const cek = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('Content-Encoding: aes128gcm\0') },
      ikmKey,
      128,
    ),
  )
  const nonce = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('Content-Encoding: nonce\0') },
      ikmKey,
      96,
    ),
  )

  const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['decrypt'])
  const decrypted = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, cekKey, ciphertext))
  expect(decrypted[decrypted.byteLength - 1]).toBe(0x02)
  return new TextDecoder().decode(decrypted.slice(0, -1))
}

describe('webPush (RFC 8291 + VAPID)', () => {
  it('validates public HTTPS push endpoints and rejects non-HTTPS, localhost, and private IPs', () => {
    expect(isValidPushEndpoint('https://fcm.googleapis.com/fcm/send/abc123')).toBe(true)
    expect(isValidPushEndpoint('https://web.push.apple.com/QABCD1234')).toBe(true)
    expect(isValidPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/xyz')).toBe(true)

    expect(isValidPushEndpoint('http://fcm.googleapis.com/fcm/send/abc')).toBe(false)
    expect(isValidPushEndpoint('https://localhost/push')).toBe(false)
    expect(isValidPushEndpoint('https://sub.localhost/push')).toBe(false)
    expect(isValidPushEndpoint('https://127.0.0.1/push')).toBe(false)
    expect(isValidPushEndpoint('https://10.0.0.5/push')).toBe(false)
    expect(isValidPushEndpoint('https://172.16.1.1/push')).toBe(false)
    expect(isValidPushEndpoint('https://192.168.1.10/push')).toBe(false)
    expect(isValidPushEndpoint('https://169.254.169.254/latest/meta-data')).toBe(false)
    expect(isValidPushEndpoint('https://[::1]/push')).toBe(false)
    expect(isValidPushEndpoint('https://[fe80::1]/push')).toBe(false)
    expect(isValidPushEndpoint('https://user:pass@fcm.googleapis.com/push')).toBe(false)
    expect(isValidPushEndpoint('not-a-url')).toBe(false)
  })

  it('signs verifiable ES256 VAPID JWTs from both raw 32-byte scalar and PKCS#8 PEM', async () => {
    const vapid = await generateVapidKeys()
    const nowSec = 1_760_000_000

    for (const priv of [vapid.privateScalarB64Url, vapid.privateKeyPem]) {
      const header = await createVapidAuthHeader(
        { VAPID_PUBLIC_KEY: vapid.publicKeyB64Url, VAPID_PRIVATE_KEY: priv },
        'https://fcm.googleapis.com',
        nowSec,
      )
      const match = /^vapid t=([^,]+), k=(.+)$/.exec(header)
      expect(match).not.toBeNull()
      expect(match![2]).toBe(vapid.publicKeyB64Url)

      const [hB64, pB64, sB64] = match![1].split('.')
      const jwtHeader = JSON.parse(new TextDecoder().decode(base64UrlDecode(hB64)!))
      const jwtPayload = JSON.parse(new TextDecoder().decode(base64UrlDecode(pB64)!))
      expect(jwtHeader).toEqual({ typ: 'JWT', alg: 'ES256' })
      expect(jwtPayload).toEqual({
        aud: 'https://fcm.googleapis.com',
        exp: nowSec + 12 * 3600,
        sub: 'mailto:yaseen@yaseenarshad.com',
      })

      const sig = base64UrlDecode(sB64)!
      expect(sig.byteLength).toBe(64)
      const verified = await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        vapid.publicKey,
        sig,
        new TextEncoder().encode(`${hB64}.${pB64}`),
      )
      expect(verified).toBe(true)
    }
  })

  it('encrypts aes128gcm payloads with RFC 8188 header that decrypt cleanly on subscriber side', async () => {
    const sub = await generateSubscriberKeys()
    const payload = JSON.stringify({ title: 'Buddy Streak', body: '🎉 You & Alice hit a 5-day buddy streak!', url: '/friends' })
    const encrypted = await encryptWebPushPayload(sub.p256dh, sub.auth, new TextEncoder().encode(payload))

    // 86-byte aes128gcm header + ciphertext + 1B delimiter + 16B GCM tag
    expect(encrypted.byteLength).toBeGreaterThan(86 + 17)
    const plaintext = await decryptAes128Gcm(encrypted, sub.privateKey, sub.publicKeyBytes, sub.authSecret)
    expect(plaintext).toBe(payload)
  })

  it('sends encrypted push via fetch and detects 404/410 gone subscriptions', async () => {
    const vapid = await generateVapidKeys()
    const sub = await generateSubscriberKeys()
    const env = { VAPID_PUBLIC_KEY: vapid.publicKeyB64Url, VAPID_PRIVATE_KEY: vapid.privateScalarB64Url }
    const subInput = { endpoint: 'https://web.push.apple.com/QTEST123', keys: { p256dh: sub.p256dh, auth: sub.auth } }

    let capturedHeaders: Record<string, string> = {}
    let capturedBody: Uint8Array | null = null
    const okRes = await sendWebPush(
      env,
      subInput,
      { title: 'Test', body: 'Hello world', url: '/friends', tag: 'test' },
      async (url, init) => {
        expect(url).toBe(subInput.endpoint)
        expect(init.method).toBe('POST')
        capturedHeaders = init.headers as Record<string, string>
        capturedBody = init.body as Uint8Array
        return new Response(null, { status: 201 })
      },
    )
    expect(okRes).toEqual({ ok: true, status: 201, gone: false })
    expect(capturedHeaders['content-encoding']).toBe('aes128gcm')
    expect(capturedHeaders.authorization.startsWith('vapid t=')).toBe(true)
    const decrypted = await decryptAes128Gcm(capturedBody!, sub.privateKey, sub.publicKeyBytes, sub.authSecret)
    expect(JSON.parse(decrypted)).toEqual({ title: 'Test', body: 'Hello world', url: '/friends', tag: 'test' })

    const gone410 = await sendWebPush(env, subInput, { title: 'Test', body: 'Gone' }, async () => new Response(null, { status: 410 }))
    expect(gone410).toEqual({ ok: false, status: 410, gone: true })

    const gone404 = await sendWebPush(env, subInput, { title: 'Test', body: 'Not found' }, async () => new Response(null, { status: 404 }))
    expect(gone404).toEqual({ ok: false, status: 404, gone: true })

    const unset = await sendWebPush({}, subInput, { title: 'Test', body: 'No VAPID' })
    expect(unset).toEqual({ ok: false, status: 0, gone: false })
  })
})
