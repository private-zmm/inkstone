import { extensionFor } from '../lib/image'

export interface StoredAttachmentKey {
  id: string
  user_id: string
  mime: string
  filename: string
}

export type AttachmentObjectStorage = 'minio'

export function attachmentObjectKey(row: StoredAttachmentKey): string {
  return `${row.user_id}/${row.id}.${extensionFor(row.mime, row.filename)}`
}

export function attachmentCleanupTarget(storage: AttachmentObjectStorage, key: string): string {
  return `${storage}:${key}`
}

export function parseAttachmentCleanupTarget(value: string): {
  storage: AttachmentObjectStorage
  key: string
} | null {
  if (value.startsWith('minio:') && value.length > 6) return { storage: 'minio', key: value.slice(6) }
  return null
}
