import { createServer } from 'node:http'
import { getRequestListener } from '@hono/node-server'
import { createApp } from '../worker/app'
import { initializeDatabase } from '../worker/db/schema'
import { createNodeRuntime } from './runtime'
import { handleMcpRequest } from './mcp'
import { RealtimeHub, installRealtimeUpgrade } from './realtime'

const runtime = await createNodeRuntime()
await initializeDatabase(runtime.env)
const realtime = new RealtimeHub(runtime.redis)
runtime.env.REALTIME = realtime
const app = createApp()

const listener = getRequestListener(async (request) => {
  const executionCtx = {
    waitUntil(task: Promise<unknown>) {
      void task.catch((error) => console.error('[inkstone] background task failed:', error))
    },
    passThroughOnException() {},
    props: {},
  }
  const pathname = new URL(request.url).pathname
  if (pathname === '/mcp' || pathname.startsWith('/mcp/')) {
    return handleMcpRequest(request, runtime.env, executionCtx)
  }
  return app.fetch(request, runtime.env, executionCtx)
})

const server = createServer(listener)
installRealtimeUpgrade(server, realtime, runtime.db as unknown as import('../worker/env').Database)
server.listen(Number(process.env.PORT || 3000), process.env.HOST || '0.0.0.0', () => {
  console.log(`[inkstone] Node server listening on http://${process.env.HOST || '0.0.0.0'}:${process.env.PORT || 3000}`)
})

const shutdown = async () => {
  server.close()
  await realtime.close()
  await runtime.close()
  process.exit(0)
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
