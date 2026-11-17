import type { Root } from 'react-dom/client'
import { App } from '../App'
import { answersSetup } from '../answers/testing'
import type { AppServices } from '../app/AppState'
import { fakeFriends, fakeSync, reviewOnTabs } from '../dev/fakes'
import { memoryBackend, openVaultStore, saveVaultList, tokenStoreOn } from '../store'
import { BRANCH, REPO, VAULT } from '../sync/testing'
import type { VaultMedia } from '../media/ui/vaultMedia'
import { writeReviewZoom } from '../store/reviewZoomPref'

/**
 * The Review tab's screen fixtures (4B), for the screenshots: `#fixture=review-…`. Made-up data only: the REAL engine
 * and answer list on the fake GitHub (no network), the real app around them. Only the `--mode fixtures` build has it.
 */
const block = (text: string, line: string, fence = '```') => `${fence}card\n${text}\n${fence}\n<!-- card: ${line} -->`
const page = (title: string, ...cards: string[]) => `---\ntitle: ${title}\n---\n\n# ${title}\n\n${cards.join('\n\n')}\n`
const DUE = '2026-10-02T09:00:00.000Z good, 2026-10-12T09:00:00.000Z good'

const FILES: Record<string, string> = {
  '.yaseendocs/review.json': '{"newPerDay": 10}',
  'spanish-words.md': page(
    'Spanish words',
    block('What does "la biblioteca" mean?\n---\nThe {{library}}. A bookshop is "la {{librería}}".', `DEMO-12, ${DUE}`),
    block('Hola\n---\n{{Hello}}', 'DEMO-13'),
    block('| | ser |\n| -- | -- |\n| yo | {{soy}} |\n| tú | {{eres}} |\n| él | {{es}} |', 'DEMO-14, title "Verbs: ser", next'),
  ),
  'git-cheat-sheet.md': page(
    'Git cheat sheet',
    block('What does git pull do?\n---\nIt {{fetches}} and then {{merges}}.', `DEMO-38, ${DUE}`),
    block('```js\nconsole.log([1, 2, 3].map((n) => n * 2))\n```\n---\n{{[2, 4, 6]}}', 'DEMO-39, title "What prints?"', '````'),
  ),
  'cards/speed-of-light-demo-40.md': `---\nkind: card\n---\n\n${block('How fast is light?\n---\nAbout {{300,000 km}} each second.', 'DEMO-40, title "Speed of light"')}\n`,
  'birds.md': page('Birds', block('![a robin](robin.png)\n---\nA {{robin}}.', 'DEMO-41, title "Which bird is this?"'), block('![[blackbird.mp3]]\n---\nA {{blackbird}}.', 'DEMO-42, title "Which bird sings this?"')),
  'robin.png': 'made-up picture bytes',
  'blackbird.mp3': 'made-up sound bytes',
  'history.md': page(
    'History',
    block(
      `${Array.from({ length: 30 }, (_, i) => `${i + 1}. A long line of made-up notes about the history of the printing press, line ${i + 1}.`).join('\n')}\n---\nThe press came to Europe in about {{1450}}.`,
      'DEMO-50, title "The long card"',
    ),
  ),
}

/**
 * YAZ-5415 (the Mochi look): a long made-up card in a folder, and pages in three folders for the folder pick.
 * `#fixture=review-mochi` (the card part shown), `-sheet`, `-folders`, `-end` (all shown: the bounce), `-more`,
 * `-zoom-max`, `-zoom-min` (YAZ-5706: all shown, the ⋯ open, zoomed all the way in or out).
 */
const MOCHI: Record<string, string> = {
  '.yaseendocs/review.json': '{"newPerDay": 3}',
  'learning/memory.md': page(
    'Memory',
    block(
      [
        'How does a review plan keep a fact?',
        '---',
        'You see the fact again just before you would {{forget}} it. Each good answer makes the next gap {{longer}}.',
        '',
        '**Why it works**',
        '',
        '- Each recall takes {{effort}}, and the effort makes the memory stronger.',
        '- The gaps grow: one day, three days, one week, then {{a month}}.',
        '- A miss sends the card back to a {{short}} gap.',
        '',
        '**How to use it**',
        '',
        'Keep cards small: one idea each. Write the answer in your {{own words}}. Review a little each day.',
        '',
        'A long card is fine when its parts belong together, but each hidden part is one thing you can say out loud.',
      ].join('\n'),
      `MEM-1, ${DUE}`,
    ),
    block('What is the testing effect?\n---\nTo {{recall}} a fact makes it stronger than to read it again.', `MEM-2, ${DUE}`),
  ),
  'languages/words.md': page('Words', block('What does "la ventana" mean?\n---\nThe {{window}}.', 'LAN-1'), block('Hola\n---\n{{Hello}}', 'LAN-2'), block('Gracias\n---\n{{Thank you}}', 'LAN-3')),
  'trip/plan.md': page('Plan', block('Which line goes to the old town?\n---\nLine {{12}}.', 'TRP-1'), block('When does the museum open?\n---\nAt {{ten}}.', 'TRP-2')),
}

