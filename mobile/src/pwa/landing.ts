import { FRIENDS_ENABLED } from '@shared/features'
import { startAppearance } from '../settings/appearance'
import { savePendingInvite } from '../store/pendingInvitePref'
import { landingCodeFrom, landingCopy, type LandingKind } from './friendLink'
import { HOME_SCREEN, THREE_LINES, safariLine, splitThreeLines } from './homeScreen'

/**
 * The landing page of a shared link (`/friend#…`, `/group#…`, `/join#…`; round 10, item 7). A link
 * opens in Safari, not in the Home Screen app (iOS has no link capture for a web app). This page shows the code and
 * copies it. It reads the code from the part after `#` ONLY, which no browser sends to a server, and it makes no
 * network call of its own. Every text goes in as text (`textContent`, `value`), never as HTML.
 */

const WORDS: Record<LandingKind, { title: string; lead: string; label: string; missing: string; paste: string }> = {
  friend: {
    title: 'A friend sent you a Yaseen Docs link',
    lead: 'Yaseen Docs puts your notes on your phone. You review your cards with it. Your friends see your review numbers. They never see your cards.',
    label: "Your friend's code",
    missing: 'This link has no friend code. Ask your friend to send the link again.',
    paste: "Paste a friend's link",
  },
  group: {
    title: 'You are invited to a Yaseen Docs group',
    lead: 'Yaseen Docs puts your notes on your phone. You review your cards with it. The people in a group see each other’s review numbers. They never see your cards.',
    label: "The group's code",
    missing: 'This link has no group code. Ask for the group link again.',
    paste: "Paste a friend's link",
  },
  join: {
    title: 'Someone asks to join your Yaseen Docs group',
    lead: 'You are the admin of a Yaseen Docs group. Add this person to the group in the app.',
    label: 'The join link',
    missing: 'This link has no join code. Ask the person to send the link again.',
    paste: "Paste a friend's link",
  },
}

/** YAZ-5652: with Friends off (`shared/features.ts`), every shared link opens this short note in place of the code. */
export const FRIENDS_OFF = {
  title: 'Friends is off for now',
  lead: 'Yaseen Docs has Friends turned off for now, so this link does nothing yet. Your notes and your cards work as before.',
  open: 'Open Yaseen Docs',
} as const

// YAZ-5565: the app's stylesheet hangs dark on `data-scheme`: this page takes the same choice.
startAppearance()

if (FRIENDS_ENABLED) showLanding()
else showFriendsOff()

/** The page with no code, no steps and no paste: the title, one line, and the way into the app. */
function showFriendsOff(): void {
  document.title = FRIENDS_OFF.title
  const main = document.querySelector('main')!
  const icon = main.querySelector('.landing__icon')
  const title = document.createElement('h1')
  title.className = 'title'
  title.textContent = FRIENDS_OFF.title
  const lead = document.createElement('p')
  lead.className = 'lead'
  lead.textContent = FRIENDS_OFF.lead
  const open = document.createElement('a')
  open.className = 'btn btn--primary'
  open.href = '/'
  open.textContent = FRIENDS_OFF.open
  main.replaceChildren(...(icon ? [icon] : []), title, lead, open)
}

/** Friends on: the code of the link, its Copy, and the steps. */
function showLanding(): void {
  const landing = landingCodeFrom(location.pathname, location.hash)
  // YAZ-6218: also accept 6–32 char alphanumeric D1 invite codes on /friend and /group.
  let code = landing.code
  if (code === null && (landing.kind === 'friend' || landing.kind === 'group')) {
    let raw = ''
    try {
      raw = decodeURIComponent(location.hash.replace(/^#/, '')).trim()
    } catch {
      raw = ''
    }
    if (/^[a-z0-9]{6,32}$/i.test(raw)) code = raw
  }
  const words = WORDS[landing.kind]
  const byId = (id: string) => document.getElementById(id)!
  const show = (id: string) => byId(id).removeAttribute('hidden')

  document.title = words.title
  byId('title').textContent = words.title
  byId('lead').textContent = words.lead
  byId('label').textContent = words.label
  for (const el of document.querySelectorAll('.paste-name')) el.textContent = words.paste
  // The Home Screen steps: the app's own words (`homeScreen.ts`, one source). YAZ-5443: the ☰ has a spoken name.
  byId('add-steps').replaceChildren(
    ...splitThreeLines(`${safariLine()} ${HOME_SCREEN.olderSafari}`).flatMap((part, i) => {
      if (i === 0) return [part]
      const glyph = document.createElement('span')
      glyph.setAttribute('role', 'img')
      glyph.setAttribute('aria-label', THREE_LINES.name)
      glyph.textContent = THREE_LINES.glyph
      return [glyph, part]
    }),
  )

  if (code === null) {
    byId('no-code-text').textContent = words.missing
    show('no-code')
  } else {
    show('has-code')
    const copy = landingCopy({ kind: landing.kind, code }, location.origin)
    const field = byId('code') as HTMLInputElement
    const said = byId('copied')
    field.value = copy
    const macBtn = document.getElementById('open-mac') as HTMLAnchorElement | null
    if (landing.kind === 'friend' || landing.kind === 'group') {
      savePendingInvite({ kind: landing.kind, code, url: copy })
    }
    if (macBtn !== null && (landing.kind === 'friend' || landing.kind === 'group')) {
      macBtn.href = `yaseendocs://${landing.kind}#${code}`
      macBtn.removeAttribute('hidden')
    }
    byId('copy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(copy)
        said.textContent = 'Copied. Now open Yaseen Docs and tap Paste.'
      } catch {
        // No clipboard access: select the code, so one tap on "Copy" in the iOS menu copies it.
        field.focus()
        field.select()
        said.textContent = 'Tap Copy in the menu above the code.'
      }
    })
  }
}
