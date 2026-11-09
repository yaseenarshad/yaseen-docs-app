/** Entry for `out/main/cli.js`: stdio in, exit code out. The program lives in `cli.ts` so it tests in-process. */
import { main } from './cli'

import { AUTOMATION_LIMITS } from '@shared/automation'
import { boundedStdin } from './input'

const stdinBytes = (maxBytes: number) => boundedStdin(process.stdin, maxBytes)
const stdin = async (maxBytes: number = AUTOMATION_LIMITS.contentBytes): Promise<string> => (await stdinBytes(maxBytes)).toString('utf8')

void main(process.argv.slice(2), { stdin, stdinBytes, stdout: (t) => process.stdout.write(t), stderr: (t) => process.stderr.write(t) }).then((code) => {
  process.exitCode = code
})
