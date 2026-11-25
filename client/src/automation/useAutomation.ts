import { useEffect, useRef } from 'react'
import { automationError } from '@shared/automation'
import type { RendererCommand } from '@shared/automationNavigation'
import { api } from '../api'

/** This window's side of CLI automation (YAZ-4502, YAZ-6539): it says it is ready, then answers each command once applied. */
export function useAutomation(handle: (command: RendererCommand) => Promise<unknown>): void {
  const latest = useRef(handle)
  latest.current = handle
  useEffect(() => {
    const off = api.automation.onRequest((command) => {
      void Promise.resolve().then(() => latest.current(command)).then(
        (value) => api.automation.reply({ id: command.id, ok: true, value }),
        (error: unknown) => api.automation.reply({ id: command.id, ...automationError(error) }),
      ).catch(() => { /* A closing window cannot deliver a reply; main reports WINDOW_CLOSED. */ })
    })
    void api.automation.ready(true)
    return () => { void api.automation.ready(false); off() }
  }, [])
}
