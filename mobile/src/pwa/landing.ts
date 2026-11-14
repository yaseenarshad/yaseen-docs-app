import { friendCodeFrom } from './friendLink'

/**
 * The friend landing page (`/friend#<code>`; round 10, item 7; YAZ-5087). A friend link opens in Safari, not in the
 * Home Screen app (iOS has no link capture for a web app). This page shows the code and copies it. It reads the code
 * from the part after `#`, which no browser sends to a server, and it makes no network call of its own.
 */

const code = friendCodeFrom(decodeURIComponent(location.hash.slice(1)))
const show = (id: string) => document.getElementById(id)!.removeAttribute('hidden')

if (code === null) {
  show('no-code')
} else {
  show('has-code')
  const field = document.getElementById('code') as HTMLInputElement
  const said = document.getElementById('copied')!
  field.value = code
  document.getElementById('copy')!.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code)
      said.textContent = 'Copied. Now open Notecards and tap Paste.'
    } catch {
      // No clipboard access: select the code, so one tap on "Copy" in the iOS menu copies it.
      field.focus()
      field.select()
      said.textContent = 'Tap Copy in the menu above the code.'
    }
  })
}
