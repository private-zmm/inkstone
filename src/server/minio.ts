import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { Readable } from 'node:stream'

export interface MinioConfig {
  endpoint: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  filesBucket: string
  backupsBucket: string
}

export class MinioBucketAdapter {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async put(
    key: string,
    value: Uint8Array,
    options?: {
      httpMetadata?: { contentType?: string; cacheControl?: string }
      customMetadata?: Record<string, string>
    },
  ): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: value,
      ContentType: options?.httpMetadata?.contentType,
      CacheControl: options?.httpMetadata?.cacheControl,
      Metadata: options?.customMetadata,
    }))
  }

  async get(key: string): Promise<{
    body: ReadableStream<Uint8Array>
    size: number
    customMetadata?: Record<string, string>
    httpMetadata?: { contentType?: string }
    arrayBuffer(): Promise<ArrayBuffer>
  } | null> {
    let response
    try {
      response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
    } catch (error) {
      const code = (error as { name?: string; Code?: string }).name ?? (error as { Code?: string }).Code
      if (code === 'NoSuchKey' || code === 'NotFound' || code === 'NoSuchObject') return null
      throw error
    }
    if (!response.Body) return null
    const bytes = await response.Body.transformToByteArray()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes)
        controller.close()
      },
    })
    return {
      body: stream,
      size: bytes.byteLength,
      customMetadata: response.Metadata,
      httpMetadata: { contentType: response.ContentType },
      arrayBuffer: async () => bytes.slice().buffer,
    }
  }

  async delete(keys: string | string[]): Promise<void> {
    const values = Array.isArray(keys) ? keys : [keys]
    if (!values.length) return
    if (values.length === 1) {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: values[0] }))
      return
    }
    await this.client.send(new DeleteObjectsCommand({
      Bucket: this.bucket,
      Delete: { Objects: values.map((Key) => ({ Key })), Quiet: true },
    }))
  }
}

export function createMinioClient(config: MinioConfig): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}

export async function ensureMinioBuckets(client: S3Client, config: MinioConfig): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await Promise.all([config.filesBucket, config.backupsBucket].map(async (Bucket) => {
        try {
          await client.send(new HeadBucketCommand({ Bucket }))
        } catch {
          await client.send(new CreateBucketCommand({ Bucket }))
        }
      }))
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, Math.min(5000, 250 * (attempt + 1))))
    }
  }
  throw lastError instanceof Error ? lastError : new Error('MinIO is not ready')
}

export function readableToWeb(value: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
  return Readable.toWeb(value as Readable) as ReadableStream<Uint8Array>
}
