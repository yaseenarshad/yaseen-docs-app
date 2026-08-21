import type {
  ApiError,
  ApiErrorCode,
  CreateDirResponse,
  CreateFileResponse,
  DirsResponse,
  FileResponse,
  FileWriteConflict,
  FileWriteRequest,
  FileWriteResponse,
  PickFolderResponse,
  TreeResponse,
} from '@shared/types'

/** Typed failure from the local server (see docs/CONTRACTS.md "HTTP API"). */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | 'CONFLICT',
    message: string,
    /** Current on-disk mtime, only present on 409 CONFLICT. */
    readonly mtime?: number,
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (res.ok) return (await res.json()) as T
  const body = (await res.json().catch(() => undefined)) as ApiError | FileWriteConflict | undefined
  const err = body?.error
  const mtime = err !== undefined && 'mtime' in err ? err.mtime : undefined
  throw new ApiRequestError(res.status, err?.code ?? 'IO_ERROR', err?.message ?? res.statusText, mtime)
}

const enc = encodeURIComponent

export const api = {
  dirs: (path?: string) => request<DirsResponse>(path === undefined ? '/api/dirs' : `/api/dirs?path=${enc(path)}`),
  tree: (root: string) => request<TreeResponse>(`/api/tree?root=${enc(root)}`),
  /** Native Finder dialog; resolves when the user picks or cancels. 501 NOT_SUPPORTED off macOS. */
  pickFolder: () => request<PickFolderResponse>('/api/pick-folder', { method: 'POST' }),
  createDir: (path: string) =>
    request<CreateDirResponse>('/api/create-dir', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    }),
  createFile: (path: string) =>
    request<CreateFileResponse>('/api/create-file', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    }),
  readFile: (path: string) => request<FileResponse>(`/api/file?path=${enc(path)}`),
  /** `keepalive` lets the PUT outlive the page (used by the beforeunload flush). */
  writeFile: (body: FileWriteRequest, keepalive = false) =>
    request<FileWriteResponse>('/api/file', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      keepalive,
    }),
}
