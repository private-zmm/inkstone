import { createMcpHandler } from '@modelcontextprotocol/server'
import type { Env, TaskContext } from '../worker/env'
import { initializeDatabase } from '../worker/db/schema'
import { verifyMcpApiKey } from '../worker/mcp/api-keys'
import { createInkstoneMcpServer } from '../worker/mcp/server'
import { isMcpEnabled } from '../worker/mcp/settings'

export async function handleMcpRequest(
  request: Request,
  env: Env,
  executionCtx: TaskContext,
): Promise<Response> {
  const database = await initializeDatabase(env)
  if (!await isMcpEnabled(env.DB)) {
    return Response.json({ error: 'MCP is disabled in Inkstone settings' }, { status: 403 })
  }
  const token = bearerToken(request.headers.get('Authorization'))
  if (!token) return Response.json({ error: 'Bearer API key required' }, { status: 401 })
  const auth = await verifyMcpApiKey(env.DB, token)
  if (!auth) return Response.json({ error: 'Invalid or revoked MCP API key' }, { status: 401 })

  const origin = configuredOrigin(request, env.PUBLIC_URL)
  const handler = createMcpHandler(
    () => createInkstoneMcpServer({
      env,
      auth,
      origin,
      ftsEnabled: database.ftsEnabled,
      executionCtx,
    }),
    {},
  )
  return handler.fetch(request, {
    authInfo: {
      token,
      clientId: 'inkstone-api-key',
      scopes: auth.scopes,
    },
  })
}

function bearerToken(value: string | null): string | null {
  if (!value) return null
  const match = /^Bearer\s+(.+)$/i.exec(value.trim())
  return match?.[1]?.trim() || null
}

function configuredOrigin(request: Request, configured?: string): string {
  try {
    return configured ? new URL(configured).origin : new URL(request.url).origin
  } catch {
    return new URL(request.url).origin
  }
}
