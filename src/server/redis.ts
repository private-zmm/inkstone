import Redis from 'ioredis'

export interface RedisServices {
  client: Redis
  publisher: Redis
  subscriber: Redis
}

export function createRedisServices(url: string): RedisServices {
  const client = new Redis(url, { maxRetriesPerRequest: 3 })
  const publisher = new Redis(url, { maxRetriesPerRequest: 3 })
  const subscriber = new Redis(url, { maxRetriesPerRequest: 3 })
  return { client, publisher, subscriber }
}

export async function closeRedisServices(services: RedisServices): Promise<void> {
  await Promise.all([
    services.client.quit(),
    services.publisher.quit(),
    services.subscriber.quit(),
  ])
}

export async function withRedisLock<T>(
  redis: Redis,
  key: string,
  ttlMs: number,
  task: () => Promise<T>,
): Promise<T | null> {
  const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`
  const acquired = await redis.set(key, token, 'PX', ttlMs, 'NX')
  if (acquired !== 'OK') return null
  try {
    return await task()
  } finally {
    await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      key,
      token,
    )
  }
}
