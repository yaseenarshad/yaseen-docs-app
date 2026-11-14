import type { FriendRead } from '@shared/friendGists'
import type { Unavailable } from '../list'

/**
 * Groups run by an admin (decision 18; round 14: remove, leave, delete), as the screens use them. 4E3 (YAZ-5084) builds
 * the logic: `list.groups` on 4E2's `FriendsList`, with the types of `shared/friendGroups.ts` (its comment "For 4E4: the
 * groups functions"). These types are a structural copy of the parts the screens read, so 4E3's `list.groups` fits as it
 * is (`service.ts` takes it when it is there). Until 4E3 lands on the integration branch, the screens run on a fake.
 */
export type GroupDailyMark = 'not-started' | 'started' | 'done'

export interface GroupMemberRow {
  login: string
  name: string
  pointer: string
  me: boolean
  admin: boolean
  /** `left`: their pointer is gone (they left); the admin can remove the row. */
  state: 'ok' | 'left' | 'no-numbers' | 'newer-app' | 'unreadable' | 'offline'
  read: FriendRead | null
  label: string | null
  mark: GroupDailyMark | null
}

export type GroupView =
  | { kind: 'ok'; group: string; name: string; admin: string; iAmAdmin: boolean; members: GroupMemberRow[]; streak: number; firstSeen: boolean }
  | { kind: 'waiting'; group: string; name: string; sendToAdmin: string }
  | { kind: 'removed'; group: string; name: string }
  | { kind: 'gone'; group: string; name: string }
  | { kind: 'needs-repair'; group: string; name: string }
  | { kind: 'newer-app'; group: string; name: string }
  | { kind: 'offline'; group: string; name: string }
  | { kind: 'not-found' }

type Failure = { kind: 'offline' } | { kind: 'rate-limited'; retryAt?: number | null } | { kind: 'refused' } | { kind: 'unauthorized' } | { kind: 'failed' } | { kind: 'not-found' }

export type JoinResult =
  | { kind: 'joined'; name: string; group: string; sendToAdmin: string }
  | { kind: 'already'; name: string; sendToAdmin: string | null }
  | { kind: 'own-group'; name: string }
  | { kind: 'is-friend-link' | 'is-join-request' | 'not-found' | 'not-a-group-link' | 'needs-repair' | 'newer-app' | 'empty' | 'other-app' | 'not-a-link' }
  | Failure

export type JoinRequest =
  | { kind: 'request'; group: string; groupName: string; pointer: string; login: string; name: string }
  | { kind: 'already-member'; name: string }
  | { kind: 'not-your-group' | 'not-a-join-link' | 'not-found' | 'needs-repair' | 'newer-app' }
  | Failure

export type GroupChange = { kind: 'done' } | { kind: 'not-admin' | 'not-found' | 'not-a-member' | 'not-a-join-link' | 'needs-repair' | 'newer-app' } | Failure

export type LeaveOutcome = { kind: 'done' } | { kind: 'paused'; why: string; retryAt: number | null } | { kind: 'admin-cannot-leave' } | { kind: 'not-found' }

export type CreateOutcome = { kind: 'ok'; group: string; link: string; title: string; text: string } | { kind: 'bad-name' }

export interface GroupsPort {
  create(name: string): Promise<CreateOutcome | Unavailable>
  join(text: string): Promise<JoinResult | Unavailable>
  request(text: string): Promise<JoinRequest | Unavailable>
  add(group: string, joinText: string): Promise<GroupChange | Unavailable>
  remove(group: string, pointer: string): Promise<GroupChange | Unavailable>
  leave(group: string): Promise<LeaveOutcome | Unavailable>
  delete(group: string): Promise<LeaveOutcome | Unavailable>
  read(group: string): Promise<GroupView | Unavailable>
  all(): Promise<GroupView[] | Unavailable>
}

/** A group's name as typed: one line, at most 60 letters (4E3's `GROUP_NAME_MAX`). */
export const GROUP_NAME_MAX = 60

/** Plain words for a group that is not `ok` (round 14). */
export function groupMessage(view: GroupView): string | null {
  switch (view.kind) {
    case 'waiting':
      return 'Waiting for the admin to add you. Send them your join link.'
    case 'removed':
      return "You're no longer in this group."
    case 'gone':
      return 'This group is gone.'
    case 'needs-repair':
      return "This group's file cannot be read. Ask the admin to fix it."
    case 'newer-app':
      return 'This group needs a newer app. Update Notecards.'
    case 'offline':
      return 'No connection. The group shows when you are online.'
    default:
      return null
  }
}

/** Plain words for a paste of a group link or of a join link. */
export function joinWords(result: JoinResult | JoinRequest | GroupChange): string {
  switch (result.kind) {
    case 'joined':
      return `You asked to join ${result.name}. Send your join link to the admin, so they can add you.`
    case 'already':
      return `You are already in ${result.name}.`
    case 'own-group':
      return `You run ${result.name}. Send its link to the people you want in it.`
    case 'request':
      return `${result.name} asks to join ${result.groupName}.`
    case 'already-member':
      return `${result.name} is already in the group.`
    case 'not-your-group':
      return 'That join link is for a group that another person runs.'
    case 'done':
      return 'Done.'
    case 'not-admin':
      return 'Only the admin can do that.'
    case 'not-found':
      return 'That link does not work any more. Ask for a new one.'
    case 'offline':
      return 'No connection. Try again when you are online.'
    case 'rate-limited':
      return 'GitHub asks the app to wait. Try again in a few minutes.'
    case 'refused':
      return 'Friends needs the Gists permission on your token.'
    case 'needs-repair':
      return "The group's file cannot be read. Nothing was changed."
    case 'newer-app':
      return 'This link needs a newer app. Update Notecards.'
    default:
      return 'That is not a Notecards link. Ask for the link again.'
  }
}
