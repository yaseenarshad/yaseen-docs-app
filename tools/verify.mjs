#!/usr/bin/env node
/**
 * Single verification entrypoint for agents and developers (YAZ-6008 D12, YAZ-6029).
 *
 * Modes:
 *   npm run verify             Fast local gate: lint + typecheck + archRules + clientFirstLoad
 *   npm run verify -- --build  Adds desktop build + mobile build + perf:budget:ci
 *   npm run verify -- --full   Full local release check: lint + typecheck + test + desktop:build + mobile:build + perf:budget
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2))

if (args.has('--help') || args.has('-h')) {
  console.log(`Usage: npm run verify [-- --build | --full]

Modes:
  (default)   lint + typecheck + archRules + clientFirstLoad
  --build     default + desktop build + mobile build + perf:budget:ci
  --full      lint + typecheck + full test suite + desktop:build + mobile:build + perf:budget`)
  process.exit(0)
}

const full = args.has('--full')
const withBuild = full || args.has('--build')

const steps = [
  { label: 'Lint (oxlint)', cmd: ['npm', 'run', 'lint', '--', '--quiet'] },
  { label: 'Typecheck (all 5 tsconfigs)', cmd: ['npm', 'run', 'typecheck'] },
  { label: 'Architecture & first-load walls', cmd: ['npx', 'vitest', 'run', 'tools/archRules.test.mjs', 'tools/clientFirstLoad.test.mjs'] },
]

if (full) {
  steps.push({ label: 'Full test suite', cmd: ['npm', 'test'] })
  steps.push({ label: 'Desktop packaged build', cmd: ['npm', 'run', 'desktop:build'] })
  steps.push({ label: 'Mobile PWA build', cmd: ['npm', 'run', 'mobile:build'] })
  steps.push({ label: 'Packaged perf & size budget', cmd: ['npm', 'run', 'perf:budget'] })
} else if (withBuild) {
  steps.push({ label: 'Desktop build', cmd: ['npm', 'run', 'build'] })
  steps.push({ label: 'Mobile PWA build', cmd: ['npm', 'run', 'mobile:build'] })
  steps.push({ label: 'CI perf & size budget', cmd: ['npm', 'run', 'perf:budget:ci'] })
}

const t0 = Date.now()
for (const step of steps) {
  const start = Date.now()
  console.log(`\n=== ${step.label} ===`)
  const res = spawnSync(step.cmd[0], step.cmd.slice(1), { cwd: ROOT, stdio: 'inherit', env: process.env })
  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  if (res.status !== 0) {
    console.error(`\nFAILED: ${step.label} (${elapsed}s)`)
    process.exit(res.status ?? 1)
  }
  console.log(`PASSED: ${step.label} (${elapsed}s)`)
}
console.log(`\nALL VERIFY STEPS PASSED (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
