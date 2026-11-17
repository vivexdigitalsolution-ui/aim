'use strict'

// Offline check of lib/claude.js with a fake client (no key, no network):   node test-claude.js
const claude = require('./lib/claude')

let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }

;(async () => {
  let sent = null
  claude.useClient({ messages: { create: async (req) => {
    sent = req
    return { model: req.model, stop_reason: 'end_turn', usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 100 }, content: [{ type: 'text', text: '{"docket":"b","confidence":0.9}' }] }
  } } })

  const r = await claude.ask({ system: 'Pick the docket.', content: 'Car: ALPHARD', schema: { type: 'object', properties: { docket: { type: 'string' }, confidence: { type: 'number' } }, required: ['docket', 'confidence'], additionalProperties: false } })
  ok(r.data.docket === 'b' && r.data.confidence === 0.9, 'JSON answer is parsed')
  ok(sent.model === 'claude-haiku-5-5', 'default model is the cheap one')
  ok(sent.system[0].cache_control?.type === 'ephemeral', 'system prompt is cached')
  ok(sent.output_config.format.type === 'json_schema', 'answer shape is enforced by the schema')
  ok(sent.messages[0].content[0].text === 'Car: ALPHARD', 'string content becomes a text block')
  ok(claude.totals.calls === 1 && claude.totals.input === 120 && claude.totals.cacheRead === 100, 'tokens are counted: ' + claude.summary())

  process.env.AI_MAX_TOKENS_PER_RUN = '100'
  let msg = ''
  try { await claude.ask({ system: 's', content: 'c', schema: {} }) } catch (e) { msg = e.message }
  ok(/token cap/.test(msg), 'stops once the token cap is reached')
  delete process.env.AI_MAX_TOKENS_PER_RUN

  claude.useClient({ messages: { create: async () => ({ stop_reason: 'refusal', content: [], usage: {} }) } })
  msg = ''
  try { await claude.ask({ system: 's', content: 'c', schema: {} }) } catch (e) { msg = e.message }
  ok(/declined/.test(msg), 'a refusal is reported')

  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
  process.exit(fails ? 1 : 0)
})().catch((e) => { console.log(e); process.exit(1) })
