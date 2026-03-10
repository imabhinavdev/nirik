/**
 * Merge multiple chunk review results into one review (body + comments).
 * Dedupes by (file, line) keeping the first occurrence.
 * @param {Array<{ summary: string, reviewComments: Array<{ file: string, line: number, severity: string, body: string }> }>} chunkResults
 * @returns {{ reviewBody: string, reviewComments: Array<{ file: string, line: number, severity: string, body: string }> }}
 */
export function mergeReviewChunks(chunkResults) {
  if (!Array.isArray(chunkResults) || chunkResults.length === 0) {
    return { reviewBody: 'No review content.', reviewComments: [] }
  }

  const seen = new Set()
  const reviewComments = []

  for (const chunk of chunkResults) {
    const comments = chunk?.reviewComments ?? []
    for (const c of comments) {
      const key = `${c.file}:${c.line}`
      if (seen.has(key)) continue
      seen.add(key)
      reviewComments.push({
        file: c.file,
        line: c.line,
        severity: c.severity,
        body: c.body,
      })
    }
  }

  const summaries = chunkResults.map((c) => c?.summary?.trim()).filter(Boolean)
  const maxSummaryLength = 600
  let summaryText =
    summaries.length > 0 ? summaries.join('\n\n') : 'No summary provided.'
  if (summaryText.length > maxSummaryLength) {
    summaryText =
      summaryText.slice(0, maxSummaryLength).trim() +
      (summaryText.slice(maxSummaryLength).match(/\S/) ? '…' : '')
  }
  const reviewBody =
    summaries.length > 0 ? '## Summary\n\n' + summaryText : 'No summary provided.'

  return { reviewBody, reviewComments }
}
