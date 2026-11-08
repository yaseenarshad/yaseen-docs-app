import { randomUUID } from 'node:crypto'
import { AutomationFailure, publicCode } from '@shared/automation'
import type { FileOperationTarget, InspectTarget, NavigationTarget, RendererCommand, RendererReply } from '@shared/automationNavigation'

export interface RendererPage {
  id: number
  send(channel: string, command: RendererCommand): void
}

/** Acknowledgements belong to the exact renderer asked. Nothing is considered applied on send alone. */
export class RendererRequests {
  private readonly ready = new Set<number>()
  private readonly pending = new Map<string, { page: RendererPage; command: RendererCommand; finish(value: RendererReply): void; sent: boolean }>()
  constructor(private readonly channel: string) {}

  setReady(page: RendererPage, ready: boolean): void {
    if (!ready) { this.ready.delete(page.id); return }
    this.ready.add(page.id)
    for (const request of this.pending.values()) if (request.page.id === page.id && !request.sent) this.send(request)
  }

  closed(pageId: number): void {
    this.ready.delete(pageId)
    for (const [id, request] of this.pending) if (request.page.id === pageId) request.finish({ id, ok: false, error: { code: 'WINDOW_CLOSED', message: 'The target window closed before acknowledgement.' } })
  }

  reply(pageId: number, reply: RendererReply): void {
    const request = this.pending.get(reply.id)
    if (request?.page.id === pageId) request.finish(reply)
  }

  navigate(page: RendererPage, target: NavigationTarget): Promise<unknown> {
    return this.request(page, { id: randomUUID(), action: 'navigate', target })
  }

  inspect(page: RendererPage, target: InspectTarget): Promise<unknown> {
    return this.request(page, { id: randomUUID(), action: 'inspect', target })
  }

  operate(page: RendererPage, target: FileOperationTarget): Promise<unknown> {
    return this.request(page, { id: randomUUID(), action: 'operate', target })
  }

  private request(page: RendererPage, command: RendererCommand): Promise<unknown> {
    const { id } = command
    return new Promise((resolve, reject) => {
      // The caller's 30-second timeout does not cancel this handshake. A dead renderer still has a finite bound.
      const timer = setTimeout(() => finish({ id, ok: false, error: { code: 'RENDERER_TIMEOUT', message: 'The renderer did not acknowledge. Its final state is unknown.' } }), 120_000)
      const finish = (reply: RendererReply) => {
        clearTimeout(timer); this.pending.delete(id)
        if (reply.ok) resolve(reply.value)
        else reject(new AutomationFailure(publicCode(reply.error.code), reply.error.message, reply.error.details))
      }
      const request = { page, command, finish, sent: false }
      this.pending.set(id, request)
      if (this.ready.has(page.id)) this.send(request)
    })
  }

  private send(request: { page: RendererPage; command: RendererCommand; finish(value: RendererReply): void; sent: boolean }): void {
    request.sent = true
    try { request.page.send(this.channel, request.command) }
    catch { request.finish({ id: request.command.id, ok: false, error: { code: 'WINDOW_CLOSED', message: 'The target window is unavailable.' } }) }
  }
}
