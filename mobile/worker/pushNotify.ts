/**
 * Web Push notification orchestration: per-user delivery with 404/410 pruning,
 * friend-finished & buddy-streak triggers, shared-card / invite triggers, and hourly daily reminders.
 */
import type { FriendFinishedMode, NotificationPrefs } from '../../shared/friendsApi'
import { computeBuddyStreak } from '../../shared/friendsBoard'
import { isTimeZone, type FriendStats } from '../../shared/friendStatsFormat'
import type { D1Database } from './d1Types'
import { sendWebPush, type WebPushEnv, type WebPushPayload } from './webPush'

export interface PushEnv extends WebPushEnv {
  FRIENDS_DB?: D1Database
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>

export const DEFAULT_REMINDER_ZONE = 'America/Phoenix'

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  dailyReminder: true,
  reminderHour: 20,
  friendFinishedMode: 'all',
  friendFinishedIds: [],
  buddyStreak: true,
  sharedCards: true,
}

export function parseIdList(raw: unknown): number[] {
  if (typeof raw !== 'string') return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0)
  } catch {
    return []
  }
}

export function parseNotificationPrefsRow(row: Record<string, unknown> | null | undefined): NotificationPrefs {
  if (!row) return { ...DEFAULT_NOTIFICATION_PREFS, friendFinishedIds: [] }
  const modeRaw = String(row.friend_finished_mode ?? 'all')
  const friendFinishedMode: FriendFinishedMode =
    modeRaw === 'off' || modeRaw === 'all' || modeRaw === 'selected' ? modeRaw : 'all'
  const hourRaw = Number(row.reminder_hour ?? 20)
  const reminderHour = Number.isInteger(hourRaw) && hourRaw >= 0 && hourRaw <= 23 ? hourRaw : 20
  return {
    dailyReminder: Number(row.daily_reminder ?? 1) === 1,
    reminderHour,
    friendFinishedMode,
    friendFinishedIds: parseIdList(row.friend_finished_ids_json),
    buddyStreak: Number(row.buddy_streak ?? 1) === 1,
    sharedCards: Number(row.shared_cards ?? 1) === 1,
  }
}

function safeParseStats(raw: unknown): FriendStats | null {
  if (typeof raw !== 'string' || !raw) return null
  try {
    const parsed = JSON.parse(raw) as FriendStats
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.days) || !parsed.totals) return null
    return parsed
  } catch {
    return null
  }
}

/** Sends `payload` to all registered push subscriptions for `userId` and prunes any 404/410 subscriptions. */
export async function notifyUser(
  env: WebPushEnv,
  db: D1Database,
  userId: number,
  payload: WebPushPayload,
  fetchFn: Fetch = (u, init) => globalThis.fetch(u, init),
  nowMs: number = Date.now(),
): Promise<{ sent: number; failed: number }> {
  if (!env.VAPID_PUBLIC_KEY?.trim() || !env.VAPID_PRIVATE_KEY?.trim()) {
    return { sent: 0, failed: 0 }
  }
  const rows = await db
    .prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?')
    .bind(userId)
    .all<{ id: string; endpoint: string; p256dh: string; auth: string }>()

  let sent = 0
  let failed = 0
  const goneIds: string[] = []

  for (const row of rows.results) {
    const res = await sendWebPush(
      env,
      {
        endpoint: String(row.endpoint),
        keys: { p256dh: String(row.p256dh), auth: String(row.auth) },
      },
      payload,
      fetchFn,
      nowMs,
    )
    if (res.ok) {
      sent++
    } else {
      failed++
      if (res.gone) goneIds.push(String(row.id))
    }
  }

  if (goneIds.length > 0) {
    await db.batch(goneIds.map((id) => db.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(id)))
  }

  return { sent, failed }
}

/**
 * Checks if `me`'s today transitioned from `done !== true` to `done === true` with `cards > 0`,
 * and notifies friends according to their buddy-streak / friend-finished preferences.
 */
