import { chmod, mkdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * GIT_ASKPASS helper for Mac/Windows GitHub App auth (YAZ-6190, D2).
 *
 * The GitHub App user token (`ghu_...`) is passed ONLY in the child process env var
 * `YASEEN_DOCS_GIT_TOKEN` and printed to git on demand. It never appears in `.git/config`,
 * `ps` argv, or logs. One tiny script is written once per process in `os.tmpdir()` with mode 0700.
 */

let cachedScript: string | null = null

const POSIX_SCRIPT = `#!/bin/sh
case "$1" in
  *Username*|*username*) printf '%s\\n' "x-access-token" ;;
  *) printf '%s\\n' "$YASEEN_DOCS_GIT_TOKEN" ;;
esac
`

const WIN_SCRIPT = `@echo off
echo %~1 | findstr /I "username" >nul
if %errorlevel%==0 (
  echo x-access-token
) else (
  echo %YASEEN_DOCS_GIT_TOKEN%
)
`

export async function ensureAskpassScript(platform: NodeJS.Platform = process.platform): Promise<string> {
  if (cachedScript !== null) {
    const ok = await stat(cachedScript).then((s) => s.isFile(), () => false)
    if (ok) return cachedScript
  }
  const dir = path.join(tmpdir(), `yaseen-docs-askpass-${process.pid}`)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const file = path.join(dir, platform === 'win32' ? 'askpass.cmd' : 'askpass.sh')
  await writeFile(file, platform === 'win32' ? WIN_SCRIPT : POSIX_SCRIPT, { encoding: 'utf8', mode: 0o700 })
  if (platform !== 'win32') await chmod(file, 0o700)
  cachedScript = file
  return file
}

export async function gitAuthEnv(token: string, platform: NodeJS.Platform = process.platform): Promise<NodeJS.ProcessEnv> {
  const script = await ensureAskpassScript(platform)
  return {
    GIT_ASKPASS: script,
    YASEEN_DOCS_GIT_TOKEN: token,
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
  }
}
