// Non-persisted store for player-view runtime state.
// Shared between TopBar, DMPlayerControls, and MapEngine.
import { create } from 'zustand'

const usePlayerStore = create((set) => ({
  showPlayerPanel:    false,
  playerWindowOpen:   false,
  autoSync:           false,

  setShowPlayerPanel:  (v) => set({ showPlayerPanel:  v }),
  setPlayerWindowOpen: (v) => set({ playerWindowOpen: v }),
  setAutoSync:         (v) => set({ autoSync:         v }),
}))

export default usePlayerStore