export async function notifyFriendsOnDoneTransition(
  env: WebPushEnv,
  db: D1Database,
  meId: number,
  meName: string,
  prevStats: FriendStats | null,
  nextStats: FriendStats,
  nowMs: number = Date.now(),
  fetchFn: Fetch = (u, init) => globalThis.fetch(u, init),
): Promise<void> {
  if (!env.VAPID_PUBLIC_KEY?.trim() || !env.VAPID_PRIVATE_KEY?.trim()) return
  const todayRow = nextStats.days[0]
  if (!todayRow || todayRow.done !== true || todayRow.cards <= 0) return

  const prevToday = prevStats?.days.find((d) => d.day === todayRow.day)
  if (prevToday?.done === true) return

  const friendRows = await db
    .prepare(
      `SELECT u.github_id, u.stats_json,
              COALESCE(np.buddy_streak, 1) AS buddy_streak,
              COALESCE(np.friend_finished_mode, 'all') AS friend_finished_mode,
              COALESCE(np.friend_finished_ids_json, '[]') AS friend_finished_ids_json
       FROM friendships f
       JOIN users u ON u.github_id = CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END
       LEFT JOIN notification_prefs np ON np.user_id = u.github_id
       WHERE (f.user_a = ? OR f.user_b = ?)
         AND EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.user_id = u.github_id)`,
    )
    .bind(meId, meId, meId)
    .all<Record<string, unknown>>()

  for (const row of friendRows.results) {
    const friendId = Number(row.github_id)
    const fStats = safeParseStats(row.stats_json)
    const buddyStreakEnabled = Number(row.buddy_streak ?? 1) === 1
    const buddyStreak = computeBuddyStreak(nextStats.days, fStats?.days, nowMs)
    const friendDoneToday = Boolean(fStats?.days.find((d) => d.day === todayRow.day)?.done)

    if (buddyStreakEnabled && buddyStreak > 0) {
      const body = friendDoneToday
        ? `🎉 You & ${meName} hit a ${buddyStreak}-day buddy streak!`
        : `${meName} finished today — finish yours to hit a ${buddyStreak + 1}-day buddy streak!`
      await notifyUser(
        env,
        db,
        friendId,
        {
          title: 'Buddy Streak',
          body,
          url: '/friends',
          tag: `buddy-streak-${meId}-${todayRow.day}`,
        },
        fetchFn,
        nowMs,
      )
      continue
    }

    const mode = String(row.friend_finished_mode ?? 'all')
    const selectedIds = parseIdList(row.friend_finished_ids_json)
    if (mode === 'all' || (mode === 'selected' && selectedIds.includes(meId))) {
      await notifyUser(
        env,
        db,
        friendId,
        {
          title: 'Friend Finished',
          body: `${meName} just finished due cards (${todayRow.cards} cards)`,
          url: '/friends',
          tag: `friend-done-${meId}-${todayRow.day}`,
        },
        fetchFn,
        nowMs,
      )
    }
  }
}

/** Notifies recipients of newly shared cards/folders if they have `shared_cards = 1`. */
export async function notifySharedCardsRecipients(
  env: WebPushEnv,
  db: D1Database,
  recipientIds: number[],
  meName: string,
  folderName: string | null,
  cardTitles: string[],
  fetchFn: Fetch = (u, init) => globalThis.fetch(u, init),
  nowMs: number = Date.now(),
): Promise<void> {
  if (!env.VAPID_PUBLIC_KEY?.trim() || !env.VAPID_PRIVATE_KEY?.trim()) return
  const uniqueIds = [...new Set(recipientIds)]
  if (uniqueIds.length === 0) return

  const placeholders = uniqueIds.map(() => '?').join(', ')
  const eligible = await db
    .prepare(
      `SELECT u.github_id
       FROM users u
       LEFT JOIN notification_prefs np ON np.user_id = u.github_id
       WHERE u.github_id IN (${placeholders})
         AND COALESCE(np.shared_cards, 1) = 1
         AND EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.user_id = u.github_id)`,
    )
    .bind(...uniqueIds)
    .all<{ github_id: number }>()

  const count = cardTitles.length
  const title = folderName ? 'Shared Folder' : count === 1 ? 'Shared Card' : 'Shared Cards'
  const body = folderName
    ? `${meName} shared folder "${folderName}" (${count} ${count === 1 ? 'card' : 'cards'})`
    : count === 1
      ? `${meName} shared "${cardTitles[0]}"`
      : `${meName} shared ${count} cards`

  for (const row of eligible.results) {
    await notifyUser(
      env,
      db,
      Number(row.github_id),
      { title, body, url: '/friends', tag: 'shared-cards' },
      fetchFn,
      nowMs,
    )
  }
}

