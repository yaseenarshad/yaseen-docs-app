import { MAX_FILE_BYTES, type ImageDownloadResponse } from '@shared/types'
import { BridgeFailure } from './fsUtils'
import { requireRequest, str } from './validate'

/**
 * An Image cell's "Paste a link" (YAZ-4802): one picture off the web, downloaded ONCE, so the cell links a file in the
 * vault and never a web address that may go away. Main fetches because the renderer is sandboxed; it writes nothing —
 * the renderer saves the bytes through `writeAsset` into `assets/images/`, the door pasted note images use (never over
 * a file, `-2`, `-3`). The guards: `http:` and `https:` only (after redirects too), an `image/*` answer only, at most
 * `MAX_FILE_BYTES` (what `writeAsset` takes; counted on what arrives, `Content-Length` is a claim), within `TIMEOUT_MS`.
 *
 * `fetch` comes in as an argument: `ipc/fs.ts` passes Electron's `net.fetch` (it takes the system proxy).
 */

export type Fetch = (url: string, init: { signal: AbortSignal; redirect: 'follow' }) => Promise<Response>

/** A stalled server never holds the picker open. */
const TIMEOUT_MS = 20_000

const tooLarge = (): BridgeFailure => new BridgeFailure('TOO_LARGE', `that picture is over the ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB limit`)

/** The URL's last part as a file name's stem: decoded, its extension off, only letters, digits, `-` and `_`, 80 at most. */
export function nameFromUrl(url: URL): string {
  const last = url.pathname.split('/').filter(Boolean).pop() ?? ''
  let decoded = last
  try {
    decoded = decodeURIComponent(last)
  } catch {
    // A malformed escape keeps the raw text; the cleanup below makes it safe anyway.
  }
  const stem = decoded.replace(/\.[A-Za-z0-9]{1,5}$/, '')
  return stem
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

export async function downloadImage(raw: unknown, fetch: Fetch): Promise<ImageDownloadResponse> {
  const text = str(requireRequest(raw).url, 'url').trim()
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new BridgeFailure('BAD_REQUEST', 'that is not a web address')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BridgeFailure('BAD_REQUEST', 'only http and https links can be downloaded')
  let response: Response
  try {
    response = await fetch(url.toString(), { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' })
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) throw new BridgeFailure('OFFLINE', 'the website took too long to answer')
    throw new BridgeFailure('OFFLINE', 'the website could not be reached')
  }
  // A redirect may not land anywhere but the web.
  if (response.url !== '' && !/^https?:/i.test(response.url)) throw new BridgeFailure('BAD_REQUEST', 'the link went somewhere that is not a web address')
  if (!response.ok) throw new BridgeFailure('PROVIDER_FAILED', `the website answered ${response.status}`)
  const mimeType = (response.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase()
  if (!mimeType.startsWith('image/')) throw new BridgeFailure('UNSUPPORTED_TYPE', 'that link is not a picture')
  if (Number(response.headers.get('Content-Length') ?? 0) > MAX_FILE_BYTES) throw tooLarge()
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = response.body?.getReader()
  if (reader !== undefined) {
    for (;;) {
      let part: ReadableStreamReadResult<Uint8Array>
      try {
        part = await reader.read()
      } catch {
        throw new BridgeFailure('OFFLINE', 'the download stopped before the end')
      }
      if (part.done) break
      size += part.value.byteLength
      if (size > MAX_FILE_BYTES) {
        void reader.cancel()
        throw tooLarge()
      }
      chunks.push(part.value)
    }
  }
  if (size === 0) throw new BridgeFailure('UNSUPPORTED_TYPE', 'that link answered with no picture')
  const bytes = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.byteLength
  }
  return { bytes, mimeType, name: nameFromUrl(new URL(response.url || url.toString())) }
}
