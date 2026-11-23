import { alive, type Element } from '@shared/boardMerge'
import { isFiniteNumber, isRecord } from '@shared/guards'

/**
 * AI-EDITED FILE SANITIZER (YAZ-4279 item 5). An external editor or AI writing `.excalidraw` JSON can leave subtle
 * structural corruption that crashes Excalidraw or breaks bindings/cache: duplicate IDs, missing/duplicate/out-of-order
 * fractional indices, dangling `containerId`/`frameId`/`boundElements` references, or text elements without `originalText`.
 *
 * Pure and engine-free: never mutates the input array or its element objects.
 */

export interface SanitizeOptions {
  /** Drop tombstones (`isDeleted === true`). */
  stripDeleted?: boolean
  /** Bump `version` by 1 and stamp a fresh `versionNonce` + `updated` so Excalidraw's ShapeCache invalidates cleanly. */
  bumpVersions?: boolean
}

export interface SanitizeResult {
  elements: Element[]
  /** Number of structural repairs applied (duplicate IDs, broken indices, dangling refs, missing originalText, invalid entries). */
  repaired: number
}

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/**
 * Generates a valid Excalidraw fractional-indexing integer key for ordinal `i >= 0` in strictly increasing
 * lexicographical order (`a0`..`az`, `b00`..`bzz`, `c000`..`czzz`, `d0000`..`dzzzz`).
 */
function indexFor(i: number): string {
  if (i < 62) return `a${BASE62[i]}`
  let n = i - 62
  if (n < 62 * 62) return `b${toBase62(n, 2)}`
  n -= 62 * 62
  if (n < 62 * 62 * 62) return `c${toBase62(n, 3)}`
  n -= 62 * 62 * 62
  return `d${toBase62(n, 4)}`
}

function toBase62(n: number, width: number): string {
  let out = ''
  let v = n
  for (let k = 0; k < width; k++) {
    out = BASE62[v % 62] + out
    v = Math.floor(v / 62)
  }
  return out
}

function indicesBroken(elements: readonly Element[]): boolean {
  let prev: string | null = null
  for (let i = 0; i < elements.length; i++) {
    const idx = elements[i].index
    if (typeof idx !== 'string' || idx.length === 0) return true
    if (prev !== null && !(prev < idx)) return true
    prev = idx
  }
  return false
}

export function sanitizeElements(elements: readonly unknown[], opts?: SanitizeOptions): SanitizeResult {
  const stripDeleted = opts?.stripDeleted === true
  const bumpVersions = opts?.bumpVersions === true
  let repaired = 0

  // Pass 1: filter valid element records, optionally drop deleted tombstones, and reserve all existing IDs.
  const valid: Element[] = []
  const reservedIds = new Set<string>()
  for (const raw of elements) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id.length === 0) {
      repaired++
      continue
    }
    const el = raw as Element
    if (stripDeleted && el.isDeleted === true) continue
    valid.push(el)
    reservedIds.add(el.id)
  }

  // Pass 2: deduplicate IDs (keep first, rename duplicates to `${id}-dup-${n}`).
  const seenIds = new Set<string>()
  const out: Element[] = new Array(valid.length)
  for (let i = 0; i < valid.length; i++) {
    const el = valid[i]
    if (!seenIds.has(el.id)) {
      seenIds.add(el.id)
      out[i] = el
    } else {
      let n = 1
      let fresh = `${el.id}-dup-${n}`
      while (reservedIds.has(fresh) || seenIds.has(fresh)) {
        n++
        fresh = `${el.id}-dup-${n}`
      }
      reservedIds.add(fresh)
      seenIds.add(fresh)
      out[i] = { ...el, id: fresh }
      repaired++
    }
  }

  // Pass 3: repair duplicate, missing, or non-monotonic fractional indices when broken.
  if (indicesBroken(out)) {
    for (let i = 0; i < out.length; i++) {
      const want = indexFor(i)
      if (out[i].index !== want) {
        out[i] = { ...out[i], index: want }
        repaired++
      }
    }
  }

  // Pass 4: repair dangling containerId, frameId, boundElements (on alive elements), missing originalText, and optional version bumps.
  const aliveIds = new Set<string>()
  for (const el of out) {
    if (alive(el)) aliveIds.add(el.id)
  }

  const now = bumpVersions ? Date.now() : 0

  for (let i = 0; i < out.length; i++) {
    let el = out[i]
    let cloned = false
    const patch = (key: string, value: unknown) => {
      if (!cloned) {
        el = { ...el }
        cloned = true
      }
      el[key] = value
    }

    if (alive(el)) {
      if (typeof el.containerId === 'string' && (!aliveIds.has(el.containerId) || el.containerId === el.id)) {
        patch('containerId', null)
        repaired++
      }
      if (typeof el.frameId === 'string' && (!aliveIds.has(el.frameId) || el.frameId === el.id)) {
        patch('frameId', null)
        repaired++
      }
      if (Array.isArray(el.boundElements)) {
        const seenBound = new Set<string>()
        const kept: Record<string, unknown>[] = []
        for (const b of el.boundElements) {
          if (!isRecord(b) || typeof b.id !== 'string' || !aliveIds.has(b.id) || b.id === el.id || seenBound.has(b.id)) continue
          seenBound.add(b.id)
          kept.push(b)
        }
        if (kept.length !== el.boundElements.length) {
          patch('boundElements', kept.length > 0 ? kept : null)
          repaired++
        }
      }
    }

    if (el.type === 'text' && typeof el.text === 'string' && (el.originalText === undefined || el.originalText === null)) {
      patch('originalText', el.text)
      repaired++
    }

    if (bumpVersions) {
      patch('version', (isFiniteNumber(el.version) ? el.version : 0) + 1)
      patch('versionNonce', Math.floor(Math.random() * 2 ** 31))
      patch('updated', now)
    }

    out[i] = el
  }

  return { elements: out, repaired }
}
