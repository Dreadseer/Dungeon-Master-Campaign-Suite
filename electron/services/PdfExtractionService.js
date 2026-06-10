/**
 * PdfExtractionService — Phase 7
 *
 * Detects D&D 5e content type from PDF chunk text, then extracts structured
 * spell / item / equipment data using regex patterns or AI-assisted parsing.
 * Also provides campaign-scoped semantic search via EmbeddingService.
 */

class PdfExtractionService {
  constructor(db, aiService, embeddingService) {
    this.db               = db
    this.aiService        = aiService
    this.embeddingService = embeddingService
  }

  // ── Type detection ──────────────────────────────────────────────────────

  /**
   * Detect whether chunk text describes a spell, item, equipment, or is unknown.
   * @param {string} text
   * @returns {'spell'|'item'|'equipment'|'unknown'}
   */
  detectType(text) {
    const t = text.toLowerCase()

    // ── Spell signals ────────────────────────────────────────────────────
    const hasLevelOrCantrip =
      /\b(\d+)(?:st|nd|rd|th)[- ]level\b/.test(t) || /\bcantrip\b/.test(t)
    const hasSchool = /\b(abjuration|conjuration|divination|enchantment|evocation|illusion|necromancy|transmutation)\b/.test(t)
    const hasCastingTime = /casting time/i.test(t)
    const hasDuration    = /\bduration\b/i.test(t)
    const hasComponents  = /\bcomponents?\b/i.test(t)

    if (
      (hasLevelOrCantrip && hasSchool && hasCastingTime) ||
      (hasCastingTime && hasDuration && hasComponents)
    ) {
      return 'spell'
    }

    // ── Item signals ─────────────────────────────────────────────────────
    const hasRarity = /\b(common|uncommon|rare|very rare|legendary|artifact)\b/i.test(t)
    const hasItemKeyword = /\b(potion|ring|rod|wand|staff|wondrous item|attunement)\b/i.test(t)
    const hasMagicWeaponArmor = /\bmagic\b/.test(t) && /\b(weapon|armor|armour|shield)\b/.test(t)

    if (hasRarity || hasItemKeyword || hasMagicWeaponArmor) {
      return 'item'
    }

    // ── Equipment signals ────────────────────────────────────────────────
    const hasDamageDice  = /\b\d+d\d+\b/.test(t)
    const hasCost        = /\b\d+\s*(gp|sp|cp|pp|gold|silver|copper)\b/i.test(t)
    const hasWeight      = /\b\d+\.?\d*\s*(lb|lbs|pound|pounds)\b/i.test(t)
    const hasHitDiceOrHP = /\bhit dice\b|\bhit points\b/i.test(t)

    if ((hasDamageDice || hasHitDiceOrHP) && (hasCost || hasWeight)) {
      return 'equipment'
    }

    // Plain weapon/armor lines without rarity often qualify as equipment
    if (
      /\b(weapon|armor|armour|shield|sword|axe|bow|crossbow|dagger|spear|mace|flail|hammer|pike|lance|rapier|scimitar|shortsword|longsword|greatsword|handaxe|battleaxe|greataxe|warhammer|maul|quarterstaff|club|sling|dart|javelin|trident|whip|net|blowgun|hand crossbow|light crossbow|heavy crossbow|longbow|shortbow|light hammer|morningstar|war pick)\b/i.test(t) &&
      (hasCost || hasWeight || hasDamageDice)
    ) {
      return 'equipment'
    }

    return 'unknown'
  }

  // ── Regex extractors ────────────────────────────────────────────────────

  /**
   * Extract spell fields from chunk text using regex patterns.
   * @param {string} text
   * @param {string} sourceName  — PDF filename used as source_book
   * @param {number|null} pageNumber
   * @returns {object}  Spell-shaped object with _confidence (0–100)
   */
  extractSpell(text, sourceName, pageNumber) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
    const name  = lines[0] || 'Unknown Spell'

    // Level
    let level = 0
    const levelMatch = text.match(/\b(\d+)(?:st|nd|rd|th)[- ]level\b/i)
    if (levelMatch) level = parseInt(levelMatch[1], 10)
    // cantrip stays 0

    // School
    const schoolMatch = text.match(/\b(abjuration|conjuration|divination|enchantment|evocation|illusion|necromancy|transmutation)\b/i)
    const school = schoolMatch ? schoolMatch[1].toLowerCase() : ''

    // Casting time — allow multi-word values (e.g. "1 bonus action")
    const castingTimeMatch = text.match(/casting time[:\s]+([^\n]+)/i)
    const casting_time     = castingTimeMatch ? castingTimeMatch[1].trim() : ''

