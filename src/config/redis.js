import Redis from 'ioredis'
import { env } from './env.js'

const redisOptions = {
  maxRetriesPerRequest: null,
}

/** @type {Redis | null} */
let redisClient = null

/** @type {Redis | null} */
let workerRedisClient = null

/**
 * Get or create the Redis connection used by the Queue (adding jobs).
 * @returns {Redis}
 */
export function getRedisConnection() {
  if (!redisClient) {
    redisClient = new Redis(env.REDIS_URL, redisOptions)
  }
  return redisClient
}

/**
 * Get or create a dedicated Redis connection for the Worker (blocking reads).
 * BullMQ recommends a separate connection so the worker's blocking commands don't block the queue.
 * @returns {Redis}
 */
export function getWorkerConnection() {
  if (!workerRedisClient) {
    workerRedisClient = new Redis(env.REDIS_URL, redisOptions)
  }
  return workerRedisClient
}

/**
 * Ensure Redis is reachable (ping). Use before starting the server.
 * @param {number} [timeoutMs=5000]
 * @throws {Error} If Redis is not connected within timeout or ping fails
 */
export async function ensureRedisConnection(timeoutMs = 5000) {
  const redis = getRedisConnection()
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Redis connection timeout')), timeoutMs),
  )
  await Promise.race([redis.ping(), timeout])
}

/**
 * Close all Redis connections. Call on graceful shutdown.
 * @returns {Promise<void>}
 */
export async function closeRedisConnection() {
  const closes = []
  if (redisClient) {
    closes.push(redisClient.quit())
    redisClient = null
  }
  if (workerRedisClient) {
    closes.push(workerRedisClient.quit())
    workerRedisClient = null
  }
  await Promise.all(closes)
}
