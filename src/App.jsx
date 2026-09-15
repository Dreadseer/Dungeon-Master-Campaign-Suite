import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'
import Sidebar            from './components/Sidebar'
import TopBar             from './components/TopBar'
import SrdLoader          from './components/SrdLoader'
import CampaignGuard      from './components/CampaignGuard'
import PlayerApp          from './PlayerApp'
import DMPlayerControls   from './components/player/DMPlayerControls'
import Toasts            from './components/ui/Toasts'
import usePlayerStore     from './stores/playerStore'

import CampaignManager  from './pages/CampaignManager'
import WorldBuilder     from './pages/WorldBuilder'
import MindMap          from './pages/MindMap'
import MapEngine        from './pages/MapEngine'
import Compendium       from './pages/Compendium'
import CharacterSheets  from './pages/CharacterSheets'
import EncounterBuilder from './pages/EncounterBuilder'
import CombatCalculator from './pages/CombatCalculator'
import AIAssistant      from './pages/AIAssistant'
import AISources        from './pages/AISources'
import Settings         from './pages/Settings'

// Phase 2 — World Builder pages
import Factions    from './pages/world/Factions'
import Locations   from './pages/world/Locations'
import NPCs        from './pages/world/NPCs'
import Lore        from './pages/world/Lore'
import Connections from './pages/world/Connections'
import Sessions    from './pages/world/Sessions'
import PlotThreads from './pages/world/PlotThreads'
import RandomTables from './pages/world/RandomTables'

function Guarded({ children }) {
  return <CampaignGuard>{children}</CampaignGuard>
}

// Inner app — has access to router context (useLocation requires being inside the Router)
function AppContent() {
  const location         = useLocation()
  const isPlayer         = location.pathname.startsWith('/player')
  const showPlayerPanel  = usePlayerStore(s => s.showPlayerPanel)
  const setShowPlayerPanel = usePlayerStore(s => s.setShowPlayerPanel)

  // ── Player view — standalone, no DM chrome ───────────────────────────────
  if (isPlayer) {
    return (
      <Routes>
        <Route path="/player" element={<PlayerApp />} />
      </Routes>
    )
  }

  // ── DM view — full chrome ─────────────────────────────────────────────────
  return (
    <>
      <SrdLoader />
      <TopBar />
      {/* DMPlayerControls panel — position:fixed overlay, toggled from TopBar */}
      {showPlayerPanel && (
        <DMPlayerControls onClose={() => setShowPlayerPanel(false)} />
      )}
      <Toasts />
      <div className="app-layout">
        <Sidebar />
        <main className="main-content">
          <Routes>
            <Route index              element={<CampaignManager />} />

            {/* World Builder routes */}
            <Route path="/world"            element={<Guarded><WorldBuilder /></Guarded>} />
            <Route path="/world/factions"   element={<Guarded><Factions /></Guarded>} />
            <Route path="/world/locations"  element={<Guarded><Locations /></Guarded>} />
            <Route path="/world/npcs"         element={<Guarded><NPCs /></Guarded>} />
            <Route path="/world/lore"         element={<Guarded><Lore /></Guarded>} />
            <Route path="/world/connections"  element={<Guarded><Connections /></Guarded>} />
            <Route path="/world/sessions"     element={<Guarded><Sessions /></Guarded>} />
            <Route path="/world/plots"        element={<Guarded><PlotThreads /></Guarded>} />
            <Route path="/world/tables"       element={<Guarded><RandomTables /></Guarded>} />

            <Route path="/mindmap"    element={<Guarded><MindMap /></Guarded>} />
            <Route path="/maps"       element={<Guarded><MapEngine /></Guarded>} />
            <Route path="/characters" element={<Guarded><CharacterSheets /></Guarded>} />
            <Route path="/encounters" element={<Guarded><EncounterBuilder /></Guarded>} />
            <Route path="/calculator" element={<Guarded><CombatCalculator /></Guarded>} />
            <Route path="/compendium" element={<Compendium />} />
            <Route path="/ai"         element={<AIAssistant />} />
            <Route path="/ai/sources" element={<Guarded><AISources /></Guarded>} />
            <Route path="/settings"   element={<Settings />} />
          </Routes>
        </main>
      </div>
    </>
  )
}

export default function App() {
  // HashRouter (not BrowserRouter): in a packaged Electron build the renderer is
  // loaded from disk via loadFile(), so there is no web server to resolve deep
  // paths like /player. Hash routing keeps the route in the URL fragment
  // (index.html#/player?campaign=1), which resolves correctly from file://.
  return (
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppContent />
    </HashRouter>
  )
}
