export function isPostgresDatabase(value: unknown): value is {
  readonly __inkstonePostgres: true
} {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as { __inkstonePostgres?: unknown }).__inkstonePostgres === true,
  )
}
