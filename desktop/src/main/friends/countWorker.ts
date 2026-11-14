import { parentPort, workerData } from 'node:worker_threads'
import { friendStats, type FriendVault } from '@shared/friendStats'
import { vaultPack, type CountAnswer, type CountJob } from './countJob'
import { scanVaultForCount } from './scanVault'

// The thread `countJobOffThread` starts (YAZ-5250): one count, one message, then it exits. The day is this Mac's local
// day: a worker thread has the same time zone as the app. YAZ-5252: a closed vault with no pack is scanned here first.
const job = workerData as CountJob
void (async () => {
  const scanned: CountAnswer['scanned'] = []
  const closed: string[] = []
  for (const c of job.closed ?? []) {
    if (c.text !== null) closed.push(c.text)
    else {
      const text = vaultPack(await scanVaultForCount(c.root))
      scanned.push({ root: c.root, text })
      closed.push(text)
    }
  }
  const vaults = JSON.parse(closed.length === 0 ? job.text : `[${[job.text.slice(1, -1), ...closed].filter((t) => t !== '').join(',')}]`) as FriendVault[]
  const answer: CountAnswer = { stats: friendStats(vaults, job.now), scanned }
  parentPort!.postMessage(answer)
})()
