import { useState, useEffect, useCallback } from 'react'
import Skeleton from '../ui/Skeleton'

function hpPct(char) {
  if (!char.hp_max) return 0
  return Math.max(0, Math.min(1, char.hp_current / char.hp_max))
}

function hpColor(pct) {
  if (pct > 0.5)  return '#2D7A2D'
  if (pct > 0.25) return '#B8750A'
  return '#8B0000'
}

export default function PlayerCharacterSelect({ campaignId, broadcastMsg, onSelect }) {
  const [characters, setCharacters] = useState([])
  const [loading,    setLoading]    = useState(true)

  const load = useCallback(async () => {
    if (!campaignId) return
    try {
      const data = await window.electronAPI.db.characters.getAll(campaignId)
      setCharacters(data ?? [])
    } catch {
      setCharacters([])
    }
    setLoading(false)
  }, [campaignId])

  // Initial load
  useEffect(() => { load() }, [load])

  // Refresh on character:sync broadcast
  useEffect(() => {
    if (broadcastMsg?.type === 'character:sync') {
      load()
    }
  }, [broadcastMsg, load])

  if (loading) {
    return (
      <div style={s.page}>
        <h2 style={s.heading}>Choose Your Character</h2>
        <div style={s.grid}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ ...s.card, cursor: 'default', gap: '0.75rem' }}>
              <Skeleton width={48} height="48px" borderRadius="50%" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Skeleton width="70%" height="1rem" />
                <Skeleton width="55%" height="0.75rem" />
              </div>
              <Skeleton width="100%" height="6px" borderRadius="3px" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (characters.length === 0) {
    return (
      <div style={s.center}>
        <p style={s.hint}>No characters found for this campaign.</p>
        <p style={s.subHint}>Ask your Dungeon Master to create your character sheet.</p>
      </div>
    )
  }

  return (
    <div style={s.page}>
      <h2 style={s.heading}>Choose Your Character</h2>
      <div style={s.grid}>
        {characters.map(char => {
          const pct   = hpPct(char)
          const color = hpColor(pct)
          const stats = (() => { try { return JSON.parse(char.stats ?? '{}') } catch { return {} } })()
          const initMod = Math.floor(((stats.dex ?? 10) - 10) / 2)

          return (
            <button key={char.id} style={s.card} onClick={() => onSelect(char.id)}>
              {/* Avatar */}
              <div style={s.avatar}>
                {(char.character_name?.[0] ?? '?').toUpperCase()}
              </div>

              {/* Identity */}
              <div style={s.identity}>
                <span style={s.charName}>{char.character_name}</span>
                <span style={s.charMeta}>
                  {[char.race, char.class, char.level ? `Level ${char.level}` : null]
                    .filter(Boolean).join(' · ')}
                </span>
                {char.player_name && (
                  <span style={s.playerName}>Player: {char.player_name}</span>
                )}
              </div>

              {/* HP bar */}
              <div style={s.hpSection}>
                <div style={s.hpLabel}>
                  <span style={s.hpText}>HP</span>
                  <span style={{ ...s.hpNumbers, color: pct === 0 ? '#e05050' : '#e8e0d0' }}>
                    {pct === 0
                      ? 'UNCONSCIOUS'
                      : `${char.hp_current ?? char.hp_max ?? '—'} / ${char.hp_max ?? '—'}`}
                  </span>
                </div>
                <div style={s.hpTrack}>
                  <div style={{ ...s.hpFill, width: `${pct * 100}%`, background: color }} />
                </div>
              </div>

              <div style={s.selectHint}>Select →</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = {
  page:       { padding: '1.5rem', maxWidth: 960, margin: '0 auto' },
  heading:    { color: '#c9a84c', fontSize: '1.4rem', marginBottom: '1.25rem' },
  grid:       { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' },
  card:       { background: '#1a1208', border: '1px solid #3a2a10', borderRadius: 8, padding: '1.25rem', cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '0.75rem', transition: 'border-color 0.15s, background 0.15s', outline: 'none', color: 'inherit' },
  avatar:     { width: 48, height: 48, borderRadius: '50%', background: '#2a1e0a', border: '2px solid #c9a84c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem', color: '#c9a84c', fontWeight: 700, flexShrink: 0 },
  identity:   { display: 'flex', flexDirection: 'column', gap: 2 },
  charName:   { color: '#e8e0d0', fontSize: '1.1rem', fontWeight: 700 },
  charMeta:   { color: '#a89060', fontSize: '0.82rem' },
  playerName: { color: '#666', fontSize: '0.78rem', marginTop: 2 },
  hpSection:  { display: 'flex', flexDirection: 'column', gap: 4 },
  hpLabel:    { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  hpText:     { color: '#a89060', fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase' },
  hpNumbers:  { fontSize: '0.85rem', fontWeight: 600 },
  hpTrack:    { height: 6, background: '#0d0a05', borderRadius: 3, overflow: 'hidden', border: '1px solid #2a1a08' },
  hpFill:     { height: '100%', borderRadius: 3, transition: 'width 0.4s ease, background 0.4s ease' },
  selectHint: { color: '#c9a84c', fontSize: '0.8rem', fontWeight: 600, alignSelf: 'flex-end', marginTop: 'auto' },
  center:     { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 48px)', gap: '0.5rem' },
  hint:       { color: '#a89060', fontSize: '1rem' },
  subHint:    { color: '#666', fontSize: '0.85rem' },
}
