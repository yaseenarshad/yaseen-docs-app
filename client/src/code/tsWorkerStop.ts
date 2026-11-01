/**
 * THE TS WORKER STOPS WITH ITS LAST MODEL (YAZ-3862, YAZ-3737). Monaco stops its JSON, CSS and HTML workers
 * when they are idle, and its editor worker too, but never its TypeScript worker: that one kept the program of
 * every file it saw. With the 5 MB `.ts` of the long-day test it held 190 to 365 MB after every code tab had
 * closed (YAZ-3861).
 *
 * Monaco stops a TS worker only when its language's defaults change (`WorkerManager` listens to `onDidChange`).
 * So, `STOP_AFTER_MS` after the last model of a language goes, with no model of it made meanwhile, a write of
 * the same compiler options stops that worker. Nothing else changes: no model of the language is left to
 * check again. The next model starts a fresh worker. TypeScript and JavaScript each have their own worker.
 *
 * The wait is Monaco's own for its other workers (`STOP_WHEN_IDLE_FOR`, 2 min). It covers a jump to another file in
 * the same tab (its model goes before the next file is read) and a close and reopen. It also keeps a worker that
 * stops and starts every few seconds from churning: macOS can take back a stopped worker's memory late, and the
 * long-day test with a 10 s wait ended at 276 MB in one run and 898 MB in another (YAZ-3862).
 */
import type * as MonacoApi from 'monaco-editor'

type Monaco = Pick<typeof MonacoApi, 'editor' | 'typescript'>

export const STOP_AFTER_MS = 2 * 60_000

export function stopTsWorkersWhenUnused({ editor, typescript }: Monaco): void {
  const defaultsOf: Record<string, typeof typescript.typescriptDefaults | undefined> = {
    typescript: typescript.typescriptDefaults,
    javascript: typescript.javascriptDefaults,
  }
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  editor.onWillDisposeModel((model) => {
    const language = model.getLanguageId()
    const defaults = defaultsOf[language]
    if (defaults === undefined) return
    clearTimeout(timers.get(language))
    timers.set(
      language,
      setTimeout(() => {
        timers.delete(language)
        if (editor.getModels().some((m) => m.getLanguageId() === language)) return
        defaults.setCompilerOptions(defaults.getCompilerOptions())
      }, STOP_AFTER_MS),
    )
  })
}
