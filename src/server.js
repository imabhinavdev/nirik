import express from 'express'
import { env } from './config/env.js'
import { httpLogger } from './config/httpLogger.js'
import { logger } from './config/logger.js'
import { errorHandler } from './middleware/errorHandler.js'
import { notFoundHandler } from './middleware/notFoundHandler.js'
import { verifyMetricsToken } from './middleware/verifyMetricsToken.js'
import { asyncHandler } from './utils/asyncHandler.js'
import router from './routes/index.js'
import {
  startReviewWorker,
  closeReviewQueue,
} from './services/queue/reviewQueue.js'
import { ensureRedisConnection } from './config/redis.js'
import { register, metricsMiddleware } from './metrics.js'

const app = express()

//  Loggers and Cors setup
app.disable('x-powered-by')
// Keep raw body for webhook signature verification (GitHub X-Hub-Signature-256)
app.use(
  express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf
    },
  }),
)
app.use(express.urlencoded({ extended: false }))
app.use(httpLogger)
app.use(metricsMiddleware)

// Routes
app.get('/metrics', verifyMetricsToken, async (_req, res) => {
  res.set('Content-Type', register.contentType)
  res.send(await register.metrics())
})
app.use('/api/v1', router)
app.get(
  '/',
  asyncHandler(async (req, res) => {
    req.log.info({ requestId: req.id }, 'Health route hit')
    res
      .status(200)
      .json({ success: true, message: 'Hello World', requestId: req.id })
  }),
)

// Global Middlewares for error handling
app.use(notFoundHandler)
app.use(errorHandler)

function getBaseUrl() {
  if (env.BASE_URL) {
    return env.BASE_URL.replace(/\/$/, '')
  }
  return `http://localhost:${env.PORT}`
}

let server

async function start() {
  try {
    await ensureRedisConnection()
    logger.info('Redis connected')
  } catch (err) {
    logger.fatal({ err }, 'Redis connection failed; server not started')
    process.exit(1)
  }

  server = app.listen(env.PORT, () => {
    const baseUrl = getBaseUrl()
    const webhookPath = '/api/v1/webhooks/review-pr'
    const webhookUrl = `${baseUrl}${webhookPath}`

    logger.info(
      { port: env.PORT, env: env.NODE_ENV, baseUrl, webhookPath },
      `Server is running on ${baseUrl}`,
    )
    logger.info({ webhookUrl }, `Webhook URL (GitHub & GitLab): ${webhookUrl}`)
    logger.info(
      {
        health: `${baseUrl}/`,
        metrics: `${baseUrl}/metrics`,
      },
      'Other endpoints: GET / (health), GET /metrics (Prometheus)',
    )

    startReviewWorker()
  })
}

start().catch((err) => {
  logger.fatal({ err }, 'Startup failed')
  process.exit(1)
})

const shutdown = async (signal) => {
  logger.warn({ signal }, 'Shutdown signal received')

  await closeReviewQueue()
  if (!server) {
    process.exit(0)
    return
  }
  server.close(() => {
    logger.info('HTTP server closed')
    process.exit(0)
  })

  setTimeout(() => {
    logger.error('Forced shutdown after timeout')
    process.exit(1)
  }, 10000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT').catch(() => process.exit(1)))
process.on('SIGTERM', () => shutdown('SIGTERM').catch(() => process.exit(1)))
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection')
})
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception')
  process.exit(1)
})

export default app
