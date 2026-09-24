import type { Env } from '../env'
import { ApiError } from './errors'
import { isValidId } from './id'


export class CryptoUnavailableError extends ApiError {
  constructor() {
    super(
      503,
      'server_misconfigured',
      'The server is missing credential encryption configuration',
    )
    this.name = 'CryptoUnavailableError'
  }
}

export async function encryptSecret(env: Env, info: string, value: unknown): Promise<string> {
  if (!isValidId(info)) throw new Error('invalid_credential_scope')
  return encryptCredential(env, `backup:${info}`, value)
}

export async function decryptSecret<T>(env: Env, info: string, stored: string): Promise<T | null> {
  if (!isValidId(info) || stored.length > 24 * 1024) return null
  const value = await decryptCredential(env, `backup:${info}`, stored)
  return isBackupCredentialRecord(value) ? (value as T) : null
}

export async function encryptTotpSecret(env: Env, userId: string, secret: string): Promise<string> {
  if (!isValidId(userId) || !/^[A-Z2-7]{32}$/.test(secret)) {
    throw new Error('invalid_totp_credential')
  }
  return encryptCredential(env, `totp:${userId}`, { secret })
}

export async function decryptTotpSecret(
  env: Env,
  userId: string,
  stored: string,
): Promise<string | null> {
  if (!isValidId(userId) || stored.length > 24 * 1024) return null
  const value = await decryptCredential(env, `totp:${userId}`, stored)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const secret = (value as Record<string, unknown>).secret
  return typeof secret === 'string' && /^[A-Z2-7]{32}$/.test(secret) ? secret : null
}

async function encryptCredential(env: Env, scope: string, value: unknown): Promise<string> {
  if (!env.ENCRYPTION_KEY) throw new CryptoUnavailableError()
  return encryptLocally(env.ENCRYPTION_KEY, scope, value)
}

async function decryptCredential(env: Env, scope: string, stored: string): Promise<unknown> {
  if (!env.ENCRYPTION_KEY) throw new CryptoUnavailableError()
  return decryptLocally(env.ENCRYPTION_KEY, scope, stored)
}

async function encryptLocally(keyMaterial: string, scope: string, value: unknown): Promise<string> {
  const key = await deriveLocalKey(keyMaterial, scope)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(value))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  return `v1.${encodeBase64Url(iv)}.${encodeBase64Url(new Uint8Array(ciphertext))}`
}

async function decryptLocally(keyMaterial: string, scope: string, stored: string): Promise<unknown> {
  const [version, encodedIv, encodedCiphertext] = stored.split('.')
  if (version !== 'v1' || !encodedIv || !encodedCiphertext) return null
  try {
    const key = await deriveLocalKey(keyMaterial, scope)
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: decodeBase64Url(encodedIv) as unknown as ArrayBuffer },
      key,
      decodeBase64Url(encodedCiphertext) as unknown as ArrayBuffer,
    )
    return JSON.parse(new TextDecoder().decode(plaintext)) as unknown
  } catch {
    return null
  }
}

async function deriveLocalKey(keyMaterial: string, scope: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${keyMaterial}\u0000${scope}`),
  )
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  const binary = atob(normalized)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function isBackupCredentialRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const allowed = new Set(['password', 'accessKeyId', 'secretAccessKey'])
  const entries = Object.entries(value)
  return entries.length > 0 &&
    entries.length <= allowed.size &&
    entries.every(
      ([key, field]) =>
        allowed.has(key) && typeof field === 'string' && field.length > 0 && field.length <= 4096,
    )
}