/**
 * YAZ-5716 (Mochi's breathing room): one made-up due card each, for the layout proof. `#fixture=review-room-short` (a
 * short card, its first side), `-long` (a long card that scrolls as one page), `-hidden` (hidden words, the first one
 * shown), `-z50`, `-z200` (the hidden-words card at 50% and 200%).
 */
const ROOM = (kind: string): Record<string, string> => ({
  '.yaseendocs/review.json': '{}',
  'reading/room.md': page(
    'Room',
    kind === 'long'
      ? block(
          [
            'What makes a habit stick?',
            '---',
            ...Array.from({ length: 9 }, (_, i) => `Made-up note ${i + 1}: a habit sticks when the cue is plain, the step is small and the reward comes soon after, so the loop runs again tomorrow.`),
            '',
            'The last line of the long card: the {{reward}} closes the loop.',
          ].join('\n\n'),
          `ROOM-2, ${DUE}`,
        )
      : kind === 'short'
        ? block('When I keep seeing the same fault in other people, what reminds me to look at myself too?\n---\nWhat you see in others is often {{a mirror}}.', `ROOM-1, ${DUE}`)
        : block('A software {{bug}} is a {{flaw}} that makes a program act in a way nobody {{intended}}, as a dead button or a wrong total.\n---\nThe first one on record was a {{moth}}.', `ROOM-3, ${DUE}`),
  ),
})

/**
 * YAZ-5495 (the Mac's YAZ-5043): the end of Due today. Five made-up due cards and three new ones; `-clear` has no new
 * card. `#fixture=review-due-missed` (the % screen after one Forgot), `-done` (Due today is done, Learn new cards),
 * `-clear` (done, nothing new left).
 */
const DUE_END = (fresh: boolean): Record<string, string> => ({
  '.yaseendocs/review.json': '{"newPerDay": 3}',
  'spanish/verbs.md': page('Verbs', ...['ser', 'estar', 'tener', 'ir', 'hacer'].map((v, i) => block(`What does "${v}" mean?\n---\n{{answer ${i + 1}}}`, `VRB-${i + 1}, ${DUE}`))),
  ...(fresh && { 'spanish/places.md': page('Places', ...['la playa', 'el museo', 'la plaza'].map((w, i) => block(`What does "${w}" mean?\n---\n{{place ${i + 1}}}`, `PLC-${i + 1}`))) }),
})

/** YAZ-5500: `#fixture=review-last`: right after one Forgot, the hint line says it: "✕ Forgot · … · back later today · Undo". */
const LAST: Record<string, string> = {
  '.yaseendocs/review.json': '{}',
  'geography/capitals.md': page('Capitals', block('What is the capital of Spain?\n---\n{{Madrid}}', `CAP-1, title "Capital of Spain", ${DUE}`), block('What is the capital of Portugal?\n---\n{{Lisbon}}', `CAP-2, title "Capital of Portugal", ${DUE}`)),
}

/**
 * YAZ-5692, YAZ-5693 (the parity gaps of YAZ-5687): three made-up new cards. `#fixture=review-learned`: the first one's
 * Remembered (the toast "Added card to reviews · Undo" over the hint line's "✓ Remembered · … · Undo");
 * Both under New cards; `-end`: all three learned, the finish screen with the toast and the line.
 */
const LEARNED: Record<string, string> = {
  '.yaseendocs/review.json': '{"newPerDay": 3}',
  'languages/new-words.md': page('New words', ...[1, 2, 3].map((i) => block(`New word ${i}?\n---\nWord {{${i}}}.`, `PYN-${i}`))),
}

/**
 * YAZ-5616 (Review check d): `#fixture=review-taps`, for the real-touch proof (`publish/proveReviewTaps.ts`). One card
 * marked Up next, four due cards, five new cards in two folders (three a day), one archived card. Nothing is tapped
 * here: the proof taps. `window.__reviewTaps` lets it send the answers (the fake clock's 5 s) and read the fake GitHub.
 */
