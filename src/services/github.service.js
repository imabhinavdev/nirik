import { env } from '../config/env.js'

const GITHUB_API = 'https://api.github.com'

/** @type {{ login: string } | null} */
let cachedBotUser = null

function getAuthHeaders() {
  const token = env.GITHUB_TOKEN
  if (!token) throw new Error('GITHUB_TOKEN is not set')
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

/**
 * Get the authenticated bot user (cached).
 * @returns {Promise<{ login: string }>}
 */
export async function getGitHubBotUser() {
  if (cachedBotUser) return cachedBotUser
  const res = await fetch(`${GITHUB_API}/user`, {
    headers: getAuthHeaders(),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitHub get user failed: ${res.status} ${text}`)
  }
  const user = await res.json()
  cachedBotUser = { login: user.login }
  return cachedBotUser
}

/**
 * List all review comments on a pull request (paginated).
 * @param {string} repoFullName - e.g. "owner/repo"
 * @returns {Promise<Array<{ path: string, line: number, commit_id: string, user: { login: string } | null }>>}
 */
export async function listPullRequestReviewComments(repoFullName, pullNumber) {
  const [owner, repo] = repoFullName.split('/')
  if (!owner || !repo) throw new Error('Invalid repo full name: ' + repoFullName)

  const all = []
  let page = 1
  const perPage = 100

  while (true) {
    const url = `${GITHUB_API}/repos/${owner}/${repo}/pulls/${pullNumber}/comments?per_page=${perPage}&page=${page}`
    const res = await fetch(url, { headers: getAuthHeaders() })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`GitHub list PR comments failed: ${res.status} ${text}`)
    }
    const comments = await res.json()
    if (comments.length === 0) break
    all.push(...comments)
    if (comments.length < perPage) break
    page++
  }

  return all.map((c) => ({
    path: c.path,
    line: c.line ?? c.original_line ?? c.position,
    commit_id: c.commit_id,
    user: c.user,
  }))
}

/**
 * Get file contents from the repository at a given ref (branch, tag, or commit SHA).
 * Returns null if the file is not found (404).
 * @param {string} repoFullName - e.g. "owner/repo"
 * @param {string} filePath - path to file, e.g. ".nirik/rules.md"
 * @param {string} ref - branch name, tag, or commit SHA
 * @returns {Promise<string|null>} File content as UTF-8 string, or null if not found
 */
export async function getRepositoryFileContents(repoFullName, filePath, ref) {
  const [owner, repo] = repoFullName.split('/')
  if (!owner || !repo) throw new Error('Invalid repo full name: ' + repoFullName)
  const encodedPath = encodeURIComponent(filePath.replace(/^\//, ''))
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`
  const res = await fetch(url, { headers: getAuthHeaders() })
  if (res.status === 404) return null
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitHub get file failed: ${res.status} ${text}`)
  }
  const data = await res.json()
  if (!data.content) return null
  return Buffer.from(data.content, 'base64').toString('utf-8')
}

/**
 * Create a pull request review with body and line-level comments.
 * Uses line + side (RIGHT = new file) for comment placement.
 * @param {object} params
 * @param {string} params.repoFullName - e.g. "owner/repo"
 * @param {number} params.pullNumber - PR number
 * @param {string} params.reviewBody - Markdown body for the review
 * @param {Array<{ file: string, line: number, body: string }>} params.comments - Line-level comments (path, line in new file, body)
 * @param {string} [params.commitId] - Head SHA of the PR (defaults to latest; pass for stability)
 */
export async function createPullRequestReview({
  repoFullName,
  pullNumber,
  reviewBody,
  comments,
  commitId,
}) {
  const token = env.GITHUB_TOKEN
  if (!token) {
    throw new Error('GITHUB_TOKEN is not set')
  }

  const [owner, repo] = repoFullName.split('/')
  if (!owner || !repo) {
    throw new Error('Invalid repo full name: ' + repoFullName)
  }

  const url = `${GITHUB_API}/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`
  const body = {
    commit_id: commitId || undefined,
    body: reviewBody,
    event: 'COMMENT',
    comments: (comments || []).map((c) => ({
      path: c.file,
      line: c.line,
      side: 'RIGHT',
      body: c.body,
    })),
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(
      `GitHub API ${response.status}: ${response.statusText} - ${errText}`,
    )
  }

  return response.json()
}
