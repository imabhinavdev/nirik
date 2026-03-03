const IGNORED_DIRS = [
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  'out',
]

/**
 * @param {string} filePath
 * @returns {boolean} true if file should be excluded from parsed result
 */
export function isIgnoredFile(filePath = '') {
  const normalized = filePath.replace(/\\/g, '/').trim()
  if (!normalized) return true

  const fileName = normalized.split('/').pop() || ''
  if (/^package.*\.json$/i.test(fileName)) {
    return true
  }

  return IGNORED_DIRS.some(
    (dir) =>
      normalized === dir ||
      normalized.startsWith(`${dir}/`) ||
      normalized.includes(`/${dir}/`),
  )
}

/**
 * Parse unified diff text into list of { file, hunks }.
 * Each hunk has addedLines, removedLines, and contextLines (unchanged lines for full context).
 * @param {string} diffText
 * @returns {Array<{ file: string, hunks: Array<{ oldStart: number, newStart: number, addedLines: Array<{ line: number, content: string }>, removedLines: Array<{ line: number, content: string }>, contextLines: Array<{ oldLine: number, newLine: number, content: string }> }> }>}
 */
export function parseDiff(diffText) {
  const lines = diffText.split('\n')
  const files = []
  let currentFile = null
  let currentHunk = null
  let oldLine = 0
  let newLine = 0

  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      if (currentFile?.file && !isIgnoredFile(currentFile.file)) {
        files.push(currentFile)
      }
      currentFile = { file: null, hunks: [] }
      currentHunk = null
      continue
    }

    if (line.startsWith('+++ b/')) {
      // GitLab compact format may omit "diff --git"; ensure we have a file entry
      if (!currentFile) {
        currentFile = { file: null, hunks: [] }
      }
      currentFile.file = line.replace('+++ b/', '').trim()
      continue
    }

    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/)
      if (!match) continue
      // Some diff formats (e.g. GitLab compact) may have hunks before "diff --git"
      if (!currentFile) {
        currentFile = { file: null, hunks: [] }
      }
      oldLine = parseInt(match[1], 10)
      newLine = parseInt(match[3], 10)
      currentHunk = {
        oldStart: oldLine,
        newStart: newLine,
        addedLines: [],
        removedLines: [],
        contextLines: [],
      }
      currentFile.hunks.push(currentHunk)
      continue
    }

    if (!currentHunk) continue

    if (line.startsWith('+') && !line.startsWith('+++')) {
      currentHunk.addedLines.push({ line: newLine, content: line.slice(1) })
      newLine++
      continue
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      currentHunk.removedLines.push({ line: oldLine, content: line.slice(1) })
      oldLine++
      continue
    }
    if (!line.startsWith('\\ No newline')) {
      currentHunk.contextLines.push({
        oldLine,
        newLine,
        content: line,
      })
      oldLine++
      newLine++
    }
  }

  if (currentFile?.file && !isIgnoredFile(currentFile.file)) {
    files.push(currentFile)
  }

  return files
}
