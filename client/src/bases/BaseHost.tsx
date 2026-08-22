import { useEffect, useRef, useState } from 'react'
import type { FileResponse } from '@shared/types'
import { api } from '../api'
import { SaveIndicator } from '../editor/SaveIndicator'
import { useAutosave } from '../hooks/useAutosave'
import type { WatchSource } from '../hooks/useWatch'
import type { Autosave } from '../lib/autosave'
import { BaseParseError, parseBase, serializeBase, type ParsedBase } from './baseFile'
import { BaseView } from './BaseView'
import { useIndex } from './useIndex'
import { useRegistry } from './useRegistry'
import './bases.css'

/** View mode when the file parses; raw-textarea fallback (with the parse error) when it does not. */
type BaseMode = { mode: 'view'; parsed: ParsedBase } | { mode: 'raw'; text: string; error: BaseParseError }

function load(text: string): BaseMode {
  try {
    return { mode: 'view', parsed: parseBase(text) }
  } catch (err) {
    if (err instanceof BaseParseError) return { mode: 'raw', text, error: err }
    throw err
  }
}

/** What goes to disk: the serialised document in view mode, the textarea text in raw mode. */
const contentOf = (m: BaseMode): string => (m.mode === 'view' ? serializeBase(m.parsed) : m.text)

/** `line:col` prefix when the parser located the error; the first message line only (yaml appends a caret snippet). */
function describeError(err: BaseParseError): string {
  const first = err.message.split('\n')[0] ?? err.message
  return err.line === undefined ? first : `${err.line}:${err.col ?? 1} ${first}`
}

interface BaseHostProps {
  root: string
  file: FileResponse
  watch: WatchSource
  /** Row links in the view open notes in the editor (GRO-2135). */
  onOpenFile: (path: string) => void
}

/**
 * Mounts one `.base` (GRO-2125); remounted via `key` when the path changes, like CrepeHost.
 * Autosave/conflict handling mirrors CrepeHost with the frontmatter always '' (a base has none).
 * Opening a file and doing nothing never writes: the autosave baseline is the first
 * `contentOf()` and only content that differs from it is ever saved.
 */
export function BaseHost({ root, file, watch, onOpenFile }: BaseHostProps) {
  const index = useIndex(root, watch)
  const registry = useRegistry(root)
  const [mode, setMode] = useState<BaseMode>(() => load(file.content))
  const modeRef = useRef(mode)
  const controllerRef = useRef<Autosave | null>(null)
  const reloadRef = useRef<() => void>(() => {})
  const autosave = useAutosave(file.path)
  const { attach, markReloaded, reportConflict } = autosave

  const setModeNow = (next: BaseMode) => {
    modeRef.current = next
    setMode(next)
  }

  useEffect(() => {
    const controller = attach(() => contentOf(modeRef.current), file.mtime, '', file.content)
    controllerRef.current = controller
    let cancelled = false

    const reload = async () => {
      const fresh = await api.readFile(file.path)
      if (cancelled) return
      setModeNow(load(fresh.content))
      markReloaded(() => contentOf(modeRef.current), fresh.mtime, '', fresh.content)
    }
    reloadRef.current = () => void reload()

    const unsubscribe = watch.subscribe((ev) => {
      if (ev.type !== 'change' || ev.path !== file.path) return
      // Settle the in-flight save first so echo suppression compares against the mtime
      // of the write that caused the event (see CrepeHost).
      void controller.settled().then(() => {
        if (cancelled) return
        if (ev.mtime === controller.mtime) return // echo of our own write
        controller.update(contentOf(modeRef.current))
        if (controller.dirty) reportConflict(ev.mtime)
        else void reload()
      })
    })

    return () => {
      cancelled = true
      controllerRef.current = null
      unsubscribe()
    }
  }, [file, watch, attach, markReloaded, reportConflict])

  const onViewChange = (parsed: ParsedBase) => {
    setModeNow({ mode: 'view', parsed })
    controllerRef.current?.update(serializeBase(parsed))
  }

  /** Raw edits re-parse on every keystroke; valid YAML+views flips back to view mode. */
  const onRawChange = (text: string) => {
    const next = load(text)
    setModeNow(next)
    controllerRef.current?.update(contentOf(next))
  }

  return (
    <>
      <SaveIndicator status={autosave.status} />
      {autosave.conflictMtime !== null && (
        <div className="conflict-bar" role="alert">
          <span>File changed on disk.</span>
          <button type="button" onClick={() => reloadRef.current()}>
            Reload
          </button>
          <button type="button" onClick={autosave.keepMine}>
            Keep mine
          </button>
        </div>
      )}
      <div className="editor-host base-host">
        {mode.mode === 'view' ? (
          <BaseView
            parsed={mode.parsed}
            onChange={onViewChange}
            root={root}
            thisFile={file.path}
            records={index.records}
            indexStatus={index.status}
            indexError={index.error ?? undefined}
            types={index.types}
            registry={registry.registry}
            onOpenFile={onOpenFile}
          />
        ) : (
          <div className="base-raw-wrap">
            <p className="base-error" role="alert">
              {describeError(mode.error)}
            </p>
            <textarea
              className="base-raw"
              spellCheck={false}
              value={mode.text}
              onChange={(e) => onRawChange(e.target.value)}
            />
          </div>
        )}
      </div>
    </>
  )
}
