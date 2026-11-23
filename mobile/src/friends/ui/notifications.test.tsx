// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveAccount } from '../../auth/account'
import { mount, newPhone, type Harness } from '../../screens/testing'
import { saveVaultList, vaultId } from '../../store'
import { demoBoard, fakeService, fakeServices, type FakeService } from './demo'
import { formatReminderHour, urlBase64ToUint8Array } from './NotificationsPart'
import { createFriendsService, DEFAULT_NOTIFICATION_PREFS, type Board, type NotificationPrefs } from './service'

const NOW = Date.UTC(2026, 10, 13, 18, 0, 0)

let h: Harness | null = null
const origNotification = globalThis.Notification
const origPushManager = (window as unknown as { PushManager?: unknown }).PushManager
const origServiceWorker = navigator.serviceWorker
const origUserAgent = Object.getOwnPropertyDescriptor(navigator, 'userAgent')
const origStandalone = Object.getOwnPropertyDescriptor(navigator, 'standalone')

afterEach(() => {
  h?.unmount()
  h = null
  window.history.replaceState({}, '', '/')
  Object.defineProperty(globalThis, 'Notification', { value: origNotification, configurable: true, writable: true })
  if (origPushManager === undefined) {
    delete (window as unknown as { PushManager?: unknown }).PushManager
  } else {
    Object.defineProperty(window, 'PushManager', { value: origPushManager, configurable: true, writable: true })
  }
  Object.defineProperty(navigator, 'serviceWorker', { value: origServiceWorker, configurable: true })
  if (origUserAgent) Object.defineProperty(navigator, 'userAgent', origUserAgent)
  if (origStandalone) Object.defineProperty(navigator, 'standalone', origStandalone)
  else delete (navigator as Navigator & { standalone?: boolean }).standalone
})

async function waitFor(check: () => boolean, ms = 4000): Promise<void> {
  const until = Date.now() + ms
  while (!check()) {
    if (Date.now() > until) throw new Error('Timed out waiting for condition')
    await act(async () => void (await new Promise((r) => setTimeout(r, 15))))
  }
}

async function openSettings(board: Board, patchService?: (s: FakeService) => void) {
  const p = await newPhone()
  const v = { repo: 'Yaseen/Med-Notes', branch: 'main', addedAt: 0 }
  const id = vaultId(v)
  await saveVaultList(p.store, { vaults: [v], open: id })
  await p.tokens.write(id, 'ghp_test_token')
  await saveAccount(p.store, id, {
    login: 'yaseen',
    name: 'Yaseen Arshad',
    avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
    gists: 'yes',
    checkedAt: NOW,
    expiresAt: null,
  })
  const s = fakeService(board)
  patchService?.(s)
  const mounted = await mount({
    phone: p,
    services: { now: () => NOW },
    friends: (store) => fakeServices(store, s, true),
  })
  h = mounted
  await waitFor(() => mounted.host.querySelector('button[aria-label="Settings"]') !== null)
  await mounted.click('Settings')
  await waitFor(() => mounted.text().includes('Notifications'))
  return { h: mounted, s, p }
}

