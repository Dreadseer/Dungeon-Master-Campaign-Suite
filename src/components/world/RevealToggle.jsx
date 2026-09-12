import { useState, useEffect, useCallback } from 'react'
import { notifyError, notifySuccess } from '../../stores/toastStore'

// Marks an entity as something the party has actually been told.
//
// The distinction this draws is the one every DM keeps in their head and no
// tool has kept for them: `is_secret` means "DM-only, do not show a player",
// while a reveal means "the party has learned this". They are independent — a
// thing can be secret and unrevealed (most things), public and unrevealed (not
// yet come up), or revealed. Revealing something marked secret is possible but
// asks first, because it is the one direction that cannot be quietly undone at
// the table: the players have already heard it.
//
// Reveals are recorded against the current session when there is one, so
// "what did the party learn in session 7" answers itself.

export default function RevealToggle({
  campaignId,
  entityType,          // 'lore' | 'npc' | 'location' | 'faction'
  entityId,
  entityName,
  isSecret = false,
  sessionId = null,    // current session, stamped onto the reveal
  onChange,
  compact = false,
}) {
  const [revealed, setRevealed] = useState(null)   // null = still loading
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (!entityId) return
    try {
      const { revealed: isRevealed } = await window.electronAPI.db.reveals.isRevealed(entityType, entityId)
      setRevealed(isRevealed)
    } catch (err) {
      notifyError(err, 'Check reveal status')
      setRevealed(false)
    }
  }, [entityType, entityId])

  useEffect(() => { refresh() }, [refresh])

  const toggle = useCallback(async (e) => {
    // These live inside clickable cards; without this the card's own onClick
    // opens an editor every time the toggle is used.
    e?.stopPropagation?.()
    if (busy || revealed === null) return

    if (!revealed && isSecret) {
      const ok = window.confirm(
        `"${entityName}" is marked DM-only. Revealing it records that the party now knows it.\n\n` +
        `That is not something you can take back at the table. Continue?`
      )
      if (!ok) return
    }

    setBusy(true)
    try {
      if (revealed) {
        await window.electronAPI.db.reveals.unreveal(entityType, entityId)
        setRevealed(false)
        notifySuccess(`"${entityName}" is hidden from players again.`)
      } else {
        await window.electronAPI.db.reveals.reveal(campaignId, entityType, entityId, sessionId)
        setRevealed(true)
        notifySuccess(sessionId
          ? `"${entityName}" revealed, and logged to this session.`
          : `"${entityName}" revealed to the party.`)
      }
      onChange?.()
    } catch (err) {
      notifyError(err, revealed ? 'Hide from players' : 'Reveal to players')
      // Re-read rather than assuming the optimistic value was wrong in a
      // particular direction.
      refresh()
    } finally {
      setBusy(false)
    }
  }, [busy, revealed, isSecret, entityName, entityType, entityId, campaignId, sessionId, onChange, refresh])

  if (revealed === null) return <span style={s.loading}>·</span>

  return (
    <button
      style={{
        ...(compact ? s.compact : s.button),
        ...(revealed ? s.on : s.off),
        opacity: busy ? 0.5 : 1,
      }}
      onClick={toggle}
      disabled={busy}
      title={revealed
        ? 'The party knows this. Click to hide it from players again.'
        : isSecret
          ? 'DM-only. Click to reveal it to the party.'
          : 'Click to record that the party has learned this.'}
    >
      {revealed ? '👁 Revealed' : compact ? '👁' : '👁 Reveal'}
    </button>
  )
}

/** Read-only badge for lists that should show state without offering the action. */
export function RevealedBadge({ revealed }) {
  if (!revealed) return null
  return <span style={{ ...s.badge }}>👁 Known to party</span>
}

const s = {
  button:  { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', padding: '3px 9px', borderRadius: 10, border: '1px solid', cursor: 'pointer', background: 'none' },
  compact: { display: 'inline-flex', alignItems: 'center', fontSize: '0.72rem', padding: '2px 6px', borderRadius: 8, border: '1px solid', cursor: 'pointer', background: 'none' },
  on:      { color: '#5ba85b', borderColor: '#5ba85b' },
  off:     { color: '#6b5a3a', borderColor: '#3a2a10' },
  loading: { color: '#3a2a10', fontSize: '0.72rem', padding: '0 8px' },
  badge:   { fontSize: '0.68rem', color: '#5ba85b', border: '1px solid #2d5a2d', background: '#0d1f0d', borderRadius: 8, padding: '1px 7px' },
}