const TAPS: Record<string, string> = {
  '.yaseendocs/review.json': '{"newPerDay": 3}',
  'review/up.md': page('Up', block('Which card goes first?\n---\nThe {{Up next}} card.', `UP-1, ${DUE}, next`)),
  'review/due.md': page('Due', ...[1, 2, 3, 4].map((i) => block(`Due question ${i}?\n---\nDue answer {{${i}}}.`, `DUE-${i}, ${DUE}`)), block('Archived?\n---\n{{Gone}}.', `OFF-1, ${DUE}, off`)),
  'words/a.md': page('Words A', ...[1, 2, 3].map((i) => block(`New word ${i}?\n---\nNew answer {{${i}}}.`, `NEW-${i}`))),
  'words/b.md': page('Words B', ...[4, 5].map((i) => block(`New word ${i}?\n---\nNew answer {{${i}}}.`, `NEW-${i}`))),
}

/** A made-up robin: a small picture drawn as a data URL. */
const ROBIN = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140"><rect width="240" height="140" fill="#e9eef5"/><circle cx="120" cy="78" r="38" fill="#7a5a43"/><circle cx="106" cy="86" r="22" fill="#d8642b"/><circle cx="134" cy="62" r="5" fill="#222"/></svg>')}`

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const press = (name: string | RegExp) => {
  const el = [...document.querySelectorAll<HTMLElement>('button, a')].find((b) => {
    const n = (b.getAttribute('aria-label') ?? b.textContent ?? '').replace(/\s+/g, ' ').trim()
    return typeof name === 'string' ? n === name : name.test(n)
  })
  el?.click()
}
const tap = () => document.querySelector<HTMLElement>('.review__card')?.click()

