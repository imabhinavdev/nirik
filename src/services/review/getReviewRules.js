import { detectProviderFromEvent } from '../../lib/webhookProvider.js'
import { getRepositoryFileContents } from '../github.service.js'
import { getMergeRequest, getRepositoryFileRaw } from '../gitlab.service.js'
import { logger } from '../../config/logger.js'

const RULES_PATH = '.nirik/rules.md'
const MAX_RULES_SIZE = 32 * 1024

/**
 * Fetch project-specific review rules from .nirik/rules.md at the PR/MR head ref.
 * Returns empty string if the file is missing or on error (review continues with default prompt).
 * @param {object} event - Webhook payload (GitHub pull_request or GitLab merge_request)
 * @returns {Promise<string>} Rules content (trimmed to MAX_RULES_SIZE), or '' if not found/error
 */
export async function getReviewRules(event) {
  const provider = detectProviderFromEvent(event)
  if (!provider) return ''

  try {
    if (provider === 'github') {
      return await getReviewRulesGitHub(event)
    }
    if (provider === 'gitlab') {
      return await getReviewRulesGitLab(event)
    }
  } catch (err) {
    logger.warn(
      { err, provider },
      'Failed to fetch .nirik/rules.md; continuing without rules',
    )
    return ''
  }
  return ''
}

/**
 * @param {object} event - GitHub pull_request webhook
 * @returns {Promise<string>}
 */
async function getReviewRulesGitHub(event) {
  const repo = event?.repository?.full_name
  const headSha = event?.pull_request?.head?.sha
  if (!repo || !headSha) return ''

  const content = await getRepositoryFileContents(repo, RULES_PATH, headSha)
  if (content == null) {
    logger.debug({ repo, ref: headSha }, 'No .nirik/rules.md found')
    return ''
  }
  return truncateRules(content)
}

/**
 * @param {object} event - GitLab merge_request webhook
 * @returns {Promise<string>}
 */
async function getReviewRulesGitLab(event) {
  const projectId = event?.project?.id ?? event?.project_id
  const iid = event?.object_attributes?.iid
  if (projectId == null || iid == null) return ''

  let mr
  try {
    mr = await getMergeRequest(projectId, iid)
  } catch (err) {
    logger.warn(
      { err, projectId, iid },
      'Could not get MR for rules ref; skipping rules',
    )
    return ''
  }

  const headSha = mr?.diff_refs?.head_sha
  if (!headSha) return ''

  const content = await getRepositoryFileRaw(projectId, RULES_PATH, headSha)
  if (content == null) {
    logger.debug({ projectId, iid, ref: headSha }, 'No .nirik/rules.md found')
    return ''
  }
  return truncateRules(content)
}

/**
 * @param {string} content
 * @returns {string}
 */
function truncateRules(content) {
  const trimmed = (content || '').trim()
  if (trimmed.length <= MAX_RULES_SIZE) return trimmed
  return trimmed.slice(0, MAX_RULES_SIZE) + '\n\n...(truncated)'
}