    // Range
    const rangeMatch = text.match(/\brange[:\s]+([^\n]+)/i)
    const range      = rangeMatch ? rangeMatch[1].trim() : ''

    // Components (V, S, M ...)
    const componentsMatch = text.match(/components?[:\s]+([^\n]+)/i)
    const components      = componentsMatch ? componentsMatch[1].trim() : ''

    // Duration
    const durationMatch = text.match(/\bduration[:\s]+([^\n]+)/i)
    const duration      = durationMatch ? durationMatch[1].trim() : ''

    // Description — everything after the metadata header lines
    const metaLabelRx = /^(casting time|range|components?|duration|classes?|level|school)[:\s]/i
    let pastMeta   = false
    const descLines = []
    for (const line of lines.slice(1)) {
      if (!pastMeta) {
        if (metaLabelRx.test(line)) continue
        pastMeta = true
      }
      descLines.push(line)
    }
    const description = descLines.join('\n').trim()

    // Confidence
    let confidence = 0
    if (name !== 'Unknown Spell') confidence += 20
    if (school)                   confidence += 20
    if (casting_time)             confidence += 20
    if (duration)                 confidence += 20
    if (components)               confidence += 20

    return {
      name, level, school, casting_time, range, components, duration,
      description, source: sourceName || '', page: pageNumber ?? null,
      _confidence: confidence,
    }
  }

  /**
   * Extract item fields from chunk text using regex patterns.
   * @param {string} text
   * @param {string} sourceName
   * @param {number|null} pageNumber
   * @returns {object}  Item-shaped object with _confidence (0–100)
   */
  extractItem(text, sourceName, pageNumber) {
    const lines    = text.split('\n').map(l => l.trim()).filter(Boolean)
    const name     = lines[0] || 'Unknown Item'

    // Item type
    const itemTypeMatch = text.match(/\b(weapon|armor|armour|potion|ring|rod|wand|staff|wondrous item|shield|scroll|gem|tool)\b/i)
    const item_type     = itemTypeMatch ? itemTypeMatch[1].toLowerCase() : 'item'

    // Rarity
    const rarityMatch = text.match(/\b(common|uncommon|rare|very rare|legendary|artifact)\b/i)
    const rarity      = rarityMatch ? rarityMatch[1].toLowerCase() : ''

    // Attunement
    const requires_attunement = /requires attunement|attunement required/i.test(text) ? 1 : 0

    // Cost
    const costMatch = text.match(/(\d+(?:,\d+)*)\s*(gp|sp|cp|pp)/i)
    const cost      = costMatch ? `${costMatch[1]} ${costMatch[2]}` : ''

    // Weight
    const weightMatch = text.match(/(\d+\.?\d*)\s*(lb|lbs|pounds?)/i)
    const weight      = weightMatch ? parseFloat(weightMatch[1]) : null

    // Properties (explicit label OR first parenthetical)
    const propertiesLabelMatch = text.match(/properties?[:\s]+([^\n]+)/i)
    const propertiesParenMatch = text.match(/\(([^)]+)\)/)
    const properties =
      propertiesLabelMatch ? propertiesLabelMatch[1].trim() :
      propertiesParenMatch  ? propertiesParenMatch[1].trim() : ''

    // Description — skip name and obvious metadata lines
    const metaLineRx = /^(type|rarity|attunement|weight|cost|value|properties?)[:\s]/i
    const descLines  = []
    let first = true
    for (const line of lines) {
      if (first) { first = false; continue }  // skip name line
      if (metaLineRx.test(line)) continue
      descLines.push(line)
    }
    const description = descLines.join('\n').trim()

    let confidence = 0
    if (name !== 'Unknown Item') confidence += 25
    if (rarity)                  confidence += 25
    if (item_type !== 'item')    confidence += 25
    if (description)             confidence += 25

    return {
      name, item_type, rarity, requires_attunement, cost, weight,
      description, properties, source: sourceName || '', page: pageNumber ?? null,
      _confidence: confidence,
    }
  }

  // ── AI-assisted extraction ───────────────────────────────────────────────

  /**
   * Use AIService.complete() to extract structured fields from chunk text.
   * Returns parsed JSON object or null on failure.
   * @param {string} chunkText
   * @param {'spell'|'item'|'equipment'} entryType
   * @param {string} sourceName
   * @param {number|null} pageNumber
   * @returns {Promise<object|null>}
   */
  async extractWithAI(chunkText, entryType, sourceName, pageNumber) {
    try {
      const fieldsByType = {
        spell:     'name, level (integer 0-9), school, casting_time, range, components, duration, description',
        item:      'name, item_type, rarity, requires_attunement (boolean), cost, weight (number or null), description, properties',
        equipment: 'name, category, cost, weight (number or null), damage, damage_type, properties, description',
      }

      const systemPrompt =
        'You are a D&D 5e content parser. Extract structured data from the provided text. ' +
        'Return ONLY valid JSON — no markdown, no commentary, no code fences.'

      const message =
        `Extract the following D&D 5e ${entryType} from this text.\n` +
        `Source: "${sourceName || 'Unknown'}", Page: ${pageNumber ?? 'unknown'}.\n` +
        `Return a JSON object with these fields: ${fieldsByType[entryType] ?? fieldsByType.item}.\n` +
        `Use null for any field that cannot be determined.\n\nTEXT:\n${chunkText.slice(0, 2000)}`

      const response = await this.aiService.complete(systemPrompt, message)

      // Strip markdown code fences that AI may include despite instructions
      const cleaned = response
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/g, '')
        .trim()

      const parsed = JSON.parse(cleaned)
      return {
        ...parsed,
        source:        sourceName || '',
        page:          pageNumber ?? null,
        _ai_extracted: true,
        _confidence:   85,
      }
    } catch (err) {
      console.error('[PdfExtraction] AI extraction failed:', err.message)
      return null
    }
  }

  // ── Main processing entry point ─────────────────────────────────────────

  /**
   * Process a single chunk: detect type, extract fields (AI then regex fallback).
   * @param {{ id, source_id, chunk_index, page_number, text }} chunk
   * @param {string} sourceFilename
   * @param {boolean} useAI
   * @returns {Promise<object>}
   */
  async processChunk(chunk, sourceFilename, useAI = false) {
    const type = this.detectType(chunk.text)

    const meta = {
      _type:        type,
      _chunk_id:    chunk.id,
      _source_id:   chunk.source_id,
      _chunk_index: chunk.chunk_index,
      _page:        chunk.page_number,
      _raw_text:    chunk.text,
    }

    if (type === 'unknown') {
      return {
        ...meta,
        name:        '',
        description: chunk.text.slice(0, 300),
        _confidence: 0,
      }
    }

    // Try AI extraction first if requested and available
    if (useAI && this.aiService) {
      const aiResult = await this.extractWithAI(chunk.text, type, sourceFilename, chunk.page_number)
      if (aiResult) return { ...aiResult, ...meta }
    }

    // Regex fallback
    let extracted
    if (type === 'spell') {
      extracted = this.extractSpell(chunk.text, sourceFilename, chunk.page_number)
    } else if (type === 'item') {
      extracted = this.extractItem(chunk.text, sourceFilename, chunk.page_number)
    } else {
      // equipment — borrow item extractor, rename item_type → category
      extracted          = this.extractItem(chunk.text, sourceFilename, chunk.page_number)
      extracted.category = extracted.item_type
      delete extracted.item_type

      // Pull out damage dice if present
      const damageMatch = chunk.text.match(/\b(\d+d\d+(?:\s*[+-]\s*\d+)?)\b/)
      extracted.damage  = damageMatch ? damageMatch[1] : ''

      // Damage type
      const damageTypeMatch = chunk.text.match(
        /\b(slashing|piercing|bludgeoning|fire|cold|lightning|thunder|acid|poison|psychic|radiant|necrotic|force)\b/i
      )
      extracted.damage_type = damageTypeMatch ? damageTypeMatch[1].toLowerCase() : ''
    }

    return { ...extracted, ...meta }
  }

  // ── Semantic search ─────────────────────────────────────────────────────

  /**
   * Run a semantic (vector) search against this campaign's embedded PDF chunks.
   * @param {string} query
   * @param {number} campaignId
   * @param {number} topK
   * @returns {Promise<Array>}  Enriched chunk objects with _score
   */
  async semanticSearch(query, campaignId, topK = 10) {
    try {
      const results = await this.embeddingService.search(query, topK)
      if (!results || !results.length) return []

      // Build a map of valid source IDs for this campaign
      const sources    = this.db.all(
        `SELECT id, filename FROM pdf_sources WHERE campaign_id = ? AND status IN ('indexed', 'embedded')`,
        [campaignId]
      )
      const sourceMap  = new Map(sources.map(s => [s.id, s.filename]))

      // Filter results to this campaign, enrich with filename
      return results
        .filter(r => sourceMap.has(r.source_id))
        .map(r => ({
          // Align field names with what db:pdf:searchChunks returns
          id:          r.chunk_id,
          source_id:   r.source_id,
          chunk_index: null,   // not stored in vectra metadata
          page_number: r.page_number,
          text:        r.text,
          filename:    sourceMap.get(r.source_id),
          _score:      r.score,
        }))
    } catch (err) {
      console.error('[PdfExtraction] Semantic search failed:', err.message)
      return []
    }
  }
}

module.exports = PdfExtractionService