export async function mountReviewFixture(root: Root, name: string): Promise<void> {
  const files = name === 'review-taps' ? TAPS : name.startsWith('review-learned') ? LEARNED : name === 'review-last' ? LAST : name.startsWith('review-due-') ? DUE_END(name !== 'review-due-clear') : name.startsWith('review-mochi') ? MOCHI : name.startsWith('review-room-') ? ROOM(name.slice('review-room-'.length)) : name === 'review-done' ? { '.yaseendocs/review.json': '{"newPerDay": 2}', 'p.md': page('Spanish words', ...Array.from({ length: 5 }, (_, i) => block(`Card ${i + 1}?\n---\n{{answer}}`, `DEMO-${i + 1}`))) } : FILES
  const step = (n: string) => void (document.body.dataset.fixtureStep = n)
  // YAZ-5706: the zoom is kept on this phone; each fixture starts at 100% (one browser runs them all).
  writeReviewZoom(name === 'review-room-z50' ? 50 : name === 'review-room-z200' ? 200 : 100)
  step('setup')
  // The fake GitHub runs in this one tab: no Web Lock, as in the tests (Node has none).
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
  const t = await answersSetup({ files })
  step('engine')
  if (name === 'review-offline') t.s.github.offline = true
  const media: VaultMedia = {
    show: async (path) =>
      path.endsWith('.png') && name !== 'review-offline'
        ? { status: 'ready', path, url: ROBIN, type: 'image/svg+xml' }
        : path.endsWith('.mp3') && name.startsWith('review-sound')
          ? { status: 'ready', path, url: 'blob:fixture-sound', type: 'audio/mpeg' }
          : { status: 'missing', path, why: 'offline' },
  }
  const backend = memoryBackend()
  const store = await openVaultStore(backend)
  const tokens = tokenStoreOn(backend)
  await tokens.write(VAULT, 'github_pat_11FIXTURE0' + 'f'.repeat(72))
  const vault = { repo: REPO, branch: BRANCH, addedAt: 1 }
  // YAZ-5663: a second vault on the phone, added first (the open one is number 2): the top bar shows no number.
  const others = name === 'review-two-vaults' ? [{ repo: 'demo/notecards-scratch-vault', branch: 'main', addedAt: 0 }] : []
  await saveVaultList(store, { vaults: [...others, vault], open: VAULT })
  const sync = fakeSync()
  sync.review = async () => ({ engine: t.engine, answers: t.answers, store: t.store })
  const services: AppServices = { store, tokens, vaultTabs: reviewOnTabs, sync, media, friends: fakeFriends(store, false), fetch: async () => new Response('{}', { status: 401 }) }
  if (name === 'review-taps')
    Object.assign(window, {
      __reviewTaps: {
        /** Sends the answers (the 5 s after the last one) and answers the vault's files on the fake GitHub. */
        send: async () => {
          await t.tick(5_000)
          return t.s.git.filesAt(t.head())
        },
        waiting: () => t.answers.state().waiting,
      },
    })
  root.render(<App services={services} />)
  step('render')
  await wait(400)

  switch (name) {
    case 'review-shown':
      tap()
      await wait(30)
      tap()
      break
    case 'review-filter':
      press(/^All cards/)
      break
    case 'review-more':
      press('Remembered')
      await wait(80)
      press('More card actions')
      break
    case 'review-table':
      // Up next goes first: DEMO-14, the table.
      tap()
      break
    case 'review-code':
      press(/^All cards/)
      await wait(30)
      press(/^New cards/)
      await wait(500) // past the tap guard (YAZ-5226)
      press('Remembered')
      await wait(60)
      tap()
      break
    case 'review-picture':
    case 'review-offline':
      press(/^All cards/)
      await wait(30)
      press(/^New cards/)
      for (let i = 0; i < 4; i++) {
        await wait(500) // past the tap guard (YAZ-5226)
        press('Remembered')
      }
      break
    // YAZ-5298: the short sound card (DEMO-42); `-tap`: one tap at the middle of the card, where the player is.
    case 'review-sound':
    case 'review-sound-tap':
      press(/^All cards/)
      await wait(30)
      press(/^New cards/)
      for (let i = 0; i < 5; i++) {
        await wait(500) // past the tap guard (YAZ-5226)
        press('Remembered')
      }
      if (name === 'review-sound-tap') {
        await wait(500)
        const box = document.querySelector<HTMLElement>('.review__card')!.getBoundingClientRect()
        ;(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) as HTMLElement | null)?.click()
      }
      break
    case 'review-long':
      press(/^All cards/)
      await wait(30)
      press(/^New cards/)
      for (let i = 0; i < 6; i++) {
        await wait(500) // past the tap guard (YAZ-5226)
        press('Remembered')
      }
      await wait(60)
      tap()
      break
    case 'review-mochi':
    case 'review-mochi-end':
      for (let i = 0; i < (name === 'review-mochi' ? 4 : 9); i++) {
        tap()
        await wait(40)
      }
      if (name === 'review-mochi-end') tap()
      break
    case 'review-mochi-sheet':
    case 'review-mochi-folders':
      press(/Choose what to review/)
      await wait(60)
      if (name === 'review-mochi-folders') {
        press(/^New cards from/)
        await wait(60)
        for (const f of ['languages', 'trip']) [...document.querySelectorAll<HTMLLabelElement>('.review__sheet-folder')].find((r) => r.textContent?.startsWith(f))?.querySelector('input')?.click()
      }
      break
    case 'review-mochi-zoom-max':
    case 'review-mochi-zoom-min':
      // YAZ-5706: every part shown, the ⋯ menu open, its Zoom walked to the wall (400% or 50%).
      for (let i = 0; i < 4; i++) {
        tap()
        await wait(40)
      }
      press('More card actions')
      for (let i = 0; i < 8; i++) {
        press(name === 'review-mochi-zoom-max' ? 'Zoom the card in' : 'Zoom the card out')
        await wait(30)
      }
      break
    case 'review-room-hidden':
    case 'review-room-z50':
    case 'review-room-z200':
      // YAZ-5716: the first hidden word shown.
      tap()
      break
    case 'review-mochi-more':
      tap()
      await wait(40)
      press('Forgot')
      await wait(500)
      press('Remembered')
      await wait(500)
      press('More card actions')
      break
    case 'review-learned':
    case 'review-learned-end':
      // New cards alone, so the last card learned ends on "Finished learning cards." (All cards would review it again).
      press(/^All cards/)
      await wait(30)
      press(/^New cards/)
      for (let i = 0; i < (name === 'review-learned' ? 1 : 3); i++) {
        await wait(500) // past the tap guard (YAZ-5226)
        press('Remembered')
      }
      break
    case 'review-done':
      for (let i = 0; i < 4; i++) {
        await wait(500) // past the tap guard (YAZ-5226)
        press('Remembered')
      }
      break
    case 'review-due-missed':
    case 'review-due-done':
    case 'review-due-clear':
      press(/Choose what to review/)
      await wait(60)
      press('Due today')
      for (const answer of ['Remembered', 'Forgot', 'Remembered', 'Remembered', 'Remembered']) {
        await wait(500) // past the tap guard (YAZ-5226)
        press(answer)
      }
      if (name !== 'review-due-missed') {
        await wait(300)
        press(/^Review missed cards/)
        await wait(500)
        press('Remembered')
      }
      // The ring has played (1.4 s): the screenshot shows its end.
      await wait(1600)
      break
    case 'review-last':
      await wait(500) // past the tap guard (YAZ-5226)
      press('Forgot')
      await wait(4300) // no timer: the line stays until the next card's first action
      break
    case 'review-lost':
      press('Remembered')
      await wait(80)
      await t.s.git.push({ 'spanish-words.md': page('Spanish words', block('Hola\n---\n{{Hello}}', 'DEMO-13')) })
      await t.tick(5_000)
      break
  }
  await wait(300)
  document.documentElement.dataset.fixtureReady = name
}
