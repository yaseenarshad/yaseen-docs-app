import { AutomationFailure, type AutomationRequest } from '@shared/automation'
import { commandDefinition, validateInput } from '@shared/automationCommands'
import type { Operation } from '../automation/requests'

export function prepareAutomation(context: { profile: string; version: string }, request: AutomationRequest, content: Buffer): Operation {
  const definition = commandDefinition(request.command)
  validateInput(definition.input, request.args)
  if (!definition.content && content.length) throw new AutomationFailure('INVALID_INPUT', 'This command accepts no content.')
  switch (request.command) {
    case 'app.status': return { writes: [], run: async () => ({ version: context.version, profile: context.profile, running: true }) }
    default: throw new AutomationFailure('UNKNOWN_COMMAND', 'This command has no adapter.')
  }
}
