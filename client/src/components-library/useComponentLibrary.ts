/**
 * THE SAVED COMPONENTS, AS THE ADD TAB USES THEM (🔒 YAZ-1775 D5, YAZ-1819; YAZ-4157 D6): list them, save the selection
 * as one, import a file as one, insert, rename and delete. `docs/CONTRACTS.md` § Components is the normative
 * description of the doors and the on-disk shape. The Components TAB is gone: its rows are tiles of the Add tab now,
 * so this hook owns the actions and the Add tab draws them.
 *
 * The whole library is a folder of small files, so it is listed once, kept in the Add tab's session (it outlives a
 * close of the panel), and ranked in the renderer by `rankItems` with everything else. The `components:changed` push
 * re-lists it, which is what makes one library out of every vault.
 *
 * NO NATIVE DIALOGS. The rename is a field in the tile and the delete is a confirm row in it, and 🔒 `confirmDelete`
 * (Settings › Files & Links) decides whether that row appears at all.
 *
 * WHAT AN INSERT COSTS ON DISK: the component's images become `assets/` files in THIS vault the first time the board
 * is saved after it (🔒 YAZ-1775 D3) — see `componentData.ts`.
 */
import { useEffect, useState } from 'react'
import type { ComponentItem, StudioItem } from '@shared/types'
import { api } from '../api'
import { loadExcalidrawElement } from '../drawings/engine'
import { createPreviewCache } from '../lib/previewCache'
import { storage } from '../lib/storage'
import { createScenePreviewPng, type PreviewEngine } from '../lib/scenePreview'
import { getErrorMessage, imageStudioSession } from '../image-studio/imageStudioSession'
import { captureComponentSelection, componentFragmentJson, insertComponent, type CapturedComponent, type ComponentElementApi, type ComponentEngine, type ComponentTarget } from './componentData'
import { importedComponentName, parseImportedComponentJson } from './componentImport'

/** What an import that is not a component says — passively, because nothing was written. */
export const IMPORT_FAILED = 'That file could not be imported as a component.'

/** A saved component as an Add tab tile (YAZ-4157 D2): its slug is its id, so a rename keeps every favorite and count. */
export const componentItem = (component: ComponentItem): StudioItem => ({
  itemKey: `component:${component.slug}`,
  provider: 'component',
  providerId: component.slug,
  kind: 'component',
  title: component.name,
})

/**
 * The tile pictures, keyed by SLUG — a component's identity. Cleared whenever the library itself changes, because a
 * slug that came back means different bytes. Bounded like the media tiles (YAZ-2073 8B), 32 MB of dataURLs at most
 * (YAZ-3737 S13): one big page component can cost more than many small ones.
 */
export const componentPreviews = createPreviewCache(async (slug) => api.components.preview({ slug }), { limit: 300, maxBytes: 32 * 1024 * 1024 })

/** Where the hook reports: `error` is a failure; `notice` is passive (a refused import changed nothing, YAZ-1833). */
export type ComponentReport = (kind: 'error' | 'notice', message: string) => void

