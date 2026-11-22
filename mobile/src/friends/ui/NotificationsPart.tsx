import { useEffect, useState } from 'react'
import { useApp } from '../../app/AppState'
import { browserFacts, whereAmI } from '../../pwa/homeScreen'
import './friends.css'
import { serviceOf } from './lazy'
import {
  DEFAULT_NOTIFICATION_PREFS,
  isFriendsDemo,
  type FriendFinishedMode,
  type FriendsService,
  type NotificationPrefs,
} from './service'

const MODE_LABELS: Record<FriendFinishedMode, string> = {
  off: 'Off',
  all: 'All friends',
  selected: 'Specific friends',
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)

const DEMO_PUSH_ENDPOINT = 'demo-push:local-device'

export function formatReminderHour(hour: number): string {
  const h = ((hour % 24) + 24) % 24
  const suffix = h < 12 ? 'AM' : 'PM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}:00 ${suffix}`
}

export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4)
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = globalThis.atob(base64)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) {
    out[i] = raw.charCodeAt(i)
  }
  return out
}

export function detectIosNotStandalone(): boolean {
  const where = whereAmI(browserFacts())
  return where === 'ios-safari' || where === 'ios-other'
}

/**
 * Settings › Friends › Notifications (lazy chunk so Settings stays lean on first load).
 * 2-click expandable row + sheet controlling Web Push subscriptions and notification preferences.
 */
