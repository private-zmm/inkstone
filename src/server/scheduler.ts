import { runAttachmentCleanup } from '../worker/attachments/cleanup'
import { runScheduledBackups } from '../worker/backup/scheduler'
import { drainAllFtsQueues } from '../worker/db/fts'
import { initializeDatabase } from '../worker/db/schema'
import { purgeRevokedMcpApiKeys } from '../worker/mcp/api-keys'
import { drainAiIndexQueue } from '../worker/mcp/ai-search'
import { purgeExpiredMcpOperations } from '../worker/mcp/operations'
import { purgeExpiredOperationalData } from '../worker/lib/maintenance'
import { createNodeRuntime } from './runtime'
import { withRedisLock } from './redis'

const runtime = await createNodeRuntime()
await initializeDatabase(runtime.env)

async function runScheduledTasks(): Promise<void> {
  const result = await withRedisLock(
    runtime.redis.client,
    'inkstone:lock:scheduler',
    55_000,
    async () => {
      await Promise.all([
        runScheduledBackups(runtime.env),
        runAttachmentCleanup(runtime.env),
        purgeExpiredMcpOperations(runtime.env.DB),
        purgeExpiredOperationalData(runtime.env.DB),
        purgeRevokedMcpApiKeys(runtime.env.DB),
        drainAiIndexQueue(runtime.env, 300),
        drainAllFtsQueues(runtime.env.DB),
      ])
    },
  )
  if (result === null) return
  console.log('[inkstone] Scheduled maintenance completed')
}

const interval = Number(process.env.SCHEDULER_INTERVAL_MS || 60_000)
await runScheduledTasks().catch((error) => {
  console.error('[inkstone] Initial scheduled maintenance failed:', error)
})
const timer = setInterval(() => {
  void runScheduledTasks().catch((error) => {
    console.error('[inkstone] Scheduled maintenance failed:', error)
  })
}, Math.max(10_000, interval))

console.log(`[inkstone] Scheduler started with ${Math.max(10_000, interval)}ms interval`)

const shutdown = async () => {
  clearInterval(timer)
  await runtime.close()
  process.exit(0)
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
