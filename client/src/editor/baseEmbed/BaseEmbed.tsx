/**
 * The React half of a base embed (6A, GRO-2145), portalled into the plugin's widget slot by
 * `CrepeHost`. Resolves the target by basename under the root over the bridge `tree()` (Obsidian
 * shortest-path rule, `resolveBase.ts`), reads and parses the `.base`, and renders the read-only
 * `<BaseView>` (view switcher only; `#View` picks the initial view). `this` = the EMBEDDING note
 * (kickoff LOCKED on GRO-2145): `thisFile` is the note's path, so `file.hasLink(this)` filters
 * work from the note the base is embedded in. The watcher keeps it live: a change to the resolved
 * file re-reads it, and add/unlink/ready events re-resolve (a created target fills a "not found"
 * embed in place). Nothing here ever writes — `onChange` is a no-op and the chrome is read-only.
 */
import { useEffect, useRef, useState } from 'react'
import { fileKind } from '@shared/fileKind'
import type { WatchEvent } from '@shared/types'
import { api } from '../../api'
import { BaseParseError, parseBase, type ParsedBase } from '../../bases/baseFile'
import { BaseView } from '../../bases/BaseView'
import { useIndex } from '../../bases/useIndex'
import type { WatchSource } from '../../hooks/useWatch'
import { resolveBasePath } from './resolveBase'
import '../../bases/bases.css'

export interface BaseEmbedProps {
  root: string
  watch: WatchSource
  /** Absolute path of the note the embed sits in; `this` in the embedded base's expressions. */
  thisFile: string
  /** The embed's target text (`X.base`, possibly with a folder). */
  target: string
  /** The `#View` part: initial view by name; null = the base's first view. */
  viewName: string | null
  onOpenFile: (path: string) => void
}

type EmbedState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'ready'; path: string; parsed: ParsedBase }

/** Could this watch event change what the embed target resolves to? */
function touchesResolution(ev: WatchEvent): boolean {
  switch (ev.type) {
    case 'ready':
    case 'unlinkDir':
      return true
    case 'add':
    case 'unlink':
      return fileKind(ev.path) === 'base'
    default:
      return false
  }
}

export function BaseEmbed({ root, watch, thisFile, target, viewName, onOpenFile }: BaseEmbedProps) {
  const index = useIndex(root, watch)
  const [state, setState] = useState<EmbedState>({ status: 'loading' })
  const pathRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // Bumped per (re-)resolution so only the latest async chain may commit.
    let generation = 0

    const read = async (path: string) => {
      const gen = generation
      try {
        const fresh = await api.readFile(path)
        if (cancelled || gen !== generation) return
        setState({ status: 'ready', path, parsed: parseBase(fresh.content) })
      } catch (err) {
        if (cancelled || gen !== generation) return
        if (err instanceof BaseParseError) setState({ status: 'error', message: err.message.split('\n')[0] ?? err.message })
        else setState({ status: 'missing' })
      }
    }

    const resolve = async () => {
      const gen = ++generation
      try {
        const res = await api.tree(root)
        if (cancelled || gen !== generation) return
        const path = resolveBasePath(res.tree, res.root, target)
        pathRef.current = path
        if (path === null) setState({ status: 'missing' })
        else await read(path)
      } catch (err) {
        if (cancelled || gen !== generation) return
        setState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    }

    void resolve()
    const unsubscribe = watch.subscribe((ev) => {
      if (ev.type === 'change' && ev.path === pathRef.current) void read(ev.path)
      else if (touchesResolution(ev)) void resolve()
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [root, watch, target])

  if (state.status === 'loading') return <p className="base-embed__msg">Loading {target}…</p>
  if (state.status === 'missing')
    return (
      <p className="base-embed__msg base-embed__msg--missing" role="note">
        Base not found: {target}
      </p>
    )
  if (state.status === 'error')
    return (
      <p className="base-embed__msg base-embed__msg--missing" role="note">
        Could not load {target}: {state.message}
      </p>
    )

  return (
    <BaseView
      parsed={state.parsed}
      onChange={() => {}}
      readOnly
      initialView={viewName ?? undefined}
      root={root}
      thisFile={thisFile}
      records={index.records}
      indexStatus={index.status}
      indexError={index.error ?? undefined}
      types={index.types}
      onOpenFile={onOpenFile}
    />
  )
}
