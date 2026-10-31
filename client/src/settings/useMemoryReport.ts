import { useEffect, useState } from 'react'
import { MEMORY_SAMPLE_MS, type MemoryReport } from '@shared/types'
import { api } from '../api'

/**
 * Settings › Memory's report (YAZ-3737 D9): asked when the page shows, then each `MEMORY_SAMPLE_MS` (with main's
 * samples) until it closes. Nothing runs while Settings is closed. `null` until the first answer; a failed ask keeps
 * what shows.
 */
export function useMemoryReport(): MemoryReport | null {
  const [report, setReport] = useState<MemoryReport | null>(null)
  useEffect(() => {
    let live = true
    const ask = () =>
      void Promise.resolve()
        .then(() => api.memory.report())
        .then(
          (next) => {
            if (live) setReport(next)
          },
          () => undefined,
        )
    ask()
    const timer = setInterval(ask, MEMORY_SAMPLE_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [])
  return report
}
