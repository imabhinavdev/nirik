import { createPullRequestReview } from '../github.service.js'
import { getMergeRequest, createMergeRequestReview } from '../gitlab.service.js'
import { logger } from '../../config/logger.js'

/**
 * Post review (summary + line comments) to the appropriate Git provider.
 * @param {object} params
 * @param {'github'|'gitlab'} params.provider
 * @param {object} params.event - Webhook event payload
 * @param {string} params.reviewBody
 * @param {Array<{ file: string, line: number, body: string }>} params.reviewComments
 * @param {{ base_sha: string, start_sha: string, head_sha: string } | null} [params.diffRefs] - From getDiffFromEvent (GitLab); avoids extra API call
 */
export async function postReview({
  provider,
  event,
  reviewBody,
  reviewComments,
  diffRefs: diffRefsParam,
}) {
  const comments = (reviewComments || []).map((c) => ({
    file: c.file,
    line: c.line,
    body: c.body,
  }))

  if (provider === 'github') {
    const repo = event.repository?.full_name
    const pullNumber = event.pull_request?.number
    const commitId = event.pull_request?.head?.sha
    if (!repo || pullNumber == null) {
      throw new Error(
        'GitHub event missing repository.full_name or pull_request.number',
      )
    }
    await createPullRequestReview({
      repoFullName: repo,
      pullNumber,
      reviewBody,
      comments,
      commitId,
    })
    return
  }

  if (provider === 'gitlab') {
    const projectId = event.project?.id ?? event.project_id
    const iid = event.object_attributes?.iid
    if (projectId == null || iid == null) {
      throw new Error(
        'GitLab event missing project.id or object_attributes.iid',
      )
    }
    let diffRefs = diffRefsParam
    if (!diffRefs) {
      logger.info(
        { projectId, iid },
        'Fetching MR for diff_refs (not in changes response)',
      )
      const mr = await getMergeRequest(projectId, iid)
      diffRefs = mr.diff_refs ?? null
    }
    if (!diffRefs?.base_sha || !diffRefs?.start_sha || !diffRefs?.head_sha) {
      throw new Error('GitLab MR missing diff_refs; cannot post line comments')
    }
    logger.info(
      { projectId, iid, summary: true, lineCommentCount: comments.length },
      'Posting review to GitLab (summary + line comments)',
    )
    await createMergeRequestReview({
      projectId,
      iid,
      reviewBody,
      comments,
      diffRefs,
    })
    logger.info(
      { projectId, iid, lineCommentCount: comments.length },
      'GitLab review posted successfully (commented)',
    )
    return
  }

  throw new Error(`Unknown provider: ${provider}`)
}
