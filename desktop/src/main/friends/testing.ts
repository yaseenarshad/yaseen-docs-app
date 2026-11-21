/**
 * Test help (YAZ-5252): the count worker built as the app builds it (one CommonJS file), in a temp folder, so a test runs
 * the REAL worker thread (`countWorker.ts`, the closed-vault scan in it).
 */
export async function buildCountWorker(): Promise<string> {
  const [{ build }, { mkdtemp }, { tmpdir }, path, { fileURLToPath }] = await Promise.all([import('esbuild'), import('node:fs/promises'), import('node:os'), import('node:path'), import('node:url')])
  const file = path.join(await mkdtemp(path.join(tmpdir(), 'yd-count-worker-')), 'countWorker.cjs')
  await build({
    entryPoints: [fileURLToPath(new URL('./countWorker.ts', import.meta.url))],
    outfile: file,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    alias: { '@shared': fileURLToPath(new URL('../../../../shared', import.meta.url)) },
    logLevel: 'silent',
  })
  return file
}
