import { ApiError } from '../../utils/apiError.js'
import { parseDiff } from './parseDiff.js'
import { detectProviderFromEvent } from '../../lib/webhookProvider.js'
import { env } from '../../config/env.js'
import { logger } from '../../config/logger.js'

const GITHUB_DIFF_API = 'https://patch-diff.githubusercontent.com/raw'

/**
 * Fetch and parse diff for a GitHub pull_request event.
 * @param {object} event - GitHub webhook payload
 * @returns {Promise<Array<{ file: string, hunks: Array }>>}
 */
export async function getDiffFromGitHubEvent(event) {
  if (!event?.pull_request?.diff_url) {
    throw new ApiError(400, 'Invalid GitHub event payload')
  }

  const diffUrl = event.pull_request.diff_url.replace(
    'https://github.com',
    GITHUB_DIFF_API,
  )

  const response = await fetch(diffUrl)
  if (!response.ok) {
    throw new ApiError(response.status, 'Failed to fetch PR diff')
  }

  const diff = await response.text()
  return parseDiff(diff)
}

/**
 * Fetch and parse diff for a GitLab merge_request event.
 * Uses GET /api/v4/projects/:id/merge_requests/:iid/changes.
 * Returns diff_refs from the same response so posting comments does not need a second API call.
 * @param {object} event - GitLab webhook payload
 * @returns {Promise<{ diffFiles: Array<{ file: string, hunks: Array }>, diffRefs: { base_sha: string, start_sha: string, head_sha: string } | null }>}
 */
export async function getDiffFromGitLabEvent(event) {
  const projectId = event?.project?.id ?? event?.project_id
  const iid = event?.object_attributes?.iid

  if (projectId == null || iid == null) {
    throw new ApiError(400, 'Invalid GitLab merge_request payload')
  }

  const token = env.GITLAB_TOKEN ?? env.GITLAB_PRIVATE_TOKEN
  if (!token) {
    throw new ApiError(500, 'GITLAB_TOKEN is required for GitLab webhooks')
  }

  const baseUrl = (env.GITLAB_URL || 'https://gitlab.com').replace(/\/$/, '')
  const encodedId = encodeURIComponent(projectId)
  const url = `${baseUrl}/api/v4/projects/${encodedId}/merge_requests/${iid}/changes`

  const response = await fetch(url, {
    headers: {
      'PRIVATE-TOKEN': token,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new ApiError(response.status, `GitLab API: ${errText}`)
  }

  const data = await response.json()
  const changes = data.changes || []
  const diffRefs =
    data.diff_refs?.base_sha &&
    data.diff_refs?.start_sha &&
    data.diff_refs?.head_sha
      ? data.diff_refs
      : null

  if (!diffRefs) {
    logger.warn(
      {
        projectId,
        iid,
        hasDiffRefsInResponse: !!data.diff_refs,
        responseKeys: data.diff_refs ? null : Object.keys(data).slice(0, 30),
      },
      'GitLab changes API did not return diff_refs; will fall back to MR endpoint when posting comments',
    )
  }

  const allFiles = []
  for (const change of changes) {
    const diff = change.diff
    if (!diff || typeof diff !== 'string') continue
    const files = parseDiff(diff)
    for (const f of files) {
      allFiles.push(f)
    }
  }

  return { diffFiles: allFiles, diffRefs }
}

/**
 * Fetch and parse diff from a webhook event (GitHub or GitLab).
 * For GitLab also returns diff_refs from the changes API for posting comments.
 * @param {object} event - Webhook payload (pull_request or merge_request)
 * @returns {Promise<{ diffFiles: Array<{ file: string, hunks: Array }>, diffRefs?: { base_sha: string, start_sha: string, head_sha: string } | null }>}
 */
export async function getDiffFromEvent(event) {
  const provider = detectProviderFromEvent(event)
  if (provider === 'github') {
    const diffFiles = await getDiffFromGitHubEvent(event)
    return { diffFiles, diffRefs: null }
  }
  if (provider === 'gitlab') {
    return getDiffFromGitLabEvent(event)
  }
  throw new ApiError(
    400,
    'Unknown webhook payload: expected GitHub or GitLab event',
  )
}
