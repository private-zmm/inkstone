import 'dotenv/config'
import { resolve } from 'node:path'
import type { Env } from '../worker/env'
import { createPostgresDatabase, type PostgresDatabase } from '../worker/db/postgres'
import { createFileAssets } from './assets'
import { createExternalEmbedding } from './embedding'
import { createMinioClient, ensureMinioBuckets, MinioBucketAdapter } from './minio'
import { closeRedisServices, createRedisServices, type RedisServices } from './redis'

export interface NodeRuntime {
  env: Env
  db: PostgresDatabase
  redis: RedisServices
  close(): Promise<void>
}

export async function createNodeRuntime(): Promise<NodeRuntime> {
  const databaseUrl = required('DATABASE_URL')
  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379'
  const s3Endpoint = process.env.S3_ENDPOINT || 'http://127.0.0.1:9000'
  const s3Region = process.env.S3_REGION || 'us-east-1'
  const s3AccessKeyId = required('S3_ACCESS_KEY_ID')
  const s3SecretAccessKey = required('S3_SECRET_ACCESS_KEY')
  const filesBucket = process.env.S3_FILES_BUCKET || 'inkstone-files'
  const backupsBucket = process.env.S3_BACKUPS_BUCKET || 'inkstone-backups'
  const encryptionKey = required('ENCRYPTION_KEY')

  const db = createPostgresDatabase(databaseUrl)
  const redis = createRedisServices(redisUrl)
  const s3 = createMinioClient({
    endpoint: s3Endpoint,
    region: s3Region,
    accessKeyId: s3AccessKeyId,
    secretAccessKey: s3SecretAccessKey,
    filesBucket,
    backupsBucket,
  })
  await ensureMinioBuckets(s3, {
    endpoint: s3Endpoint,
    region: s3Region,
    accessKeyId: s3AccessKeyId,
    secretAccessKey: s3SecretAccessKey,
    filesBucket,
    backupsBucket,
  })

  const embedding = process.env.EMBEDDING_BASE_URL && process.env.EMBEDDING_API_KEY
    ? createExternalEmbedding({
        baseUrl: process.env.EMBEDDING_BASE_URL,
        apiKey: process.env.EMBEDDING_API_KEY,
        model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
      })
    : undefined

  const env = {
    DB: db as unknown as Env['DB'],
    ASSETS: createFileAssets(resolve(process.env.CLIENT_ASSETS_DIR || 'dist/client')) as unknown as Env['ASSETS'],
    FILES: new MinioBucketAdapter(s3, filesBucket) as unknown as NonNullable<Env['FILES']>,
    APP_NAME: process.env.APP_NAME || 'Inkstone',
    PUBLIC_URL: process.env.PUBLIC_URL || 'http://localhost:3000',
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    S3_ENDPOINT: s3Endpoint,
    S3_REGION: s3Region,
    S3_ACCESS_KEY_ID: s3AccessKeyId,
    S3_SECRET_ACCESS_KEY: s3SecretAccessKey,
    S3_FILES_BUCKET: filesBucket,
    S3_BACKUPS_BUCKET: backupsBucket,
    EMBEDDING_BASE_URL: process.env.EMBEDDING_BASE_URL,
    EMBEDDING_API_KEY: process.env.EMBEDDING_API_KEY,
    EMBEDDING_MODEL: process.env.EMBEDDING_MODEL,
    ENCRYPTION_KEY: encryptionKey,
    ASSETS_DIR: resolve(process.env.CLIENT_ASSETS_DIR || 'dist/client'),
    ...(embedding ? { AI: embedding } : {}),
  } as unknown as Env

  return {
    env,
    db,
    redis,
    async close() {
      await closeRedisServices(redis)
      await db.close()
    },
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}
