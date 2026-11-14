import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { groupLink, joinLink, parseAnyLink } from '@shared/friendGroups'
import { parseFriendLink } from '@shared/friendsList'
import { friendLink, landingCopy } from '../../pwa/friendLink'
import { groupShareText, joinShareText, ownSiteLink } from './parts'

/** YAZ-5085 with 5- (YAZ-5087): the link that "Share my link" sends, and what 4E2's paste box reads back. */
const ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

describe('the friend link of 5- and the paste box of 4E2', () => {
  it('the share sheet gets the landing page of the site the app runs on', () => {
    expect(ownSiteLink(`https://notecard.yaseenarshad.com/friend#${ID}`, 'https://preview.notecard.yaseenarshad.com')).toBe(
      `https://preview.notecard.yaseenarshad.com/friend#${ID}`,
    )
    expect(ownSiteLink(`https://notecard.yaseenarshad.com/friend#${ID}`, 'https://notecard.yaseenarshad.com')).toBe(
      `https://notecard.yaseenarshad.com/friend#${ID}`,
    )
    // Not on a site (a test, a file): 4E2's link as it is.
    expect(ownSiteLink(`https://notecard.yaseenarshad.com/friend#${ID}`, 'null')).toBe(`https://notecard.yaseenarshad.com/friend#${ID}`)
  })

  it("4E2's paste reads each shape that 5- makes: the stable site, the preview, the code alone", () => {
    for (const text of [
      friendLink('https://notecard.yaseenarshad.com', ID),
      friendLink('https://preview.notecard.yaseenarshad.com', ID),
      ID,
      `Add me: ${friendLink('https://notecard.yaseenarshad.com', ID)}`,
    ]) {
      expect(parseFriendLink(text)).toEqual({ kind: 'ok', id: ID })
      expect(['friend', 'id']).toContain(parseAnyLink(text).kind)
    }
  })

  it('YAZ-5263: a group or join link names the site the app runs on, and its words tell the true step', () => {
    const preview = 'https://preview.notecard.yaseenarshad.com'
    const group = ownSiteLink(groupLink(ID), preview)
    expect(group).toBe(`${preview}/group#${ID}`)
    const join = ownSiteLink(joinLink(ID, ID), preview)
    expect(join.startsWith(`${preview}/join#`)).toBe(true)
    const g = groupShareText('Study group', group)
    const j = joinShareText('Study group', join)
    for (const t of [g, j]) {
      // YAZ-5290: the link opens a landing page with the code and Copy (as /friend), so the words say that step.
      expect(t.text).toContain('Open this link, copy the code, then paste it in the app.')
      expect(t.text).not.toContain('whole message')
    }
    // The paste box reads the whole message.
    expect(parseAnyLink(`${g.text} ${g.url}`)).toEqual({ kind: 'group', id: ID })
    expect(parseAnyLink(`${j.text} ${j.url}`)).toEqual({ kind: 'join', group: ID, pointer: ID })
  })

  it('YAZ-5290: the paste box reads each kind of link from the preview, and the code each landing page copies', () => {
    const preview = 'https://preview.notecard.yaseenarshad.com'
    expect(parseAnyLink(ownSiteLink(groupLink(ID), preview))).toEqual({ kind: 'group', id: ID })
    expect(parseAnyLink(ownSiteLink(joinLink(ID, ID), preview))).toEqual({ kind: 'join', group: ID, pointer: ID })
    expect(parseAnyLink(ownSiteLink(friendLink('https://notecard.yaseenarshad.com', ID), preview))).toEqual({ kind: 'friend', id: ID })
    // What each landing page copies (landingCopy): friend and group copy the code, a join copies its link.
    expect(['friend', 'id']).toContain(parseAnyLink(landingCopy({ kind: 'friend', code: ID }, preview)).kind)
    expect(['group', 'id']).toContain(parseAnyLink(landingCopy({ kind: 'group', code: ID }, preview)).kind)
    expect(parseAnyLink(landingCopy({ kind: 'join', code: `${ID}-${ID}` }, preview))).toEqual({ kind: 'join', group: ID, pointer: ID })
  })

  it('YAZ-5291: the share sheet never gets a fixed host; no app file of mobile/src names one', () => {
    const preview = 'https://preview.notecard.yaseenarshad.com'
    expect(ownSiteLink(groupLink(ID), preview).startsWith(`${preview}/group#`)).toBe(true)
    expect(ownSiteLink(joinLink(ID, ID), preview).startsWith(`${preview}/join#`)).toBe(true)
    const src = fileURLToPath(new URL('../..', import.meta.url))
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
    const fixed = walk(src).filter(
      (f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$|testing\.ts$|\/dev\//.test(f) && /notecards?\.yaseenarshad\.com/.test(readFileSync(f, 'utf8')),
    )
    expect(fixed.map((f) => f.slice(src.length))).toEqual([])
  })

  it('the address is notecard.yaseenarshad.com (Yaseen, 2026-11-14); a link shared before that, on notecards.yaseenarshad.com, still pastes', () => {
    for (const old of [`https://notecards.yaseenarshad.com/friend#${ID}`, `https://preview.notecards.yaseenarshad.com/friend#${ID}`]) {
      expect(parseFriendLink(old)).toEqual({ kind: 'ok', id: ID })
      expect(parseAnyLink(old)).toEqual({ kind: 'friend', id: ID })
    }
    expect(parseAnyLink(`https://preview.notecards.yaseenarshad.com/group#${ID}`)).toEqual({ kind: 'group', id: ID })
    expect(parseAnyLink(`https://preview.notecard.yaseenarshad.com/join#${ID}-${ID}`)).toEqual({ kind: 'join', group: ID, pointer: ID })
    expect(groupLink(ID)).toBe(`https://notecard.yaseenarshad.com/group#${ID}`)
  })
})
