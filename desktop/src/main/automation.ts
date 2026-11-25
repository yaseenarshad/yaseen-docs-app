import { AutomationFailure, AUTOMATION_VERSION, type AutomationRequest } from '@shared/automation'
import { commandDefinition, validateInput, validateOutput } from '@shared/automationCommands'
import type { NavigationInput } from '@shared/automationNavigation'
import type { AppState } from '@shared/types'
import type { Operation } from '../automation/requests'
import { BridgeFailure } from './fs/fsUtils'
import type { NavigationHost } from './automation/navigation'
import type { ActivateTabArgs, CloseTabArgs, MoveTabArgs, MoveWindowArgs } from './automation/windowControl'

export interface AutomationContext { profile: string; version: string; packaged?: boolean; state?: () => AppState; navigation?: NavigationHost }
type Args = Record<string, unknown>
interface Route {
  /** The queue keys the command holds while it runs (D9). A read holds none. */
  locks(args: Args): string[]
  run(context: AutomationContext, args: Args): unknown
}

const windowLock = (args: Args): string[] => (typeof args.window === 'string' ? [`window:${args.window}`] : [])
const moveTabLocks = (args: Args): string[] => [
  ...new Set(
    [args.from, args.to]
      .filter((id): id is string => typeof id === 'string')
      .map(id => `window:${id}`)
      .sort(),
  ),
]

/** Every public command's adapter. `request.status` is the server's own: it answers receipts outside the queue. */
const ROUTES: Record<string, Route> = {
  'app.status': { locks: () => [], run: context => ({ version: context.version, automation: AUTOMATION_VERSION, packaged: context.packaged === true, profile: context.profile, running: true }) },
  'navigation.open': {
    locks: args => ['navigation', ...windowLock(args)],
    // The adapter loads at the first navigation: an app start parses none of it.
    run: async (context, args) => (await import('./automation/navigation')).navigate(context.navigation!, args as NavigationInput),
  },
  'window.list': {
    locks: () => [],
    run: async (context) => (await import('./automation/windowControl')).listWindows(context.navigation!),
  },
  'window.move': {
    locks: windowLock,
    run: async (context, args) => (await import('./automation/windowControl')).moveWindow(context.navigation!, args as unknown as MoveWindowArgs),
  },
  'window.focus': {
    locks: windowLock,
    run: async (context, args) => (await import('./automation/windowControl')).focusWindow(context.navigation!, args as { window: string }),
  },
  'window.minimize': {
    locks: windowLock,
    run: async (context, args) => (await import('./automation/windowControl')).minimizeWindow(context.navigation!, args as { window: string }),
  },
  'window.close': {
    locks: windowLock,
    run: async (context, args) => (await import('./automation/windowControl')).closeWindow(context.navigation!, args as { window: string; force?: boolean }),
  },
  'tab.activate': {
    locks: windowLock,
    run: async (context, args) => (await import('./automation/windowControl')).activateTab(context.navigation!, args as unknown as ActivateTabArgs),
  },
  'tab.close': {
    locks: windowLock,
    run: async (context, args) => (await import('./automation/windowControl')).closeTab(context.navigation!, args as unknown as CloseTabArgs),
  },
  'tab.move': {
    locks: moveTabLocks,
    run: async (context, args) => (await import('./automation/windowControl')).moveTab(context.navigation!, args as unknown as MoveTabArgs),
  },
}

export function routeFor(command: string): Route {
  if (!Object.hasOwn(ROUTES, command)) throw new AutomationFailure('UNKNOWN_COMMAND', 'This command has no adapter.')
  return ROUTES[command]
}

/** Tests prove each result against the command's declared output (YAZ-4506). A packaged or dev app does not. */
const checkOutputs = process.env.VITEST !== undefined

export function prepareAutomation(context: AutomationContext, request: AutomationRequest): Operation {
  validateInput(commandDefinition(request.command).input, request.args)
  const route = routeFor(request.command)
  return { writes: route.locks(request.args), run: async () => {
    try {
      const value = await route.run(context, request.args)
      if (checkOutputs) validateOutput(request.command, value)
      return value
    } catch (error) {
      // A list file the app cannot read (malformed, unreadable) says so, as the sidebar does.
      if (error instanceof BridgeFailure) throw new AutomationFailure(error.code, error.message)
      throw error
    }
  } }
}
