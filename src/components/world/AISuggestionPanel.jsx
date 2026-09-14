import { useState, useEffect } from 'react'
import SuggestionCards from '../ai/SuggestionCards'
import { notifyError } from '../../stores/toastStore'

// The World Builder's AI panel (Phase 6 tasks 1-2).
//
// It used to call ai.complete once and render the reply as <p> lines split on
// newlines, with only "Generate Suggestions" and "Regenerate" to act on: no
// Save, no Apply, no Accept. A DM who liked an idea re-typed it by hand into
// three separate forms. The prompt was also blind — it sent three integer counts
// and the names of the first three NPCs, and no lore text at all, so the model
// was told how MANY things existed and never what any of them were.
//
// All of that now lives in SuggestionCards (shared with the AI Assistant) and
// aiContext (the budgeted world summary). This file is the collapsible shell
// and the data it needs.

export default function AISuggestionPanel({ activeCampaign, factions, locations, npcs, lore = [], onSaved }) {
  const [open, setOpen] = useState(false)
  const [session, setSession] = useState(null)
  const [plots, setPlots] = useState([])

  // The current session and open plot threads were never available to this
  // panel; together with lore they are most of what makes a suggestion fit the
  // world rather than merely sound like D&D. Fetched only once the panel is
  // opened — a collapsed panel should cost nothing.
  useEffect(() => {
    if (!open || !activeCampaign?.id) return
    const api = window.electronAPI.db
    Promise.allSettled([
      api.sessions.getCurrent(activeCampaign.id),
      api.plots.getAll(activeCampaign.id),
    ]).then(([se, pl]) => {
      const val = (r, fallback) => (r.status === 'fulfilled' && r.value != null ? r.value : fallback)
      setSession(val(se, null))
      setPlots(val(pl, []))
    }).catch(err => notifyError(err, 'Load world context'))
  }, [open, activeCampaign?.id])

  return (
    <div style={s.panel}>
      <button style={s.toggle} onClick={() => setOpen(o => !o)}>
        {open ? '▾' : '▸'} ✨ AI World Suggestions
      </button>

      {open && (
        <div style={s.body}>
          <SuggestionCards
            campaign={activeCampaign}
            world={{
              campaign: activeCampaign,
              npcs: npcs ?? [],
              locations: locations ?? [],
              factions: factions ?? [],
              lore, session, plots,
            }}
            onSaved={onSaved}
          />
        </div>
      )}
    </div>
  )
}

const s = {
  panel:  { border: '1px solid #3a2a10', borderRadius: 6, overflow: 'hidden', marginTop: '2rem' },
  toggle: { display: 'block', width: '100%', background: '#1a1208', border: 'none', color: '#c9a84c', padding: '0.75rem 1rem', textAlign: 'left', cursor: 'pointer', fontSize: '0.9rem', fontFamily: 'Georgia, serif' },
  body:   { background: '#100d08', padding: '1rem' },
}
