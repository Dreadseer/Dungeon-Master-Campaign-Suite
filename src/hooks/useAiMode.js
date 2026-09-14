import { useState, useEffect } from 'react'

// One place that knows the AI mode, and keeps knowing it (Phase 6.1 task 9).
//
// Every AI surface used to call ai.getMode() once in its own useEffect and then
// hold that value forever. Saving a key, or Ollama coming up, changed the mode
// in the main process and nothing in the UI noticed until a restart — which is
// half of the bug this phase exists to fix.
//
// This hook reads the mode once and then subscribes to ai:modeChanged, so every
// component using it flips together the moment detection re-runs.
//
// It also carries the DETECTION, so a component can say *why* rather than only
// that AI is unavailable.

/** The shape components get before the first read resolves. */
const UNKNOWN = { mode: null, detection: null }

export default function useAiMode() {
  const [state, setState] = useState(UNKNOWN)

  useEffect(() => {
    let cancelled = false

    // ai:getMode resolves to an OBJECT — { mode }. Comparing the object to a
    // string is the bug the capability review found, twice.
    Promise.all([
      window.electronAPI.ai.getMode(),
      window.electronAPI.ai.getDetection(),
    ])
      .then(([m, detection]) => {
        if (!cancelled) setState({ mode: m?.mode ?? null, detection })
      })
      .catch(() => {
        // A failure here must not leave a component enabled with nothing behind
        // it; treat an unreadable mode as no-ai.
        if (!cancelled) setState({ mode: 'no-ai', detection: null })
      })

    const unsubscribe = window.electronAPI.ai.onModeChanged(({ mode, detection }) => {
      if (!cancelled) setState({ mode: mode ?? null, detection })
    })

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  return {
    mode: state.mode,
    detection: state.detection,
    // null means "still checking" — a component should not render its AI
    // controls as available OR unavailable until it knows.
    checking: state.mode === null,
    noAi: state.mode === 'no-ai',
    ready: state.mode === 'online' || state.mode === 'offline-ollama',
  }
}
