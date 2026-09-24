import type { Env } from '../env'
import type { AttachmentObjectStorage } from './keys'

export interface AttachmentObjectMetadata {
  userId: string
  objectId: string
  kind: 'attachment' | 'avatar'
  filename: string
  mime: string
  sha256: string
}

export interface AttachmentObjectStream {
  body: ReadableStream<Uint8Array>
  size: number | null
  metadata: Partial<AttachmentObjectMetadata> | null
}

export function selectAttachmentStorage(env: Env): AttachmentObjectStorage | null {
  return env.FILES ? 'minio' : null
}

export function isAttachmentObjectStorage(value: string): value is AttachmentObjectStorage {
  return value === 'minio'
}

export function hasAttachmentStorage(env: Env, storage: AttachmentObjectStorage): boolean {
  return storage === 'minio' && Boolean(env.FILES)
}

export async function putAttachmentObject(
  env: Env,
  storage: AttachmentObjectStorage,
  key: string,
  bytes: Uint8Array,
  metadata: AttachmentObjectMetadata,
): Promise<void> {
  if (!env.FILES || storage !== 'minio') throw new Error('MinIO attachment storage is not configured')
  await env.FILES.put(key, bytes, {
    httpMetadata: { contentType: metadata.mime, cacheControl: 'private, no-store' },
    customMetadata: {
      userId: metadata.userId,
      objectId: metadata.objectId,
      kind: metadata.kind,
      filename: metadata.filename,
      mime: metadata.mime,
      sha256: metadata.sha256,
    },
  })
}

export async function readAttachmentObject(
  env: Env,
  storage: AttachmentObjectStorage,
  key: string,
): Promise<Uint8Array | null> {
  if (!env.FILES || storage !== 'minio') throw new Error('MinIO attachment storage is not configured')
  const object = await env.FILES.get(key)
  return object ? new Uint8Array(await object.arrayBuffer()) : null
}

export async function readAttachmentObjectStream(
  env: Env,
  storage: AttachmentObjectStorage,
  key: string,
): Promise<AttachmentObjectStream | null> {
  if (!env.FILES || storage !== 'minio') throw new Error('MinIO attachment storage is not configured')
  const object = await env.FILES.get(key)
  return object
    ? {
        body: object.body,
        size: object.size,
        metadata: { ...object.customMetadata, mime: object.httpMetadata?.contentType },
      }
    : null
}

export async function deleteAttachmentObjects(
  env: Env,
  storage: AttachmentObjectStorage,
  keys: readonly string[],
): Promise<void> {
  if (!keys.length) return
  if (!env.FILES || storage !== 'minio') throw new Error('MinIO attachment storage is not configured')
  await env.FILES.delete([...keys])
}
