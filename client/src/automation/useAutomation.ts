import { useEffect, useRef } from 'react'
import { automationError } from '@shared/automation'
import type { InspectTarget, NavigationTarget } from '@shared/automationNavigation'
import { api } from '../api'

export function useAutomation(navigate: (target: NavigationTarget) => Promise<unknown>, inspect: (target: InspectTarget) => unknown): void {
  const latest = useRef({ navigate, inspect })
  latest.current = { navigate, inspect }
  useEffect(() => {
    const off = api.automation.onRequest(request => {
      void Promise.resolve().then(() => request.action === 'navigate' ? latest.current.navigate(request.target) : latest.current.inspect(request.target)).then(
        value => api.automation.reply({ id: request.id, ok: true, value }),
        error => {
          const result = automationError(error)
          return api.automation.reply({ id: request.id, ...result })
        },
      ).catch(() => { /* A closing window cannot deliver a reply; main reports WINDOW_CLOSED. */ })
    })
    void api.automation.ready(true)
    return () => { void api.automation.ready(false); off() }
  }, [])
}
