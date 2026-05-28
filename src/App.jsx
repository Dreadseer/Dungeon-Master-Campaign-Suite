import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'

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

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <TopBar />
      <div className="app-layout">
        <Sidebar />
        <main className="main-content">
          <Routes>
            <Route index              element={<CampaignManager />} />
            <Route path="/world"      element={<WorldBuilder />} />
            <Route path="/lore"       element={<LoreConnections />} />
            <Route path="/mindmap"    element={<MindMap />} />
            <Route path="/maps"       element={<MapEngine />} />
            <Route path="/compendium" element={<Compendium />} />
            <Route path="/characters" element={<CharacterSheets />} />
            <Route path="/encounters" element={<EncounterBuilder />} />
            <Route path="/calculator" element={<CombatCalculator />} />
            <Route path="/ai"         element={<AIAssistant />} />
            <Route path="/settings"   element={<Settings />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
