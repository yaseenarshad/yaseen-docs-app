import { act } from 'react'
import { FOLDER_FILES } from '../dev/folderVault'
import { seedReaderVault } from '../dev/readerVault'
import { HOLD_MS } from '../search/holdFolder'
import { mount, newPhone, type Harness } from '../screens/testing'

/** YAZ-5460's tests: the app on the made-up folder vault, a folder page open. Only tests reach this file. */
export async function waitFor(x: Harness, done: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms
  while (!done()) {
    if (Date.now() > until) throw new Error(`Timed out. Screen: ${x.text()}`)
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
  }
}

/** The app on the folder vault, the folder page of `folder` open full screen (held in Search's tree). */
export async function openFolder(folder = 'Projects', files: Record<string, string | Uint8Array> = FOLDER_FILES): Promise<Harness> {
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, files)
  const x = await mount({ phone })
  await x.click('Search')
  await waitFor(x, () => x.host.querySelector('.tree') !== null)
  await x.settle()
  const row = [...x.host.querySelectorAll<HTMLElement>('.tree__row')].find((r) => r.querySelector('.tree__label')?.textContent === folder)!
  await act(async () => void row.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })))
  await act(async () => void (await new Promise((r) => setTimeout(r, HOLD_MS + 30))))
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.hold-menu__item')].find((b) => b.textContent === 'Open folder page')!.click())
  await waitFor(x, () => x.host.querySelector('.folder-view') !== null)
  await x.settle()
  return x
}
