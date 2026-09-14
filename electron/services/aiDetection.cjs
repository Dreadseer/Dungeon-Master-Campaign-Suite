// Pure detection logic for AIService (Phase 6.1).
//
// Kept separate and free of Electron so it can be unit-tested. CommonJS because
// electron/ is CJS; Vitest imports it directly, so there is ONE copy rather
// than the renderer/main duplication CampaignLoreIndex had to accept.
//
// WHY THIS EXISTS
// AIService.initialize used a bare `catch {}`. A 401 (bad key), a 404 (bad model
// id), a DNS failure and a timeout were indistinguishable — to the code and to
// the DM, who saw only "no-ai" with a saved key on screen. Deciding what an
// error MEANS is the part worth testing, so it lives here.

const PROVIDERS = ['auto', 'claude', 'ollama']

/** Models the Ollama path needs: one to chat with, one to embed with. */
const OLLAMA_REQUIRED = { chat: 'llama3', embed: 'nomic-embed-text' }

/**
 * Last-resort Claude model id.
 *
 * Deliberately a constant rather than a guess dressed up as a default: the
 * account's real list comes from GET /v1/models ("Fetch available models" in
 * Settings), and this is only what to try before anyone has fetched it.
 */
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5'

const str = (v) => (v == null ? '' : String(v).trim())

/**
 * Pull an HTTP status out of whatever the Anthropic SDK threw.
 *
 * The SDK sets `.status`; a raw fetch rejection has none; some wrappers carry
 * it on `.response.status`. Falls back to reading it out of the message, since
 * a stringified error is sometimes all that survives.
 */
