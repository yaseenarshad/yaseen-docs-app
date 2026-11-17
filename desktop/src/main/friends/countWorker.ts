import { parentPort, workerData } from 'node:worker_threads'
import { friendStats, type FriendVault } from '@shared/friendStats'
import { ClosedVaultsUnreadable, type CountAnswer, type CountJob } from './countJob'
import { scanClosedVault } from './scanVault'

// The thread `countJobOffThread` starts (YAZ-5250): one count, one message, then it exits. The day is this Mac's local
// day, or the person's home zone (YAZ-5251, `job.zone`): a worker thread has the same time zone as the app.
// YAZ-5252: the closed vaults are scanned here first (`scanVault.ts`, its own cache on disk). YAZ-5388: one vault that
// cannot be read never stops the others: each is scanned, and the answer names the ones skipped (then no count).
const job = workerData as CountJob
void (async () => {
  const answer: CountAnswer = { stats: null, failed: [], scanned: [], read: 0, scanMs: 0, scanCpuMs: 0, cpuMs: 0 }
  const closed: FriendVault[] = []
  const cpu = () => {
    const u = typeof process.threadCpuUsage === 'function' ? process.threadCpuUsage() : process.cpuUsage()
    return (u.user + u.system) / 1000
  }
  const startWall = performance.now()
  const startCpu = cpu()
  for (const c of job.closed ?? []) {
    try {
      const got = await scanClosedVault(c.root, { key: c.key, scanDir: job.scanDir, indexDir: job.indexDir })
      if (got.scanned) answer.scanned.push(c.root)
      answer.read += got.read
      closed.push(got.vault)
    } catch (err) {
      answer.failed.push(...(err instanceof ClosedVaultsUnreadable ? err.vaults : [{ root: c.root, why: 'unreadable' as const }]))
    }
  }
  answer.scanMs = performance.now() - startWall
  answer.scanCpuMs = cpu() - startCpu
  if (answer.failed.length === 0) {
    const vaults = (JSON.parse(job.text) as FriendVault[]).concat(closed)
    answer.stats = friendStats(vaults, job.now, job.zone ?? null)
  }
  answer.cpuMs = cpu() - startCpu
  parentPort!.postMessage(answer)
})()
