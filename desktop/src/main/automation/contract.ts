import { validateOutput } from '@shared/automationCommands'

/** For adapter tests: the result, after it is proven against the command's declared output (YAZ-4506). */
export async function checked<T>(command: string, value: T | Promise<T>): Promise<T> {
  const result = await value
  validateOutput(command, result)
  return result
}
