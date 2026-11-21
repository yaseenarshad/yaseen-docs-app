/**
 * An Image cell's "Paste a link" (YAZ-4802 demo): main downloads ONE picture. `fetch` is passed in (Electron's
 * `net.fetch` in the app), so each case hands a stand-in that answers with a made-up `Response`. The guards: http(s)
 * only, before and after redirects; an `image/*` answer only; at most `MAX_FILE_BYTES`, counted on what arrives; a
 * file name stem cleaned to letters, digits, `-` and `_`.
 */
import { describe, expect, it, vi } from 'vitest'
import { MAX_FILE_BYTES } from '@shared/types'
import { downloadImage, nameFromUrl, type Fetch } from './downloadImage'

/** A response as `net.fetch` gives it: `url` is where it landed after redirects. */
function answer(body: BodyInit | null, headers: Record<string, string>, opts: { status?: number; url?: string } = {}): Response {
  const response = new Response(body, { status: opts.status ?? 200, headers })
  Object.defineProperty(response, 'url', { value: opts.url ?? '' })
  return response
}
const fetchOf = (response: Response | (() => Promise<Response>)) =>
  vi.fn<Fetch>(async () => (typeof response === 'function' ? response() : response))
const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3])

describe('YAZ-4802 demo: downloadImage (main)', () => {
  it('YAZ-4802 demo: an https picture comes back as its bytes, its type, and a name from the address', async () => {
    const fetch = fetchOf(answer(PNG, { 'Content-Type': 'image/png; charset=binary' }, { url: 'https://cdn.example.com/logos/React%20Logo.png' }))
    const out = await downloadImage({ url: '  https://cdn.example.com/logos/React%20Logo.png ' }, fetch)
    expect(Array.from(out.bytes)).toEqual(Array.from(PNG))
    expect(out.mimeType).toBe('image/png')
    expect(out.name).toBe('React-Logo')
    expect(fetch).toHaveBeenCalledWith('https://cdn.example.com/logos/React%20Logo.png', expect.objectContaining({ redirect: 'follow' }))
  })

  it('YAZ-4802 demo: plain http works too', async () => {
    await expect(downloadImage({ url: 'http://example.com/a.gif' }, fetchOf(answer(PNG, { 'Content-Type': 'image/gif' })))).resolves.toMatchObject({ mimeType: 'image/gif', name: 'a' })
  })

  it('YAZ-4802 demo: only http and https; a file:, data: or javascript: address is refused before any fetch', async () => {
    for (const url of ['file:///etc/passwd', 'data:image/png;base64,AAAA', 'javascript:alert(1)', 'ftp://example.com/a.png']) {
      const fetch = fetchOf(answer(PNG, { 'Content-Type': 'image/png' }))
      await expect(downloadImage({ url }, fetch)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
      expect(fetch).not.toHaveBeenCalled()
    }
  })

  it('YAZ-4802 demo: text that is not an address is refused', async () => {
    await expect(downloadImage({ url: 'not a link' }, fetchOf(answer(PNG, {})))).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('YAZ-4802 demo: a redirect that lands off the web is refused', async () => {
    const fetch = fetchOf(answer(PNG, { 'Content-Type': 'image/png' }, { url: 'file:///Users/me/secret.png' }))
    await expect(downloadImage({ url: 'https://example.com/a.png' }, fetch)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('YAZ-4802 demo: an answer that is not image/* is refused', async () => {
    for (const type of ['text/html', 'application/octet-stream', '']) {
      const headers: Record<string, string> = type === '' ? {} : { 'Content-Type': type }
      await expect(downloadImage({ url: 'https://example.com/a.png' }, fetchOf(answer('<html>', headers)))).rejects.toMatchObject({ code: 'UNSUPPORTED_TYPE' })
    }
  })

  it('YAZ-4802 demo: a non-OK answer is refused with its status', async () => {
    await expect(downloadImage({ url: 'https://example.com/a.png' }, fetchOf(answer(null, { 'Content-Type': 'image/png' }, { status: 404 })))).rejects.toMatchObject({
      code: 'PROVIDER_FAILED',
      message: expect.stringContaining('404'),
    })
  })

  it('YAZ-4802 demo: a Content-Length over the cap is refused', async () => {
    const response = answer(PNG, { 'Content-Type': 'image/png', 'Content-Length': String(MAX_FILE_BYTES + 1) })
    await expect(downloadImage({ url: 'https://example.com/a.png' }, fetchOf(response))).rejects.toMatchObject({ code: 'TOO_LARGE' })
  })

  it('YAZ-4802 demo: a body over the cap is refused even when the header claims less', async () => {
    const big = new Uint8Array(MAX_FILE_BYTES + 1)
    const response = answer(big, { 'Content-Type': 'image/png', 'Content-Length': '10' })
    await expect(downloadImage({ url: 'https://example.com/a.png' }, fetchOf(response))).rejects.toMatchObject({ code: 'TOO_LARGE' })
  })

  it('YAZ-4802 demo: an empty body is no picture', async () => {
    await expect(downloadImage({ url: 'https://example.com/a.png' }, fetchOf(answer(new Uint8Array(0), { 'Content-Type': 'image/png' })))).rejects.toMatchObject({ code: 'UNSUPPORTED_TYPE' })
  })

  it('YAZ-4802 demo: a site that can not be reached, or times out, is OFFLINE', async () => {
    await expect(downloadImage({ url: 'https://example.com/a.png' }, vi.fn<Fetch>(async () => Promise.reject(new TypeError('fetch failed'))))).rejects.toMatchObject({ code: 'OFFLINE' })
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    await expect(downloadImage({ url: 'https://example.com/a.png' }, vi.fn<Fetch>(async () => Promise.reject(timeout)))).rejects.toMatchObject({
      code: 'OFFLINE',
      message: expect.stringContaining('too long'),
    })
  })
})

describe('YAZ-4802 demo: nameFromUrl cleans the downloaded file name', () => {
  it('YAZ-4802 demo: the last path part, decoded, extension off, only letters, digits, - and _', () => {
    expect(nameFromUrl(new URL('https://x.com/a/b/My%20Logo%20(v2).svg?x=1'))).toBe('My-Logo-v2')
    expect(nameFromUrl(new URL('https://x.com/../../etc/passwd'))).toBe('passwd')
    expect(nameFromUrl(new URL('https://x.com/a/%2E%2E%2Fsecret.png'))).toBe('secret')
    expect(nameFromUrl(new URL('https://x.com/a/snake_case-name.webp'))).toBe('snake_case-name')
  })

  it('YAZ-4802 demo: a bad escape keeps the raw text, made safe; no path gives an empty stem; at most 80 characters', () => {
    expect(nameFromUrl(new URL('https://x.com/a/%E0%A4%A.png'))).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(nameFromUrl(new URL('https://x.com/'))).toBe('')
    expect(nameFromUrl(new URL(`https://x.com/${'a'.repeat(200)}.png`))).toHaveLength(80)
  })
})
