const { expandQuery } = require('./queryExpansion')
const { srdSectionName, SRD_SOURCE_FILENAME } = require('./srdIndexText')

class RAGService {
  constructor(db, embeddingService, aiService) {
    this.db               = db
    this.embeddingService = embeddingService
    this.aiService        = aiService
  }

  // Expand common D&D query terms to improve recall. The table moved to
  // ./queryExpansion so it could be unit tested and cross-checked against the
  // renderer's condition list; this stays as a method because callers use it.
  expandQuery(q) {
    return expandQuery(q)
  }

  /**
   * Source ids this campaign is allowed to retrieve from: its own uploaded
   * books, plus every shared source (campaign_id IS NULL — currently just the
   * SRD index).
   *
   * The SRD is included unconditionally. That is the point of Phase 3: a DM with
   * an empty campaign and no uploads can still ask what the restrained condition
   * does and get a grounded answer.
   */
  allowedSourceIds(campaignId) {
    const rows = this.db.all(
      'SELECT id, campaign_id, filename FROM pdf_sources WHERE campaign_id = ? OR campaign_id IS NULL',
      [campaignId]
    )
    return {
      ids: new Set(rows.map(r => r.id)),
      srdSourceId: rows.find(r => r.campaign_id == null && r.filename === SRD_SOURCE_FILENAME)?.id ?? null,
    }
  }

  /** Human-readable citation for a chunk. SRD pages are sections, not pages. */
  _citation(sourceName, pageNumber, isSrd) {
    if (isSrd) return { source: sourceName, page: srdSectionName(pageNumber), isSrd: true }
    return { source: sourceName, page: pageNumber, isSrd: false }
  }

  async query(question, campaignId, options = {}) {
    const { topK = 5, maxContextLen = 3000 } = options

    // ── Step 1: Retrieve ───────────────────────────────────────────────────
    const expandedQuestion = this.expandQuery(question)
    const { ids: allowedIds, srdSourceId } = this.allowedSourceIds(campaignId)

    // Over-fetch, then filter. Filtering a topK-sized list by source is how
    // cross-campaign dilution used to empty the results: five global hits could
    // all belong to another campaign's book, leaving this campaign with nothing
    // even though its own sources had relevant passages further down the list.
    const searchResults = await this.embeddingService.search(expandedQuestion, topK * 4)
    const degraded      = searchResults.degraded === true
    const degradedReason = searchResults.degradedReason ?? null

    let relevantChunks = searchResults
      .filter(r => allowedIds.has(r.source_id))
      .slice(0, topK)

    // ── Step 2: Keyword top-up when semantic scores are weak ───────────────
    const goodResults = relevantChunks.filter(r => r.score > 0.5)
    if (goodResults.length < 2 && allowedIds.size > 0) {
      const keywords = question.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3)
      if (keywords.length > 0) {
        const placeholders = keywords.map(() => 'text LIKE ?').join(' OR ')
        // Scoped to the same allowed set, so the SRD is searchable here too —
        // the old query filtered on campaign_id = ? and could never see it.
        const idList = [...allowedIds]
        const keywordResults = this.db.all(`
          SELECT id AS chunk_id, source_id, page_number, text, 0.4 AS score
          FROM pdf_chunks
          WHERE source_id IN (${idList.map(() => '?').join(',')})
            AND (${placeholders})
          LIMIT ?`,
          [...idList, ...keywords.map(k => `%${k}%`), topK]
        )
        const merged = [...goodResults, ...keywordResults]
        const seen   = new Set()
        relevantChunks = merged
          .filter(r => {
            const key = r.chunk_id ?? r.id
            if (seen.has(key)) return false
            seen.add(key)
            return true
          })
          .sort((a, b) => b.score - a.score)
          .slice(0, topK)
      }
    }

    // ── Step 3: Resolve source names for attribution ───────────────────────
    const sourceMap = {}
    relevantChunks.forEach(chunk => {
      if (!sourceMap[chunk.source_id]) {
        const source = this.db.get('SELECT filename FROM pdf_sources WHERE id=?', [chunk.source_id])
        sourceMap[chunk.source_id] = source?.filename ?? 'Unknown Source'
      }
    })

