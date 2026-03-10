import { asyncHandler } from '../utils/asyncHandler.js'
import { getReviewQueue } from '../services/queue/reviewQueue.js'
import { recordReviewJob } from '../metrics.js'
import { logger } from '../config/logger.js'
import {
  detectAndValidateWebhook,
  getReviewJobId,
  isReviewableAction,
} from '../lib/webhookProvider.js'

export const reviewPRWebhook = asyncHandler(async (req, res) => {
  let parsed
  try {
    parsed = detectAndValidateWebhook(req.body)
  } catch (err) {
    res.status(400).json({ success: false, message: err.message })
    return
  }

  const { provider, event } = parsed

  const repoLabel =
    provider === 'github'
      ? event?.repository?.full_name
      : (event?.project?.path_with_namespace ?? event?.project_id)
  const mrNumber =
    provider === 'github'
      ? event?.pull_request?.number
      : event?.object_attributes?.iid

  if (!isReviewableAction(provider, event)) {
    logger.info(
      {
        provider,
        repoLabel,
        mrNumber,
        reason: 'non_reviewable_action',
      },
      'Webhook received but action is not reviewable; event ignored',
    )
    res.status(200).json({
      accepted: false,
      queued: false,
      reason: 'non_reviewable_action',
      message:
        'Event ignored (only opened/synchronize for GitHub; open/reopen/update for GitLab)',
      provider,
      repoLabel,
      mrNumber,
    })
    return
  }

  const baseId = getReviewJobId(provider, event)
  const jobId = `${baseId}-${Date.now()}`
  const queue = getReviewQueue()
  const job = await queue.add('review', event, { jobId })
  recordReviewJob('enqueued')
  logger.info(
    {
      jobId: job.id,
      jobName: job.name,
      provider,
      repoLabel,
      mrNumber,
    },
    'Review job enqueued; worker will process in background',
  )

  res.status(202).json({
    accepted: true,
    queued: true,
    message:
      'Review started (runs in background; check app logs for progress or errors)',
    provider,
    repoLabel,
    mrNumber,
    jobId: job.id,
  })
})
