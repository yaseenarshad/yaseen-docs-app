import type { GroupChange, JoinRequest } from '@shared/friendGroups'
import type { FriendsGroups } from '../list'

/**
 * Groups run by an admin (decision 18; round 14: remove, leave, delete), from 4E3 (YAZ-5084): `list.groups` on 4E2's
 * list, the types and the words of `shared/friendGroups.ts` (`joinMessage`, `groupViewMessage`). The screens draw them.
 */
export type { GroupChange, GroupMemberRow, GroupView, JoinRequest, JoinResult } from '@shared/friendGroups'
export { GROUP_NAME_MAX, groupLink, groupViewMessage, joinMessage } from '@shared/friendGroups'
export type GroupsPort = FriendsGroups

/**
 * Words for the admin's side of a join, which 4E3 gives no words for: a join request (`request`) and a change of the
 * group file (`add`, `remove`). The words of a join (`JoinResult`) are 4E3's `joinMessage`.
 */
export function adminWords(result: JoinRequest | GroupChange): string {
  switch (result.kind) {
    case 'request':
      return `${result.name} asks to join ${result.groupName}.`
    case 'already-member':
      return `${result.name} is already in the group.`
    case 'not-your-group':
      return 'That join link is for a group that another person runs.'
    case 'not-a-join-link':
      return 'That is not a Notecards join link. Ask the person to send it again.'
    case 'done':
      return 'Done.'
    case 'not-admin':
      return 'Only the admin can do that.'
    case 'not-a-member':
      return 'That person is not in the group now.'
    case 'not-found':
      return 'That link does not work any more. Ask for a new one.'
    case 'needs-repair':
      return "The group's file cannot be read. Nothing was changed."
    case 'newer-app':
      return 'This needs a newer Notecards. Update this app.'
    case 'offline':
      return 'No connection. Try again when you are online.'
    case 'rate-limited':
      return 'GitHub asks the app to wait. Try again in a few minutes.'
    case 'refused':
      return 'Friends needs the Gists permission on your token.'
    case 'unauthorized':
      return 'Sign in again, then try again.'
    default:
      return 'Something went wrong. Try again.'
  }
}
