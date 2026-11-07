import { AutomationFailure } from './automation'
import { navigationSchema, validateInput } from './automationCommands'
import type { NavigationInput } from './automationNavigation'

const PREFIX = 'yaseendocs://navigate?v=1&request='

/** Navigation fields only. Public command names, mutation arguments, and secrets cannot appear in this format. */
export function navigationLink(input: NavigationInput): string {
  validateInput(navigationSchema, input)
  const url = PREFIX + encodeURIComponent(JSON.stringify(input))
  if (url.length > 64 * 1024) throw new AutomationFailure('INVALID_INPUT', 'Navigation link exceeds 64 KiB.')
  return url
}

export function parseNavigationLink(url: string): NavigationInput | null {
  if (!url.startsWith(PREFIX) || url.length > 64 * 1024) return null
  try {
    const input: unknown = JSON.parse(decodeURIComponent(url.slice(PREFIX.length)))
    validateInput(navigationSchema, input)
    return input as NavigationInput
  } catch { return null }
}