/** Notifies the creator of a friend invite when someone accepts it (if `shared_cards = 1`). */
export async function notifyFriendInviteAccepted(
  env: WebPushEnv,
  db: D1Database,
  inviterId: number,
  acceptorId: number,
  acceptorName: string,
  fetchFn: Fetch = (u, init) => globalThis.fetch(u, init),
  nowMs: number = Date.now(),
): Promise<void> {
  if (!env.VAPID_PUBLIC_KEY?.trim() || !env.VAPID_PRIVATE_KEY?.trim()) return
  const pref = await db
    .prepare('SELECT shared_cards FROM notification_prefs WHERE user_id = ?')
    .bind(inviterId)
    .first<{ shared_cards: number }>()
  if (pref && Number(pref.shared_cards) !== 1) return

  await notifyUser(
    env,
    db,
    inviterId,
    {
      title: 'New Friend',
      body: `${acceptorName} accepted your friend invite`,
      url: '/friends',
      tag: `friend-accept-${acceptorId}`,
    },
    fetchFn,
    nowMs,
  )
}

/** Returns local `YYYY-MM-DD` and 0–23 hour for `nowMs` in `zone` (falling back to `America/Phoenix`). */
export function localDateAndHourIn(nowMs: number, zone: string | null | undefined): { localDate: string; localHour: number } {
  const validZone = zone && isTimeZone(zone) ? zone : DEFAULT_REMINDER_ZONE
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: validZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
  }).formatToParts(nowMs)

  let year = '1970'
  let month = '01'
  let day = '01'
  let hour = 0
  for (const p of parts) {
    if (p.type === 'year') year = p.value
    else if (p.type === 'month') month = p.value
    else if (p.type === 'day') day = p.value
    else if (p.type === 'hour') hour = Number(p.value) % 24
  }
  return { localDate: `${year}-${month}-${day}`, localHour: hour }
}

/**
 * Hourly cron job: sends daily due-card reminders to users whose local hour matches `reminder_hour`,
 * who haven't been reminded today, haven't finished today's due cards, and have `dueLeft > 0`.
 */
export async function runDailyReminders(
  env: PushEnv,
  nowMs: number = Date.now(),
  fetchFn: Fetch = (u, init) => globalThis.fetch(u, init),
): Promise<{ checked: number; sent: number; failed: number }> {
  const db = env.FRIENDS_DB
  if (!db || !env.VAPID_PUBLIC_KEY?.trim() || !env.VAPID_PRIVATE_KEY?.trim()) {
    return { checked: 0, sent: 0, failed: 0 }
  }

  const rows = await db
    .prepare(
      `SELECT u.github_id, u.zone, u.stats_json,
              COALESCE(np.reminder_hour, 20) AS reminder_hour,
              np.last_reminder_day
       FROM users u
       LEFT JOIN notification_prefs np ON np.user_id = u.github_id
       WHERE COALESCE(np.daily_reminder, 1) = 1
         AND EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.user_id = u.github_id)`,
    )
    .all<Record<string, unknown>>()

  let checked = 0
  let sent = 0
  let failed = 0
  const nowIso = new Date(nowMs).toISOString()

  for (const row of rows.results) {
    checked++
    const userId = Number(row.github_id)
    const reminderHour = Number(row.reminder_hour ?? 20)
    const lastReminderDay = row.last_reminder_day ? String(row.last_reminder_day) : null
    const { localDate, localHour } = localDateAndHourIn(nowMs, row.zone ? String(row.zone) : null)

    if (localHour !== reminderHour) continue
    if (lastReminderDay === localDate) continue

    const stats = safeParseStats(row.stats_json)
    if (!stats) continue

    const todayRow = stats.days.find((d) => d.day === localDate)
    if (todayRow?.done === true) continue

    const dueLeft = Number(stats.totals?.dueLeft ?? 0)
    if (dueLeft <= 0) continue

    const streak = Number(stats.totals?.streak ?? 0)
    const body = `${dueLeft} due cards left today — keep your ${streak}-day streak going.`
    const res = await notifyUser(
      env,
      db,
      userId,
      {
        title: 'Daily Reminder',
        body,
        url: '/',
        tag: `daily-reminder-${localDate}`,
      },
      fetchFn,
      nowMs,
    )
    sent += res.sent
    failed += res.failed

    if (res.sent > 0) {
      await db
        .prepare(
          `INSERT INTO notification_prefs (user_id, last_reminder_day, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             last_reminder_day = excluded.last_reminder_day,
             updated_at = excluded.updated_at`,
        )
        .bind(userId, localDate, nowIso)
        .run()
    }
  }

  return { checked, sent, failed }
}
