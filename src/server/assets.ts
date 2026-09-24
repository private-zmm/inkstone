import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
}

export function createFileAssets(root: string): { fetch(request: Request): Promise<Response> } {
  const base = normalize(root).endsWith(sep) ? normalize(root) : `${normalize(root)}${sep}`

  return {
    async fetch(request) {
      const url = new URL(request.url)
      const requested = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
      const candidate = normalize(join(root, requested))
      let file = candidate.startsWith(base) ? candidate : join(root, 'index.html')
      let body: Buffer
      try {
        body = await readFile(file)
      } catch {
        file = join(root, 'index.html')
        body = await readFile(file)
      }
      const type = CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
      return new Response(body as unknown as BodyInit, {
        headers: {
          'Content-Type': type,
          'Cache-Control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
        },
      })
    },
  }
}
