import crypto from 'crypto'
import { env } from '../config/env.js'

/**
 * Verify GitHub webhook using X-Hub-Signature-256 (HMAC-SHA256).
 * Expects header: X-Hub-Signature-256: sha256=<hex>
 * @param {Buffer} rawBody - Raw request body (must not be parsed)
 * @param {string} signature - Value of X-Hub-Signature-256
 * @param {string} secret - GITHUB_WEBHOOK_SECRET
 * @returns {boolean}
 */
function verifyGitHubSignature(rawBody, signature, secret) {
  if (!signature || !secret || !rawBody) return false
  const expected =
    'sha256=' +
    crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(signature, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

/**
 * Verify GitLab webhook using X-Gitlab-Token (exact string match).
 * @param {string} token - Value of X-Gitlab-Token header
 * @param {string} expected - GITLAB_WEBHOOK_TOKEN from env
 * @returns {boolean}
 */
function verifyGitLabToken(token, expected) {
  if (!expected) return false
  if (!token) return false
  const a = Buffer.from(token, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

/**
 * Middleware: verify webhook request using provider-specific secret/token.
 * - GitHub: X-Hub-Signature-256 (requires GITHUB_WEBHOOK_SECRET and req.rawBody)
 * - GitLab: X-Gitlab-Token (requires GITLAB_WEBHOOK_TOKEN)
 * If no secret/token is configured, skips verification. If configured and missing/invalid, responds 401.
 */
export function verifyWebhook(req, res, next) {
  const githubSecret = env.GITHUB_WEBHOOK_SECRET
  const gitlabToken = env.GITLAB_WEBHOOK_TOKEN

  if (!githubSecret && !gitlabToken) {
    return next()
  }

  const hubSignature = req.get('X-Hub-Signature-256')
  const gitlabHeader = req.get('X-Gitlab-Token')

  // GitHub: X-Hub-Signature-256 present => verify with secret
  if (hubSignature) {
    if (!githubSecret) {
      res.status(401).json({
        success: false,
        message: 'GitHub webhook secret not configured',
      })
      return
    }
    const rawBody = req.rawBody
    if (!rawBody) {
      res.status(401).json({
        success: false,
        message: 'Missing body for signature verification',
      })
      return
    }
    if (!verifyGitHubSignature(rawBody, hubSignature, githubSecret)) {
      res
        .status(401)
        .json({ success: false, message: 'Invalid GitHub webhook signature' })
      return
    }
    return next()
  }

  // GitLab: X-Gitlab-Token present => verify with token
  if (gitlabHeader) {
    if (!gitlabToken) {
      res.status(401).json({
        success: false,
        message: 'GitLab webhook token not configured',
      })
      return
    }
    if (!verifyGitLabToken(gitlabHeader, gitlabToken)) {
      res
        .status(401)
        .json({ success: false, message: 'Invalid GitLab webhook token' })
      return
    }
    return next()
  }

  // Neither header present but at least one secret is set => reject
  res.status(401).json({
    success: false,
    message:
      'Missing webhook verification: send X-Hub-Signature-256 (GitHub) or X-Gitlab-Token (GitLab)',
  })
}
