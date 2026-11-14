import { describe, expect, it } from 'vitest'
import { groupLink, joinLink, parseAnyLink } from '@shared/friendGroups'
import { parseFriendLink } from '@shared/friendsList'
import { friendLink } from '../../pwa/friendLink'
import { groupShareText, joinShareText, ownSiteLink } from './parts'

/** YAZ-5085 with 5- (YAZ-5087): the link that "Share my link" sends, and what 4E2's paste box reads back. */
const ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

describe('the friend link of 5- and the paste box of 4E2', () => {
  it('the share sheet gets the landing page of the site the app runs on', () => {
    expect(ownSiteLink(`https://notecards.yaseenarshad.com/friend#${ID}`, 'https://preview.notecards.yaseenarshad.com')).toBe(
      `https://preview.notecards.yaseenarshad.com/friend#${ID}`,
    )
    expect(ownSiteLink(`https://notecards.yaseenarshad.com/friend#${ID}`, 'https://notecards.yaseenarshad.com')).toBe(
      `https://notecards.yaseenarshad.com/friend#${ID}`,
    )
    // Not on a site (a test, a file): 4E2's link as it is.
    expect(ownSiteLink(`https://notecards.yaseenarshad.com/friend#${ID}`, 'null')).toBe(`https://notecards.yaseenarshad.com/friend#${ID}`)
  })

  it("4E2's paste reads each shape that 5- makes: the stable site, the preview, the code alone", () => {
    for (const text of [
      friendLink('https://notecards.yaseenarshad.com', ID),
      friendLink('https://preview.notecards.yaseenarshad.com', ID),
      ID,
      `Add me: ${friendLink('https://notecards.yaseenarshad.com', ID)}`,
    ]) {
      expect(parseFriendLink(text)).toEqual({ kind: 'ok', id: ID })
      expect(['friend', 'id']).toContain(parseAnyLink(text).kind)
    }
  })

  it('YAZ-5263: a group or join link names the site the app runs on, and its words tell the true step', () => {
    const preview = 'https://preview.notecards.yaseenarshad.com'
    const group = ownSiteLink(groupLink(ID), preview)
    expect(group).toBe(`${preview}/group#${ID}`)
    const join = ownSiteLink(joinLink(ID, ID), preview)
    expect(join.startsWith(`${preview}/join#`)).toBe(true)
    const g = groupShareText('Study group', group)
    const j = joinShareText('Study group', join)
    for (const t of [g, j]) {
      // No landing page shows a code for these links yet: the words never say "copy the code".
      expect(t.text).not.toMatch(/copy the code/i)
      expect(t.text).toContain('Copy this whole message')
    }
    // The paste box reads the whole message.
    expect(parseAnyLink(`${g.text} ${g.url}`)).toEqual({ kind: 'group', id: ID })
    expect(parseAnyLink(`${j.text} ${j.url}`)).toEqual({ kind: 'join', group: ID, pointer: ID })
  })
})
