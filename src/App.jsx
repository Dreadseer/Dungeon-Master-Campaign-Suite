import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Sidebar        from './components/Sidebar'
import TopBar         from './components/TopBar'
import SrdLoader      from './components/SrdLoader'
import CampaignGuard  from './components/CampaignGuard'

import CampaignManager  from './pages/CampaignManager'
import WorldBuilder     from './pages/WorldBuilder'
import LoreConnections  from './pages/LoreConnections'
import MindMap          from './pages/MindMap'
import MapEngine        from './pages/MapEngine'
import Compendium       from './pages/Compendium'
import CharacterSheets  from './pages/CharacterSheets'
import EncounterBuilder from './pages/EncounterBuilder'
import CombatCalculator from './pages/CombatCalculator'
import AIAssistant      from './pages/AIAssistant'
import Settings         from './pages/Settings'

// Phase 2 — World Builder pages
import Factions    from './pages/world/Factions'
import Locations   from './pages/world/Locations'
import NPCs        from './pages/world/NPCs'
import Lore        from './pages/world/Lore'
import Connections from './pages/world/Connections'

function Guarded({ children }) {
  return <CampaignGuard>{children}</CampaignGuard>
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <SrdLoader />
      <TopBar />
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

            <Route path="/lore"       element={<Guarded><LoreConnections /></Guarded>} />
            <Route path="/mindmap"    element={<Guarded><MindMap /></Guarded>} />
            <Route path="/maps"       element={<Guarded><MapEngine /></Guarded>} />
            <Route path="/characters" element={<Guarded><CharacterSheets /></Guarded>} />
            <Route path="/encounters" element={<Guarded><EncounterBuilder /></Guarded>} />
            <Route path="/calculator" element={<Guarded><CombatCalculator /></Guarded>} />
            <Route path="/compendium" element={<Compendium />} />
            <Route path="/ai"         element={<AIAssistant />} />
            <Route path="/settings"   element={<Settings />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
