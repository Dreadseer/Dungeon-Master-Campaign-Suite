class RAGService {
  constructor(db, embeddingService, aiService) {
    this.db               = db
    this.embeddingService = embeddingService
    this.aiService        = aiService
  }

  // Expand common D&D query terms to improve embedding recall
  expandQuery(q) {
    const expansions = {
      'attack':      'attack roll hit bonus',
      'damage':      'damage dice roll',
      'spell':       'spell casting spellcasting',
      'save':        'saving throw',
      'dc':          'difficulty class',
      'proficiency': 'proficiency bonus',
      'reaction':    'reaction action bonus action',
    }
    const words = q.toLowerCase().split(' ')
    const extra = words.flatMap(w => (expansions[w] ? [expansions[w]] : []))
    return extra.length > 0 ? `${q} ${extra.join(' ')}` : q
  }

  async query(question, campaignId, options = {}) {
    const { topK = 5, maxContextLen = 3000 } = options

    // ── Step 1: Semantic search using expanded query ───────────────────────
    const expandedQuestion = this.expandQuery(question)
    const searchResults    = await this.embeddingService.search(expandedQuestion, topK)

    // ── Step 2: Filter to campaign-specific sources only ──────────────────
    const campaignSourceIds = new Set(
      this.db.all('SELECT id FROM pdf_sources WHERE campaign_id=?', [campaignId])
        .map(s => s.id)
    )
    let relevantChunks = searchResults.filter(r => campaignSourceIds.has(r.source_id))

    // ── Step 3: Hybrid fallback — keyword search if semantic scores are low ─
    const goodResults = relevantChunks.filter(r => r.score > 0.5)
    if (goodResults.length < 2) {
      const keywords = question.toLowerCase().split(' ').filter(w => w.length > 3)
      if (keywords.length > 0) {
        const placeholders = keywords.map(() => 'text LIKE ?').join(' OR ')
        const keywordResults = this.db.all(`
          SELECT id AS chunk_id, source_id, page_number, text, 0.4 AS score
          FROM pdf_chunks
          WHERE source_id IN (SELECT id FROM pdf_sources WHERE campaign_id=?)
            AND (${placeholders})
          LIMIT 5`,
          [campaignId, ...keywords.map(k => `%${k}%`)]
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
      }
    }

    // ── Step 4: Resolve source filenames for attribution ──────────────────
    const sourceMap = {}
    relevantChunks.forEach(chunk => {
      if (!sourceMap[chunk.source_id]) {
        const source = this.db.get('SELECT filename FROM pdf_sources WHERE id=?', [chunk.source_id])
        sourceMap[chunk.source_id] = source?.filename ?? 'Unknown Source'
      }
    })

    // ── Step 5: Assemble context (truncated to maxContextLen) ─────────────
    let contextText = ''
    const usedChunks = []
    for (const chunk of relevantChunks) {
      const chunkContext = `[Source: ${sourceMap[chunk.source_id]}, p.${chunk.page_number}]\n${chunk.text}\n\n`
      if ((contextText + chunkContext).length > maxContextLen) break
      contextText += chunkContext
      usedChunks.push({
        source:  sourceMap[chunk.source_id],
        page:    chunk.page_number,
        preview: chunk.text.slice(0, 120) + (chunk.text.length > 120 ? '…' : ''),
        score:   chunk.score,
      })
    }

    // ── Step 6: No sources found — fall back to general AI knowledge ──────
    if (!contextText.trim()) {
      const answer = await this.aiService.complete(
        'You are a D&D 5e rules expert. Answer the question clearly and concisely.',
        question,
        { campaignId, type: 'rag_fallback' }
      )
      return { answer, sources: [], noSourcesFound: true }
    }

    // ── Step 7: Build RAG prompt and get grounded answer ──────────────────
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

    return { answer, sources: usedChunks, noSourcesFound: false }
  }
}

module.exports = RAGService
