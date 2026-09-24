
export interface PreparedStatement {
  bind(...values: unknown[]): PreparedStatement
  all<T = Record<string, unknown>>(): Promise<QueryResult<T>>
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>
  run(): Promise<QueryResult>
}

export interface Database {
  prepare(sql: string): PreparedStatement
  batch(statements: readonly PreparedStatement[]): Promise<QueryResult[]>
}

export interface QueryResult<T = Record<string, unknown>> {
  results: T[]
  success: true
  meta: { changes: number; rows_read: number; rows_written: number; duration: number }
}

export interface ObjectStorage {
  put(key: string, value: Uint8Array, options?: {
    httpMetadata?: { contentType?: string; cacheControl?: string }
    customMetadata?: Record<string, string>
  }): Promise<void>
  get(key: string): Promise<{
    body: ReadableStream<Uint8Array>
    size: number
    customMetadata?: Record<string, string>
    httpMetadata?: { contentType?: string }
    arrayBuffer(): Promise<ArrayBuffer>
  } | null>
  delete(keys: string | string[]): Promise<void>
}

export interface AssetFetcher { fetch(request: Request): Promise<Response> }
export interface TaskContext { waitUntil(task: Promise<unknown>): void }
export interface RealtimeService {
  notify(userId: string, cursor: number, origin: string | null): Promise<void>
}

export interface Env {

  DB: Database

  ASSETS: AssetFetcher

  FILES?: ObjectStorage

  APP_NAME?: string

  PUBLIC_URL?: string

  AI?: {
    run: <T = unknown>(model: string, inputs: unknown) => Promise<T>
  }

  DATABASE_URL?: string

  REDIS_URL?: string

  S3_ENDPOINT?: string

  S3_REGION?: string

  S3_ACCESS_KEY_ID?: string

  S3_SECRET_ACCESS_KEY?: string

  S3_FILES_BUCKET?: string

  S3_BACKUPS_BUCKET?: string

  EMBEDDING_BASE_URL?: string

  EMBEDDING_API_KEY?: string

  EMBEDDING_MODEL?: string

  ENCRYPTION_KEY?: string

  ASSETS_DIR?: string

  TASK_CONTEXT?: TaskContext
  REALTIME?: RealtimeService
}

export interface DatabaseState {
  ftsEnabled: boolean
}


export interface Variables {

  database: DatabaseState
  userId: string

  sessionId: string

  user: {
    id: string
    username: string
    login: string
    name: string
    avatarUrl: string
    role: 'owner' | 'member'
    createdAt: number
    settingsRaw: string
  }
}

export type AppBindings = { Bindings: Env; Variables: Variables }
