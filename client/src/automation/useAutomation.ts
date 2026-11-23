import { useEffect, useRef } from 'react'
import { automationError } from '@shared/automation'
import type { NavigationTarget } from '@shared/automationNavigation'
import { api } from '../api'

/** This window's side of CLI navigation (YAZ-4502): it says it is ready, then answers each request once it shows the target. */
export function useAutomation(navigate: (target: NavigationTarget) => Promise<unknown>): void {
  const latest = useRef(navigate)
  latest.current = navigate
  useEffect(() => {
    const off = api.automation.onRequest((request) => {
      void Promise.resolve().then(() => latest.current(request.target)).then(
        (value) => api.automation.reply({ id: request.id, ok: true, value }),
        (error: unknown) => api.automation.reply({ id: request.id, ...automationError(error) }),
      ).catch(() => { /* A closing window cannot deliver a reply; main reports WINDOW_CLOSED. */ })
    })
    void api.automation.ready(true)
    return () => { void api.automation.ready(false); off() }
  }, [])
}