export default function NotificationsPart() {
  const app = useApp()
  const [service, setService] = useState<FriendsService | null>(null)
  const [open, setOpen] = useState(false)
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS)
  const [subscribedCount, setSubscribedCount] = useState(0)
  const [deviceSubscribed, setDeviceSubscribed] = useState(false)
  const [friends, setFriends] = useState<{ id: number; name: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [testBusy, setTestBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const isIosNotStandalone = detectIosNotStandalone()
  const pushOn = deviceSubscribed || subscribedCount > 0

  useEffect(() => {
    const load = serviceOf(app.services.friends)
    if (load === null) return
    let live = true
    setLoading(true)
    void load()
      .then(async (s) => {
        if (!live) return
        setService(s)
        const [notifRes, board] = await Promise.all([
          s.getNotificationPrefs?.().catch(() => null) ?? Promise.resolve(null),
          s.board().catch(() => null),
        ])
        if (!live) return
        if (notifRes) {
          setPrefs(notifRes.prefs)
          setSubscribedCount(notifRes.subscribedCount)
          if (isFriendsDemo()) {
            setDeviceSubscribed(notifRes.subscribedCount > 0)
          }
        }
        if (board && board.kind === 'ok') {
          setFriends(
            board.friends
              .filter((f): f is typeof f & { userId: number } => typeof f.userId === 'number')
              .map((f) => ({ id: f.userId, name: f.name })),
          )
        }
        if (!isFriendsDemo() && typeof navigator !== 'undefined' && navigator.serviceWorker && typeof navigator.serviceWorker.getRegistration === 'function') {
          const reg = await navigator.serviceWorker.getRegistration().catch(() => undefined)
          const sub = await reg?.pushManager?.getSubscription?.().catch(() => null)
          if (live && sub) {
            setDeviceSubscribed(true)
          }
        }
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [app.services.friends])

  const persistPatch = async (patch: Partial<NotificationPrefs>) => {
    if (!service?.updateNotificationPrefs) return
    const prev = prefs
    setPrefs({ ...prev, ...patch })
    setSaving(true)
    setStatus(null)
    try {
      const res = await service.updateNotificationPrefs(patch)
      if (!res.ok) {
        setPrefs(prev)
        setStatus('Could not save notification settings. Try again.')
        return
      }
      setPrefs(res.prefs)
    } finally {
      setSaving(false)
    }
  }

  const toggleFriend = (friendId: number) => {
    const has = prefs.friendFinishedIds.includes(friendId)
    const friendFinishedIds = has
      ? prefs.friendFinishedIds.filter((id) => id !== friendId)
      : [...prefs.friendFinishedIds, friendId]
    void persistPatch({ friendFinishedIds })
  }

  const enablePush = async () => {
    if (!service?.subscribePush) {
      setStatus('Notifications are not available right now.')
      return
    }
    setPushBusy(true)
    setStatus(null)
    try {
      if (isFriendsDemo()) {
        const res = await service.subscribePush({
          endpoint: DEMO_PUSH_ENDPOINT,
          keys: { p256dh: 'demo-p256dh', auth: 'demo-auth' },
        })
        if (!res.ok) {
          setStatus(res.error || 'Could not enable notifications.')
          return
        }
        setDeviceSubscribed(true)
        setSubscribedCount((c) => Math.max(1, c))
        setStatus('Notifications enabled on this device.')
        return
      }

      if (
        typeof Notification === 'undefined' ||
        typeof navigator === 'undefined' ||
        !navigator.serviceWorker ||
        typeof window === 'undefined' ||
        !('PushManager' in window)
      ) {
        setStatus('Push notifications are not supported in this browser.')
        return
      }

      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setStatus('Notifications are blocked. Enable them in browser settings.')
        return
      }

      const config = await service.getPushConfig?.()
      if (!config?.vapidPublicKey) {
        setStatus('Push notifications are not configured on the server yet.')
        return
      }

      const reg = await navigator.serviceWorker.ready
      let sub = await reg.pushManager.getSubscription()
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey),
        })
      }
      const json = sub.toJSON()
      const endpoint = json.endpoint ?? sub.endpoint
      const p256dh = json.keys?.p256dh
      const auth = json.keys?.auth
      if (!endpoint || !p256dh || !auth) {
        setStatus('Could not read push subscription keys from this browser.')
        return
      }

      const res = await service.subscribePush({
        endpoint,
        keys: { p256dh, auth },
      })
      if (!res.ok) {
        setStatus(res.error || 'Could not enable notifications.')
        return
      }
      setDeviceSubscribed(true)
      setSubscribedCount((c) => Math.max(1, c))
      setStatus('Notifications enabled on this device.')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not enable notifications.')
    } finally {
      setPushBusy(false)
    }
  }

  const disablePush = async () => {
    if (!service?.unsubscribePush) {
      setStatus('Notifications are not available right now.')
      return
    }
    setPushBusy(true)
    setStatus(null)
    try {
      if (isFriendsDemo()) {
        const res = await service.unsubscribePush(DEMO_PUSH_ENDPOINT)
        if (!res.ok) {
          setStatus(res.error || 'Could not disable notifications.')
          return
        }
        setDeviceSubscribed(false)
        setSubscribedCount(0)
        setStatus('Notifications disabled on this device.')
        return
      }

      let endpoint = ''
      if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
        const reg =
          typeof navigator.serviceWorker.getRegistration === 'function'
            ? (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.ready)
            : await navigator.serviceWorker.ready
        const sub = await reg?.pushManager?.getSubscription()
        if (sub) {
          endpoint = sub.endpoint
          await sub.unsubscribe().catch(() => false)
        }
      }
      if (endpoint) {
        const res = await service.unsubscribePush(endpoint)
        if (!res.ok) {
          setStatus(res.error || 'Could not disable notifications.')
          return
        }
      }
      setDeviceSubscribed(false)
      setSubscribedCount((c) => Math.max(0, c - 1))
      setStatus('Notifications disabled on this device.')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not disable notifications.')
    } finally {
      setPushBusy(false)
    }
  }

  const sendTest = async () => {
    if (!service?.sendTestPush) {
      setStatus('Test notifications are not available right now.')
      return
    }
    setTestBusy(true)
    setStatus(null)
    try {
      const res = await service.sendTestPush()
      if (!res.ok) {
        setStatus(res.error || 'Could not send test notification.')
        return
      }
      if (res.sent > 0) {
        setStatus('Test notification sent')
      } else {
        setStatus('Enable notifications on this device first.')
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not send test notification.')
    } finally {
      setTestBusy(false)
    }
  }

  return (
    <li>
      <div className="row">
        <button
          type="button"
          className="row__button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          Notifications
        </button>
        <span className="row__side">{pushOn ? 'On' : 'Off'}</span>
      </div>
      {open && (
        <div className="sheet stack fr-notif-sheet" role="region" aria-label="Notifications">
          {isIosNotStandalone && (
            <p className="fr-notif-tip">
              On iPhone, tap Share → Add to Home Screen first to enable lock-screen notifications.
            </p>
          )}
          <div className="fr-notif-master">
            <button
              type="button"
              className="btn btn--wide"
              disabled={pushBusy || loading}
              onClick={() => void (pushOn ? disablePush() : enablePush())}
            >
              {pushBusy ? 'Updating…' : pushOn ? 'Disable on this device' : 'Enable notifications'}
            </button>
          </div>

          <div className="fr-notif-group">
            <label className="row">
              <input
                type="checkbox"
                className="check"
                checked={prefs.dailyReminder}
                disabled={saving || loading}
                onChange={(e) => void persistPatch({ dailyReminder: e.target.checked })}
              />
              <span className="row__main">Daily reminder</span>
            </label>
            <div className="fr-notif-sub">
              <label className="field">
                <span className="field__label">Only reminds you if you still have due cards left today.</span>
                <select
                  aria-label="Daily reminder time"
                  value={prefs.reminderHour}
                  disabled={!prefs.dailyReminder || saving || loading}
                  onChange={(e) => void persistPatch({ reminderHour: Number(e.target.value) })}
                >
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {formatReminderHour(h)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="fr-notif-group" role="radiogroup" aria-label="Friend finished today">
            <div className="field__label fr-notif-heading">Friend finished today</div>
            {(['off', 'all', 'selected'] as const).map((m) => (
              <label key={m} className="row">
                <input
                  type="radio"
                  className="check"
                  name="friend-finished-mode"
                  checked={prefs.friendFinishedMode === m}
                  disabled={saving || loading}
                  onChange={() => void persistPatch({ friendFinishedMode: m })}
                />
                <span className="row__main">{MODE_LABELS[m]}</span>
              </label>
            ))}
          </div>

          {prefs.friendFinishedMode === 'selected' && (
            <div className="fr-notif-sub" role="group" aria-label="Specific friends">
              <div className="field__label fr-notif-heading">Notify when these friends finish</div>
              {friends.length === 0 ? (
                <p className="muted fr-notif-note">No friends added yet.</p>
              ) : (
                friends.map((f) => (
                  <label key={f.id} className="row">
                    <input
                      type="checkbox"
                      className="check"
                      checked={prefs.friendFinishedIds.includes(f.id)}
                      disabled={saving || loading}
                      onChange={() => toggleFriend(f.id)}
                    />
                    <span className="row__main">{f.name}</span>
                  </label>
                ))
              )}
            </div>
          )}

          <div className="fr-notif-group">
            <label className="row">
              <input
                type="checkbox"
                className="check"
                checked={prefs.buddyStreak}
                disabled={saving || loading}
                onChange={(e) => void persistPatch({ buddyStreak: e.target.checked })}
              />
              <span className="row__main">
                Buddy streak nudge &amp; milestones
                <span className="fr-notif-helper">Nudge me when a friend finishes so we keep our buddy streak</span>
              </span>
            </label>
            <label className="row">
              <input
                type="checkbox"
                className="check"
                checked={prefs.sharedCards}
                disabled={saving || loading}
                onChange={(e) => void persistPatch({ sharedCards: e.target.checked })}
              />
              <span className="row__main">Shared cards &amp; invites</span>
            </label>
          </div>

          <div className="fr-notif-actions">
            <button
              type="button"
              className="btn btn--wide"
              disabled={testBusy || loading}
              onClick={() => void sendTest()}
            >
              {testBusy ? 'Sending…' : 'Send test notification'}
            </button>
            {status !== null && (
              <p className="muted fr-notif-status" role="status">
                {status}
              </p>
            )}
          </div>
        </div>
      )}
    </li>
  )
}
