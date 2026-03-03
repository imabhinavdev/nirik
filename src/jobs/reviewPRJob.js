import { getDiffFromEvent } from '../services/review/getDiffFromEvent.js'
import { filterReviewableDiff } from '../services/review/filterReviewableDiff.js'
import { getReviewChunks } from '../services/review/getReviewChunks.js'
import { getReviewRules } from '../services/review/getReviewRules.js'
import { reviewChunkWithAI } from '../services/review/reviewChunkWithAI.js'
import { mergeReviewChunks } from '../services/review/mergeReviewChunks.js'
import { getExistingReviewComments } from '../services/review/getExistingReviewComments.js'
import { postReview } from '../services/review/postReview.js'
import { detectProviderFromEvent } from '../lib/webhookProvider.js'
import { logger } from '../config/logger.js'

/** Default: only error and warning. If rules mention suggestions/info, allow those too. */
const DEFAULT_SEVERITIES = ['error', 'warning']
const ALL_SEVERITIES = ['error', 'warning', 'info', 'suggestion']

/**
 * @param {string} rules - Content of .nirik/rules.md
 * @returns {boolean} true if rules explicitly ask for info or suggestions
 */
function rulesAllowInfoOrSuggestion(rules) {
  if (!rules || !String(rules).trim()) return false
  const r = String(rules).toLowerCase()
  return /suggestion|info|hints/.test(r)
}

/**
 * Run the full PR/MR review pipeline in the background.
 * @param {object} event - Webhook payload (GitHub pull_request or GitLab merge_request)
 */
export async function runReviewPRJob(event) {
  const provider = detectProviderFromEvent(event)
  if (!provider) {
    logger.warn(
      { event: !!event },
      'Review job skipped: unknown webhook payload',
    )
    return
  }

  const repoLabel =
    provider === 'github'
      ? event?.repository?.full_name
      : (event?.project?.path_with_namespace ?? event?.project_id)
  const mrNumber =
    provider === 'github'
      ? event?.pull_request?.number
      : event?.object_attributes?.iid

  if (!repoLabel || mrNumber == null) {
    logger.warn(
      { provider, repoLabel, mrNumber },
      'Review job skipped: missing repo or MR/PR identifier',
    )
    return
  }

  try {
    const [diffResult, customRules] = await Promise.all([
      getDiffFromEvent(event),
      getReviewRules(event),
    ])
    const diffFiles = diffResult.diffFiles ?? diffResult
    const diffRefs = diffResult.diffRefs ?? null

    logger.info(
      {
        provider,
        repoLabel,
        mrNumber,
        diffFileCount: Array.isArray(diffFiles) ? diffFiles.length : 0,
        hasDiffRefs: !!diffRefs,
      },
      'Diff loaded',
    )

    const filtered = filterReviewableDiff(diffFiles)
    const chunks = getReviewChunks(filtered)

    if (chunks.length === 0) {
      logger.info(
        {
          provider,
          repoLabel,
          mrNumber,
          commented: false,
          reason: 'no_reviewable_lines',
        },
        'No reviewable hunks; skipping review (nothing commented)',
      )
      return
    }
    const chunkResults = []

    for (let i = 0; i < chunks.length; i++) {
      const result = await reviewChunkWithAI(chunks[i], i, { customRules })
      chunkResults.push(result)
    }

    const { reviewBody, reviewComments } = mergeReviewChunks(chunkResults)

    const allowedSeverities = rulesAllowInfoOrSuggestion(customRules)
      ? ALL_SEVERITIES
      : DEFAULT_SEVERITIES
    const filteredComments = reviewComments.filter((c) =>
      allowedSeverities.includes(c.severity),
    )

    const commentsForGit = filteredComments.map((c) => ({
      file: c.file,
      line: c.line,
      body: `**[${c.severity}]** ${c.body}`,
    }))

    const existingKeys = await getExistingReviewComments(event)
    const commentsToPost = commentsForGit.filter((c) => {
      const key = `${c.file}:${c.line}`
      return !existingKeys.has(key)
    })

    if (commentsToPost.length === 0) {
      logger.info(
        {
          provider,
          repoLabel,
          mrNumber,
          commented: false,
          reason: 'all_already_exist',
          totalFindings: commentsForGit.length,
        },
        'No new findings; skipping post (all comments already exist; nothing commented)',
      )
      return
    }

    logger.info(
      {
        provider,
        repoLabel,
        mrNumber,
        commentCount: commentsToPost.length,
        skipped: commentsForGit.length - commentsToPost.length,
      },
      'Posting review to GitLab',
    )

    await postReview({
      provider,
      event,
      reviewBody,
      reviewComments: commentsToPost,
      diffRefs,
    })

    logger.info(
      {
        provider,
        repoLabel,
        mrNumber,
        commented: true,
        commentCount: commentsToPost.length,
        skipped: commentsForGit.length - commentsToPost.length,
      },
      'Review posted successfully (summary + line comments)',
    )
  } catch (err) {
    logger.error(
      {
        err,
        provider,
        repoLabel,
        mrNumber,
        commented: false,
        reason: 'job_failed',
      },
      'Review job failed (nothing commented)',
    )
    throw err
  }
}
