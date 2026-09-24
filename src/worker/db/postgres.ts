import { Pool, types, type PoolClient, type QueryResultRow } from 'pg'

// JavaScript timestamps fit safely in Number, while node-postgres returns BIGINT as strings.
types.setTypeParser(20, (value) => Number.parseInt(value, 10))

export { isPostgresDatabase } from './runtime-kind'

export interface PostgresResult<T extends QueryResultRow = QueryResultRow> {
  results: T[]
  success: true
  meta: {
    changes: number
    rows_read: number
    rows_written: number
    duration: number
  }
}

export interface PostgresPreparedStatement {
  bind(...values: unknown[]): PostgresPreparedStatement
  all<T extends QueryResultRow = QueryResultRow>(): Promise<PostgresResult<T>>
  first<T extends QueryResultRow = QueryResultRow>(column?: string): Promise<T | null>
  run(): Promise<PostgresResult>
}

export interface PostgresDatabase {
  readonly __inkstonePostgres: true
  readonly pool: Pool
  prepare(sql: string): PostgresPreparedStatement
  batch(statements: readonly PostgresPreparedStatement[]): Promise<PostgresResult[]>
  close(): Promise<void>
}

interface InternalStatement extends PostgresPreparedStatement {
  execute(client: PoolClient): Promise<PostgresResult>
}

export function createPostgresDatabase(connectionString: string): PostgresDatabase {
  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })

  return {
    __inkstonePostgres: true,
    pool,
    prepare(sql) {
      return new PreparedStatement(pool, sql)
    },
    async batch(statements) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const results: PostgresResult[] = []
        for (const statement of statements) {
          const internal = statement as InternalStatement
          if (typeof internal.execute !== 'function') {
            throw new Error('Invalid PostgreSQL prepared statement')
          }
          results.push(await internal.execute(client))
        }
        await client.query('COMMIT')
        return results
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        throw error
      } finally {
        client.release()
      }
    },
    close: () => pool.end(),
  }
}

class PreparedStatement implements InternalStatement {
  private values: unknown[] = []

  constructor(
    private readonly pool: Pool,
    private readonly sourceSql: string,
  ) {}

  bind(...values: unknown[]): PostgresPreparedStatement {
    this.values = values
    return this
  }

  async all<T extends QueryResultRow = QueryResultRow>(): Promise<PostgresResult<T>> {
    return this.execute(this.pool) as Promise<PostgresResult<T>>
  }

  async first<T extends QueryResultRow = QueryResultRow>(column?: string): Promise<T | null> {
    const result = await this.execute(this.pool)
    const row = result.results[0] as T | undefined
    if (!row) return null
    if (column) return (row as Record<string, unknown>)[column] as T
    return row
  }

  run(): Promise<PostgresResult> {
    return this.execute(this.pool)
  }

  async execute(client: PoolClient | Pool): Promise<PostgresResult> {
    const started = performance.now()
    const result = await client.query(normalizePostgresSql(this.sourceSql), this.values.map(normalizeParameter))
    const duration = performance.now() - started
    const rows = result.rows as QueryResultRow[]
    const changes = result.rowCount ?? 0
    return {
      results: rows,
      success: true,
      meta: {
        changes,
        rows_read: rows.length,
        rows_written: changes,
        duration,
      },
    }
  }
}

function normalizeParameter(value: unknown): unknown {
  if (value instanceof ArrayBuffer) return Buffer.from(value)
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  }
  return value
}

/**
 * Keeps the existing query calls usable while the SQL runs on PostgreSQL.
 * PostgreSQL. New code should use PostgreSQL syntax directly.
 */
