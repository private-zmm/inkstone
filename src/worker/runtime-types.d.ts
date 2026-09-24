import type { Database as LocalDatabase, PreparedStatement as LocalPreparedStatement, QueryResult as LocalQueryResult } from './env'

declare global {
  type Database = LocalDatabase
  type PreparedStatement = LocalPreparedStatement
  type QueryResult<T = Record<string, unknown>> = LocalQueryResult<T>
  interface ExecutionContext {
    waitUntil(task: Promise<unknown>): void
  }
}

export {}
