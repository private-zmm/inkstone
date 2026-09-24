import type { IncomingMessage, Server as HttpServer } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, WebSocket } from 'ws'
import type { Database, RealtimeService } from '../worker/env'
import { hashToken, isSessionToken } from '../worker/lib/session-store'
import { sessionCookieNames } from '../worker/middleware/auth'
import type { RedisServices } from './redis'

interface SessionRow { id: string; expires_at: number }

export class RealtimeHub implements RealtimeService {
  private readonly sockets = new Map<string, Set<WebSocket>>()
  private readonly server = new WebSocketServer({ noServer: true })

  constructor(private readonly redis: RedisServices) {
    void this.redis.subscriber.psubscribe('inkstone:user:*:changes')
    this.redis.subscriber.on('pmessage', (_pattern, channel, message) => {
      const userId = channel.split(':')[2]
      if (!userId) return
      let payload: unknown
      try { payload = JSON.parse(message) } catch { return }
      const sockets = this.sockets.get(userId)
      if (!sockets) return
      for (const socket of sockets) {
        if (socket.readyState !== WebSocket.OPEN) continue
        socket.send(JSON.stringify(payload))
      }
    })
  }

  async notify(userId: string, cursor: number, origin: string | null): Promise<void> {
    await this.redis.publisher.publish(
      `inkstone:user:${userId}:changes`,
      JSON.stringify({ type: 'changed', cursor, origin }),
    )
  }

  async handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    db: Database,
  ): Promise<boolean> {
    const origin = typeof request.headers.origin === 'string' ? request.headers.origin : null
    const host = request.headers.host ? `http://${request.headers.host}` : null
    if (origin && host && new URL(origin).origin !== new URL(host).origin) {
      socket.destroy()
      return true
    }
    const userId = await authenticateSocket(request, db)
    if (!userId) {
      socket.destroy()
      return true
    }
    this.server.handleUpgrade(request, socket, head, (ws) => {
      this.attach(userId, ws)
    })
    return true
  }

  close(): Promise<void> {
    for (const sockets of this.sockets.values()) {
      for (const socket of sockets) socket.close(1001, 'Server shutting down')
    }
    this.sockets.clear()
    return new Promise((resolve) => this.server.close(() => resolve()))
  }

  private attach(userId: string, socket: WebSocket): void {
    const connections = this.sockets.get(userId) ?? new Set<WebSocket>()
    if (connections.size >= 32) {
      socket.close(1013, 'Too many realtime connections')
      return
    }
    connections.add(socket)
    this.sockets.set(userId, connections)
    socket.on('message', (message) => {
      const size = Array.isArray(message)
        ? message.reduce((total, chunk) => total + chunk.byteLength, 0)
        : message.byteLength
      if (size > 1024) return socket.close(1009, 'Message too large')
      try {
        const value = JSON.parse(message.toString()) as { type?: unknown }
        if (value.type !== 'ping') return
        socket.send(JSON.stringify({ type: 'pong', serverTime: Date.now() }))
      } catch {
      }
    })
    socket.on('close', () => {
      connections.delete(socket)
      if (!connections.size) this.sockets.delete(userId)
    })
    socket.on('error', () => socket.close())
  }
}

export function installRealtimeUpgrade(server: HttpServer, hub: RealtimeHub, db: Database): void {
  server.on('upgrade', (request, socket, head) => {
    if (new URL(request.url || '/', 'http://localhost').pathname !== '/api/sync/ws') {
      socket.destroy()
      return
    }
    void hub.handleUpgrade(request, socket, head, db)
  })
}

async function authenticateSocket(request: IncomingMessage, db: Database): Promise<string | null> {
  const url = new URL(request.url || '/', 'http://localhost')
  const cookies = parseCookies(request.headers.cookie)
  for (const name of sessionCookieNames(url.toString())) {
    const token = cookies.get(name)
    if (!token || !isSessionToken(token)) continue
    const row = await db.prepare(
      `SELECT s.user_id AS id, s.expires_at FROM sessions s
        WHERE s.id = ?1 AND s.expires_at > ?2`,
    ).bind(await hashToken(token), Date.now()).first<SessionRow>()
    if (row?.id) return row.id
  }
  return null
}

function parseCookies(value: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>()
  for (const part of value?.split(';') ?? []) {
    const separator = part.indexOf('=')
    if (separator <= 0) continue
    cookies.set(part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim()))
  }
  return cookies
}