function statusOf(err) {
  if (!err) return null
  const direct = err.status ?? err.statusCode ?? err.response?.status
  if (Number.isFinite(direct)) return Number(direct)

  // The message fallback must require an explicit status marker. A bare
  // /\b(4\d\d|5\d\d)\b/ matches the PORT in "ECONNREFUSED 1.2.3.4:443" and
  // turns a connection refusal into "HTTP 443", which then classifies as
  // 'unknown' instead of 'offline'. Ports, IP octets and byte counts all look
  // like statuses; only the word next to them says otherwise.
  const m = /(?:\bstatus(?:\s+code)?[:\s]+|\bHTTP[/\s]+|^)\(?([45]\d\d)\b/i.exec(str(err.message))
  return m ? Number(m[1]) : null
}

/** Network-level failures, which say nothing about the key or the model. */
// Two vocabularies, because two stacks are in play: Node's errno codes from the
// Anthropic SDK's fetch, and Chromium's `net::ERR_*` from Electron's net module
// (which is what the Ollama check uses). Matching only the first classified a
// refused Ollama connection as "unknown" instead of "offline".
const OFFLINE_PATTERN =
  /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|EHOSTUNREACH|ENETUNREACH|network|fetch failed|timed? ?out|socket hang up|aborted|net::ERR_|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_ADDRESS_UNREACHABLE/i

/**
 * What does this Claude failure actually mean?
 *
 * The distinction drives behaviour, not just wording (task 7):
 *   'key'     — 401/403. The key is wrong. Preferring Ollama is correct.
 *   'model'   — 404 or a not_found_error body. The KEY MAY BE FINE; only the
 *               model id is wrong, so falling back to Ollama would hide a
 *               one-field fix behind a silent downgrade.
 *   'offline' — no reachable endpoint. Nothing can be concluded.
 *   'rate'    — 429. Transient; the key and model are both fine.
 *   'unknown' — anything else, reported verbatim rather than flattened.
 *
 * @returns {{ kind, status, message }}
 */
function classifyClaudeError(err) {
  const status = statusOf(err)
  const raw = str(err?.message) || 'Request failed'
  const body = str(err?.error?.type) + ' ' + str(err?.error?.error?.type) + ' ' + raw

  if (status === 401 || status === 403) {
    return { kind: 'key', status, message: `the key was rejected (HTTP ${status})` }
  }
  if (status === 404 || /not_found_error/i.test(body)) {
    return { kind: 'model', status: status ?? 404, message: raw }
  }
  if (status === 429) {
    return { kind: 'rate', status, message: 'rate limited (HTTP 429)' }
  }
  // Checked regardless of whether a status was found: a transport-level failure
  // tells us nothing about the key or the model whatever number came with it.
  if (OFFLINE_PATTERN.test(raw)) {
    return { kind: 'offline', status, message: raw }
  }
  if (status !== null && status >= 500) {
    return { kind: 'offline', status, message: `Anthropic returned HTTP ${status}` }
  }
  return { kind: 'unknown', status, message: raw }
}

/** The same question for the Ollama endpoint, where there is no auth to be wrong. */
function classifyOllamaError(err) {
  const raw = str(err?.message) || 'Request failed'
  return {
    kind: OFFLINE_PATTERN.test(raw) ? 'offline' : 'unknown',
    message: raw,
  }
}

/**
 * Which of the required models are missing from an /api/tags response (task 12).
 *
 * Tags carry a version suffix (`llama3:latest`), so matching is on the name
 * before the colon — a DM who pulled `llama3:8b` has llama3.
 */
function missingOllamaModels(tags, required = OLLAMA_REQUIRED) {
  const names = (Array.isArray(tags) ? tags : [])
    .map(t => str(typeof t === 'string' ? t : t?.name ?? t?.model))
    .filter(Boolean)
    .map(n => n.split(':')[0].toLowerCase())

  const missing = []
  for (const wanted of Object.values(required)) {
    if (!names.includes(str(wanted).toLowerCase())) missing.push(wanted)
  }
  return missing
}

/** The exact command to fix a missing model, for Settings to show verbatim. */
function ollamaPullCommand(missing) {
  const list = (missing ?? []).filter(Boolean)
  return list.length ? list.map(m => `ollama pull ${m}`).join(' && ') : ''
}

/**
 * One human sentence per provider, for Settings and the TopBar tooltip.
 *
 * Never returns an empty string for an attempted check: "no reason given" is
 * the failure this whole phase exists to remove.
 */
function describeClaude(claude) {
  if (!claude) return 'Claude: not checked'
  if (!claude.attempted) return `Claude: not checked — ${claude.message || 'no key saved'}`
  if (claude.ok) return `Claude: ready — ${claude.model || 'model unknown'}`

  switch (claude.kind) {
    case 'key':
      return `Claude: rejected — ${claude.message}. Re-enter your API key in Settings.`
    case 'model':
      return `Claude: model '${claude.model}' not found (HTTP ${claude.status ?? 404}) — the key may be fine; pick another model id.`
    case 'unreadable-key':
      return `Claude: a key is saved but could not be decrypted — ${claude.message} Re-enter it.`
    case 'rate':
      return `Claude: ${claude.message} — try again shortly.`
    case 'offline':
      return `Claude: unreachable — ${claude.message}`
    default:
      return `Claude: failed — ${claude.message}`
  }
}

function describeOllama(ollama) {
  if (!ollama) return 'Ollama: not checked'
  if (!ollama.attempted) return `Ollama: not checked — ${ollama.message || 'not selected'}`
  if (ollama.ok) {
    return ollama.missing?.length
      ? `Ollama: reachable at ${ollama.url}, but ${ollama.missing.join(' and ')} ${ollama.missing.length === 1 ? 'is' : 'are'} not pulled`
      : `Ollama: ready at ${ollama.url}`
  }
  return `Ollama: unreachable — ${ollama.message} (${ollama.url})`
}

/** Both lines, in the order Settings shows them. */
function describeDetection(detection) {
  return [describeClaude(detection?.claude), describeOllama(detection?.ollama)]
}

/** A short provider label for the TopBar badge — the provider, not just the mode. */
function providerLabel(detection) {
  const mode = detection?.mode
  if (mode === 'online') return `Claude API${detection?.claude?.model ? ` — ${detection.claude.model}` : ''}`
  if (mode === 'offline-ollama') return `Ollama${detection?.ollama?.chatModel ? ` — ${detection.ollama.chatModel}` : ''}`
  return 'No AI configured'
}

function normaliseProvider(value) {
  const v = str(value).toLowerCase()
  return PROVIDERS.includes(v) ? v : 'auto'
}

/**
 * Should this outcome fall back to the other provider?
 *
 * Only a key that is definitively wrong justifies silently preferring Ollama.
 * A bad model id is one editable field, and hiding it behind a downgrade is how
 * a DM ends up on a local model wondering why their paid key does nothing.
 */
/** The only two outcomes where Claude is worth staying on and fixing. */
const CLAUDE_WORTH_REPORTING = ['model', 'rate']

function shouldFallBackToOllama(claudeResult) {
  if (!claudeResult || claudeResult.ok) return false
  // Stated as an exception list rather than an allow list. Written the other
  // way round, 'no-key' was left out — so the commonest setup of all, no key
  // with a working Ollama, reported no-ai instead of falling back. A kind added
  // later should fall back by default, not silently strand the DM.
  return !CLAUDE_WORTH_REPORTING.includes(claudeResult.kind)
}

module.exports = {
  PROVIDERS,
  OLLAMA_REQUIRED,
  DEFAULT_CLAUDE_MODEL,
  statusOf,
  classifyClaudeError,
  classifyOllamaError,
  missingOllamaModels,
  ollamaPullCommand,
  describeClaude,
  describeOllama,
  describeDetection,
  providerLabel,
  normaliseProvider,
  shouldFallBackToOllama,
}
