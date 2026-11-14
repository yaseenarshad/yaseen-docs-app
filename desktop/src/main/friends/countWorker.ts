import { parentPort, workerData } from 'node:worker_threads'
import { friendStats, type FriendVault } from '@shared/friendStats'
import type { CountJob } from './countJob'

// The thread `countOffThread` starts (YAZ-5250): one count, one message, then it exits. The day is this Mac's local day:
// a worker thread has the same time zone as the app.
const job = workerData as CountJob
parentPort!.postMessage(friendStats(JSON.parse(job.text) as FriendVault[], job.now))
