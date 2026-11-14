import { IMAGE_VIEW_MIME } from '@shared/types'
import type { MediaAhead } from '../media'
import type { VaultStore } from '../store'

/**
 * HOW A SCREEN GETS ONE FILE'S BYTES (YAZ-5079): a picture or a sound in a page, a PDF a link opens. 3D (YAZ-5074,
 * `mobile/src/media`) owns this: `MediaAhead.show(path)` reads the store first, then GitHub, keeps what it fetched,
 * and gives an object URL. Until 3D lands in the shell, the page view uses `storedMedia`: the store only, so a file on the
 * phone shows and any other says it needs a connection (N3).
 *
 * `PageMedia` is the part of 3D's `MediaAhead` the reader calls, by the same name and shape, so 3D's object plugs in as
 * it is: pass it as `AppServices.media` (`main.tsx`).
 */
export type FileShow =
  | { status: 'ready'; path: string; url: string; type: string }
  | {
      status: 'missing'
      path: string | null
      /** 3D's reasons: `offline` (N3), `slowed`, `gone`, `not-in-vault`, `no-vault`, `failed`. */
      why: string
    }

export interface PageMedia {
  show(path: string): Promise<FileShow>
}

/** 3D's `MediaAhead` is a `PageMedia` as it is: this line fails the typecheck if the two drift apart. */
export const mediaFits = (media: MediaAhead): PageMedia => media

const SOUND_MIME: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg' }

/** The MIME type of a vault file by its name: a picture, a sound, a PDF; else `application/octet-stream`. */
export function fileType(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  if (ext === 'pdf') return 'application/pdf'
  return (IMAGE_VIEW_MIME as Record<string, string>)[`.${ext}`] ?? SOUND_MIME[ext] ?? 'application/octet-stream'
}

/**
 * The store alone (no network): a stored file is an object URL, any other is `offline`. The URLs live until `release()`.
 * `markViewed` tells the store the file showed (row P2 drops the media viewed longest ago first).
 */
export function storedMedia(store: VaultStore, vault: string): PageMedia & { release(): void } {
  const urls = new Map<string, string>()
  return {
    async show(path) {
      const held = urls.get(path)
      if (held !== undefined) return { status: 'ready', path, url: held, type: fileType(path) }
      const file = await store.read(vault, path)
      if (file === null) return { status: 'missing', path, why: 'offline' }
      void store.markViewed(vault, path).catch(() => undefined)
      const bytes = typeof file.content === 'string' ? new TextEncoder().encode(file.content) : file.content
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: fileType(path) }))
      urls.set(path, url)
      return { status: 'ready', path, url, type: fileType(path) }
    },
    release() {
      for (const url of urls.values()) URL.revokeObjectURL(url)
      urls.clear()
    },
  }
}