export function normalizePostgresSql(source: string): string {
  let sql = source.trim().replace(/;\s*$/, '')

  sql = sql.replace(/\?(\d+)/g, (_match, index: string) => `$${index}`)
  sql = normalizeBareParameters(sql)
  // SQLite's NOCASE collation is attached to both comparisons and ordering.
  // Keep the same behavior with PostgreSQL expressions and functional indexes.
  sql = sql.replace(
    /([A-Za-z_][\w.]*)\s*=\s*(\$\d+)\s+COLLATE\s+NOCASE\b/gi,
    'LOWER($1) = LOWER($2)',
  )
  sql = sql.replace(
    /(\$\d+)\s*=\s*([A-Za-z_][\w.]*)\s+COLLATE\s+NOCASE\b/gi,
    'LOWER($1) = LOWER($2)',
  )
  sql = sql.replace(
    /(json_extract\([^)]*\))\s*=\s*([A-Za-z_][\w.]*)\s+COLLATE\s+NOCASE\b/gi,
    'LOWER($1) = LOWER($2)',
  )
  sql = sql.replace(
    /([A-Za-z_][\w.]*)\s+COLLATE\s+NOCASE\b/gi,
    'LOWER($1)',
  )
  sql = sql.replace(/\bCOLLATE\s+NOCASE\b/gi, '')
  sql = sql.replace(/\bIFNULL\s*\(/gi, 'COALESCE(')
  sql = sql.replace(/\bGROUP_CONCAT\(\s*([A-Za-z_][\w.]*)\s*,\s*char\(1\)\s*\)/gi, 'STRING_AGG($1, chr(1))')
  sql = sql.replace(/\bLIKE\b/gi, 'ILIKE')
  // SQLite exposes an implicit rowid on ordinary tables. PostgreSQL's ctid
  // provides the same short-lived row locator for bounded cleanup queries.
  sql = sql.replace(/\browid\b/gi, 'ctid')
  sql = sql.replace(/\bIS\s+NOT\s+\$(\d+)/gi, (_match, index: string) => `IS DISTINCT FROM $${index}`)
  sql = sql.replace(/\bIS\s+\$(\d+)/gi, (_match, index: string) => `IS NOT DISTINCT FROM $${index}`)
  sql = sql.replace(/\bIS\s+NOT\s+((?!(?:DISTINCT|NULL|TRUE|FALSE|NOT)\b)(?:[A-Za-z_][\w]*\.)?[A-Za-z_][\w]*)/gi, 'IS DISTINCT FROM $1')
  sql = sql.replace(/\bIS\s+((?!(?:DISTINCT|NULL|TRUE|FALSE|NOT)\b)(?:[A-Za-z_][\w]*\.)?[A-Za-z_][\w]*)/gi, 'IS NOT DISTINCT FROM $1')
  sql = sql.replace(/\bjson_each\s*\(\s*(\$\d+)\s*\)/gi, 'jsonb_array_elements($1::jsonb)')
  sql = sql.replace(
    /json_extract\(\s*([A-Za-z_][\w.]*)\s*,\s*'\$\.([A-Za-z_][\w]*)'\s*\)/gi,
    '($1 ->> \'$2\')',
  )
  sql = sql.replace(/CAST\(\s*([^()]+?)\s+AS\s+BLOB\s*\)/gi, "convert_to($1, 'UTF8')")
  sql = sql.replace(/\bMAX\(\s*(\$\d+)\s*,/gi, 'GREATEST($1::bigint,')
  sql = sql.replace(/\bMAX\(\s*([^(),]+?)\s*,\s*([^()]+?)\s*\)/gi, 'GREATEST($1, $2)')

  const replaceMatch = /^INSERT\s+OR\s+REPLACE\s+INTO\s+ai_index_queue\b/i.test(sql)
  const ignoreMatch = /^INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(sql)
  if (replaceMatch) {
    sql = sql.replace(/^INSERT\s+OR\s+REPLACE\s+INTO\s+/i, 'INSERT INTO ')
    if (!/\bON\s+CONFLICT\b/i.test(sql)) {
      sql += ' ON CONFLICT (user_id, note_id) DO UPDATE SET kind = EXCLUDED.kind, created_at = EXCLUDED.created_at'
    }
  } else if (ignoreMatch) {
    sql = sql.replace(/^INSERT\s+OR\s+IGNORE\s+INTO\s+/i, 'INSERT INTO ')
    if (!/\bON\s+CONFLICT\b/i.test(sql)) {
      sql += ' ON CONFLICT DO NOTHING'
    }
  }

  return sql
}

function normalizeBareParameters(sql: string): string {
  let nextIndex = 0
  for (const match of sql.matchAll(/\$(\d+)/g)) {
    nextIndex = Math.max(nextIndex, Number(match[1]))
  }

  let output = ''
  let inSingleQuote = false
  let inDoubleQuote = false
  for (let index = 0; index < sql.length; index++) {
    const character = sql[index]!
    if (character === "'" && !inDoubleQuote) {
      output += character
      if (inSingleQuote && sql[index + 1] === "'") {
        output += sql[++index]!
      } else {
        inSingleQuote = !inSingleQuote
      }
      continue
    }
    if (character === '"' && !inSingleQuote) {
      output += character
      inDoubleQuote = !inDoubleQuote
      continue
    }
    if (character === '?' && !inSingleQuote && !inDoubleQuote) {
      output += `$${++nextIndex}`
      continue
    }
    output += character
  }
  return output
}
