/**
 * The updater's state in this window (YAZ-2976 D4): main owns the updater, and every window reads
 * the same state (S20). One read on mount, then main's pushes. A push that lands before the read
 * answers is newer than that answer, so the read is then dropped — never a step back. A read that
 * fails (an older main, or none in a test) leaves `idle`: no pill, which is the right default.
 */
import { useEffect, useState } from 'react'
import type { UpdateState } from '@shared/types'
import { api } from '../api'

const IDLE: UpdateState = { kind: 'idle' }

export function useUpdate(): UpdateState {
  const [update, setUpdate] = useState<UpdateState>(IDLE)
  useEffect(() => {
    let pushed = false
    let live = true
    api.update.state().then(
      (state) => {
        if (live && !pushed) setUpdate(state)
      },
      () => undefined,
    )
    const off = api.update.onState((state) => {
      pushed = true
      setUpdate(state)
    })
    return () => {
      live = false
      off()
    }
  }, [])
  return update
}