    // ── Step 4: Assemble context ───────────────────────────────────────────
    let contextText = ''
    const usedChunks = []
    for (const chunk of relevantChunks) {
      const isSrd = chunk.source_id === srdSourceId
      const cite  = this._citation(sourceMap[chunk.source_id], chunk.page_number, isSrd)
      const label = isSrd ? `${cite.source}, ${cite.page}` : `${cite.source}, p.${cite.page}`
      const chunkContext = `[Source: ${label}]\n${chunk.text}\n\n`
      if ((contextText + chunkContext).length > maxContextLen) break
      contextText += chunkContext
      usedChunks.push({
        ...cite,
        // Passages are the primary result in no-ai mode, so the preview has to
        // be long enough to actually read a rule from.
        preview: chunk.text.slice(0, 400) + (chunk.text.length > 400 ? '…' : ''),
        text:    chunk.text,
        score:   chunk.score,
      })
    }

    const mode = this.aiService.getMode()
    const base = { sources: usedChunks, degraded, degradedReason, mode }

    // ── Step 5: no-ai — the passages ARE the answer ────────────────────────
    //
    // Previously this path threw "No AI service available", so a DM without a
    // key and without Ollama got an error where a rules lookup should have been,
    // even though the retrieved SRD text answers most single-rule questions on
    // its own.
    if (mode === 'no-ai') {
      return {
        ...base,
        answer: null,
        extractedPassages: true,
        noSourcesFound: usedChunks.length === 0,
      }
    }

    // ── Step 6: No sources — fall back to the model's own knowledge ────────
    if (!contextText.trim()) {
      const answer = await this.aiService.complete(
        'You are a D&D 5e rules expert. Answer the question clearly and concisely.',
        question,
        { campaignId, type: 'rag_fallback' }
      )
      return { ...base, answer, noSourcesFound: true, extractedPassages: false }
    }

    // ── Step 7: Grounded answer ────────────────────────────────────────────
    const systemPrompt = [
      'You are a D&D rules expert assistant.',
      'Answer the question using ONLY the provided source material context.',
      'Be specific and cite the source when relevant.',
      'If the context does not contain enough information, say so clearly.',
      'Keep your answer concise and directly useful at the game table.',
    ].join(' ')

    const userMessage = [
      'SOURCE MATERIAL:',
      contextText,
      '---',
      `QUESTION: ${question}`,
    ].join('\n')

    const answer = await this.aiService.complete(systemPrompt, userMessage, { campaignId, type: 'rag' })