export function useComponentLibrary(engine: ComponentEngine & PreviewEngine, excalidrawAPI: ComponentTarget, report: ComponentReport) {
  const [element, setElement] = useState<ComponentElementApi | null>(null)
  const [captured, setCaptured] = useState<CapturedComponent | null>(null)
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [busySlug, setBusySlug] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(() => storage.getSettings().confirmDelete)
  const setComponents = (next: (current: ComponentItem[]) => ComponentItem[]) => imageStudioSession.set({ components: next(imageStudioSession.getState().components) })

  // The library, and the ONE push that keeps it true in every window and every vault (🔒 YAZ-1775 D5).
  useEffect(() => {
    let live = true
    const refresh = () => {
      void api.components.list().then(
        (list) => live && imageStudioSession.set({ components: list }),
        (cause: unknown) => live && report('error', getErrorMessage(cause, 'Components could not be loaded.')),
      )
    }
    refresh()
    const off = api.components.onChanged(() => {
      // A slug that came back means different bytes; the pictures are re-asked for.
      componentPreviews.clear()
      refresh()
    })
    return () => {
      live = false
      off()
    }
    // Once per mount: `report` is a new closure each render, and a re-list per render would be a loop.
  }, [])

  // 🔒 `confirmDelete` is read off the renderer's own state cache, the seam `App` reads it from, so a change in any
  // window reaches this tab too.
  useEffect(() => storage.subscribe(() => setConfirmDelete(storage.getSettings().confirmDelete)), [])

  // The element package, lazily (YAZ-1818's second package): only a CAPTURE needs it.
  useEffect(() => {
    let live = true
    void loadExcalidrawElement().then(
      (mod) => live && setElement(mod as ComponentElementApi),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [])

  const run = async (slug: string, action: () => Promise<void>, fallback: string): Promise<boolean> => {
    setBusySlug(slug)
    try {
      await action()
      return true
    } catch (cause) {
      report('error', getErrorMessage(cause, fallback))
      return false
    } finally {
      setBusySlug(null)
    }
  }

  /** The selection, captured; the name form shows while this is set. Gated on the element package being here. */
  const startSave = () => {
    if (element === null) return
    try {
      setCaptured(captureComponentSelection(element, excalidrawAPI))
    } catch (cause) {
      report('error', getErrorMessage(cause, 'The selection cannot be saved as a component'))
    }
  }

  const commitSave = async (name: string) => {
    if (captured === null || name.trim() === '') return
    setSaving(true)
    try {
      const previewPng = await createScenePreviewPng(engine, { elements: captured.elements, appState: excalidrawAPI.getAppState() as unknown as Record<string, unknown>, files: captured.files })
      const saved = await api.components.save({ name: name.trim(), fragmentJson: componentFragmentJson(captured), previewPng })
      setComponents((current) => [saved, ...current.filter((row) => row.slug !== saved.slug)])
      setCaptured(null)
    } catch (cause) {
      report('error', getErrorMessage(cause, 'The component could not be saved'))
    } finally {
      setSaving(false)
    }
  }

  /**
   * Import (YAZ-1833): the native picker, the ported parser, then the SAME save door "Save selection" uses. The name
   * is the file's own base name. A failure anywhere is a passive notice and NOTHING written.
   */
  const importFile = async () => {
    setImporting(true)
    try {
      const picked = await api.dialog.openDrawing()
      if ('cancelled' in picked) return
      const imported = parseImportedComponentJson(engine, picked.content)
      const previewPng = await createScenePreviewPng(engine, { elements: imported.elements, appState: excalidrawAPI.getAppState() as unknown as Record<string, unknown>, files: imported.files })
      const saved = await api.components.save({ name: importedComponentName(picked.name), fragmentJson: componentFragmentJson(imported), previewPng })
      setComponents((current) => [saved, ...current.filter((row) => row.slug !== saved.slug)])
    } catch (cause) {
      report('notice', getErrorMessage(cause, IMPORT_FAILED))
    } finally {
      setImporting(false)
    }
  }

  /** Read the fragment and hand it to the engine's own insert door; the engine makes each copy independent. */
  const insert = async (slug: string) => {
    const { fragmentJson } = await api.components.read({ slug })
    insertComponent(engine, excalidrawAPI, fragmentJson)
  }

  /** The tile takes the name the STORE answers with, and only once it answered: a refused rename keeps the old name. */
  const rename = (component: ComponentItem, next: string) => {
    const name = next.trim()
    if (name === '' || name === component.name) return
    void run(
      component.slug,
      async () => {
        const renamed = await api.components.rename({ slug: component.slug, name })
        setComponents((current) => current.map((row) => (row.slug === component.slug ? renamed : row)))
      },
      `${component.name} could not be renamed`,
    )
  }

  /** Both files to the Trash, and the row out of the library. */
  const remove = (component: ComponentItem) =>
    void run(
      component.slug,
      async () => {
        await api.components.delete({ slug: component.slug })
        setComponents((current) => current.filter((row) => row.slug !== component.slug))
      },
      `${component.name} could not be deleted`,
    )

  return {
    /** Save selection can start: the board has a selection (the caller knows) and the element package is here. */
    canCapture: element !== null && captured === null,
    captured,
    saving,
    importing,
    busySlug,
    confirmDelete,
    startSave,
    /** A picture pasted or dropped into the tab (demo 6M, `pastedImage.ts`): the name form, for it and not the selection. */
    startSaveFrom: (picture: CapturedComponent) => setCaptured(picture),
    cancelSave: () => setCaptured(null),
    commitSave,
    importFile,
    insert,
    rename,
    remove,
  }
}
