/**
 * YAZ-5161 (2A2): the phone builds the review hook, the card drawing and the review pieces its Review screen needs
 * (4B, YAZ-5078) through the phone's own import wall: the real Vite build with `vite.config.ts` (`phoneImportGuard`),
 * so the same rule as the phone's build stops any file that reaches the desktop bridge (`client/src/api`), the app's
 * storage wrapper (`client/src/lib/storage`), `window.yaseenDocs` or browser storage. Each entry is built alone.
 */
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'

const CONFIG = fileURLToPath(new URL('../vite.config.ts', import.meta.url))
const CLIENT = fileURLToPath(new URL('../../client/src/', import.meta.url))

/** The error of the phone build of `entry` alone, or null when it builds. Nothing is written. */
async function phoneBuild(entry: string): Promise<string | null> {
  try {
    await build({ configFile: CONFIG, logLevel: 'silent', build: { write: false, rollupOptions: { input: `${CLIENT}${entry}` } } })
    return null
  } catch (err) {
    return err instanceof Error ? err.message.split('\n')[0] : String(err)
  }
}

describe('the review the phone shares with the Mac builds through the phone wall (YAZ-5161)', () => {
  it.each([
    ['review/useCardReview.ts', 'the review hook (decision 3)'],
    ['review/reviewHost.ts', 'the host type'],
    ['review/cardRead.ts', 'the pure card read: a card file`s title, "card gone"'],
    ['review/memoryReviewHost.ts', 'a host built on the pure reads'],
    ['editor/card/cardRender.ts', 'the card drawing, its hidden words and sides'],
    ['editor/card/cardLook.ts', 'a card`s look: links, pictures, sounds, boards'],
    ['editor/wikilink/linkResolve.ts', 'how a link in a card resolves'],
    ['editor/wikilink/cardPill.ts', 'the card pill'],
    ['review/cardWords.ts', 'the words of the card screens: waits, dates, the review history strip'],
    ['review/cardInboxChip.tsx', 'the answer buttons` labels and icons'],
    ['review/reviewTime.ts', 'how long an answer took'],
  ])('%s (%s)', async (entry) => {
    expect(await phoneBuild(entry)).toBeNull()
  }, 60_000)
})
