// YAZ-4074 6A item 19: the index reads the boards' IDs with at most SCAN_CONCURRENCY heads open at a time. Before, it
// opened every board at once; on a big vault an EMFILE error read as "no ID", and links to those boards stopped working.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BOARD_META_KEY } from '@shared/drawingAssets'
import { IDS_FILE } from '@shared/pageId'
import { makeFirstMac, removeVault } from '../fs/testFixture'
import { writeConfig } from '../vaultConfig'
import { _evictAll, getIndex } from './index'
import { SCAN_CONCURRENCY } from './reconcile'

const heads = vi.hoisted(() => ({ open: 0, most: 0 }))
vi.mock('../fs/boardHead', async (importOriginal) => {
  const real = await importOriginal<typeof import('../fs/boardHead')>()
  return {
    ...real,
    readBoardHead: async (file: string) => {
      heads.open++
      heads.most = Math.max(heads.most, heads.open)
      try {
        await new Promise((resolve) => setTimeout(resolve, 5))
        return await real.readBoardHead(file)
      } finally {
        heads.open--
      }
    },
  }
})

let root: string
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mdapp-board-ids-pool-'))
  heads.most = 0
})
afterEach(async () => {
  _evictAll()
  await removeVault(root)
})

describe('the board IDs at index build (YAZ-4074 6A item 19)', () => {
  it(`reads ${SCAN_CONCURRENCY * 2} boards with at most ${SCAN_CONCURRENCY} heads open, and finds every ID`, async () => {
    // a vault that gives IDs with the letters DEM: the index sends the boards' IDs
    await writeConfig(root, IDS_FILE, { enabled: true, letters: 'DEM' })
    await makeFirstMac(root)
    const count = SCAN_CONCURRENCY * 2
    for (let n = 0; n < count; n++) {
      await writeFile(path.join(root, `B${n}.excalidraw`), `${JSON.stringify({ [BOARD_META_KEY]: { createdAt: 1, updatedAt: 2, id: `DEM-${n + 1}` }, type: 'excalidraw', elements: [] })}\n`)
    }
    const { boards } = await getIndex(root)
    expect(boards).toHaveLength(count)
    expect(heads.most).toBeLessThanOrEqual(SCAN_CONCURRENCY)
  })
})
