import { z } from 'zod'
import { generateStructuredReview } from '../ai/aiProvider.js'

/** JSON Schema for structured review output (one chunk). */
export const reviewChunkResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: {
      type: 'string',
      description: 'Brief summary of findings for this chunk',
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
 * Build the prompt text for one chunk of added lines.
 * When customRules is non-empty, prepends a project rules section.
 * @param {Array<{ file: string, line: number, content: string }>} lines
 * @param {number} chunkIndex
 * @param {string} [customRules] - Optional project rules from .nirik/rules.md
 * @returns {string}
 */
function buildChunkPrompt(lines, chunkIndex, customRules = '') {
  const baseHeader =
    'You are a code reviewer. Review only the following ADDED lines. For each finding, report: file path, line number (new side), severity (info | suggestion | warning | error), and a concise comment. Prefer actionable comments.\n\n'
  const rulesBlock =
    customRules && customRules.trim()
      ? `Apply these project-specific review rules when reviewing:\n\n${customRules.trim()}\n\n---\n\n`
      : ''
  const header = rulesBlock + baseHeader

  const blocks = []
  let currentFile = null
  for (const { file, line, content } of lines) {
    if (file !== currentFile) {
      blocks.push(`\n--- File: ${file} ---`)
      currentFile = file
    }
    blocks.push(`Line ${line}: ${content}`)
  }
  return (
    header +
    (chunkIndex >= 0 ? `Chunk ${chunkIndex + 1}.\n` : '') +
    blocks.join('\n').trim()
  )
}

/**
 * Review one chunk with the configured AI provider (Gemini or OpenAI) and return parsed result.
 * @param {Array<{ file: string, line: number, content: string }>} chunkLines
 * @param {number} chunkIndex
 * @param {{ customRules?: string }} [options] - Optional project rules from .nirik/rules.md
 * @returns {Promise<{ summary: string, reviewComments: Array<{ file: string, line: number, severity: string, body: string }> }>}
 */
export async function reviewChunkWithAI(
  chunkLines,
  chunkIndex = 0,
  options = {},
) {
  const customRules = options?.customRules ?? ''
  const prompt = buildChunkPrompt(chunkLines, chunkIndex, customRules)
  const raw = await generateStructuredReview(prompt, reviewChunkResponseSchema)
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = { summary: 'Parse error', reviewComments: [] }
  }
  return parsedChunkSchema.parse(parsed)
}