    return { ...base, answer, noSourcesFound: false, extractedPassages: false }
  }

  // ── Situation mode (Phase 3, stretch) ─────────────────────────────────────
  //
  // A single retrieval answers "what does restrained do". It does badly on "the
  // rogue is grappled by a giant octopus underwater and wants to cast a spell
  // with somatic components" — one embedding of that whole sentence lands
  // between four different rules and retrieves none of them well.
  //
  // So: decompose into concepts, retrieve per concept, union, then ask for one
  // ruling over the whole set. Requires AI for the decomposition, so it is
  // hidden in no-ai mode rather than degrading.

  async situationQuery(situation, campaignId, options = {}) {
    const { topK = 3, maxContextLen = 4000, maxConcepts = 5 } = options

    const mode = this.aiService.getMode()
    if (mode === 'no-ai') {
      throw new Error('Situation mode needs an AI model. Configure an API key or start Ollama.')
    }

    // ── Step 1: decompose ─────────────────────────────────────────────────
    const concepts = await this._decompose(situation, campaignId, maxConcepts)

    // ── Step 2: retrieve per concept, union and dedupe ────────────────────
    const { ids: allowedIds, srdSourceId } = this.allowedSourceIds(campaignId)
    const byChunkId = new Map()
    const perConcept = []
    let anyDegraded = false

    for (const concept of concepts) {
      const results = await this.embeddingService.search(this.expandQuery(concept), topK * 4)
      if (results.degraded) anyDegraded = true
      const hits = results.filter(r => allowedIds.has(r.source_id)).slice(0, topK)
      perConcept.push({ concept, hits: hits.length })

      for (const hit of hits) {
        const key = hit.chunk_id
        // A chunk retrieved by two concepts keeps its best score, and records
        // both — the ruling should know a passage covers more than one issue.
        const existing = byChunkId.get(key)
        if (existing) {
          existing.score = Math.max(existing.score, hit.score)
          if (!existing.concepts.includes(concept)) existing.concepts.push(concept)
        } else {
          byChunkId.set(key, { ...hit, concepts: [concept] })
        }
      }
    }

    const union = [...byChunkId.values()].sort((a, b) => b.score - a.score)

    // ── Step 3: assemble and rule ─────────────────────────────────────────
    const sourceMap = {}
    union.forEach(chunk => {
      if (!sourceMap[chunk.source_id]) {
        const source = this.db.get('SELECT filename FROM pdf_sources WHERE id=?', [chunk.source_id])
        sourceMap[chunk.source_id] = source?.filename ?? 'Unknown Source'
      }
    })

    let contextText = ''
    const usedChunks = []
    for (const chunk of union) {
      const isSrd = chunk.source_id === srdSourceId
      const cite  = this._citation(sourceMap[chunk.source_id], chunk.page_number, isSrd)
      const label = isSrd ? `${cite.source}, ${cite.page}` : `${cite.source}, p.${cite.page}`
      const block = `[Source: ${label} | covers: ${chunk.concepts.join('; ')}]\n${chunk.text}\n\n`
      if ((contextText + block).length > maxContextLen) break
      contextText += block
      usedChunks.push({
        ...cite,
        concepts: chunk.concepts,
        preview: chunk.text.slice(0, 400) + (chunk.text.length > 400 ? '…' : ''),
        text:    chunk.text,
        score:   chunk.score,
      })
    }

    const systemPrompt = [
      'You are a D&D 5e rules expert helping a DM adjudicate a situation at the table.',
      'You are given the rules concepts involved and the source passages for each.',
      'Give a clear ruling, then a short justification that names which concept and',
      'which source each part of the ruling comes from.',
      'If the passages do not settle a component, say which one and say what you would rule anyway.',
      'Be concise: a DM is reading this mid-session.',
    ].join(' ')

    const userMessage = [
      `SITUATION: ${situation}`,
      '',
      `RULES CONCEPTS IDENTIFIED: ${concepts.join('; ')}`,
      '',
      'SOURCE MATERIAL:',
      contextText || '(no passages retrieved)',
    ].join('\n')

    const answer = await this.aiService.complete(systemPrompt, userMessage, {
      campaignId, type: 'rag_situation', maxTokens: 1500,
    })

    return {
      answer,
      concepts,
      perConcept,
      sources: usedChunks,
      degraded: anyDegraded,
      mode,
      noSourcesFound: usedChunks.length === 0,
      extractedPassages: false,
    }
  }

  /**
   * Ask the model to break a situation into 2-5 rules concepts, as strict JSON.
   * Falls back to the raw situation as a single concept if the model's output
   * cannot be parsed — a worse decomposition still beats an error.
   */
  async _decompose(situation, campaignId, maxConcepts) {
    const systemPrompt = [
      'You break a D&D 5e table situation into the distinct rules concepts it involves.',
      `Reply with ONLY a JSON array of 2 to ${maxConcepts} short strings, no prose, no code fence.`,
      'Each string names one rules concept to look up, in the vocabulary the rules use.',
      'Example input: "the grappled rogue wants to cast a spell with somatic components underwater"',
      'Example output: ["grappled condition","somatic components","spellcasting underwater","improvised weapon attacks"]',
    ].join(' ')

    const raw = await this.aiService.complete(systemPrompt, situation, {
      campaignId, type: 'rag_decompose', maxTokens: 300,
    })

    const parsed = this._parseConceptList(raw)
    return parsed.length > 0 ? parsed.slice(0, maxConcepts) : [situation]
  }

  /** Pull a JSON string array out of a model response that may be wrapped. */
  _parseConceptList(raw) {
    if (typeof raw !== 'string') return []
    // Models wrap JSON in ```json fences even when told not to.
    const unfenced = raw.replace(/```(?:json)?/gi, '').trim()
    const start = unfenced.indexOf('[')
    const end   = unfenced.lastIndexOf(']')
    if (start === -1 || end === -1 || end < start) return []
    try {
      const arr = JSON.parse(unfenced.slice(start, end + 1))
      if (!Array.isArray(arr)) return []
      return arr
        .map(v => (typeof v === 'string' ? v.trim() : ''))
        .filter(v => v.length > 0 && v.length < 200)
    } catch {
      return []
    }
  }
}

module.exports = RAGService
