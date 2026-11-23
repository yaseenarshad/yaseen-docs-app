import { wire, type ShellBuild, type SwScope } from './swCore'

/** The service worker file (`dist/sw.js`, built by `publish/pwaPlugin.ts`): this build's shell list, and the logic. */
declare const __NOTECARDS_SHELL__: ShellBuild

interface PushEventDataLike {
  json(): unknown
  text(): string
}

interface PushEventLike {
  data?: PushEventDataLike | null
  waitUntil(promise: Promise<unknown>): void
}

interface NotificationLike {
  data?: unknown
  close(): void
}

interface NotificationClickEventLike {
  notification: NotificationLike
  waitUntil(promise: Promise<unknown>): void
}

interface WindowClientLike {
  id?: string
  url: string
  focus(): Promise<unknown>
  navigate(url: string): Promise<unknown>
}

interface PushSwScope extends SwScope {
  registration: {
    unregister(): Promise<boolean>
    showNotification(
      title: string,
      options?: { body?: string; tag?: string; data?: { url: string } },
    ): Promise<void>
  }
  clients: {
    claim(): Promise<void>
    matchAll(options?: { type?: string; includeUncontrolled?: boolean }): Promise<WindowClientLike[]>
    openWindow(url: string): Promise<unknown>
  }
  addEventListener: SwScope['addEventListener'] & {
    (type: 'push', fn: (event: PushEventLike) => void): void
    (type: 'notificationclick', fn: (event: NotificationClickEventLike) => void): void
  }
}

declare const self: PushSwScope

wire(self, __NOTECARDS_SHELL__)

function parsePushPayload(data: PushEventDataLike | null | undefined): {
  title: string
  body: string
  url: string
  tag?: string
} {
  let title = 'Yaseen Docs'
  let body = ''
  let url = '/'
  let tag: string | undefined
  if (!data) return { title, body, url, tag }
  try {
    const parsed = data.json() as Record<string, unknown> | null
    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.title === 'string' && parsed.title.trim()) title = parsed.title
      if (typeof parsed.body === 'string') body = parsed.body
      if (typeof parsed.url === 'string' && parsed.url.trim()) url = parsed.url
      if (typeof parsed.tag === 'string' && parsed.tag.trim()) tag = parsed.tag
      return { title, body, url, tag }
    }
  } catch {
    try {
      const text = data.text()
      if (text) body = text
    } catch {
      // Ignore malformed push payload
    }
  }
  return { title, body, url, tag }
}

function safeTargetUrl(raw: string, origin: string): string {
  try {
    const parsed = new URL(raw || '/', origin)
    if (parsed.origin === origin) return parsed.href
  } catch {
    // Fallback to origin root
  }
  return new URL('/', origin).href
}

self.addEventListener('push', (event: PushEventLike) => {
  const payload = parsePushPayload(event.data)
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      ...(payload.tag ? { tag: payload.tag } : {}),
      data: { url: payload.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event: NotificationClickEventLike) => {
  event.notification.close()
  const rawUrl =
    typeof event.notification.data === 'object' &&
    event.notification.data !== null &&
    typeof (event.notification.data as { url?: unknown }).url === 'string'
      ? (event.notification.data as { url: string }).url
      : '/'
  const targetUrl = safeTargetUrl(rawUrl, self.location.origin)
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client && typeof client.focus === 'function') {
          if (client.url !== targetUrl && typeof client.navigate === 'function') {
            return client.navigate(targetUrl).catch(() => undefined).then(() => client.focus())
          }
          return client.focus()
        }
      }
      return self.clients.openWindow(targetUrl)
    }),
  )
})
