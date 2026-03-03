/** Max total lines (context + removed + added) per chunk. Never split a hunk. */
const MAX_LINES_PER_CHUNK = 150

/**
 * Count total lines in a hunk for chunking.
 * @param {{ contextLines?: Array, removedLines?: Array, addedLines?: Array }} hunk
 * @returns {number}
 */
function hunkLineCount(hunk) {
  const ctx = hunk?.contextLines ?? []
  const rem = hunk?.removedLines ?? []
  const add = hunk?.addedLines ?? []
  return ctx.length + rem.length + add.length
}

/**
 * Build review chunks from filtered diff: each chunk is an array of full hunks (with context,
 * removed, and added lines). Chunks by total line count, never splitting a hunk.
 * @param {Array<{ file: string, hunks: Array<{ oldStart?: number, newStart?: number, addedLines?: Array, removedLines?: Array, contextLines?: Array }> }>} diffFiles - output from filterReviewableDiff
 * @param {{ maxLinesPerChunk?: number }} [options]
 * @returns {Array<Array<{ file: string, hunk: object }>>}
 */
export function getReviewChunks(diffFiles, options = {}) {
  if (!Array.isArray(diffFiles)) return []

  const maxLines = options.maxLinesPerChunk ?? MAX_LINES_PER_CHUNK
  const flatHunks = []

  for (const { file, hunks } of diffFiles) {
    if (!file || !Array.isArray(hunks)) continue
    for (const hunk of hunks) {
      const normalized = {
        oldStart: hunk.oldStart,
        newStart: hunk.newStart,
        addedLines: hunk.addedLines ?? [],
        removedLines: hunk.removedLines ?? [],
        contextLines: hunk.contextLines ?? [],
      }
      flatHunks.push({ file, hunk: normalized })
    }
  }

  if (flatHunks.length === 0) return []

  const chunks = []
  let currentChunk = []
  let currentLineCount = 0

  for (const { file, hunk } of flatHunks) {
    const count = hunkLineCount(hunk)
    const wouldExceed =
      currentLineCount + count > maxLines && currentChunk.length > 0

    if (wouldExceed) {
      chunks.push(currentChunk)
      currentChunk = []
      currentLineCount = 0
    }

    currentChunk.push({ file, hunk })
    currentLineCount += count
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk)
  }

  return chunks
}
