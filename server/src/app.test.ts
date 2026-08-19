import { describe, it, expect } from 'vitest'
import { app } from './app'

describe('app', () => {
  it('GET /api/health', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
