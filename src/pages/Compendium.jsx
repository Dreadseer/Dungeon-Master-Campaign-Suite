import { useState } from 'react'
import MonsterBrowser   from '../components/compendium/MonsterBrowser'
import SpellBrowser     from '../components/compendium/SpellBrowser'
import EquipmentBrowser from '../components/compendium/EquipmentBrowser'

const TABS = [
  { key: 'monsters',  label: '🐉 Monsters'  },
  { key: 'spells',    label: '✨ Spells'     },
  { key: 'equipment', label: '⚔ Equipment'  },
  { key: 'custom',    label: '📜 Custom'     },
]

export default function Compendium() {
  const [activeTab, setActiveTab] = useState('monsters')

  return (
    <div style={s.page}>
      {/* Tab bar */}
      <div style={s.tabBar}>
        <div style={s.tabTitle}>Compendium</div>
        <div style={s.tabs}>
          {TABS.map(tab => (
            <button
              key={tab.key}
              style={activeTab === tab.key ? { ...s.tab, ...s.tabActive } : s.tab}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content area */}
      <div style={s.content}>
        {activeTab === 'monsters'  && <MonsterBrowser />}
        {activeTab === 'spells'    && <SpellBrowser />}
        {activeTab === 'equipment' && <EquipmentBrowser />}
        {activeTab === 'custom'    && (
          <div style={s.placeholder}>
            <p style={s.phIcon}>📜</p>
            <p style={s.phTitle}>Custom Compendium</p>
            <p style={s.phText}>Create homebrew items, spells, equipment, and monsters. Coming in Phase 4 Prompt 02.</p>
          </div>
        )}
      </div>
    </div>
  )
}

const s = {
  page:    { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', margin: '-2rem' },
  tabBar:  {
    display: 'flex', alignItems: 'center', gap: '1.5rem',
    padding: '0.6rem 1.5rem', background: '#0d0a05',
    borderBottom: '1px solid #2a1c08', flexShrink: 0,
  },
  tabTitle: { color: '#c9a84c', fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 600, whiteSpace: 'nowrap' },
  tabs:    { display: 'flex', gap: '0.25rem' },
  tab: {
    background: 'transparent', border: '1px solid transparent',
    borderRadius: '4px 4px 0 0', color: '#6b5a3a',
    padding: '0.35rem 1rem', cursor: 'pointer',
    fontSize: '0.85rem', fontFamily: 'Georgia, serif',
    transition: 'color 0.15s',
  },
  tabActive: {
    background: '#1a1208', border: '1px solid #2a1c08',
    borderBottom: '1px solid #1a1208', color: '#c9a84c', fontWeight: 600,
  },
  content:     { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  placeholder: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: '0.5rem' },
  phIcon:  { fontSize: '3rem', margin: 0 },
  phTitle: { color: '#c9a84c', fontFamily: 'Georgia, serif', fontSize: '1.2rem', margin: 0 },
  phText:  { color: '#6b5a3a', fontSize: '0.88rem', fontStyle: 'italic', margin: 0 },
}
