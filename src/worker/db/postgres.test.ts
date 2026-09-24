import { describe, expect, it } from 'vitest'
import { normalizePostgresSql } from './postgres'

describe('normalizePostgresSql', () => {
  it('translates numbered parameters without changing their indexes', () => {
    expect(normalizePostgresSql(
      'SELECT * FROM folders WHERE parent_id IS ?3 AND color IS NOT ?5',
    )).toBe(
      'SELECT * FROM folders WHERE parent_id IS NOT DISTINCT FROM $3 AND color IS DISTINCT FROM $5',
    )
  })

  it('translates anonymous parameters while ignoring question marks in strings', () => {
    expect(normalizePostgresSql(
      "SELECT * FROM links WHERE user_id = ? AND target_key LIKE ? ESCAPE '?'",
    )).toBe(
      "SELECT * FROM links WHERE user_id = $1 AND target_key ILIKE $2 ESCAPE '?'",
    )
  })

  it('translates SQLite JSON and conflict syntax', () => {
    expect(normalizePostgresSql(
      "INSERT OR IGNORE INTO tags (id) SELECT json_extract(j.value, '$.id') FROM json_each(?1) AS j",
    )).toBe(
      "INSERT INTO tags (id) SELECT (j.value ->> 'id') FROM jsonb_array_elements($1::jsonb) AS j ON CONFLICT DO NOTHING",
    )
  })

  it('translates conflict syntax after a CTE', () => {
    expect(normalizePostgresSql(
      'WITH source AS (SELECT 1) INSERT OR IGNORE INTO folders (id) SELECT 1 WHERE EXISTS (SELECT 1 FROM source)',
    )).toBe(
      'WITH source AS (SELECT 1) INSERT INTO folders (id) SELECT 1 WHERE EXISTS (SELECT 1 FROM source) ON CONFLICT DO NOTHING',
    )
  })

  it('maps the AI queue replacement to a PostgreSQL upsert', () => {
    expect(normalizePostgresSql(
      'INSERT OR REPLACE INTO ai_index_queue (user_id, note_id, kind, created_at) VALUES (?1, ?2, ?3, ?4)',
    )).toContain('ON CONFLICT (user_id, note_id) DO UPDATE SET')
  })

  it('translates note tag aggregation for sync snapshots', () => {
    expect(normalizePostgresSql(
      'SELECT GROUP_CONCAT(t.name, char(1)) AS tag_names FROM note_tags nt',
    )).toBe(
      'SELECT STRING_AGG(t.name, chr(1)) AS tag_names FROM note_tags nt',
    )
  })

  it('translates SQLite unlimited pagination to PostgreSQL LIMIT ALL', () => {
    expect(normalizePostgresSql(
      'SELECT * FROM notes LIMIT -1 OFFSET ?8',
    )).toBe(
      'SELECT * FROM notes LIMIT ALL OFFSET $8',
    )
    expect(normalizePostgresSql(
      'SELECT * FROM notes limit   -1   offset ?2',
    )).toBe(
      'SELECT * FROM notes LIMIT ALL OFFSET $2',
    )
    expect(normalizePostgresSql(
      'SELECT * FROM notes LIMIT -1',
    )).toBe(
      'SELECT * FROM notes LIMIT ALL',
    )
  })

  it('casts millisecond timestamps in nested SQLite MAX calls', () => {
    expect(normalizePostgresSql(
      'SELECT MAX(?3, COALESCE((SELECT created_at + 1 FROM ai_index_queue), ?3))',
    )).toBe(
      'SELECT GREATEST($3::bigint, COALESCE((SELECT created_at + 1 FROM ai_index_queue), $3))',
    )
  })

  it('keeps SQLite case-insensitive comparisons and bounded row cleanup', () => {
    expect(normalizePostgresSql(
      'DELETE FROM mcp_operations WHERE rowid IN (SELECT rowid FROM mcp_operations WHERE created_at < ?1 ORDER BY created_at, rowid LIMIT ?2)',
    )).toContain('ctid IN (SELECT ctid FROM mcp_operations')
    expect(normalizePostgresSql(
      'SELECT * FROM tags WHERE name = ?1 COLLATE NOCASE ORDER BY name COLLATE NOCASE',
    )).toBe('SELECT * FROM tags WHERE LOWER(name) = LOWER($1) ORDER BY LOWER(name)')
  })
})