describe('Mobile Settings › Notifications (Web Push)', () => {
  it('formats 24 reminder hours and decodes base64url VAPID keys', () => {
    expect(formatReminderHour(0)).toBe('12:00 AM')
    expect(formatReminderHour(8)).toBe('8:00 AM')
    expect(formatReminderHour(12)).toBe('12:00 PM')
    expect(formatReminderHour(20)).toBe('8:00 PM')
    expect(formatReminderHour(23)).toBe('11:00 PM')
    const bytes = urlBase64ToUint8Array('AQID')
    expect([...bytes]).toEqual([1, 2, 3])
  })

  it('supports 2-click expandable Notifications sheet with daily reminder, friend mode, buddy streak, shared cards, and test push', async () => {
    let prefs: NotificationPrefs = { ...DEFAULT_NOTIFICATION_PREFS }
    const updateNotificationPrefs = vi.fn(async (patch: Partial<NotificationPrefs>) => {
      prefs = { ...prefs, ...patch }
      return { ok: true as const, prefs: { ...prefs } }
    })
    const sendTestPush = vi.fn(async () => ({ ok: true as const, sent: 1, failed: 0 }))

    const board = demoBoard(NOW)
    if (board.kind === 'ok') {
      board.friends = board.friends.map((f, idx) => ({ ...f, userId: idx + 10 }))
    }
    const { h: mounted } = await openSettings(board, (s) => {
      s.getNotificationPrefs = vi.fn(async () => ({ prefs: { ...prefs }, subscribedCount: 0 }))
      s.updateNotificationPrefs = updateNotificationPrefs
      s.sendTestPush = sendTestPush
    })

    // Collapsed row shows Notifications Off
    expect(mounted.text()).toMatch(/Notifications\s*Off/)

    await mounted.click('Notifications')
    expect(mounted.text()).toContain('Enable notifications')
    expect(mounted.text()).toContain('Only reminds you if you still have due cards left today.')
    expect(mounted.text()).toContain('Nudge me when a friend finishes so we keep our buddy streak')
    expect(mounted.text()).toContain('Shared cards & invites')

    // Change daily reminder hour to 9:00 PM (21)
    const select = mounted.host.querySelector('select[aria-label="Daily reminder time"]') as HTMLSelectElement
    expect(select).not.toBeNull()
    expect(select.value).toBe('20')
    await act(async () => {
      select.value = '21'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await waitFor(() => updateNotificationPrefs.mock.calls.length === 1)
    expect(updateNotificationPrefs).toHaveBeenLastCalledWith({ reminderHour: 21 })

    // Switch Friend finished today to Specific friends -> reveals friend checkboxes
    const specificLabel = [...mounted.host.querySelectorAll('label')].find((el) => el.textContent?.includes('Specific friends'))
    const specificRadio = specificLabel?.querySelector('input[type="radio"]') as HTMLInputElement | null
    expect(specificRadio).not.toBeNull()
    await act(async () => {
      specificRadio!.click()
    })
    await waitFor(() => updateNotificationPrefs.mock.calls.length === 2)
    expect(updateNotificationPrefs).toHaveBeenLastCalledWith({ friendFinishedMode: 'selected' })

    const specificGroup = mounted.host.querySelector('[aria-label="Specific friends"]')
    expect(specificGroup).not.toBeNull()
    const firstFriendCheckbox = specificGroup!.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(firstFriendCheckbox).not.toBeNull()
    await act(async () => {
      firstFriendCheckbox.click()
    })
    await waitFor(() => updateNotificationPrefs.mock.calls.length === 3)
    expect(updateNotificationPrefs).toHaveBeenLastCalledWith({ friendFinishedIds: [10] })

    // Toggle Shared cards & invites
    const sharedLabel = [...mounted.host.querySelectorAll('label')].find((el) => el.textContent?.includes('Shared cards & invites'))
    const sharedCheckbox = sharedLabel?.querySelector('input[type="checkbox"]') as HTMLInputElement | null
    expect(sharedCheckbox).not.toBeNull()
    await act(async () => {
      sharedCheckbox!.click()
    })
    await waitFor(() => updateNotificationPrefs.mock.calls.length === 4)
    expect(updateNotificationPrefs).toHaveBeenLastCalledWith({ sharedCards: false })

    // Send test notification before enabling on this device prompts to enable first
    await mounted.click('Send test notification')
    await waitFor(() => mounted.text().includes('Enable notifications on this device first.'))
    expect(sendTestPush).not.toHaveBeenCalled()
  })

  it('shows the iOS Home Screen tip only on non-standalone iOS browsers', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      configurable: true,
    })
    Object.defineProperty(navigator, 'standalone', { value: false, configurable: true })

    const board = demoBoard(NOW)
    const { h: mounted } = await openSettings(board)
    await mounted.click('Notifications')
    expect(mounted.text()).toContain('On iPhone, tap Share → Add to Home Screen first to enable lock-screen notifications.')

    mounted.unmount()
    h = null

    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true })
    const { h: standaloneMounted } = await openSettings(board)
    await standaloneMounted.click('Notifications')
    expect(standaloneMounted.text()).not.toContain('Add to Home Screen first')
  })

  it('subscribes and unsubscribes via Notification + ServiceWorker PushManager + service API in real mode', async () => {
    const unsubscribeMock = vi.fn(async () => true)
    let activeSub: {
      endpoint: string
      toJSON: () => { endpoint: string; keys: { p256dh: string; auth: string } }
      unsubscribe: () => Promise<boolean>
    } | null = null

    const subscribeMock = vi.fn(async () => {
      activeSub = {
        endpoint: 'https://push.example.test/sub-1',
        toJSON: () => ({
          endpoint: 'https://push.example.test/sub-1',
          keys: { p256dh: 'p256dh_key', auth: 'auth_key' },
        }),
        unsubscribe: unsubscribeMock,
      }
      return activeSub
    })
    const getSubscriptionMock = vi.fn(async () => activeSub)
    const reg = {
      pushManager: {
        getSubscription: getSubscriptionMock,
        subscribe: subscribeMock,
      },
    }

    const requestPermission = vi.fn(async () => 'granted' as NotificationPermission)
    Object.defineProperty(globalThis, 'Notification', {
      value: { requestPermission, permission: 'default' },
      configurable: true,
      writable: true,
    })
    Object.defineProperty(window, 'PushManager', { value: function PushManager() {}, configurable: true, writable: true })
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        ready: Promise.resolve(reg),
        getRegistration: vi.fn(async () => reg),
      },
      configurable: true,
    })

    const subscribePush = vi.fn(async () => ({ ok: true as const }))
    const unsubscribePush = vi.fn(async () => ({ ok: true as const }))
    const getPushConfig = vi.fn(async () => ({ vapidPublicKey: 'AQID' }))

    const board = demoBoard(NOW)
    const { h: mounted } = await openSettings(board, (s) => {
      s.getNotificationPrefs = vi.fn(async () => ({ prefs: { ...DEFAULT_NOTIFICATION_PREFS }, subscribedCount: 0 }))
      s.getPushConfig = getPushConfig
      s.subscribePush = subscribePush
      s.unsubscribePush = unsubscribePush
    })

    await mounted.click('Notifications')
    await mounted.click('Enable notifications')
    await waitFor(() => subscribePush.mock.calls.length === 1)

    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(getPushConfig).toHaveBeenCalledTimes(1)
    expect(subscribeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userVisibleOnly: true,
        applicationServerKey: expect.any(Uint8Array),
      }),
    )
    expect(subscribePush).toHaveBeenCalledWith({
      endpoint: 'https://push.example.test/sub-1',
      keys: { p256dh: 'p256dh_key', auth: 'auth_key' },
    })
    await waitFor(() => mounted.text().includes('Disable on this device'))
    expect(mounted.text()).toMatch(/Notifications\s*On/)

    await mounted.click('Disable on this device')
    await waitFor(() => unsubscribePush.mock.calls.length === 1)
    expect(unsubscribeMock).toHaveBeenCalledTimes(1)
    expect(unsubscribePush).toHaveBeenCalledWith('https://push.example.test/sub-1')
    await waitFor(() => mounted.text().includes('Enable notifications'))
    expect(mounted.text()).toMatch(/Notifications\s*Off/)
  })

  it('wires ?friendsDemo=1 demo service in-memory for all push methods and toggles cleanly without PushManager', async () => {
    window.history.replaceState({}, '', '/?friendsDemo=1')
    delete (window as unknown as { PushManager?: unknown }).PushManager

    const p = await newPhone()
    const svc = createFriendsService({ store: p.store, tokens: p.tokens, now: () => NOW })

    const cfg = await svc.getPushConfig!()
    expect(cfg.vapidPublicKey).toBeTruthy()

    const init = await svc.getNotificationPrefs!()
    expect(init).toEqual({ prefs: DEFAULT_NOTIFICATION_PREFS, subscribedCount: 0 })

    const subRes = await svc.subscribePush!({
      endpoint: 'https://demo.push.local/device',
      keys: { p256dh: 'k1', auth: 'a1' },
    })
    expect(subRes).toEqual({ ok: true })

    const afterSub = await svc.getNotificationPrefs!()
    expect(afterSub?.subscribedCount).toBe(1)

    const upd = await svc.updateNotificationPrefs!({
      dailyReminder: false,
      reminderHour: 19,
      friendFinishedMode: 'selected',
      friendFinishedIds: [2, 3],
      buddyStreak: false,
      sharedCards: false,
    })
    expect(upd).toEqual({
      ok: true,
      prefs: {
        dailyReminder: false,
        reminderHour: 19,
        friendFinishedMode: 'selected',
        friendFinishedIds: [2, 3],
        buddyStreak: false,
        sharedCards: false,
      },
    })

    const testRes = await svc.sendTestPush!()
    expect(testRes).toEqual({ ok: true, sent: 1, failed: 0 })

    const unsubRes = await svc.unsubscribePush!('https://demo.push.local/device')
    expect(unsubRes).toEqual({ ok: true })
    expect((await svc.getNotificationPrefs!())?.subscribedCount).toBe(0)
  })

  it('keeps this device Off when another device is subscribed, then targets this device endpoint on test push', async () => {
    let activeSub: {
      endpoint: string
      toJSON: () => { endpoint: string; keys: { p256dh: string; auth: string } }
      unsubscribe: () => Promise<boolean>
    } | null = null

    const reg = {
      pushManager: {
        getSubscription: vi.fn(async () => activeSub),
        subscribe: vi.fn(async () => {
          activeSub = {
            endpoint: 'https://web.push.apple.com/QIPHONE123',
            toJSON: () => ({
              endpoint: 'https://web.push.apple.com/QIPHONE123',
              keys: { p256dh: 'iphone_p256dh', auth: 'iphone_auth' },
            }),
            unsubscribe: vi.fn(async () => true),
          }
          return activeSub
        }),
      },
    }

    Object.defineProperty(globalThis, 'Notification', {
      value: { requestPermission: vi.fn(async () => 'granted' as NotificationPermission), permission: 'default' },
      configurable: true,
      writable: true,
    })
    Object.defineProperty(window, 'PushManager', { value: function PushManager() {}, configurable: true, writable: true })
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { ready: Promise.resolve(reg), getRegistration: vi.fn(async () => reg) },
      configurable: true,
    })

    const sendTestPush = vi
      .fn()
      .mockResolvedValueOnce({ ok: true as const, sent: 1, failed: 0 })
      .mockResolvedValueOnce({ ok: true as const, sent: 0, failed: 1, failedStatuses: [403] })
    const subscribePush = vi.fn(async () => ({ ok: true as const }))

    const board = demoBoard(NOW)
    const { h: mounted } = await openSettings(board, (s) => {
      // Simulate Mac Chrome already subscribed in D1, while this iPhone has no local PushSubscription
      s.getNotificationPrefs = vi.fn(async () => ({ prefs: { ...DEFAULT_NOTIFICATION_PREFS }, subscribedCount: 1 }))
      s.getPushConfig = vi.fn(async () => ({ vapidPublicKey: 'AQID' }))
      s.subscribePush = subscribePush
      s.sendTestPush = sendTestPush
    })

    expect(mounted.text()).toMatch(/Notifications\s*Off/)
    await mounted.click('Notifications')
    expect(mounted.text()).toContain('Enable on this device')
    expect(mounted.text()).toContain('Notifications are on for 1 other device, not this device yet.')

    // Clicking test before enabling on this device does not send to another device
    await mounted.click('Send test notification')
    await waitFor(() => mounted.text().includes('Enable notifications on this device first.'))
    expect(sendTestPush).not.toHaveBeenCalled()

    // Enabling on this device registers its APNs endpoint, then test push targets that endpoint
    await mounted.click('Enable on this device')
    await waitFor(() => mounted.text().includes('Disable on this device'))
    expect(mounted.text()).toMatch(/Notifications\s*On/)

    await mounted.click('Send test notification')
    await waitFor(() => mounted.text().includes('Test notification sent'))
    expect(sendTestPush).toHaveBeenCalledWith('https://web.push.apple.com/QIPHONE123')

    // Surfaces push service HTTP error code if delivery fails
    await mounted.click('Send test notification')
    await waitFor(() => mounted.text().includes('Test notification failed (HTTP 403)'))
  })
})
