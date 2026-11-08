import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AUTOMATION_VERSION, AutomationFailure } from '@shared/automation'

export interface Connection {
  version: typeof AUTOMATION_VERSION
  endpoint: string
  session: string
  token: string
  startedAt: number
}

export const descriptorPath = (profile: string): string => join(profile, 'cli', 'connection.json')

/** Profile files hold the token; sockets live in a short, owner-only path for macOS's path limit. */
export async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink() || (process.getuid && (info.uid !== process.getuid() || (info.mode & 0o077) !== 0))) {
    throw new AutomationFailure('UNSAFE_PROFILE', 'The CLI directory must be private and owned by this user.')
  }
}

export async function endpointFor(profile: string): Promise<string> {
  const hash = createHash('sha256').update(await realpath(profile)).digest('hex').slice(0, 20)
  if (process.platform === 'win32') return `\\\\.\\pipe\\yaseendocs-${hash}`
  const dir = join(tmpdir(), `yd-cli-${process.getuid?.() ?? 'user'}`)
  await privateDirectory(dir)
  return join(dir, `${hash}.sock`)
}

export async function readConnection(profile: string): Promise<Connection> {
  try {
    const path = descriptorPath(profile)
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || (process.getuid && (info.uid !== process.getuid() || (info.mode & 0o077) !== 0))) {
      throw new AutomationFailure('UNSAFE_PROFILE', 'The CLI connection file is not private.')
    }
    const value = JSON.parse(await readFile(path, 'utf8')) as Connection
    if (value.version !== AUTOMATION_VERSION || value.endpoint !== await endpointFor(profile) ||
        !/^[a-f0-9]{64}$/.test(value.token) || !/^[a-f0-9]{32}$/.test(value.session) || !Number.isFinite(value.startedAt)) {
      throw new AutomationFailure('BAD_CONNECTION', 'The Docs connection file is invalid.')
    }
    return value
  } catch (error) {
    if (error instanceof AutomationFailure) throw error
    throw new AutomationFailure('NOT_RUNNING', 'Docs is not running in this profile. Start it, or pass --start.')
  }
}
