import { landingCodeFrom, landingCopy, type LandingKind } from './friendLink'

/**
 * The landing page of a shared link (`/friend#…`, `/group#…`, `/join#…`; round 10, item 7; YAZ-5087, YAZ-5290). A link
 * opens in Safari, not in the Home Screen app (iOS has no link capture for a web app). This page shows the code and
 * copies it. It reads the code from the part after `#` ONLY, which no browser sends to a server, and it makes no
 * network call of its own. Every text goes in as text (`textContent`, `value`), never as HTML.
 */

const WORDS: Record<LandingKind, { title: string; lead: string; label: string; missing: string; paste: string }> = {
  friend: {
    title: 'A friend sent you a Notecard link',
    lead: 'Notecard is the phone app of Yaseen Docs. You review your cards with it. Your friends see your review numbers. They never see your cards.',
    label: "Your friend's code",
    missing: 'This link has no friend code. Ask your friend to send the link again.',
    paste: "Paste a friend's link",
  },
  group: {
    title: 'You are invited to a Notecard group',
    lead: 'Notecard is the phone app of Yaseen Docs. You review your cards with it. The people in a group see each other’s review numbers. They never see your cards.',
    label: "The group's code",
    missing: 'This link has no group code. Ask for the group link again.',
    paste: "Paste a friend's link",
  },
  join: {
    title: 'Someone asks to join your Notecard group',
    lead: 'You are the admin of a Notecard group. Add this person to the group in the app.',
    label: 'The join link',
    missing: 'This link has no join code. Ask the person to send the link again.',
    paste: "Paste a friend's link",
  },
}

const landing = landingCodeFrom(location.pathname, location.hash)
const words = WORDS[landing.kind]
const byId = (id: string) => document.getElementById(id)!
const show = (id: string) => byId(id).removeAttribute('hidden')

document.title = words.title
byId('title').textContent = words.title
byId('lead').textContent = words.lead
byId('label').textContent = words.label
for (const el of document.querySelectorAll('.paste-name')) el.textContent = words.paste

if (landing.code === null) {
  byId('no-code-text').textContent = words.missing
  show('no-code')
} else {
  show('has-code')
  const copy = landingCopy({ kind: landing.kind, code: landing.code }, location.origin)
  const field = byId('code') as HTMLInputElement
  const said = byId('copied')
  field.value = copy
  byId('copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(copy)
      said.textContent = 'Copied. Now open Notecard and tap Paste.'
    } catch {
      // No clipboard access: select the code, so one tap on "Copy" in the iOS menu copies it.
      field.focus()
      field.select()
      said.textContent = 'Tap Copy in the menu above the code.'
    }
  })
}
