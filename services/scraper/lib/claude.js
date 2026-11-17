'use strict'

/**
 * lib/claude.js — the one place this project talks to the Claude API. Reusable: any step that needs "read this, answer in
 * this shape" (docket matching, translating notes, writing selling points, reading an auction sheet photo ...) calls ask().
 *
 *   const { ask } = require('./claude')
 *   const { data, usage } = await ask({
 *     system: 'You match cars to Customs dockets ...',
 *     content: 'Car: TOYOTA ALPHARD AGH40W 2493cc\nCandidates: ...',      // a string, or an array of content blocks (text + images)
 *     schema: { type: 'object', properties: {...}, required: [...], additionalProperties: false },
 *   })
 *
 * Runs on the scraper PC (plain Node, your own key in scraper/.env), so there is no Supabase edge function, no server
 * to pay for and no request limit besides the Anthropic account's own.
 *
 *   ANTHROPIC_API_KEY=         required for any AI step; without it ask() throws "AI is not set up" and callers skip the step
 *   AI_MODEL=claude-haiku-5-5  the cheap, fast model is plenty for matching / translating; change here, not in the code
 *   AI_MAX_TOKENS_PER_RUN=     optional safety stop: once this many input+output tokens are used in one run, ask() refuses
 *                              (blank = no cap). The run summary prints the totals.
 */

require('dotenv').config()

const MODEL = () => process.env.AI_MODEL || 'claude-haiku-5-5'
const CAP = () => { const n = parseInt(process.env.AI_MAX_TOKENS_PER_RUN || '', 10); return Number.isFinite(n) && n > 0 ? n : null }

const totals = { calls: 0, input: 0, output: 0, cacheRead: 0 }
let sdkClient = null

function client() {
  if (sdkClient) return sdkClient
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('AI is not set up (ANTHROPIC_API_KEY is empty in scraper/.env)')
  const Anthropic = require('@anthropic-ai/sdk')
  sdkClient = new (Anthropic.default || Anthropic)({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 3 })
  return sdkClient
}

/** Test hook: use a fake client instead of the real SDK. */
function useClient(fake) { sdkClient = fake }

/**
 * Ask Claude for a JSON answer that matches `schema` (the API enforces the shape, so JSON.parse cannot fail on a normal reply).
 * `system` is sent with prompt caching, so a long fixed instruction costs almost nothing after the first call of a run.
 */
async function ask({ system, content, schema, model, maxTokens = 2000, effort = 'low' }) {
  const cap = CAP()
  if (cap && totals.input + totals.output >= cap) throw new Error(`AI token cap reached (${cap}); raise AI_MAX_TOKENS_PER_RUN to continue`)
  const res = await client().messages.create({
    model: model || MODEL(),
    max_tokens: maxTokens,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    output_config: { effort, format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: typeof content === 'string' ? [{ type: 'text', text: content }] : content }],
  })
  const u = res.usage || {}
  totals.calls++; totals.input += u.input_tokens || 0; totals.output += u.output_tokens || 0; totals.cacheRead += u.cache_read_input_tokens || 0
  if (res.stop_reason === 'refusal') throw new Error('AI declined this request')
  if (res.stop_reason === 'max_tokens') throw new Error('AI answer was cut off (raise maxTokens)')
  const text = (res.content || []).find((b) => b.type === 'text')?.text
  if (!text) throw new Error('AI gave no answer')
  return { data: JSON.parse(text), usage: { input: u.input_tokens || 0, output: u.output_tokens || 0 }, model: res.model || model || MODEL() }
}

/** An image from a URL as a content block (the auction sheet, a photo). */
const imageBlock = (url) => ({ type: 'image', source: { type: 'url', url } })

const summary = () => `AI: ${totals.calls} calls, ${totals.input} input + ${totals.output} output tokens (${totals.cacheRead} read from cache)`

module.exports = { ask, imageBlock, useClient, summary, totals, isReady: () => !!process.env.ANTHROPIC_API_KEY }
