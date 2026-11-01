/**
 * The TS worker stops with its last model (YAZ-3862): Monaco stops it only on a change of its language's
 * defaults, so the test plays Monaco's model list and counts the writes of the compiler options.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STOP_AFTER_MS, stopTsWorkersWhenUnused } from './tsWorkerStop'

type Model = { getLanguageId(): string }

function fakeMonaco() {
  const models = new Set<Model>()
  const disposing = new Set<(model: Model) => void>()
  const defaults = () => {
    const options = { target: 99 }
    return { getCompilerOptions: () => options, setCompilerOptions: vi.fn() }
  }
  const typescript = { typescriptDefaults: defaults(), javascriptDefaults: defaults() }
  const editor = {
    getModels: () => [...models],
    onWillDisposeModel: (listener: (model: Model) => void) => disposing.add(listener),
  }
  const create = (language: string): Model => {
    const model = { getLanguageId: () => language }
    models.add(model)
    return model
  }
  // Monaco fires `onWillDisposeModel` while the model is still in its list.
  const dispose = (model: Model): void => {
    for (const listener of disposing) listener(model)
    models.delete(model)
  }
  stopTsWorkersWhenUnused({ editor, typescript } as unknown as Parameters<typeof stopTsWorkersWhenUnused>[0])
  return { typescript, create, dispose }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('stopTsWorkersWhenUnused', () => {
  it('stops a language’s worker STOP_AFTER_MS after its last model goes, with the same options, and only that language’s', () => {
    const { typescript, create, dispose } = fakeMonaco()
    const a = create('typescript')
    const b = create('typescript')
    create('javascript')
    dispose(a)
    vi.advanceTimersByTime(STOP_AFTER_MS)
    expect(typescript.typescriptDefaults.setCompilerOptions).not.toHaveBeenCalled() // b is still open
    dispose(b)
    vi.advanceTimersByTime(STOP_AFTER_MS - 1)
    expect(typescript.typescriptDefaults.setCompilerOptions).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(typescript.typescriptDefaults.setCompilerOptions).toHaveBeenCalledTimes(1)
    expect(typescript.typescriptDefaults.setCompilerOptions).toHaveBeenCalledWith(typescript.typescriptDefaults.getCompilerOptions())
    expect(typescript.javascriptDefaults.setCompilerOptions).not.toHaveBeenCalled()
  })

  it('keeps the worker when a model of the language comes back in the wait (a jump to another file in the tab)', () => {
    const { typescript, create, dispose } = fakeMonaco()
    dispose(create('typescript'))
    vi.advanceTimersByTime(STOP_AFTER_MS / 2)
    const next = create('typescript')
    vi.advanceTimersByTime(STOP_AFTER_MS)
    expect(typescript.typescriptDefaults.setCompilerOptions).not.toHaveBeenCalled()
    dispose(next)
    vi.advanceTimersByTime(STOP_AFTER_MS)
    expect(typescript.typescriptDefaults.setCompilerOptions).toHaveBeenCalledTimes(1)
  })

  it('leaves the workers alone when a model of another language goes', () => {
    const { typescript, create, dispose } = fakeMonaco()
    dispose(create('python'))
    vi.advanceTimersByTime(STOP_AFTER_MS)
    expect(typescript.typescriptDefaults.setCompilerOptions).not.toHaveBeenCalled()
    expect(typescript.javascriptDefaults.setCompilerOptions).not.toHaveBeenCalled()
  })
})
