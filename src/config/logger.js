import path from 'node:path'
import pino from 'pino'
import { env } from './env.js'

const isProduction = env.NODE_ENV === 'production'
const logLevel = env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug')

const fileStamp = new Date().toISOString().slice(0, 10)
const prodLogPath = env.LOG_FILE_PATH || path.join('logs', `app-${fileStamp}.log`)

const transport = isProduction
  ? pino.transport({
      targets: env.LOG_FILE_PATH
        ? [
            { target: 'pino/file', options: { destination: 1 } },
            {
              target: 'pino/file',
              options: { destination: prodLogPath, mkdir: true },
            },
          ]
        : [{ target: 'pino/file', options: { destination: 1 } }],
    })
  : pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: true,
        singleLine: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    })

export const logger = pino(
  {
    level: logLevel,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'password',
        '*.password',
        '*.token',
        '*.apiKey',
      ],
      censor: '[REDACTED]',
    },
  },
  transport,
)
