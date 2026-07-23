import { useState } from 'react'
import MonsterBrowser        from '../components/compendium/MonsterBrowser'
import SpellBrowser          from '../components/compendium/SpellBrowser'
import EquipmentBrowser      from '../components/compendium/EquipmentBrowser'
import CustomBrowser         from '../components/compendium/CustomBrowser'
import SourceBookImportModal from '../components/compendium/SourceBookImportModal'
import BulkImportModal       from '../components/compendium/BulkImportModal'

const TABS = [
  { key: 'monsters',  label: '🐉 Monsters',  importType: 'monster'   },
  { key: 'spells',    label: '✨ Spells',     importType: 'spell'     },
  { key: 'equipment', label: '⚔ Equipment',  importType: 'equipment' },
  { key: 'custom',    label: '📜 Custom',     importType: null        },
]

export default function Compendium() {
  const [activeTab,   setActiveTab]   = useState('monsters')
  const [showImport,  setShowImport]  = useState(false)
  const [showBulk,    setShowBulk]    = useState(false)
  const [importKey,   setImportKey]   = useState(0)
  const [bulkKey,     setBulkKey]     = useState(0)

  const activeTabDef = TABS.find(t => t.key === activeTab)
  const canImport    = activeTabDef?.importType != null

  const openImport = () => { setImportKey(k => k + 1); setShowImport(true) }
  const openBulk   = () => { setBulkKey(k => k + 1);   setShowBulk(true)  }

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
        {canImport && (
          <div style={s.importBtns}>
            <button style={s.importBtn} onClick={openImport}>
              📥 Single Import
            </button>
            <button style={s.importBtn} onClick={openBulk}>
              📦 Bulk Import
            </button>
          </div>
        )}
      </div>

      {/* Content area */}
      <div style={s.content}>
        {activeTab === 'monsters'  && <MonsterBrowser />}
        {activeTab === 'spells'    && <SpellBrowser />}
        {activeTab === 'equipment' && <EquipmentBrowser />}
        {activeTab === 'custom'    && <CustomBrowser />}
      </div>

      {showImport && (
        <SourceBookImportModal
          key={importKey}
          initialType={activeTabDef.importType}
          onClose={() => setShowImport(false)}
          onImported={() => {}}
        />
      )}

      {showBulk && (
        <BulkImportModal
          key={bulkKey}
          initialType={activeTabDef.importType}
          onClose={() => setShowBulk(false)}
          onImported={() => {}}
        />
      )}
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
  tabs:    { display: 'flex', gap: '0.25rem', flex: 1 },
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
  importBtns: { display: 'flex', gap: 6, flexShrink: 0 },
  importBtn: {
    padding: '0.35rem 0.9rem', background: 'transparent',
    border: '1px solid #3a2a10', borderRadius: 4,
    color: '#a89060', cursor: 'pointer', fontSize: '0.8rem',
    whiteSpace: 'nowrap', transition: 'all 0.15s',
  },
  content: { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
}
