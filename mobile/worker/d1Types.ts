/**
 * Minimal Cloudflare D1 TypeScript surface so `mobile/worker/` stays zero-dependency
 * and testable with a lightweight in-memory D1 adapter.
 */
export interface D1Result<T = Record<string, unknown>> {
  results: T[]
  success: boolean
  meta?: { changes?: number }
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>
  run(): Promise<D1Result>
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>
}
