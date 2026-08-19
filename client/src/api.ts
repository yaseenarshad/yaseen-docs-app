import type {
  ApiError,
  ApiErrorCode,
  DirsResponse,
  FileResponse,
  FileWriteConflict,
  FileWriteRequest,
  FileWriteResponse,
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

const q = (params: Record<string, string | undefined>) => {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined) s.set(k, v)
  const str = s.toString()
  return str === '' ? '' : `?${str}`
}

export const api = {
  dirs: (path?: string) => request<DirsResponse>(`/api/dirs${q({ path })}`),
  tree: (root: string) => request<TreeResponse>(`/api/tree${q({ root })}`),
  readFile: (path: string) => request<FileResponse>(`/api/file${q({ path })}`),
  /** `keepalive` lets the PUT outlive the page (used by the beforeunload flush). */
  writeFile: (body: FileWriteRequest, keepalive = false) =>
    request<FileWriteResponse>('/api/file', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      keepalive,
    }),
}
