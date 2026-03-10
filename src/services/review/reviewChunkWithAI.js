import { z } from 'zod'
import { generateStructuredReview } from '../ai/aiProvider.js'

/** JSON Schema for structured review output (one chunk). */
export const reviewChunkResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: {
      type: 'string',
      description:
        'Short summary for this chunk: 4-5 sentences max. Keep it brief even for large changes.',
    },
    reviewComments: {
      type: 'array',
      description: 'Line-level review comments',
      items: {
        type: 'object',
        properties: {
          file: {
            type: 'string',
            description: 'File path as given in the code block',
          },
          line: { type: 'integer', description: 'Line number in the new file' },
          severity: {
            type: 'string',
            enum: ['info', 'suggestion', 'warning', 'error'],
            description: 'Severity of the finding',
          },
          body: { type: 'string', description: 'Comment text' },
        },
        required: ['file', 'line', 'severity', 'body'],
      },
    },
  },
  required: ['summary', 'reviewComments'],
}

const parsedChunkSchema = z.object({
  summary: z.string(),
  reviewComments: z.array(
    z.object({
      file: z.string(),
      line: z.number().int().positive(),
      severity: z.enum(['info', 'suggestion', 'warning', 'error']),
      body: z.string(),
    }),
  ),
})

/**
 * Build the prompt text for one chunk of hunks (full context, removed, and added lines).
 * When customRules is non-empty, prepends a project rules section.
 * @param {Array<{ file: string, hunk: { contextLines: Array<{ oldLine: number, newLine: number, content: string }>, removedLines: Array<{ line: number, content: string }>, addedLines: Array<{ line: number, content: string }> } }>} chunkHunks
 * @param {number} chunkIndex
 * @param {string} [customRules] - Optional project rules from .nirik/rules.md
 * @returns {string}
 */
function buildChunkPrompt(chunkHunks, chunkIndex, customRules = '') {
  const baseHeader =
    'You are a code reviewer. Review the following code changes. Each section shows Context (unchanged), Removed, and Added lines. Only report findings on ADDED lines—use the line numbers from the Added section for each file. For each finding report: file path, line number (new side), severity (error | warning | info | suggestion), and a concise comment. Prefer actionable comments.\n\n' +
    'Keep the summary short: 4-5 sentences max for this chunk, even when the change is large. Do not write long paragraphs.\n\n' +
    'By default output only a brief summary and findings that are actual errors or serious issues (use severity "error" or "warning"). Do not use "info" or "suggestion" unless the project rules explicitly ask for them.\n\n'
  const rulesBlock =
    customRules && customRules.trim()
      ? `Apply these project-specific review rules when reviewing:\n\n${customRules.trim()}\n\n---\n\n`
      : ''
  const header = rulesBlock + baseHeader

  const blocks = []
  for (const { file, hunk } of chunkHunks) {
    const ctx = hunk.contextLines ?? []
    const rem = hunk.removedLines ?? []
    const add = hunk.addedLines ?? []

    blocks.push(`\n--- File: ${file} ---`)

    if (ctx.length > 0) {
      blocks.push('Context (unchanged):')
      for (const { newLine, content } of ctx) {
        blocks.push(`  Line ${newLine}: ${content}`)
      }
    }
    if (rem.length > 0) {
      blocks.push('Removed:')
      for (const { line, content } of rem) {
        blocks.push(`  Line ${line} (old): ${content}`)
      }
    }
    if (add.length > 0) {
      blocks.push('Added:')
      for (const { line, content } of add) {
        blocks.push(`  Line ${line}: ${content}`)
      }
    }
  }
  return (
    header +
    (chunkIndex >= 0 ? `Chunk ${chunkIndex + 1}.\n` : '') +
    blocks.join('\n').trim()
  )
}

/**
 * Set of "file:line" that are valid added-line targets for comments in this chunk.
 * @param {Array<{ file: string, hunk: { addedLines: Array<{ line: number }> } }>} chunkHunks
 * @returns {Set<string>}
 */
function addedLineKeys(chunkHunks) {
  const set = new Set()
  for (const { file, hunk } of chunkHunks) {
    const add = hunk.addedLines ?? []
    for (const { line } of add) {
      set.add(`${file}:${line}`)
    }
  }
  return set
}

/**
 * Review one chunk (array of full hunks) with the configured AI provider and return parsed result.
 * Comments are validated to be on added lines only; others are dropped.
 * @param {Array<{ file: string, hunk: { contextLines?: Array, removedLines?: Array, addedLines?: Array } }>} chunkHunks
 * @param {number} chunkIndex
 * @param {{ customRules?: string }} [options] - Optional project rules from .nirik/rules.md
 * @returns {Promise<{ summary: string, reviewComments: Array<{ file: string, line: number, severity: string, body: string }> }>}
 */
export async function reviewChunkWithAI(
  chunkHunks,
  chunkIndex = 0,
  options = {},
) {
  const customRules = options?.customRules ?? ''
  const prompt = buildChunkPrompt(chunkHunks, chunkIndex, customRules)
  const raw = await generateStructuredReview(prompt, reviewChunkResponseSchema)
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = { summary: 'Parse error', reviewComments: [] }
  }
  const result = parsedChunkSchema.parse(parsed)
  const allowedKeys = addedLineKeys(chunkHunks)
  result.reviewComments = result.reviewComments.filter((c) =>
    allowedKeys.has(`${c.file}:${c.line}`),
  )
  return result
}
